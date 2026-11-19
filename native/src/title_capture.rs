//! Per-session title channels (issue #73): a headless ghostty terminal fed
//! by the harness's raw Bash output.
//!
//! A hosted session's Bash tool runs on a pipe — its raw stdout (escape
//! sequences included) never reaches a real terminal. The host hands the
//! harness the slave end of a session-scoped pty pair (fd inherited via
//! `pre_exec` in acp.rs, `ZU_TITLE_FD` naming the number) and drains the
//! master end through this module's emulator: the kernel is the only
//! interpreter, and whatever the tool wrote (OSC 0/2) surfaces as a title.
//!
//! One pair per session: created before the first spawn, reused across
//! harness restarts, dropped when the session is deleted. A channel is
//! keyed by the host's session identity, which is also `AcpOptions`'s
//! `title_channel` — the glue between the two native classes.

use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::io::Read;
use std::os::unix::fs::OpenOptionsExt;
use std::os::unix::io::AsRawFd;
use std::os::unix::process::CommandExt;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use nsh_core::prelude::*;
use zu_ghostty::Terminal as Ghostty;

/// The fd number the channel's slave end is dup'd to inside the harness
/// (acp.rs's `pre_exec`). 0-2 are the ACP stdio pipes; nothing else is
/// open at exec time.
pub(crate) const TITLE_FD: i32 = 3;

/// The env var naming that fd for the harness.
pub(crate) const TITLE_FD_ENV: &str = "ZU_TITLE_FD";

/// How large the drain reads are; a title is short, chunks are not.
const READ_CHUNK: usize = 16 * 1024;

/// A channel's observer slot.
type Reports = Arc<Mutex<Option<Box<dyn Fn(String) + Send + Sync>>>>;

/// The registry's half of a channel: everything the host needs to dup, to
/// poke the drain awake on removal, and to observe titles. `Sync` by
/// construction — the pty's master lives in the drain thread instead.
struct Channel {
    /// The host's own handle on the slave end: `dup2`'s source, and the
    /// removal-time poke that wakes the drain. Non-blocking: a full buffer
    /// must stall the tool or the harness's event loop, so the tap drops
    /// instead (the title is decorative).
    slave: File,
    /// The slave's path, declared to the harness as `ZU_TTY`.
    path: std::path::PathBuf,
    /// Set by `remove`: the drain breaks and drops the pty.
    close: Arc<AtomicBool>,
    /// The current observer; a re-opened sheet reattaches it.
    reports: Reports,
}

