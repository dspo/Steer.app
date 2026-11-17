//! Pseudo-terminals: a real shell or command under a PTY.
//!
//! [`Process`] is the program and its PTY: a reader thread owns the
//! master's read half, a writer thread its write half (so a program that
//! stops reading cannot freeze a caller), a waiter thread its exit. Two
//! owners use it: [`Pty`], whose output goes to TSX as text through a
//! callback (as `nsh`'s own `process.spawn` delivers output), and the
//! terminal session (`crate::session`), whose output goes straight into its
//! emulator and never reaches TSX.
//!
//! The program is started in its own session (`portable-pty` does `setsid`
//! on Unix), so closing the pty hangs it up and kills a foreground TUI with
//! `SIGHUP`. Dropping the owner closes it.

use std::{
    collections::BTreeMap,
    io::{Read, Write},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    thread,
};

use nsh_core::prelude::*;
use portable_pty::{ChildKiller, CommandBuilder, MasterPty, PtySize, native_pty_system};

/// A PTY larger than this is a caller's mistake, not a terminal.
const MAX_DIMENSION: u16 = 1000;
/// Arguments are capped so a bad call cannot build an unbounded argv.
const MAX_ARGS: usize = 4096;
/// Bytes waiting to be written; a full-screen program that stops reading
/// rejects the write instead of growing without bound.
const MAX_INPUT: usize = 1 << 20;

/// How a PTY starts.
#[derive(Debug, Clone, Default, JsObject)]
pub struct PtyOptions {
    /// The program; `$SHELL`, else the platform's login shell (`/bin/zsh` on
    /// macOS, `/bin/bash` elsewhere), when left out.
    command: Option<String>,
    /// The program's arguments, none for the default shell.
    args: Option<Vec<String>>,
    /// The working directory; the app's current directory when left out.
    cwd: Option<String>,
    /// Extra environment entries (`TERM` and `COLORTERM` are always set).
    env: Option<BTreeMap<String, String>>,
    /// Columns at start (80 when left out); the view resizes it.
    cols: Option<u16>,
    /// Rows at start (24 when left out).
    rows: Option<u16>,
}

/// How a PTY's program ended.
#[derive(Debug, Clone, Default, JsObject)]
pub struct PtyExit {
    /// The exit status, `null` when a signal ended it.
    pub(crate) code: Option<i32>,
    /// The signal's name (`"SIGHUP"`), `null` on a normal exit.
    pub(crate) signal: Option<String>,
}

/// A running pseudo-terminal.
///
/// The program starts in a new session with the pty as its controlling
/// terminal. `onData` receives UTF-8 text as the program writes it (escape
/// sequences included); `onExit` fires once when the program ends. `write`
/// sends user input, `resize` reports the view's new cell grid, and `close`
/// (or dropping the handle) hangs up and kills the program.
#[class]
pub struct Pty {
    process: Process,
}

/// What a PTY's owner and its threads share: the program's input, size and
/// end. Safe from any thread.
pub(crate) struct Control {
    closed: AtomicBool,
    killer: Mutex<Option<Box<dyn ChildKiller + Send + Sync>>>,
    master: Mutex<Option<Box<dyn MasterPty + Send>>>,
    writer: Mutex<Option<mpsc::Sender<Vec<u8>>>>,
    queued: Arc<Mutex<usize>>,
    size: Mutex<(u16, u16)>,
    exited: AtomicBool,
    exit: Mutex<PtyExit>,
}

impl Control {
    /// Hangs up the program and closes the pty. Idempotent.
    pub(crate) fn close(&self) {
        if self.closed.swap(true, Ordering::AcqRel) {
            return;
        }
        if let Ok(mut killer) = self.killer.lock()
            && let Some(killer) = killer.as_mut()
        {
            let _ = killer.kill();
        }
        // Dropping the master makes the reader see EOF and closes the pty's
        // slave side; a program in the foreground gets SIGHUP.
        if let Ok(mut master) = self.master.lock() {
            master.take();
        }
        if let Ok(mut writer) = self.writer.lock() {
            writer.take();
        }
    }

