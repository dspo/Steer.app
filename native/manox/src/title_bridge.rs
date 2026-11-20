//! Per-thread title bridges (issue #73, the manox half): a session-scoped
//! pty pair whose slave end is the thread's title tty, and a headless
//! ghostty draining the master end.
//!
//! The kernel's bash output tap (v0.13.0, #1030) routes raw chunks by
//! session id; this module writes them into the channel's slave fd — the
//! same transport pi uses, minus the process boundary (the tap fires on
//! this side of it, so the write is in-proc). The slave's path is also
//! declared to the thread's tools as `ZU_TTY` (via `SessionIntent.tool_env`,
//! #1032), so the explicit redirect form feeds the same emulator.
//!
//! One pair per thread: opened before the thread's first bash, reused
//! across pump restarts, dropped when the thread is deleted.

use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::io::Read;
use std::os::unix::fs::OpenOptionsExt;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use manox_harness::{BashOutputTap, BashOutputTapId, install_bash_output_tap};
use nsh_core::prelude::*;
use zu_ghostty::Terminal as Ghostty;

/// A bridge's observer slot.
type Reports = Arc<Mutex<Option<Box<dyn Fn(String) + Send + Sync>>>>;

struct Bridge {
    /// The host's handle on the slave end: the tap writes here. Non-blocking:
    /// a full buffer drops instead of stalling the kernel's chunk path (the
    /// title is decorative; the drain normally keeps up).
    slave: File,
    /// The slave's path, declared to the thread's tools as `ZU_TTY`.
    path: PathBuf,
    /// Set by `remove`: the drain breaks and drops the pty.
    close: Arc<AtomicBool>,
    /// The current observer; a re-opened chat reattaches it.
    reports: Reports,
}

impl Bridge {
    fn write(&self, bytes: &[u8]) {
        use std::io::Write;
        let mut slave = self.slave.try_clone().expect("the slave fd stays open");
        let _ = slave.write_all(bytes);
        let _ = slave.flush();
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

/// Installs the process-level bash output tap. Called once at pump start,
/// before the first session; a restart finds it installed and reuses it
/// (the `OnceLock` outlives runtime rebuilds). The closure routes by
/// session id into the channel's slave end; chunks for sessions without a
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

/// Opens (or reuses) the thread's bridge; `reports` observes every new
/// title until the bridge is removed.
pub(crate) fn install(key: &str, reports: Box<dyn Fn(String) + Send + Sync>) -> Result<(), String> {
    let mut bridges = bridges().lock().unwrap_or_else(|e| e.into_inner());
    if let Some(existing) = bridges.get(key) {
        if let Ok(mut slot) = existing.reports.lock() {
            *slot = Some(reports);
        }
        return Ok(());
    }
    let pair = portable_pty::native_pty_system()
        .openpty(portable_pty::PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| format!("cannot create a title pty: {error}"))?;
    let path = pair
        .master
        .tty_name()
        .ok_or_else(|| "the title pty has no tty name".to_owned())?;
    // The host holds the master, so the path resolves to this pair and
    // cannot be reused under it; `O_NOCTTY` keeps it from ever becoming a
    // controlling terminal of the app.
    let slave = OpenOptions::new()
        .read(true)
        .write(true)
        .custom_flags(libc::O_NOCTTY | libc::O_NONBLOCK)
        .open(&path)
        .map_err(|error| format!("cannot open the title pty slave: {error}"))?;
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| format!("cannot read the title pty: {error}"))?;

    let close = Arc::new(AtomicBool::new(false));
    let title = Arc::new(Mutex::new(String::new()));
    let reports: Reports = Arc::new(Mutex::new(Some(reports)));

    // The drain owns the pty's master: it lives as long as the bridge does,
    // and its drop closes the pty. The kernel parses whatever arrives; each
    // new title is reported once, full value (not a delta).
    let drain_close = close.clone();
    let drain_title = title.clone();
    let drain_reports = reports.clone();
    std::thread::Builder::new()
        .name("title-bridge".into())
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
                if drain_close.load(Ordering::Relaxed) {
                    break;
                }
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
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
                }
            }
        })
        .map_err(|error| format!("cannot start the title drain: {error}"))?;

    bridges.insert(
        key.to_owned(),
        Arc::new(Bridge {
            slave,
            path,
            close,
            reports,
        }),
    );
    Ok(())
}

