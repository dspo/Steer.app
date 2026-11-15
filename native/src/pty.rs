//! Pseudo-terminals: a real shell or command under a PTY, its output pushed
//! to TSX through a callback.
//!
//! The UI never sees the PTY's bytes on the engine wire. A reader thread owns
//! the master's read half and hands chunks to a task of the NSH core through
//! a channel; that task calls the TSX `onData` callback with `Callback::post`,
//! exactly as `nsh`'s own `process.spawn` delivers output. Writes go the other
//! way through a writer thread, so a program that stops reading cannot freeze
//! the engine thread.
//!
//! A terminal belongs to one external container. Killing the container calls
//! [`Pty::close`]; dropping the JS handle (disposal or the VM going away) also
//! kills the child through [`Drop`]. The program is started in its own session
//! (`portable-pty` does `setsid` on Unix), so closing the pty hangs it up and
//! kills a foreground TUI with `SIGHUP`.

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
    code: Option<i32>,
    /// The signal's name (`"SIGHUP"`), `null` on a normal exit.
    signal: Option<String>,
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
    control: Arc<Control>,
    pid: Option<u32>,
    title: String,
    /// The last dims, so a viewer can report them.
    size: Mutex<(u16, u16)>,
    exited: Arc<AtomicBool>,
    exit_code: Arc<Mutex<Option<i32>>>,
    exit_signal: Arc<Mutex<Option<String>>>,
}

/// Everything `close`, the cleanup of the owner and the child's threads share.
struct Control {
    closed: AtomicBool,
    killer: Mutex<Option<Box<dyn ChildKiller + Send + Sync>>>,
    master: Mutex<Option<Box<dyn MasterPty + Send>>>,
    writer: Mutex<Option<mpsc::Sender<Vec<u8>>>>,
    queued: Arc<Mutex<usize>>,
}