    /// Queues `bytes` for the program.
    pub(crate) fn write(&self, bytes: Vec<u8>) -> Result<(), String> {
        if self.closed.load(Ordering::Acquire) {
            return Err("the terminal is closed".to_owned());
        }
        if bytes.len() > MAX_INPUT {
            return Err("input is larger than 1 MiB".to_owned());
        }
        let Ok(writer) = self.writer.lock() else {
            return Err("terminal lock poisoned".to_owned());
        };
        let Some(writer) = writer.as_ref() else {
            return Err("the terminal is closed".to_owned());
        };
        let queued = self.queued.clone();
        let pending = queued.lock().map(|n| *n).unwrap_or(0);
        if pending.saturating_add(bytes.len()) > MAX_INPUT {
            return Err("terminal input is not being read".to_owned());
        }
        if let Ok(mut n) = queued.lock() {
            *n += bytes.len();
        }
        if let Err(error) = writer.send(bytes) {
            if let Ok(mut n) = queued.lock() {
                *n = n.saturating_sub(error.0.len());
            }
            return Err("the terminal is closed".to_owned());
        }
        Ok(())
    }

    /// Tells the program its window is `cols` × `rows` cells.
    pub(crate) fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        let cols = cols.clamp(1, MAX_DIMENSION);
        let rows = rows.clamp(1, MAX_DIMENSION);
        if self.closed.load(Ordering::Acquire) {
            return Err("the terminal is closed".to_owned());
        }
        let master = self
            .master
            .lock()
            .map_err(|_| "terminal lock poisoned".to_owned())?;
        let Some(master) = master.as_ref() else {
            return Err("the terminal is closed".to_owned());
        };
        master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| format!("cannot resize the pty: {error}"))?;
        if let Ok(mut size) = self.size.lock() {
            *size = (cols, rows);
        }
        Ok(())
    }

    pub(crate) fn size(&self) -> (u16, u16) {
        self.size.lock().map(|s| *s).unwrap_or((80, 24))
    }

    pub(crate) fn alive(&self) -> bool {
        !self.exited.load(Ordering::Acquire)
    }

    pub(crate) fn exit(&self) -> PtyExit {
        self.exit.lock().map(|e| e.clone()).unwrap_or_default()
    }
}

/// A program under a PTY, with its reader, writer and waiter threads.
/// Dropping it closes the PTY.
pub(crate) struct Process {
    pub(crate) control: Arc<Control>,
    pub(crate) pid: Option<u32>,
    pub(crate) program: String,
}

impl Drop for Process {
    fn drop(&mut self) {
        self.control.close();
    }
}

impl Process {
    /// Starts `options`. `output` gets every chunk the program writes, on
    /// the reader thread, until EOF; `ended` gets the program's end once, on
    /// the waiter thread, after the exit state is recorded.
    pub(crate) fn spawn(
        options: PtyOptions,
        output: impl FnMut(&[u8]) + Send + 'static,
        ended: impl FnOnce(PtyExit) + Send + 'static,
    ) -> Result<Process, String> {
        let PtyOptions {
            command,
            args,
            cwd,
            env,
            cols,
            rows,
        } = options;
        let program = command
            .as_deref()
            .map(str::trim)
            .filter(|program| !program.is_empty())
            .map(str::to_owned)
            .or_else(|| {
                std::env::var("SHELL")
                    .ok()
                    .filter(|shell| !shell.is_empty())
            })
            // The fallback is the platform's own login shell, not a Mac-ism:
            // a Linux box without `$SHELL` set has no `/bin/zsh`, and the
            // terminal must still start (the CI runner is exactly that box).
            .unwrap_or_else(|| {
                if cfg!(target_os = "macos") {
                    "/bin/zsh".to_owned()
                } else {
                    "/bin/bash".to_owned()
                }
            });
        let mut argv = args.unwrap_or_default();
        if argv.len() > MAX_ARGS {
            return Err(format!("too many arguments (at most {MAX_ARGS})"));
        }
        let cwd = match cwd.map(|cwd| cwd.trim().to_owned()) {
            Some(cwd) if !cwd.is_empty() => {
                let path = std::path::PathBuf::from(&cwd);
                if !path.is_dir() {
                    return Err(format!("cwd is not a directory: {cwd}"));
                }
                Some(path)
            }
            _ => None,
        };
        let cols = cols.unwrap_or(80).clamp(1, MAX_DIMENSION);
        let rows = rows.unwrap_or(24).clamp(1, MAX_DIMENSION);

        let mut builder = CommandBuilder::new(&program);
        // `CommandBuilder::new` puts the program in argv[0]; appending it
        // again would pass it as the first argument.
        for arg in argv.drain(..) {
            builder.arg(arg);
        }
        if let Some(cwd) = cwd {
            builder.cwd(cwd);
        }
        // A pty program needs a terminal description; the host's TERM may be
        // a GUI process's empty value, and agent TUIs need truecolor.
        let term = std::env::var("TERM")
            .ok()
            .filter(|term| !term.trim().is_empty() && term != "dumb")
            .unwrap_or_else(|| "xterm-256color".to_owned());
        builder.env("TERM", term);
        builder.env("COLORTERM", "truecolor");
        builder.env("TERM_PROGRAM", "Zu");
        if let Some(env) = env {
            for (name, value) in env {
                if name.is_empty()
                    || name.contains('=')
                    || name.contains('\0')
                    || value.contains('\0')
                {
                    return Err(format!("invalid environment entry: {name:?}"));
                }
                builder.env(name, value);
            }
        }

        let pair = native_pty_system()
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| format!("cannot create a pty: {error}"))?;
        let child = pair
            .slave
            .spawn_command(builder)
            .map_err(|error| format!("cannot start {program}: {error}"))?;
        // The slave must go: holding it open would keep the master's reader
        // from ever seeing EOF.
        drop(pair.slave);

