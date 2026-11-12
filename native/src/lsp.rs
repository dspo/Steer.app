//! Language servers: a child process speaking LSP's framed JSON-RPC over
//! stdin/stdout, its messages pushed to TSX through a callback.
//!
//! The UI never sees a language server's bytes on the engine wire, exactly as
//! with [`crate::pty`]. A reader thread frames stdout (`Content-Length`
//! headers, bounded), a writer thread frames what TSX sends, and a third
//! thread collects stderr; a task of the NSH core posts each complete message,
//! stderr chunk and the exit status through `Callback::post`. JSON-RPC ids,
//! request timeouts and cancellation live in `lsp.ts` — this module ships
//! bytes and owns the process, nothing more. Failures carry `code`
//! (`ERR_LSP_ARGS`, `ERR_LSP_ENV`, `ERR_LSP_CWD`, `ERR_LSP_SPAWN`,
//! `ERR_LSP_INPUT`, `ERR_LSP_COMMAND`, `ERR_LSP_CLOSED`).
//!
//! The server is started from an argv array with an explicit, canonicalized
//! working directory and no shell. It runs in its own process group, so
//! `stop` (or dropping the JS handle) hangs up the whole tree instead of
//! leaving rust-analyzer's children behind. A server's death, a write failure
//! and a protocol error all surface to TSX; none of them can take the engine,
//! PTY or file domain down with them.

use std::{
    collections::BTreeMap,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    thread,
};

use nsh_core::prelude::*;

#[cfg(unix)]
use std::os::unix::process::CommandExt;

/// The largest header block a server may send; a longer one is a desync, not
/// a message.
const MAX_HEADER_BYTES: usize = 8 * 1024;
/// The largest one message body this module accepts (8 MiB): rust-analyzer's
/// largest responses are far below it, and a whole file's text is capped at
/// 2 MiB by `zu/fs`.
const MAX_MESSAGE_BYTES: usize = 8 * 1024 * 1024;
/// Bytes queued for the server's stdin; a server that stops reading makes
/// `send` fail instead of growing without bound.
const MAX_INPUT_BYTES: usize = 8 * 1024 * 1024;
/// Arguments are capped so a bad call cannot build an unbounded argv.
const MAX_ARGS: usize = 4096;
/// One read of stderr is posted at most this large; a chatty server can still
/// fill the queue, which back-pressures it.
const MAX_STDERR_CHUNK: usize = 4 * 1024;
/// Events waiting for the posting task; the reader back-pressures the server
/// when TSX falls behind.
const EVENT_QUEUE: usize = 64;

const ERR_COMMAND: &str = "ERR_LSP_COMMAND";
const ERR_CWD: &str = "ERR_LSP_CWD";
const ERR_ARGS: &str = "ERR_LSP_ARGS";
const ERR_ENV: &str = "ERR_LSP_ENV";
const ERR_SPAWN: &str = "ERR_LSP_SPAWN";
const ERR_INPUT: &str = "ERR_LSP_INPUT";
const ERR_CLOSED: &str = "ERR_LSP_CLOSED";

/// How a language server starts.
#[derive(Debug, Clone, Default, JsObject)]
pub struct LspOptions {
    /// The program: a bare name looked up on `PATH` (and the usual install
    /// directories), or an absolute path.
    pub command: String,
    /// Its arguments, none by default. Never interpreted by a shell.
    pub args: Option<Vec<String>>,
    /// The working directory, required: a language server's workspace is
    /// explicit, never the app's launch directory.
    pub cwd: Option<String>,
    /// Extra environment entries; the app's environment is inherited.
    pub env: Option<BTreeMap<String, String>>,
}

/// How a language server ended.
#[derive(Debug, Clone, Default, JsObject)]
pub struct LspExit {
    /// The exit status, `null` when a signal ended it.
    pub code: Option<i32>,
    /// The signal's name (`"SIGTERM"`), `null` on a normal exit.
    pub signal: Option<String>,
}