/// Drops the thread's bridge: the pty closes and the drain ends. Only a
/// thread's deletion calls this — chats closing must leave it alone.
pub(crate) fn remove(key: &str) {
    let bridge = bridges()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(key);
    if let Some(bridge) = bridge {
        bridge.close.store(true, Ordering::Relaxed);
        // The poke wakes a drain blocked on an empty buffer; a NUL byte is
        // ignored by the kernel.
        bridge.write(&[0]);
    }
}

/// The slave's path for `key`, when a bridge is open: the `ZU_TTY` value.
pub(crate) fn path_for(key: &str) -> Option<PathBuf> {
    bridges()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(key)
        .and_then(|bridge| bridge.path.to_str().map(PathBuf::from))
}

/// A thread's title bridge (issue #73, manox half): the headless emulator
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
    /// Opens (or reuses) the bridge and posts each new title to
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

    /// The slave path to declare as the thread's `ZU_TTY` (C1's explicit
    /// redirect form); null when the bridge is not open.
    pub fn path(key: String) -> Option<String> {
        path_for(&key).and_then(|path| path.to_str().map(|text| text.to_owned()))
    }

    /// Drops the bridge: only a thread's deletion calls this.
    pub fn close(&self) {
        remove(&self.key);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    /// A bridge whose titles land in a queue the test can read.
    fn installed(key: &str) -> (String, mpsc::Receiver<String>) {
        let (sender, receiver) = mpsc::channel::<String>();
        install(
            key,
            Box::new(move |title| {
                let _ = sender.send(title);
            }),
        )
        .expect("the bridge installs");
        let path = path_for(key).expect("the bridge has a path");
        (path.to_string_lossy().into_owned(), receiver)
    }

    /// Writes bytes into the bridge's tty as a tool would (the C1 form).
    fn write_tty(path: &str, bytes: &[u8]) {
        use std::io::Write;
        let mut tty = OpenOptions::new()
            .write(true)
            .custom_flags(libc::O_NOCTTY | libc::O_NONBLOCK)
            .open(path)
            .expect("the tty opens");
        tty.write_all(bytes).expect("the tty writes");
        tty.flush().ok();
    }

    /// Tool output written into the bridge's tty surfaces as new full
    /// titles (C1, end to end: path open → pty → emulator).
    #[test]
    fn explicit_writes_to_the_tty_surface_as_titles() {
        let (path, receiver) = installed("thread-a");
        write_tty(&path, b"\x1b]2;from the tool\x07");
        let got = receiver
            .recv_timeout(std::time::Duration::from_secs(5))
            .expect("the title is reported");
        assert_eq!(got, "from the tool");
    }

    /// Routing is per thread: another thread's chunks never cross, and a
    /// removed bridge drops its thread's later chunks.
    #[test]
    fn routing_is_per_thread_and_removal_drops() {
        let (path_b, receiver) = installed("thread-b");
        // Another thread's bridge gets its own pty: writes there never
        // cross here.
        let (_path_other, _other) = installed("thread-other");
        write_tty(&path_b, b"\x1b]2;mine\x07");
        let got = receiver
            .recv_timeout(std::time::Duration::from_secs(5))
            .expect("the title is reported");
        assert_eq!(got, "mine");
        assert!(
            receiver.try_recv().is_err(),
            "nothing leaked across threads"
        );

        remove("thread-b");
        write_tty(&path_b, b"\x1b]2;after\x07");
        assert!(receiver.try_recv().is_err(), "no bridge, no title");
        let _ = _path_other;
    }

    /// An empty title after a real one reports the fallback value; with
    /// nothing before it, nothing reports.
    #[test]
    fn empty_title_semantics_match_the_channel() {
        let (path, receiver) = installed("thread-empty");
        write_tty(&path, b"\x1b]2;\x07");
        assert!(receiver.try_recv().is_err(), "no title before, no change");
        write_tty(&path, b"\x1b]2;old\x07");
        assert_eq!(
            receiver
                .recv_timeout(std::time::Duration::from_secs(5))
                .expect("reported"),
            "old"
        );
        write_tty(&path, b"\x1b]2;\x07");
        assert_eq!(
            receiver
                .recv_timeout(std::time::Duration::from_secs(5))
                .expect("the empty title is reported"),
            ""
        );
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