impl Control {
    /// Hangs up the program and closes the pty. Idempotent; safe from any
    /// thread.
    fn close(&self) {
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

    fn write(&self, bytes: Vec<u8>) -> Result<(), String> {
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
}

impl Drop for Pty {
    fn drop(&mut self) {
        self.control.close();
    }
}

/// Events from the pty's threads to the task that posts them to TSX.
enum Event {
    Data(Vec<u8>),
    Exit(Option<i32>, Option<String>),
}

/// An incremental UTF-8 decoder: a read may split a multi-byte character,
/// and the emulator needs text, not replacement characters at the seam.
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
        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|error| format!("cannot read the pty: {error}"))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|error| format!("cannot write the pty: {error}"))?;

        // Bounded: a flood (`yes`) back-pressures the program instead of
        // growing the engine's heap without bound.
        let (events, mut received) = tokio::sync::mpsc::channel::<Event>(256);
        let exited = Arc::new(AtomicBool::new(false));
        let exit_code = Arc::new(Mutex::new(None));
        let exit_signal = Arc::new(Mutex::new(None));
        let queued = Arc::new(Mutex::new(0usize));

        // The reader: bytes in, events out. It never touches JS.
        {
            let events = events.clone();
            let mut reader = reader;
            thread::Builder::new()
                .name("zu-pty-reader".to_owned())
                .spawn(move || {
                    let mut buffer = [0u8; 32 * 1024];
                    loop {
                        match reader.read(&mut buffer) {
                            Ok(0) => break,
                            Ok(n) => {
                                if events
                                    .blocking_send(Event::Data(buffer[..n].to_vec()))
                                    .is_err()
                                {
                                    break;
                                }
                            }
                            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => {
                                continue;
                            }
                            // A hung-up pty reads as EIO on macOS/Linux.
                            Err(_) => break,
                        }
                    }
                })
                .map_err(|error| format!("cannot start the pty reader: {error}"))?;
        }

        // The writer: queued input out, so no write blocks the engine thread.
        {
            let (input, outgoing) = mpsc::channel::<Vec<u8>>();
            let writer_queued = queued.clone();
            let mut writer = writer;
            thread::Builder::new()
                .name("zu-pty-writer".to_owned())
                .spawn(move || {
                    while let Ok(bytes) = outgoing.recv() {
                        if let Ok(mut n) = writer_queued.lock() {
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
            *queued.lock().map_err(|_| "pty lock poisoned".to_owned())? = 0;
            // The sender lives in `Control`; the channel is handed over below.
            let control = Control {
                closed: AtomicBool::new(false),
                killer: Mutex::new(Some(killer)),
                master: Mutex::new(Some(pair.master)),
                writer: Mutex::new(Some(input)),
                queued,
            };
            let pty = Pty {
                control: Arc::new(control),
                pid,
                title: program.clone(),
                size: Mutex::new((cols, rows)),
                exited: exited.clone(),
                exit_code: exit_code.clone(),
                exit_signal: exit_signal.clone(),
            };
            let exit_events = events.clone();
            thread::Builder::new()
                .name("zu-pty-waiter".to_owned())
                .spawn(move || {
                    let mut child = child;
                    let status = child.wait();
                    let (code, signal) = match status {
                        Ok(status) => match status.signal() {
                            // A signal's status is 1 by convention; the signal
                            // itself is the real outcome, and `code` is null.
                            Some(signal) => (None, Some(signal.to_owned())),
                            None => (Some(status.exit_code() as i32), None),
                        },
                        Err(_) => (None, None),
                    };
                    exited.store(true, Ordering::Release);
                    if let Ok(mut slot) = exit_code.lock() {
                        *slot = code;
                    }
                    if let Ok(mut slot) = exit_signal.lock() {
                        *slot = signal.clone();
                    }
                    let _ = exit_events.blocking_send(Event::Exit(code, signal));
                })
                .map_err(|error| format!("cannot start the pty waiter: {error}"))?;
            // Keep the event sender alive with the task; each thread has its
            // own clone, so the channel closes when the last one stops.
            drop(events);
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
                        Event::Exit(code, signal) => {
                            if let Some(on_exit) = on_exit.as_ref() {
                                on_exit.post(PtyExit { code, signal });
                            }
                            break;
                        }
                    }
                }
            });
            Ok(pty)
        }
    }

    /// Writes text to the program (keys, pastes, the emulator's answers).
    pub fn write(&self, data: String) -> Result<(), String> {
        self.control.write(data.into_bytes())
    }

    /// Tells the program the view's new size, in cells.
    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        let cols = cols.clamp(1, MAX_DIMENSION);
        let rows = rows.clamp(1, MAX_DIMENSION);
        if self.control.closed.load(Ordering::Acquire) {
            return Err("the terminal is closed".to_owned());
        }
        let master = self
            .control
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

    /// Hangs up and kills the program; a second call does nothing.
    pub fn close(&self) {
        self.control.close();
    }

    /// Whether the program is still running.
    pub fn alive(&self) -> bool {
        !self.exited.load(Ordering::Acquire)
    }

    /// The program's id, `null` when the platform has none.
    #[getter]
    pub fn pid(&self) -> Option<u32> {
        self.pid
    }

    /// The program's name (the default shell's path when it was not given).
    #[getter]
    pub fn title(&self) -> String {
        self.title.clone()
    }

    /// The last cell size: columns and rows.
    #[getter]
    pub fn size(&self) -> Vec<u16> {
        self.size
            .lock()
            .map(|size| vec![size.0, size.1])
            .unwrap_or_else(|_| vec![80, 24])
    }

    /// The exit status, `null` while running or when a signal ended it.
    #[getter]
    pub fn exit_code(&self) -> Option<i32> {
        self.exit_code.lock().ok().and_then(|code| *code)
    }

    /// The signal that ended the program, `null` after a normal exit.
    #[getter]
    pub fn exit_signal(&self) -> Option<String> {
        self.exit_signal
            .lock()
            .ok()
            .and_then(|signal| signal.clone())
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