/// A running language server.
///
/// `new Lsp(options, onMessage, onStderr, onExit?)` starts it (`start` in the
/// M11 contract). `onMessage` gets each complete LSP message body as text
/// (its JSON-RPC envelope intact, `Content-Length` framing removed),
/// `onStderr` gets the server's stderr as it is written, and `onExit` fires
/// once when the process ends. `send` writes one framed message (TSX builds
/// the JSON-RPC envelope), `stop` hangs up the process group, and dropping
/// the handle does the same.
#[class]
pub struct Lsp {
    control: Arc<Control>,
    pid: Option<u32>,
    program: String,
    exited: Arc<AtomicBool>,
    exit_code: Arc<Mutex<Option<i32>>>,
    exit_signal: Arc<Mutex<Option<String>>>,
}

/// What `stop`, the drop and the reader/writer share.
struct Control {
    closed: AtomicBool,
    pid: Option<u32>,
    writer: Mutex<Option<mpsc::Sender<Vec<u8>>>>,
    queued: Arc<Mutex<usize>>,
}

impl Control {
    /// Hangs up the language server and its children. Idempotent; safe from
    /// any thread.
    fn close(&self) {
        if self.closed.swap(true, Ordering::AcqRel) {
            return;
        }
        if let Some(pid) = self.pid {
            kill_group(pid);
        }
        // Dropping the sender ends the writer thread, which drops stdin: a
        // server that survives the signal also sees EOF and exits.
        if let Ok(mut writer) = self.writer.lock() {
            writer.take();
        }
    }

    fn send(&self, message: &str) -> Result<(), JsError> {
        if self.closed.load(Ordering::Acquire) {
            return Err(lsp_error(ERR_CLOSED, "the language server is closed"));
        }
        if message.trim().is_empty() {
            return Err(lsp_error(ERR_INPUT, "the message is empty"));
        }
        if message.len() > MAX_INPUT_BYTES {
            return Err(lsp_error(
                ERR_INPUT,
                format!("the message is over the {MAX_INPUT_BYTES}-byte limit"),
            ));
        }
        let mut frame = format!("Content-Length: {}\r\n\r\n", message.len()).into_bytes();
        frame.extend_from_slice(message.as_bytes());
        let Ok(writer) = self.writer.lock() else {
            return Err(lsp_error(
                ERR_CLOSED,
                "the language server lock is poisoned",
            ));
        };
        let Some(writer) = writer.as_ref() else {
            return Err(lsp_error(ERR_CLOSED, "the language server is closed"));
        };
        let Ok(mut pending) = self.queued.lock() else {
            return Err(lsp_error(
                ERR_CLOSED,
                "the language server lock is poisoned",
            ));
        };
        if pending.saturating_add(frame.len()) > MAX_INPUT_BYTES {
            return Err(lsp_error(
                ERR_INPUT,
                "the language server is not reading its stdin",
            ));
        }
        *pending += frame.len();
        drop(pending);
        if let Err(error) = writer.send(frame) {
            if let Ok(mut pending) = self.queued.lock() {
                *pending = pending.saturating_sub(error.0.len());
            }
            return Err(lsp_error(ERR_CLOSED, "the language server is closed"));
        }
        Ok(())
    }
}

impl Drop for Lsp {
    fn drop(&mut self) {
        self.control.close();
    }
}

/// Events from the server's threads to the task that posts them to TSX.
enum Event {
    Message(Vec<u8>),
    Stderr(Vec<u8>),
    Exit(LspExit),
}

/// On Unix the child starts in its own process group; killing the group
/// takes the language server's own children (rust-analyzer's cargo checks,
/// tsserver) with it.
#[cfg(unix)]
fn kill_group(pid: u32) {
    unsafe extern "C" {
        fn kill(pid: i32, signal: i32) -> i32;
    }
    const SIGKILL: i32 = 9;
    if pid <= i32::MAX as u32 {
        // SAFETY: `kill` is the platform's process signal call; a negative pid
        // names the process group, and an unreachable group is harmless.
        unsafe {
            let _ = kill(-(pid as i32), SIGKILL);
            let _ = kill(pid as i32, SIGKILL);
        }
    }
}

/// Other targets have no process-group kill here; dropping stdin makes the
/// server exit.
#[cfg(not(unix))]
fn kill_group(_pid: u32) {}

