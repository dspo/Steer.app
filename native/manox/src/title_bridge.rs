//! Per-thread title channels (issue #73, the manox half): a session-scoped
//! FIFO under `$TMPDIR` whose write end is the thread's title tty, and a
//! headless ghostty draining the read end.
//!
//! The kernel's bash output tap (v0.13.0, #1030) routes raw chunks by
//! session id; this module writes them into the channel's write end. The
//! FIFO **path** is also declared to the thread's tools as `ZU_TTY` (via
//! `SessionIntent.tool_env`, #1032), so the explicit redirect form feeds
//! the same emulator. `$TMPDIR` is inside the seatbelt's writable roots,
//! so C1 works for sandboxed sessions too (a `/dev/ttys*` path would not:
//! ptys created outside the sandbox lack the pty extension).
//!
//! One FIFO per thread: opened before the thread's first bash, reused
//! across pump restarts, unlinked when the thread is deleted.
//!
//! The FIFO is not a tty — there is no termios — but the bytes reach the
//! same ghostty interpreter the pi channel uses, which is the isomorphism
//! the design requires.

use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::io::Read;
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

use manox_harness::{BashOutputTap, BashOutputTapId, install_bash_output_tap};
use nsh_core::prelude::*;
use zu_ghostty::Terminal as Ghostty;

/// A bridge's observer slot.
type Reports = Arc<Mutex<Option<Box<dyn Fn(String) + Send + Sync>>>>;

struct Bridge {
    /// The FIFO's write end: the tap feed (in-proc, non-blocking — a full
    /// buffer drops the rest instead of stalling the kernel's chunk path;
    /// the title is decorative and the drain normally keeps up).
    write: File,
    /// The FIFO's path, declared to the thread's tools as `ZU_TTY`.
    path: PathBuf,
    /// The current observer; a re-opened chat reattaches it.
    reports: Reports,
}

impl Bridge {
    /// Writes bytes into the channel as the tap delivered them.
    fn write(&self, bytes: &[u8]) {
        use std::io::Write;
        if let Ok(mut writer) = self.write.try_clone() {
            let _ = writer.write_all(bytes);
            let _ = writer.flush();
        }
    }

    /// The FIFO path for `key`, when a bridge is open.
    fn path_of(&self) -> &Path {
        &self.path
    }
}

fn bridges() -> &'static Mutex<HashMap<String, Arc<Bridge>>> {
    static BRIDGES: OnceLock<Mutex<HashMap<String, Arc<Bridge>>>> = OnceLock::new();
    BRIDGES.get_or_init(|| Mutex::new(HashMap::new()))
}

fn report_new(reports: &Reports, title: &str) {
    if let Ok(slot) = reports.lock()
        && let Some(report) = slot.as_ref()
    {
        report(title.to_owned());
    }
}

/// The FIFO path for one thread: `$TMPDIR/zu-title-{key}.fifo`. The thread
/// id is a minted uuid, so paths do not collide across runs; a stale FIFO
/// from a crashed run is replaced.
fn fifo_path(key: &str) -> Result<PathBuf, String> {
    // The key is a path component: only uuid-safe characters are accepted
    // so no caller (today's app, tomorrow's) can traverse out of the
    // directory.
    if key.is_empty() || !key.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err(format!(
            "invalid title channel key {key:?}: only [A-Za-z0-9-] is accepted"
        ));
    }
    Ok(std::env::temp_dir().join(format!("zu-title-{key}.fifo")))
}

/// Installs the process-level bash output tap. Called once at pump start,
/// before the first session; a restart finds it installed and reuses it
/// (the `OnceLock` outlives runtime rebuilds). The closure routes by
/// session id into the channel's write end; chunks for sessions without a
/// bridge are dropped (decorative).
pub(crate) fn ensure_tap_installed() -> Result<(), String> {
    let tap: BashOutputTap = Arc::new(|id: BashOutputTapId, bytes: &[u8]| {
        let Some(key) = id.session_id else {
            return;
        };
        let bridge = bridges()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(&key)
            .cloned();
        if let Some(bridge) = bridge {
            bridge.write(bytes);
        }
    });
    match install_bash_output_tap(tap) {
        Ok(()) => Ok(()),
        Err(error @ manox_harness::InstallError::AlreadyInstalled) => {
            tracing::debug!(%error, "bash output tap already installed: restart reuse");
            Ok(())
        }
    }
}