        let pid = child.process_id();
        let killer = child.clone_killer();
        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|error| format!("cannot read the pty: {error}"))?;
        let mut writer = pair
            .master
            .take_writer()
            .map_err(|error| format!("cannot write the pty: {error}"))?;

        let (input, outgoing) = mpsc::channel::<Vec<u8>>();
        let control = Arc::new(Control {
            closed: AtomicBool::new(false),
            killer: Mutex::new(Some(killer)),
            master: Mutex::new(Some(pair.master)),
            writer: Mutex::new(Some(input)),
            queued: Arc::new(Mutex::new(0)),
            size: Mutex::new((cols, rows)),
            exited: AtomicBool::new(false),
            exit: Mutex::new(PtyExit::default()),
        });
        // From here on dropping `process` closes the PTY, so a thread that
        // fails to start leaves no program behind.
        let process = Process {
            control: control.clone(),
            pid,
            program: program.clone(),
        };

        let mut output = output;
        thread::Builder::new()
            .name("zu-pty-reader".to_owned())
            .spawn(move || {
                let mut buffer = [0u8; 64 * 1024];
                loop {
                    match reader.read(&mut buffer) {
                        Ok(0) => break,
                        Ok(n) => output(&buffer[..n]),
                        Err(error) if error.kind() == std::io::ErrorKind::Interrupted => {
                            continue;
                        }
                        // A hung-up pty reads as EIO on macOS/Linux.
                        Err(_) => break,
                    }
                }
            })
            .map_err(|error| format!("cannot start the pty reader: {error}"))?;

        let queued = control.queued.clone();
        thread::Builder::new()
            .name("zu-pty-writer".to_owned())
            .spawn(move || {
                while let Ok(bytes) = outgoing.recv() {
                    if let Ok(mut n) = queued.lock() {
                        *n = n.saturating_sub(bytes.len());
                    }
                    let mut rest = bytes.as_slice();
                    while !rest.is_empty() {
                        match writer.write(rest) {
                            Ok(0) => return,
                            Ok(n) => rest = &rest[n..],
                            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => {
                                continue;
                            }
                            Err(_) => return,
                        }
                    }
                    let _ = writer.flush();
                }
            })
            .map_err(|error| format!("cannot start the pty writer: {error}"))?;

        let waiter = control.clone();
        thread::Builder::new()
            .name("zu-pty-waiter".to_owned())
            .spawn(move || {
                let mut child = child;
                let (code, signal) = match child.wait() {
                    // A signal's status is 1 by convention; the signal itself
                    // is the real outcome, and `code` is null.
                    Ok(status) => match status.signal() {
                        Some(signal) => (None, Some(signal.to_owned())),
                        None => (Some(status.exit_code() as i32), None),
                    },
                    Err(_) => (None, None),
                };
                let exit = PtyExit { code, signal };
                if let Ok(mut slot) = waiter.exit.lock() {
                    *slot = exit.clone();
                }
                waiter.exited.store(true, Ordering::Release);
                ended(exit);
            })
            .map_err(|error| format!("cannot start the pty waiter: {error}"))?;

        Ok(process)
    }
}

/// Events from the pty's threads to the task that posts them to TSX.
enum Event {
    Data(Vec<u8>),
    Exit(PtyExit),
}

/// An incremental UTF-8 decoder: a read may split a multi-byte character,
/// and TSX needs text, not replacement characters at the seam.
#[derive(Default)]
struct Decoder {
    pending: Vec<u8>,
}