impl Channel {
    fn open(reports: Box<dyn Fn(String) + Send + Sync>) -> Result<Channel, String> {
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
        // cannot be reused under it; `O_NOCTTY` keeps it from ever becoming
        // a controlling terminal of the app.
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

        // The drain owns the pty's master: it lives as long as the channel
        // does, and its drop closes the pty. The kernel parses whatever
        // arrives; each new title is reported once, full value (not a
        // delta).
        let drain_close = close.clone();
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
                let mut buf = vec![0u8; READ_CHUNK];
                loop {
                    if drain_close.load(Ordering::Relaxed) {
                        break;
                    }
                    match reader.read(&mut buf) {
                        Ok(0) | Err(_) => break,
                        Ok(n) => {
                            term.write(&buf[..n]);
                            if let Some(t) = term.title() {
                                let mut current =
                                    drain_title.lock().unwrap_or_else(|e| e.into_inner());
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

        Ok(Channel {
            slave,
            path,
            close,
            reports,
        })
    }

    /// Writes bytes into the channel as if the harness had: the tests' way
    /// to drive the emulator without a spawned harness.
    #[cfg(test)]
    fn write(&self, bytes: &[u8]) -> std::io::Result<()> {
        use std::io::Write;
        let mut slave = self.slave.try_clone()?;
        slave.write_all(bytes)?;
        slave.flush()
    }

    /// The slave fd the harness's `pre_exec` dups to `TITLE_FD`.
    fn fd(&self) -> i32 {
        self.slave.as_raw_fd()
    }

    /// Closes the pty: the drain wakes from its blocked read (a NUL pokes
    /// the slave — ignored by the kernel) and its thread drops the master.
    fn close_poke(&self) {
        self.close.store(true, Ordering::Relaxed);
        if let Ok(mut slave) = self.slave.try_clone() {
            use std::io::Write;
            let _ = slave.write_all(&[0]);
            let _ = slave.flush();
        }
    }
}

/// Reports a new title through the channel's current observer.
fn report_new(reports: &Reports, title: &str) {
    if let Ok(slot) = reports.lock()
        && let Some(report) = slot.as_ref()
    {
        report(title.to_owned());
    }
}

fn channels() -> &'static Mutex<HashMap<String, Arc<Channel>>> {
    static CHANNELS: OnceLock<Mutex<HashMap<String, Arc<Channel>>>> = OnceLock::new();
    CHANNELS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Opens (or reuses) the session's channel; `reports` observes every new
/// title until the channel is removed. Reuse across harness restarts also
/// reattaches the observer.
pub(crate) fn install(key: &str, reports: Box<dyn Fn(String) + Send + Sync>) -> Result<(), String> {
    let mut channels = channels().lock().unwrap_or_else(|e| e.into_inner());
    if let Some(existing) = channels.get(key) {
        if let Ok(mut slot) = existing.reports.lock() {
            *slot = Some(reports);
        }
        return Ok(());
    }
    channels.insert(key.to_owned(), Arc::new(Channel::open(reports)?));
    Ok(())
}

/// Drops the channel: the pty closes and the drain ends. Only a session's
/// deletion calls this — sheets closing must leave the store alone.
pub(crate) fn remove(key: &str) {
    let channel = channels()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(key);
    if let Some(channel) = channel {
        channel.close_poke();
    }
}

/// The slave fd to inherit for `key`, when a channel is open.
#[cfg(test)]
pub(crate) fn fd_for(key: &str) -> Option<i32> {
    channels()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(key)
        .map(|channel| channel.fd())
}

/// Wires a harness spawn to the channel: `ZU_TITLE_FD` in the env and the
/// `pre_exec` that dups the slave fd onto `TITLE_FD`. A missing channel is
/// not an error — tools simply write nowhere.
pub(crate) fn wire(key: &str, builder: &mut std::process::Command) {
    let Some(channel) = channels()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(key)
        .map(|channel| (channel.fd(), channel.path.clone()))
    else {
        return;
    };
    let (fd, path) = channel;
    builder.env(TITLE_FD_ENV, TITLE_FD.to_string());
    if let Some(text) = path.to_str() {
        builder.env("ZU_TTY", text);
    }
    #[cfg(unix)]
    // SAFETY: `dup2` in the forked child, before exec — no shared state.
    unsafe {
        builder.pre_exec(move || {
            if libc::dup2(fd, TITLE_FD) == -1 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
}

/// A session's title channel (issue #73): the headless emulator the
/// harness's raw Bash output feeds. Open it with the same key as
/// `AcpOptions.title_channel` before `Acp.start`; drop it only when the
/// session is deleted (`close`) — sheets closing must leave it alone.
#[class]
pub struct TitleCapture {
    key: String,
}

#[class]
impl TitleCapture {
    /// Opens (or reuses) the channel and posts each new title to
    /// `on_title`, on the engine thread.
    pub fn open(
        key: String,
        #[args(event)] on_title: Callback<String>,
        cx: CallCx<'_>,
    ) -> Result<TitleCapture, String> {
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
        Ok(TitleCapture { key })
    }

    /// Drops the channel: only a session's deletion calls this. Sheets
    /// closing and harness restarts reuse the channel instead.
    pub fn close(&self) {
        remove(&self.key);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    /// A channel whose titles land in a queue the test can read.
    fn installed(key: &str) -> mpsc::Receiver<String> {
        let (sender, receiver) = mpsc::channel::<String>();
        install(
            key,
            Box::new(move |title| {
                let _ = sender.send(title);
            }),
        )
        .expect("the channel installs");
        receiver
    }

    /// Titles written into the slave end surface as new full values.
    #[test]
    fn titles_written_to_the_slave_surface_to_the_observer() {
        let receiver = installed("test-basic");
        let channel = channels()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get("test-basic")
            .expect("the channel is registered")
            .clone();
        channel
            .write(b"\x1b]2;from the tool\x07")
            .expect("the slave writes");
        let got = receiver
            .recv_timeout(std::time::Duration::from_secs(5))
            .expect("the title is reported");
        assert_eq!(got, "from the tool");
    }

    /// The harness side: a `pre_exec` dup of the slave fd onto `TITLE_FD`
    /// gives a spawned shell a writable title end — the exact wiring acp.rs
    /// performs for the harness.
    #[test]
    fn an_inherited_fd_reaches_the_channel_from_a_spawned_shell() {
        let receiver = installed("test-inherit");
        let fd = fd_for("test-inherit").expect("the channel has an fd");

        let mut command = std::process::Command::new("/bin/sh");
        command.args([
            "-c",
            "printf '\\033]2;inherited\\007' >&$ZU_TITLE_FD; sleep 0.2",
        ]);
        command.env("ZU_TITLE_FD", TITLE_FD.to_string());
        let target = TITLE_FD;
        // SAFETY: `dup2` in the forked child, before exec — no shared state.
        unsafe {
            command.pre_exec(move || {
                if libc::dup2(fd, target) == -1 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
        let mut child = command.spawn().expect("sh starts");
        child.wait().expect("sh exits");

        let got = receiver
            .recv_timeout(std::time::Duration::from_secs(5))
            .expect("the title is reported");
        assert_eq!(got, "inherited");
    }

    /// `ZU_TTY` declares the channel's own tty: the C1 form (an explicit
    /// write into the same emulator) works from the inherited shell.
    #[test]
    fn zu_tty_names_the_channel_tty_in_the_shell() {
        let receiver = installed("test-zu-tty");
        let fd = fd_for("test-zu-tty").expect("the channel has an fd");
        let path = channels()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get("test-zu-tty")
            .map(|channel| channel.path.clone())
            .expect("the channel has a path");

        let mut command = std::process::Command::new("/bin/sh");
        command.args([
            "-c",
            "printf 'TTY=%s\\n' \"$ZU_TTY\"; printf '\\033]2;direct\\007' > \"$ZU_TTY\"; sleep 0.2",
        ]);
        command.env("ZU_TTY", &path);
        command.env("ZU_TITLE_FD", TITLE_FD.to_string());
        let target = TITLE_FD;
        let source = fd;
        // SAFETY: `dup2` in the forked child, before exec — no shared state.
        unsafe {
            use std::os::unix::process::CommandExt;
            command.pre_exec(move || {
                if libc::dup2(source, target) == -1 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
        let mut child = command.spawn().expect("sh starts");
        child.wait().expect("sh exits");

        let mut titles = Vec::new();
        while let Ok(title) = receiver.try_recv() {
            titles.push(title);
        }
        assert!(
            titles.contains(&"direct".to_owned()),
            "the explicit write lands in the same emulator: {titles:?}"
        );
        drop(path);
    }

    /// Re-installing reuses the pair and reattaches the observer.
    #[test]
    fn install_reuses_the_pair_and_reattaches_the_observer() {
        let first = installed("test-reuse");
        let (sender, second) = mpsc::channel::<String>();
        install(
            "test-reuse",
            Box::new(move |title| {
                let _ = sender.send(title);
            }),
        )
        .expect("the second install reuses");
        let fd_one = fd_for("test-reuse").expect("fd after first");
        let channel = channels()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get("test-reuse")
            .expect("registered")
            .clone();
        channel
            .write(b"\x1b]2;second observer\x07")
            .expect("the slave writes");
        assert!(first.try_recv().is_err(), "the first observer is detached");
        let got = second
            .recv_timeout(std::time::Duration::from_secs(5))
            .expect("the reattached observer reports");
        assert_eq!(got, "second observer");
        let fd_two = fd_for("test-reuse").expect("fd after reuse");
        assert_eq!(fd_one, fd_two, "the pair is the same one");
    }

    /// An empty title after a real one still reports — the projection falls
    /// back to the session name. An empty title with nothing before it is
    /// not a change and reports nothing.
    #[test]
    fn empty_title_after_a_real_one_reports_the_fallback() {
        let receiver = installed("test-empty");
        let channel = channels()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get("test-empty")
            .expect("registered")
            .clone();
        channel.write(b"\x1b]2;\x07").expect("the slave writes");
        assert!(
            receiver.try_recv().is_err(),
            "no title before, no change now: nothing reports"
        );
        channel.write(b"\x1b]2;old\x07").expect("the slave writes");
        let got = receiver
            .recv_timeout(std::time::Duration::from_secs(5))
            .expect("the title is reported");
        assert_eq!(got, "old");
        channel.write(b"\x1b]2;\x07").expect("the slave writes");
        let got = receiver
            .recv_timeout(std::time::Duration::from_secs(5))
            .expect("the empty title is reported");
        assert_eq!(got, "");
    }

    /// Removal closes the channel: the fd goes away and nothing leaks.
    #[test]
    fn remove_drops_the_channel() {
        let _receiver = installed("test-remove");
        assert!(fd_for("test-remove").is_some());
        remove("test-remove");
        assert!(fd_for("test-remove").is_none());
    }
}