/// Opens (or reuses) the thread's channel; `reports` observes every new
/// title until the channel is removed.
pub(crate) fn install(key: &str, reports: Box<dyn Fn(String) + Send + Sync>) -> Result<(), String> {
    let mut bridges = bridges().lock().unwrap_or_else(|e| e.into_inner());
    if let Some(existing) = bridges.get(key) {
        if let Ok(mut slot) = existing.reports.lock() {
            *slot = Some(reports);
        }
        return Ok(());
    }
    let path = fifo_path(key)?;
    // A stale FIFO from a crashed run is replaced: the old drain died with
    // that run, and its write end is gone.
    let _ = std::fs::remove_file(&path);
    let c_path = match std::ffi::CString::new(path.as_os_str().as_encoded_bytes()) {
        Ok(c_path) => c_path,
        Err(error) => return Err(format!("the fifo path is not a C string: {error}")),
    };
    // SAFETY: `mkfifo` with a valid C path — no shared state.
    if unsafe { libc::mkfifo(c_path.as_ptr(), 0o600) } != 0 {
        let detail = std::io::Error::last_os_error();
        return Err(format!("mkfifo {path:?} failed: {detail}"));
    }
    // The read end opens first and stays: every later write end (the tap's
    // and the tools' C1 opens) succeeds without blocking.
    let mut read = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NONBLOCK)
        .open(&path)
        .map_err(|error| format!("cannot open the title fifo: {error}"))?;
    let write = OpenOptions::new()
        .write(true)
        .custom_flags(libc::O_NONBLOCK)
        .open(&path)
        .map_err(|error| format!("cannot open the title fifo writer: {error}"))?;

    let title: Arc<Mutex<String>> = Arc::new(Mutex::new(String::new()));
    let reports: Reports = Arc::new(Mutex::new(Some(reports)));

    // The drain owns the FIFO's read end: it lives as long as the channel
    // does, and its drop closes the read end (all writers see EOF). The
    // kernel parses whatever arrives; each new title is reported once, full
    // value (not a delta).
    let drain_title = title.clone();
    let drain_reports = reports.clone();
    std::thread::Builder::new()
        .name("title-channel".into())
        .spawn(move || {
            let Ok(term) = Ghostty::new(80, 24) else {
                return;
            };
            // The emulator is a title interpreter, not a display: no
            // scrollback to keep, and no write pty — query answers have
            // nowhere to go and are dropped.
            term.set_scrollback_lines(0);
            let mut buf = vec![0u8; 16 * 1024];
            loop {
                match read.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        term.write(&buf[..n]);
                        if let Some(t) = term.title() {
                            let mut current = drain_title.lock().unwrap_or_else(|e| e.into_inner());
                            if *current != t {
                                report_new(&drain_reports, &t);
                                *current = t;
                            }
                        }
                    }
                    // Non-blocking read with no writers yet: wait briefly.
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(std::time::Duration::from_millis(20));
                    }
                    Err(_) => break,
                }
            }
        })
        .map_err(|error| format!("cannot start the title drain: {error}"))?;

    bridges.insert(
        key.to_owned(),
        Arc::new(Bridge {
            write,
            path,
            reports,
        }),
    );
    Ok(())
}

/// Drops the thread's channel: the path is unlinked (later C1 opens fail
/// with ENOENT) and the write end closes (the drain sees EOF and ends).
/// Only a thread's deletion calls this — chats closing must leave it
/// alone.
pub(crate) fn remove(key: &str) {
    let bridge = bridges()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(key);
    if let Some(bridge) = bridge {
        let _ = std::fs::remove_file(&bridge.path);
        // Dropping `bridge` closes the write end: the drain sees EOF.
    }
}