impl Decoder {
    fn push(&mut self, bytes: &[u8]) -> String {
        let mut all = std::mem::take(&mut self.pending);
        all.extend_from_slice(bytes);
        let mut out = String::new();
        let mut rest = all.as_slice();
        loop {
            match std::str::from_utf8(rest) {
                Ok(text) => {
                    out.push_str(text);
                    rest = &[];
                    break;
                }
                Err(error) => {
                    let valid = error.valid_up_to();
                    // SAFETY: `valid_up_to` is the length of the valid prefix.
                    out.push_str(unsafe { std::str::from_utf8_unchecked(&rest[..valid]) });
                    match error.error_len() {
                        Some(len) => {
                            out.push('\u{FFFD}');
                            rest = &rest[valid + len..];
                        }
                        None => {
                            rest = &rest[valid..];
                            break;
                        }
                    }
                }
            }
        }
        // A partial tail is at most one UTF-8 character; anything else was
        // already consumed as replacement characters above.
        if rest.len() <= 3 {
            self.pending = rest.to_vec();
        }
        out
    }
}

#[class]
impl Pty {
    /// Starts `options` under a new pseudo-terminal.
    ///
    /// # Rust
    ///
    /// Takes `cx` only to start the task that posts output to `onData`; the
    /// call itself is synchronous. The child is killed when this value is
    /// dropped or `close` is called.
    pub fn open(
        options: PtyOptions,
        #[args(data)] on_data: Callback<String>,
        #[args(exit)] on_exit: Option<Callback<PtyExit>>,
        cx: CallCx<'_>,
    ) -> Result<Pty, String> {
        // Bounded: a flood (`yes`) back-pressures the program instead of
        // growing the engine's heap without bound.
        let (events, mut received) = tokio::sync::mpsc::channel::<Event>(256);
        let data = events.clone();
        let process = Process::spawn(
            options,
            move |bytes| {
                let _ = data.blocking_send(Event::Data(bytes.to_vec()));
            },
            move |exit| {
                let _ = events.blocking_send(Event::Exit(exit));
            },
        )?;
        cx.start(async move {
            let mut decoder = Decoder::default();
            while let Some(event) = received.recv().await {
                match event {
                    Event::Data(bytes) => {
                        let text = decoder.push(&bytes);
                        if !text.is_empty() {
                            on_data.post(text);
                        }
                    }
                    Event::Exit(exit) => {
                        if let Some(on_exit) = on_exit.as_ref() {
                            on_exit.post(exit);
                        }
                        break;
                    }
                }
            }
        });
        Ok(Pty { process })
    }

    /// Writes text to the program (keys, pastes, the emulator's answers).
    pub fn write(&self, data: String) -> Result<(), String> {
        self.process.control.write(data.into_bytes())
    }

    /// Tells the program the view's new size, in cells.
    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        self.process.control.resize(cols, rows)
    }

    /// Hangs up and kills the program; a second call does nothing.
    pub fn close(&self) {
        self.process.control.close();
    }

    /// Whether the program is still running.
    pub fn alive(&self) -> bool {
        self.process.control.alive()
    }

    /// The program's id, `null` when the platform has none.
    #[getter]
    pub fn pid(&self) -> Option<u32> {
        self.process.pid
    }

    /// The program's name (the default shell's path when it was not given).
    #[getter]
    pub fn title(&self) -> String {
        self.process.program.clone()
    }

    /// The last cell size: columns and rows.
    #[getter]
    pub fn size(&self) -> Vec<u16> {
        let (cols, rows) = self.process.control.size();
        vec![cols, rows]
    }

    /// The exit status, `null` while running or when a signal ended it.
    #[getter]
    pub fn exit_code(&self) -> Option<i32> {
        self.process.control.exit().code
    }

    /// The signal that ended the program, `null` after a normal exit.
    #[getter]
    pub fn exit_signal(&self) -> Option<String> {
        self.process.control.exit().signal
    }
}

#[cfg(test)]
mod tests {
    use super::Decoder;

    #[test]
    fn a_character_split_across_reads_survives() {
        let mut decoder = Decoder::default();
        let bytes = "aé中".as_bytes();
        // Split inside `é`'s two bytes and inside `中`'s three.
        assert_eq!(decoder.push(&bytes[..2]), "a");
        assert_eq!(decoder.push(&bytes[2..5]), "é");
        assert_eq!(decoder.push(&bytes[5..]), "中");
    }

    #[test]
    fn invalid_bytes_become_replacement_characters() {
        let mut decoder = Decoder::default();
        let text = decoder.push(&[0xff, b'o', b'k']);
        assert!(text.starts_with('\u{FFFD}'));
        assert!(text.ends_with("ok"));
    }

    #[test]
    fn an_incomplete_tail_waits_for_the_next_read() {
        let mut decoder = Decoder::default();
        let bytes = "中".as_bytes();
        assert_eq!(decoder.push(&bytes[..1]), "");
        assert_eq!(decoder.push(&bytes[1..]), "中");
    }
}