#[class]
impl Lsp {
    /// Starts `options` and wires its streams to the callbacks.
    ///
    /// # Rust
    ///
    /// Takes `cx` only to start the task that posts output to TSX; the spawn
    /// itself is synchronous. The child is killed when this value is dropped
    /// or `stop` is called.
    pub fn start(
        options: LspOptions,
        #[args(message)] on_message: Callback<String>,
        #[args(text)] on_stderr: Callback<String>,
        #[args(exit)] on_exit: Option<Callback<LspExit>>,
        cx: CallCx<'_>,
    ) -> Result<Lsp, JsError> {
        let LspOptions {
            command,
            args,
            cwd,
            env,
        } = options;
        let raw = command.trim();
        if raw.is_empty() {
            return Err(lsp_error(
                ERR_COMMAND,
                "no language server command was given",
            ));
        }
        if raw.contains('\0') {
            return Err(lsp_error(ERR_COMMAND, "the command contains a NUL byte"));
        }
        let argv = args.unwrap_or_default();
        if argv.len() > MAX_ARGS {
            return Err(lsp_error(
                ERR_ARGS,
                format!("too many arguments (at most {MAX_ARGS})"),
            ));
        }
        for arg in &argv {
            if arg.contains('\0') {
                return Err(lsp_error(ERR_ARGS, "an argument contains a NUL byte"));
            }
        }
        let cwd = explicit_cwd(cwd.as_deref())?;
        let program = resolve_program(raw)?;
        let mut builder = Command::new(&program);
        builder
            .args(&argv)
            .current_dir(&cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        // A new session is a new process group; `close` hangs up the group.
        #[cfg(unix)]
        builder.process_group(0);
        if let Some(env) = env {
            for (name, value) in env {
                if name.is_empty()
                    || name.contains('=')
                    || name.contains('\0')
                    || value.contains('\0')
                {
                    return Err(lsp_error(
                        ERR_ENV,
                        format!("invalid environment entry: {name:?}"),
                    ));
                }
                builder.env(name, value);
            }
        }
        let mut child = builder.spawn().map_err(|error| {
            lsp_error(
                ERR_SPAWN,
                format!("cannot start {}: {error}", program.display()),
            )
        })?;
        let pid = child.id();
        let Some(stdin) = child.stdin.take() else {
            kill_group(pid);
            return Err(lsp_error(ERR_SPAWN, "the language server has no stdin"));
        };
        let Some(stdout) = child.stdout.take() else {
            kill_group(pid);
            return Err(lsp_error(ERR_SPAWN, "the language server has no stdout"));
        };
        let Some(stderr) = child.stderr.take() else {
            kill_group(pid);
            return Err(lsp_error(ERR_SPAWN, "the language server has no stderr"));
        };

        let (events, mut received) = tokio::sync::mpsc::channel::<Event>(EVENT_QUEUE);
        let exited = Arc::new(AtomicBool::new(false));
        let exit_code = Arc::new(Mutex::new(None));
        let exit_signal = Arc::new(Mutex::new(None));
        let queued = Arc::new(Mutex::new(0usize));

        // The reader: framed messages in, events out. It never touches JS.
        {
            let events = events.clone();
            thread::Builder::new()
                .name("zu-lsp-reader".to_owned())
                .spawn(move || {
                    let mut stdout = stdout;
                    let mut framer = Framer::default();
                    let mut buffer = [0u8; 32 * 1024];
                    loop {
                        match stdout.read(&mut buffer) {
                            Ok(0) => break,
                            Ok(n) => match framer.push(&buffer[..n]) {
                                Ok(messages) => {
                                    for message in messages {
                                        if events.blocking_send(Event::Message(message)).is_err() {
                                            return;
                                        }
                                    }
                                }
                                Err(error) => {
                                    let text = format!("lsp framing error: {error}");
                                    let _ = events.blocking_send(Event::Stderr(text.into_bytes()));
                                    return;
                                }
                            },
                            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => {
                                continue;
                            }
                            Err(_) => break,
                        }
                    }
                })
                .map_err(|error| {
                    kill_group(pid);
                    lsp_error(ERR_SPAWN, format!("cannot start the LSP reader: {error}"))
                })?;
        }

        // The stderr reader: a server's diagnostics about itself, posted as
        // text (lossy UTF-8; stderr is not guaranteed to be a message).
        {
            let events = events.clone();
            thread::Builder::new()
                .name("zu-lsp-stderr".to_owned())
                .spawn(move || {
                    let mut stderr = stderr;
                    let mut buffer = [0u8; MAX_STDERR_CHUNK];
                    loop {
                        match stderr.read(&mut buffer) {
                            Ok(0) => break,
                            Ok(n) => {
                                if events
                                    .blocking_send(Event::Stderr(buffer[..n].to_vec()))
                                    .is_err()
                                {
                                    break;
                                }
                            }
                            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => {
                                continue;
                            }
                            Err(_) => break,
                        }
                    }
                })
                .map_err(|error| {
                    kill_group(pid);
                    lsp_error(
                        ERR_SPAWN,
                        format!("cannot start the LSP stderr reader: {error}"),
                    )
                })?;
        }

        // The writer: queued frames out, so no send blocks the engine thread.
        {
            let (input, outgoing) = mpsc::channel::<Vec<u8>>();
            let writer_queued = queued.clone();
            let writer_events = events.clone();
            thread::Builder::new()
                .name("zu-lsp-writer".to_owned())
                .spawn(move || {
                    let mut stdin = stdin;
                    while let Ok(frame) = outgoing.recv() {
                        let length = frame.len();
                        let mut rest = frame.as_slice();
                        let mut failed = false;
                        while !rest.is_empty() {
                            match stdin.write(rest) {
                                Ok(0) => {
                                    failed = true;
                                    break;
                                }
                                Ok(n) => rest = &rest[n..],
                                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => {
                                    continue;
                                }
                                Err(_) => {
                                    failed = true;
                                    break;
                                }
                            }
                        }
                        let _ = stdin.flush();
                        if let Ok(mut pending) = writer_queued.lock() {
                            *pending = pending.saturating_sub(length);
                        }
                        if failed {
                            let _ = writer_events
                                .blocking_send(Event::Stderr(b"lsp: stdin closed".to_vec()));
                            break;
                        }
                    }
                })
                .map_err(|error| {
                    kill_group(pid);
                    lsp_error(ERR_SPAWN, format!("cannot start the LSP writer: {error}"))
                })?;
            let control = Control {
                closed: AtomicBool::new(false),
                pid: Some(pid),
                writer: Mutex::new(Some(input)),
                queued,
            };
            let lsp = Lsp {
                control: Arc::new(control),
                pid: Some(pid),
                program: program.display().to_string(),
                exited: exited.clone(),
                exit_code: exit_code.clone(),
                exit_signal: exit_signal.clone(),
            };
            // The waiter: the process's death is an event, not a poll.
            let waiter_events = events.clone();
            thread::Builder::new()
                .name("zu-lsp-waiter".to_owned())
                .spawn(move || {
                    let mut child: Child = child;
                    let status = child.wait();
                    let (code, signal) = match status {
                        Ok(status) => match exit_signal_of(&status) {
                            Some(signal) => (None, Some(signal)),
                            None => (Some(status.code().unwrap_or(1)), None),
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
                    let _ = waiter_events.blocking_send(Event::Exit(LspExit { code, signal }));
                })
                .map_err(|error| {
                    kill_group(pid);
                    lsp_error(ERR_SPAWN, format!("cannot start the LSP waiter: {error}"))
                })?;
            // Keep the event sender alive with the task; each thread has its
            // own clone, so the channel closes when the last one stops.
            drop(events);
            cx.start(async move {
                while let Some(event) = received.recv().await {
                    match event {
                        Event::Message(bytes) => match String::from_utf8(bytes) {
                            Ok(text) => on_message.post(text),
                            Err(error) => on_stderr.post(format!(
                                "lsp: a message was not valid UTF-8 ({} bytes), dropped",
                                error.as_bytes().len()
                            )),
                        },
                        Event::Stderr(bytes) => {
                            on_stderr.post(String::from_utf8_lossy(&bytes).into_owned());
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
            Ok(lsp)
        }
    }

    /// Writes one framed message; TSX builds the JSON-RPC envelope.
    pub fn send(&self, message: String) -> Result<(), JsError> {
        self.control.send(&message)
    }

    /// Hangs up the language server and its process group; a second call
    /// does nothing.
    pub fn stop(&self) {
        self.control.close();
    }

    /// Whether the process is still running.
    pub fn alive(&self) -> bool {
        !self.exited.load(Ordering::Acquire)
    }

    /// The process's id, `null` when the platform has none.
    #[getter]
    pub fn pid(&self) -> Option<u32> {
        self.pid
    }

    /// The program as it was resolved (`/opt/homebrew/bin/rust-analyzer`).
    #[getter]
    pub fn program(&self) -> String {
        self.program.clone()
    }

    /// The exit status, `null` while running or when a signal ended it.
    #[getter]
    pub fn exit_code(&self) -> Option<i32> {
        self.exit_code.lock().ok().and_then(|code| *code)
    }

    /// The signal that ended the process, `null` after a normal exit.
    #[getter]
    pub fn exit_signal(&self) -> Option<String> {
        self.exit_signal
            .lock()
            .ok()
            .and_then(|signal| signal.clone())
    }
}

#[cfg(unix)]
fn exit_signal_of(status: &std::process::ExitStatus) -> Option<String> {
    use std::os::unix::process::ExitStatusExt;
    status.signal().map(signal_name)
}

#[cfg(not(unix))]
fn exit_signal_of(_status: &std::process::ExitStatus) -> Option<String> {
    None
}

/// The names a stopped server most often reports; anything else keeps its
/// number.
#[cfg(unix)]
fn signal_name(signal: i32) -> String {
    let name = match signal {
        1 => "SIGHUP",
        2 => "SIGINT",
        3 => "SIGQUIT",
        6 => "SIGABRT",
        9 => "SIGKILL",
        11 => "SIGSEGV",
        13 => "SIGPIPE",
        15 => "SIGTERM",
        _ => return format!("signal {signal}"),
    };
    name.to_owned()
}

// --- the start policy -------------------------------------------------------

/// The explicit working directory: required, absolute and a real directory.
fn explicit_cwd(raw: Option<&str>) -> Result<PathBuf, JsError> {
    let raw = raw.map(str::trim).filter(|value| !value.is_empty());
    let Some(raw) = raw else {
        return Err(lsp_error(
            ERR_CWD,
            "a language server needs an explicit cwd (the workspace root)",
        ));
    };
    let path = Path::new(raw);
    if !path.is_absolute() {
        return Err(lsp_error(
            ERR_CWD,
            format!("the language server's cwd is not absolute: {raw}"),
        ));
    }
    let canonical = path.canonicalize().map_err(|error| {
        lsp_error(
            ERR_CWD,
            format!("the language server's cwd is unusable ({raw}): {error}"),
        )
    })?;
    if !canonical.is_dir() {
        return Err(lsp_error(
            ERR_CWD,
            format!("the language server's cwd is not a directory: {raw}"),
        ));
    }
    Ok(canonical)
}

/// Resolves `raw` to a program without a shell: a path with a separator is
/// used as it is, a bare name is looked up on `PATH` and then the usual
/// install directories (a GUI app's `PATH` often lacks them).
///
/// The result is deliberately **not** canonicalized: `~/.cargo/bin/rust-analyzer`
/// is a symlink to `rustup`, and rustup chooses its tool from `argv[0]`.
/// Resolving the symlink would run `rustup`, not rust-analyzer (it prints
/// rustup's help and never speaks LSP), so the symlink is the program.
fn resolve_program(raw: &str) -> Result<PathBuf, JsError> {
    let looks_like_path = raw.contains('/') || raw.contains('\\');
    if looks_like_path {
        let path = PathBuf::from(raw);
        if path.is_file() {
            return Ok(absolute(path));
        }
        return Err(lsp_error(
            ERR_COMMAND,
            format!("the language server does not exist: {raw}"),
        ));
    }
    let mut directories = Vec::new();
    if let Ok(path) = std::env::var("PATH") {
        directories.extend(
            path.split(':')
                .filter(|dir| !dir.is_empty())
                .map(PathBuf::from),
        );
    }
    let mut common = vec![
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/usr/bin"),
        PathBuf::from("/bin"),
    ];
    if let Ok(home) = std::env::var("HOME") {
        let home = PathBuf::from(home);
        common.push(home.join(".cargo/bin"));
        common.push(home.join(".local/bin"));
        common.push(home.join("go/bin"));
    }
    for dir in common {
        if !directories.contains(&dir) {
            directories.push(dir);
        }
    }
    for dir in &directories {
        let candidate = absolute(dir.join(raw));
        if candidate.is_file() {
            return Ok(candidate);
        }
    }
    Err(lsp_error(
        ERR_COMMAND,
        format!(
            "the language server was not found: {raw} (looked on PATH and the usual install directories)"
        ),
    ))
}

/// `path` made absolute against the app's working directory, without
/// resolving symlinks.
fn absolute(path: PathBuf) -> PathBuf {
    if path.is_absolute() {
        return path;
    }
    std::env::current_dir()
        .map(|cwd| cwd.join(&path))
        .unwrap_or(path)
}

fn lsp_error(code: &str, message: impl Into<String>) -> JsError {
    JsError::Error(message.into()).with_code(code)
}

// --- framing ---------------------------------------------------------------

/// LSP's framing over a byte stream: `Content-Length` headers, then exactly
/// that many body bytes. A read may end anywhere (inside a header, inside a
/// body, inside a UTF-8 character), so this keeps its own buffer.
#[derive(Default)]
struct Framer {
    buffer: Vec<u8>,
    /// The body length of the frame whose header was read.
    body: Option<usize>,
}

impl Framer {
    /// Adds `bytes`; returns every complete message body now available.
    fn push(&mut self, bytes: &[u8]) -> Result<Vec<Vec<u8>>, String> {
        self.buffer.extend_from_slice(bytes);
        let mut messages = Vec::new();
        loop {
            if self.body.is_none() {
                let Some(head) = find(&self.buffer, b"\r\n\r\n") else {
                    if self.buffer.len() > MAX_HEADER_BYTES {
                        return Err(format!(
                            "a header block is over the {MAX_HEADER_BYTES}-byte limit"
                        ));
                    }
                    break;
                };
                if head > MAX_HEADER_BYTES {
                    return Err(format!(
                        "a header block is over the {MAX_HEADER_BYTES}-byte limit"
                    ));
                }
                let length = content_length(&self.buffer[..head])?;
                self.buffer.drain(..head + 4);
                self.body = Some(length);
            }
            let Some(length) = self.body else {
                break;
            };
            if self.buffer.len() < length {
                break;
            }
            let message: Vec<u8> = self.buffer.drain(..length).collect();
            self.body = None;
            messages.push(message);
        }
        Ok(messages)
    }
}

/// Finds `needle` in `haystack`.
fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || haystack.len() < needle.len() {
        return None;
    }
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

/// Reads `Content-Length` from a header block (case-insensitive), with the
/// bounded body check.
fn content_length(headers: &[u8]) -> Result<usize, String> {
    let text = std::str::from_utf8(headers).map_err(|_| "a header is not UTF-8".to_owned())?;
    let mut length = None;
    for line in text.split("\r\n") {
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        if !name.trim().eq_ignore_ascii_case("content-length") {
            continue;
        }
        if length.is_some() {
            return Err("two Content-Length headers".to_owned());
        }
        let value = value.trim();
        let parsed: usize = value
            .parse()
            .map_err(|_| format!("a Content-Length is not a number: {value:?}"))?;
        if parsed == 0 {
            return Err("a Content-Length of 0 is not a message".to_owned());
        }
        if parsed > MAX_MESSAGE_BYTES {
            return Err(format!(
                "a message is over the {MAX_MESSAGE_BYTES}-byte limit"
            ));
        }
        length = Some(parsed);
    }
    length.ok_or_else(|| "a header block has no Content-Length".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(body: &[u8]) -> Vec<u8> {
        let mut bytes = format!("Content-Length: {}\r\n\r\n", body.len()).into_bytes();
        bytes.extend_from_slice(body);
        bytes
    }

    #[test]
    fn a_frame_split_across_reads_is_one_message() {
        let bytes = frame(b"{\"id\":1}");
        let mut framer = Framer::default();
        assert!(framer.push(&bytes[..5]).unwrap().is_empty());
        assert!(framer.push(&bytes[5..bytes.len() - 2]).unwrap().is_empty());
        let messages = framer.push(&bytes[bytes.len() - 2..]).unwrap();
        assert_eq!(messages, vec![b"{\"id\":1}".to_vec()]);
    }

    #[test]
    fn several_frames_in_one_read_all_come_out() {
        let mut bytes = frame(b"one");
        bytes.extend(frame(b"two"));
        bytes.extend(frame(b"three"));
        let mut framer = Framer::default();
        let messages = framer.push(&bytes).unwrap();
        assert_eq!(messages.len(), 3);
        assert_eq!(messages[2], b"three".to_vec());
    }

    #[test]
    fn extra_headers_and_other_cases_are_accepted() {
        let bytes = b"Content-Type: application/vscode-jsonrpc; charset=utf-8\r\ncontent-length: 2\r\n\r\n{}";
        let mut framer = Framer::default();
        assert_eq!(framer.push(bytes).unwrap(), vec![b"{}".to_vec()]);
    }

    #[test]
    fn a_header_without_a_length_or_with_a_bad_one_is_an_error() {
        let mut framer = Framer::default();
        assert!(
            framer
                .push(b"Content-Type: x\r\n\r\n")
                .unwrap_err()
                .contains("no Content-Length")
        );
        let mut framer = Framer::default();
        assert!(
            framer
                .push(b"Content-Length: nope\r\n\r\n")
                .unwrap_err()
                .contains("not a number")
        );
        let mut framer = Framer::default();
        assert!(
            framer
                .push(b"Content-Length: 0\r\n\r\n")
                .unwrap_err()
                .contains("not a message")
        );
    }

    #[test]
    fn an_oversized_body_is_refused_before_it_is_buffered() {
        let mut framer = Framer::default();
        let head = format!("Content-Length: {}\r\n\r\n", MAX_MESSAGE_BYTES + 1);
        assert!(framer.push(head.as_bytes()).unwrap_err().contains("over"));
        // A header that never ends hits the header cap.
        let mut framer = Framer::default();
        let junk = vec![b'x'; MAX_HEADER_BYTES + 1];
        assert!(framer.push(&junk).unwrap_err().contains("header block"));
    }

    #[test]
    fn a_multibyte_body_is_framed_by_bytes_not_characters() {
        let body = "é中".as_bytes();
        assert_eq!(body.len(), 5);
        let mut framer = Framer::default();
        assert_eq!(framer.push(&frame(body)).unwrap(), vec![body.to_vec()]);
    }

    #[test]
    fn a_bare_name_is_found_and_a_missing_one_is_coded() {
        let sh = resolve_program("sh").expect("sh is on PATH");
        assert!(sh.is_absolute());
        assert_eq!(
            resolve_program("zu-m11-not-a-real-language-server")
                .unwrap_err()
                .code(),
            Some(ERR_COMMAND)
        );
        assert_eq!(
            resolve_program("/definitely/not/a/server")
                .unwrap_err()
                .code(),
            Some(ERR_COMMAND)
        );
    }

    #[test]
    fn a_cwd_is_required_absolute_and_real() {
        assert_eq!(explicit_cwd(None).unwrap_err().code(), Some(ERR_CWD));
        assert_eq!(explicit_cwd(Some("")).unwrap_err().code(), Some(ERR_CWD));
        assert_eq!(
            explicit_cwd(Some("relative")).unwrap_err().code(),
            Some(ERR_CWD)
        );
        assert_eq!(
            explicit_cwd(Some("/definitely/not/a/dir"))
                .unwrap_err()
                .code(),
            Some(ERR_CWD)
        );
        let cwd = explicit_cwd(Some("/tmp")).expect("/tmp is a directory");
        assert!(cwd.is_absolute());
    }
}