/// The FIFO path for `key`, when a channel is open: the `ZU_TTY` value.
pub(crate) fn path_for(key: &str) -> Option<PathBuf> {
    bridges()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(key)
        .map(|bridge| bridge.path_of().to_path_buf())
}

/// A thread's title channel (issue #73, manox half): the headless emulator
/// the kernel's bash tap feeds, with its own title tty (`ZU_TTY`). Open it
/// with the thread id before the thread's first turn; drop it only when
/// the thread is deleted (`close`) — chats closing and pump restarts reuse
/// it instead.
#[class]
pub struct TitleBridge {
    key: String,
}

#[class]
impl TitleBridge {
    /// Opens (or reuses) the channel and posts each new title to
    /// `on_title`, on the engine thread.
    pub fn open(
        key: String,
        #[args(event)] on_title: Callback<String>,
        cx: CallCx<'_>,
    ) -> Result<TitleBridge, String> {
        let (titles, mut received) = tokio::sync::mpsc::unbounded_channel();
        install(
            &key,
            Box::new(move |title| {
                let _ = titles.send(title);
            }),
        )?;
        cx.start(async move {
            while let Some(title) = received.recv().await {
                on_title.post(title);
            }
        });
        Ok(TitleBridge { key })
    }

    /// The channel's FIFO path to declare as the thread's `ZU_TTY` (C1's
    /// explicit redirect form); null when the channel is not open.
    pub fn tty_path(key: String) -> Option<String> {
        path_for(&key).and_then(|path| path.to_str().map(|text| text.to_owned()))
    }

    /// Drops the channel: only a thread's deletion calls this.
    pub fn close(&self) {
        remove(&self.key);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    /// A channel whose titles land in a queue the test can read.
    fn installed(key: &str) -> (PathBuf, mpsc::Receiver<String>) {
        let (sender, receiver) = mpsc::channel::<String>();
        install(
            key,
            Box::new(move |title| {
                let _ = sender.send(title);
            }),
        )
        .expect("the channel installs");
        (path_for(key).expect("the channel has a path"), receiver)
    }

    /// Feeds bytes through the channel's write end, as the kernel tap
    /// would (C2).
    fn feed(key: &str, bytes: &[u8]) {
        let bridge = bridges()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(key)
            .cloned();
        if let Some(bridge) = bridge {
            bridge.write(bytes);
        }
    }

    /// C1, end to end: a tool opens the declared `ZU_TTY` path and writes
    /// an OSC title — it surfaces through the emulator.
    #[test]
    fn c1_explicit_writes_to_the_fifo_surface_as_titles() {
        let (path, receiver) = installed("thread-a");
        let mut tty = OpenOptions::new()
            .write(true)
            .custom_flags(libc::O_NONBLOCK)
            .open(&path)
            .expect("the tty opens for the tool");
        use std::io::Write;
        tty.write_all(b"\x1b]2;from the tool\x07")
            .expect("the tty writes");
        drop(tty);
        let got = receiver
            .recv_timeout(std::time::Duration::from_secs(5))
            .expect("the title is reported");
        assert_eq!(got, "from the tool");
    }

    /// C2: the kernel tap's in-proc write surfaces the same way.
    #[test]
    fn tap_write_surfaces_as_titles() {
        let (_path, receiver) = installed("thread-tap");
        feed("thread-tap", b"\x1b]2;from the tap\x07");
        let got = receiver
            .recv_timeout(std::time::Duration::from_secs(5))
            .expect("the title is reported");
        assert_eq!(got, "from the tap");
    }

    /// Routing is per thread; removal unlinks the path (later C1 opens
    /// fail with ENOENT) and drops the tap feed.
    #[test]
    fn routing_is_per_thread_and_removal_drops() {
        let (path_b, receiver) = installed("thread-b");
        let (_other, other_receiver) = installed("thread-other");
        feed("thread-other", b"\x1b]2;elsewhere\x07");
        feed("thread-b", b"\x1b]2;mine\x07");
        let got = receiver
            .recv_timeout(std::time::Duration::from_secs(5))
            .expect("the title is reported");
        assert_eq!(got, "mine");
        // Each thread's own observer saw exactly its own title — nothing
        // crossed.
        assert!(receiver.try_recv().is_err(), "thread-b has no second title");
        assert_eq!(
            other_receiver.try_recv().expect("its own title"),
            "elsewhere"
        );
        assert!(
            other_receiver.try_recv().is_err(),
            "thread-other has no second title"
        );

        remove("thread-b");
        // The path is gone: a later C1 open fails instead of writing into
        // a dead channel.
        assert!(
            OpenOptions::new()
                .write(true)
                .custom_flags(libc::O_NONBLOCK)
                .open(&path_b)
                .is_err(),
            "the fifo path must be unlinked on removal"
        );
        feed("thread-b", b"\x1b]2;after\x07");
        assert!(receiver.try_recv().is_err(), "no bridge, no title");
    }

    /// An empty title after a real one reports the fallback value; with
    /// nothing before it, nothing reports.
    #[test]
    fn empty_title_semantics_match_the_channel() {
        let (_path, receiver) = installed("thread-empty");
        feed("thread-empty", b"\x1b]2;\x07");
        assert!(receiver.try_recv().is_err(), "no title before, no change");
        feed("thread-empty", b"\x1b]2;old\x07");
        assert_eq!(
            receiver
                .recv_timeout(std::time::Duration::from_secs(5))
                .expect("reported"),
            "old"
        );
        feed("thread-empty", b"\x1b]2;\x07");
        assert_eq!(
            receiver
                .recv_timeout(std::time::Duration::from_secs(5))
                .expect("the empty title is reported"),
            ""
        );
    }

    /// 100 MB through the channel: the overflow is dropped by design
    /// (Q125), the drain survives, and a title written after the flood
    /// still reports.
    #[test]
    fn a_flood_drops_but_the_channel_survives() {
        let (_path, receiver) = installed("thread-flood");
        let chunk = vec![b'x'; 1024 * 1024];
        let started = std::time::Instant::now();
        for _ in 0..100 {
            feed("thread-flood", &chunk);
        }
        std::thread::sleep(std::time::Duration::from_millis(300));
        feed("thread-flood", b"\x1b]2;after the flood\x07");
        let got = receiver
            .recv_timeout(std::time::Duration::from_secs(30))
            .expect("the title is reported");
        println!(
            "FLOOD: 100 MB fed in {}ms; title reported",
            started.elapsed().as_millis()
        );
        assert_eq!(got, "after the flood");
    }

    /// The channel key names a file under `$TMPDIR`: traversal and empty
    /// keys are refused at install.
    #[test]
    fn invalid_keys_are_refused() {
        for key in ["", "../escape", "a/b", "a b"] {
            let error = install(key, Box::new(|_| {})).expect_err("an unsafe key must be refused");
            assert!(
                error.contains("invalid title channel key"),
                "unexpected error: {error}"
            );
            assert!(path_for(key).is_none());
        }
        // A safe key still installs.
        install("safe-key-1", Box::new(|_| {})).expect("a safe key installs");
        assert!(path_for("safe-key-1").is_some());
    }

    /// The process tap is installed exactly once; a second install is
    /// refused loudly (`AlreadyInstalled`), and restarts reuse it.
    #[test]
    fn the_tap_is_a_process_singleton() {
        // Either this is the first install (Ok — and any further install
        // must be refused), or a tap already exists (Err). The invariant:
        // at most one tap per process, and it is never replaced.
        let first = install_bash_output_tap(Arc::new(|_id: BashOutputTapId, _bytes: &[u8]| {}));
        if first.is_ok() {
            let second =
                install_bash_output_tap(Arc::new(|_id: BashOutputTapId, _bytes: &[u8]| {}));
            assert!(second.is_err(), "a second install must be refused");
        } else {
            assert!(matches!(
                first,
                Err(manox_harness::InstallError::AlreadyInstalled)
            ));
        }
    }
}
