//! `zu/acp`: per-turn ACP harness processes over ndjson stdio (v2 §7).
//!
//! One class instance is one `pi-acp` child: an explicit argv, an explicit
//! working directory, no shell, its own process group. A reader thread frames
//! stdout into newline-delimited messages (a line is capped at 32 MiB — tool
//! outputs reach MiB scale, following the bounded-frame precedent of
//! [`crate::lsp`]), a writer thread frames what TSX sends, a third thread
//! collects stderr, and a waiter turns the process's death into an event; a
//! task of the NSH core posts each through `Callback::post`.
//!
//! The module ships bytes and owns the process — **zero JSON parsing, zero id
//! pairing** (v2 §3: the transport layering that mirrors `zu/lsp`). JSON-RPC
//! ids, timeouts and notification dispatch live in the TS client. The
//! graceful exit is `finish()` (close stdin: an ACP agent flushes and exits);
//! `kill` and dropping the handle hang up the whole process group.
//!
//! Failures carry `code` (`ERR_ACP_ARGS`, `ERR_ACP_ENV`, `ERR_ACP_CWD`,
//! `ERR_ACP_SPAWN`, `ERR_ACP_INPUT`, `ERR_ACP_CLOSED`).
//!
//! When TSX names no command, the harness binary is resolved here: a packaged
//! app's `Contents/Helpers/pi-acp` first, then the repository's build — the
//! UI cannot know the install location. An explicit `command` (tests, a stub
//! agent) wins.

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

use crate::{AGENT_DIR, EXTRA_EXTENSIONS, NO_EXTENSIONS, harness_path};

#[cfg(unix)]
use std::os::unix::process::CommandExt;

/// The largest one protocol line this module accepts (v2 §7.3): a line over
/// it is a desync, not a message, and is never buffered whole.
const MAX_LINE_BYTES: usize = 32 * 1024 * 1024;
/// Bytes queued for the harness's stdin; a harness that stops reading makes
/// `send` fail instead of growing without bound.
const MAX_INPUT_BYTES: usize = 32 * 1024 * 1024;
/// Arguments are capped so a bad call cannot build an unbounded argv.
const MAX_ARGS: usize = 256;
/// One read of stderr is posted at most this large; a chatty harness can
/// still fill the queue, which back-pressures it.
const MAX_STDERR_CHUNK: usize = 4 * 1024;
/// Events waiting for the posting task; the reader back-pressures the harness
/// when TSX falls behind.
const EVENT_QUEUE: usize = 64;

const ERR_COMMAND: &str = "ERR_ACP_ARGS";
const ERR_CWD: &str = "ERR_ACP_CWD";
const ERR_ARGS: &str = "ERR_ACP_ARGS";
const ERR_ENV: &str = "ERR_ACP_ENV";
const ERR_SPAWN: &str = "ERR_ACP_SPAWN";
const ERR_INPUT: &str = "ERR_ACP_INPUT";
const ERR_CLOSED: &str = "ERR_ACP_CLOSED";

/// How a harness process starts.
#[derive(Debug, Clone, Default, JsObject)]
pub struct AcpOptions {
    /// The working directory the pi session runs in; required and absolute.
    pub cwd: String,
    /// An explicit program override (a stub agent in tests). Empty names the
    /// shipped `pi-acp` harness, resolved like the legacy engine sidecar.
    pub command: Option<String>,
    /// Extra arguments after the program; normally none. Never shell-read.
    pub args: Option<Vec<String>>,
    /// Extra environment entries; the app's environment is inherited.
    pub env: Option<BTreeMap<String, String>>,
}

/// How a harness process ended.
#[derive(Debug, Clone, Default, JsObject)]
pub struct AcpExit {
    /// The exit status, `null` when a signal ended it.
    pub code: Option<i32>,
    /// The signal's name (`"SIGTERM"`), `null` on a normal exit.
    pub signal: Option<String>,
}

/// A running harness process.
///
/// `new Acp(options, onFrame, onStderr, onExit?)` starts it. `onFrame` gets
/// each complete stdout line (its JSON intact — this module does not parse
/// it), `onStderr` gets the harness's stderr as it is written, and `onExit`
/// fires once when the process ends. `send` writes one line plus the newline,
/// `finish` closes stdin (the graceful ACP exit), `kill` hangs up the process
/// group, and dropping the handle does the same.
#[class]
pub struct Acp {
    control: Arc<Control>,
    pid: Option<u32>,
    program: String,
    exited: Arc<AtomicBool>,
    exit_code: Arc<Mutex<Option<i32>>>,
    exit_signal: Arc<Mutex<Option<String>>>,
}

/// What `finish`, `kill`, the drop and the reader/writer share.
struct Control {
    /// A hard hang-up happened (`kill` or the drop): no more sends.
    closed: AtomicBool,
    /// stdin was handed to the harness as EOF (the graceful exit).
    finished: AtomicBool,
    pid: Option<u32>,
    writer: Mutex<Option<mpsc::Sender<Vec<u8>>>>,
    queued: Arc<Mutex<usize>>,
}

impl Control {
    /// Ends the writer thread, which drops stdin: the harness sees EOF,
    /// flushes and exits. Idempotent; safe from any thread.
    fn finish(&self) {
        if self.finished.swap(true, Ordering::AcqRel) {
            return;
        }
        if let Ok(mut writer) = self.writer.lock() {
            writer.take();
        }
    }

    /// Hangs up the harness and its children. Idempotent; safe from any
    /// thread.
    fn kill(&self) {
        if self.closed.swap(true, Ordering::AcqRel) {
            return;
        }
        if let Some(pid) = self.pid {
            kill_group(pid);
        }
        self.finish();
    }

    fn send(&self, line: &str) -> Result<(), JsError> {
        if self.closed.load(Ordering::Acquire) {
            return Err(acp_error(ERR_CLOSED, "the harness process is closed"));
        }
        if line.trim().is_empty() {
            return Err(acp_error(ERR_INPUT, "the line is empty"));
        }
        if line.len() > MAX_INPUT_BYTES {
            return Err(acp_error(
                ERR_INPUT,
                format!("the line is over the {MAX_INPUT_BYTES}-byte limit"),
            ));
        }
        let Ok(writer) = self.writer.lock() else {
            return Err(acp_error(ERR_CLOSED, "the harness lock is poisoned"));
        };
        let Some(writer) = writer.as_ref() else {
            return Err(acp_error(ERR_CLOSED, "the harness's stdin is closed"));
        };
        let Ok(mut pending) = self.queued.lock() else {
            return Err(acp_error(ERR_CLOSED, "the harness lock is poisoned"));
        };
        let mut frame = line.as_bytes().to_vec();
        frame.push(b'\n');
        if pending.saturating_add(frame.len()) > MAX_INPUT_BYTES {
            return Err(acp_error(ERR_INPUT, "the harness is not reading its stdin"));
        }
        *pending += frame.len();
        drop(pending);
        if let Err(error) = writer.send(frame) {
            if let Ok(mut pending) = self.queued.lock() {
                *pending = pending.saturating_sub(error.0.len());
            }
            return Err(acp_error(ERR_CLOSED, "the harness process is closed"));
        }
        Ok(())
    }
}

impl Drop for Acp {
    fn drop(&mut self) {
        self.control.kill();
    }
}

/// Events from the harness's threads to the task that posts them to TSX.
enum Event {
    Frame(Vec<u8>),
    Stderr(Vec<u8>),
    Exit(AcpExit),
}

/// On Unix the child starts in its own process group; killing the group takes
/// the harness's own children (pi's tool subprocesses) with it.
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
/// harness exit.
#[cfg(not(unix))]
fn kill_group(_pid: u32) {}

#[class]
impl Acp {
    /// Starts `options` and wires its streams to the callbacks.
    ///
    /// # Rust
    ///
    /// Takes `cx` only to start the task that posts output to TSX; the spawn
    /// itself is synchronous. The child is killed when this value is dropped
    /// or `kill` is called.
    pub fn start(
        options: AcpOptions,
        #[args(frame)] on_frame: Callback<String>,
        #[args(text)] on_stderr: Callback<String>,
        #[args(exit)] on_exit: Option<Callback<AcpExit>>,
        cx: CallCx<'_>,
    ) -> Result<Acp, JsError> {
        let AcpOptions {
            cwd,
            command,
            args,
            env,
        } = options;
        let cwd = explicit_cwd(Some(cwd.as_str()))?;
        let argv = args.unwrap_or_default();
        if argv.len() > MAX_ARGS {
            return Err(acp_error(
                ERR_ARGS,
                format!("too many arguments (at most {MAX_ARGS})"),
            ));
        }
        for arg in &argv {
            if arg.contains('\0') {
                return Err(acp_error(ERR_ARGS, "an argument contains a NUL byte"));
            }
        }
        let raw = command.as_deref().map(str::trim).filter(|c| !c.is_empty());
        let program = match raw {
            Some(raw) => resolve_program(raw)?,
            None => harness_path("pi-acp").ok_or_else(|| {
                acp_error(
                    ERR_SPAWN,
                    "the pi harness was not found (build it with `cd pi-harness && bun run build`)",
                )
            })?,
        };
        let mut builder = Command::new(&program);
        builder
            .args(&argv)
            .current_dir(&cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        // A new session is a new process group; `kill` hangs up the group.
        #[cfg(unix)]
        builder.process_group(0);
        // The host's harness knobs, the same ones the legacy engine got (v2
        // §4.1: extensions are the distro's business; tests narrow them).
        if let Ok(extra) = EXTRA_EXTENSIONS.lock() {
            let extra = extra.join(",");
            if !extra.is_empty() {
                builder.env("ACP_EXTRA_EXTENSION_PATHS", extra);
            }
        }
        if NO_EXTENSIONS.lock().map(|skip| *skip).unwrap_or(false) {
            builder.env("ACP_NO_EXTENSIONS", "1");
        }
        if let Some(dir) = AGENT_DIR.lock().ok().and_then(|dir| dir.clone()) {
            builder.env("PI_CODING_AGENT_DIR", dir);
        }
        if let Some(env) = env {
            for (name, value) in env {
                if name.is_empty()
                    || name.contains('=')
                    || name.contains('\0')
                    || value.contains('\0')
                {
                    return Err(acp_error(
                        ERR_ENV,
                        format!("invalid environment entry: {name:?}"),
                    ));
                }
                builder.env(name, value);
            }
        }
        let mut child = builder.spawn().map_err(|error| {
            acp_error(
                ERR_SPAWN,
                format!("cannot start {}: {error}", program.display()),
            )
        })?;
        let pid = child.id();
        let Some(stdin) = child.stdin.take() else {
            kill_group(pid);
            return Err(acp_error(ERR_SPAWN, "the harness has no stdin"));
        };
        let Some(stdout) = child.stdout.take() else {
            kill_group(pid);
            return Err(acp_error(ERR_SPAWN, "the harness has no stdout"));
        };
        let Some(stderr) = child.stderr.take() else {
            kill_group(pid);
            return Err(acp_error(ERR_SPAWN, "the harness has no stderr"));
        };

        let (events, mut received) = tokio::sync::mpsc::channel::<Event>(EVENT_QUEUE);
        let exited = Arc::new(AtomicBool::new(false));
        let exit_code = Arc::new(Mutex::new(None));
        let exit_signal = Arc::new(Mutex::new(None));
        let queued = Arc::new(Mutex::new(0usize));

        // The reader: newline-framed lines in, events out. It never touches JS.
        {
            let events = events.clone();
            thread::Builder::new()
                .name("zu-acp-reader".to_owned())
                .spawn(move || {
                    let mut stdout = stdout;
                    let mut framer = LineFramer::default();
                    let mut buffer = [0u8; 32 * 1024];
                    loop {
                        match stdout.read(&mut buffer) {
                            Ok(0) => break,
                            Ok(n) => match framer.push(&buffer[..n]) {
                                Ok(lines) => {
                                    for line in lines {
                                        if events.blocking_send(Event::Frame(line)).is_err() {
                                            return;
                                        }
                                    }
                                }
                                Err(error) => {
                                    let text = format!("acp framing error: {error}");
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
                    acp_error(ERR_SPAWN, format!("cannot start the ACP reader: {error}"))
                })?;
        }

        // The stderr reader: the harness's own account of itself (lossy UTF-8;
        // stderr is not protocol).
        {
            let events = events.clone();
            thread::Builder::new()
                .name("zu-acp-stderr".to_owned())
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
                    acp_error(
                        ERR_SPAWN,
                        format!("cannot start the ACP stderr reader: {error}"),
                    )
                })?;
        }

        // The writer: queued lines out, so no send blocks the engine thread.
        {
            let (input, outgoing) = mpsc::channel::<Vec<u8>>();
            let writer_queued = queued.clone();
            let writer_events = events.clone();
            thread::Builder::new()
                .name("zu-acp-writer".to_owned())
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
                                .blocking_send(Event::Stderr(b"acp: stdin closed".to_vec()));
                            break;
                        }
                    }
                })
                .map_err(|error| {
                    kill_group(pid);
                    acp_error(ERR_SPAWN, format!("cannot start the ACP writer: {error}"))
                })?;
            let control = Control {
                closed: AtomicBool::new(false),
                finished: AtomicBool::new(false),
                pid: Some(pid),
                writer: Mutex::new(Some(input)),
                queued,
            };
            let acp = Acp {
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
                .name("zu-acp-waiter".to_owned())
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
                    let _ = waiter_events.blocking_send(Event::Exit(AcpExit { code, signal }));
                })
                .map_err(|error| {
                    kill_group(pid);
                    acp_error(ERR_SPAWN, format!("cannot start the ACP waiter: {error}"))
                })?;
            // Keep the event sender alive with the task; each thread has its
            // own clone, so the channel closes when the last one stops.
            drop(events);
            cx.start(async move {
                while let Some(event) = received.recv().await {
                    match event {
                        Event::Frame(bytes) => match String::from_utf8(bytes) {
                            Ok(line) => on_frame.post(line),
                            Err(error) => on_stderr.post(format!(
                                "acp: a frame was not valid UTF-8 ({} bytes), dropped",
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
            Ok(acp)
        }
    }

    /// Writes one line; the newline is this module's business. TSX builds the
    /// JSON-RPC envelope.
    pub fn send(&self, line: String) -> Result<(), JsError> {
        self.control.send(&line)
    }

    /// The graceful exit: stdin goes to EOF, and an ACP harness flushes and
    /// exits on its own (v2 §7.1).
    pub fn finish(&self) {
        self.control.finish();
    }

    /// Hangs up the harness and its process group; a second call does nothing.
    pub fn kill(&self) {
        self.control.kill();
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

    /// The program as it was resolved (a packaged Helper or the dev build).
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
    status.signal().map(super::lsp::signal_name)
}

#[cfg(not(unix))]
fn exit_signal_of(_status: &std::process::ExitStatus) -> Option<String> {
    None
}

// --- the start policy -------------------------------------------------------

/// The explicit working directory: required, absolute and a real directory.
fn explicit_cwd(raw: Option<&str>) -> Result<PathBuf, JsError> {
    let raw = raw.map(str::trim).filter(|value| !value.is_empty());
    let Some(raw) = raw else {
        return Err(acp_error(
            ERR_CWD,
            "a harness process needs an explicit cwd",
        ));
    };
    let path = Path::new(raw);
    if !path.is_absolute() {
        return Err(acp_error(
            ERR_CWD,
            format!("the harness cwd is not absolute: {raw}"),
        ));
    }
    let canonical = path.canonicalize().map_err(|error| {
        acp_error(
            ERR_CWD,
            format!("the harness cwd is unusable ({raw}): {error}"),
        )
    })?;
    if !canonical.is_dir() {
        return Err(acp_error(
            ERR_CWD,
            format!("the harness cwd is not a directory: {raw}"),
        ));
    }
    Ok(canonical)
}

/// Resolves an explicit `raw` command to a program without a shell: a path
/// with a separator is used as it is, a bare name is looked up on `PATH` and
/// the usual install directories.
fn resolve_program(raw: &str) -> Result<PathBuf, JsError> {
    let looks_like_path = raw.contains('/') || raw.contains('\\');
    if looks_like_path {
        let path = PathBuf::from(raw);
        if path.is_file() {
            return Ok(path);
        }
        return Err(acp_error(
            ERR_COMMAND,
            format!("the harness program does not exist: {raw}"),
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
    for dir in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"] {
        let dir = PathBuf::from(dir);
        if !directories.contains(&dir) {
            directories.push(dir);
        }
    }
    for dir in &directories {
        let candidate = dir.join(raw);
        if candidate.is_file() {
            return Ok(candidate);
        }
    }
    Err(acp_error(
        ERR_COMMAND,
        format!("the harness program was not found: {raw}"),
    ))
}

// --- framing ----------------------------------------------------------------

/// ACP's framing over a byte stream: newline-delimited lines, each capped.
/// A read may end anywhere (mid-line, mid-UTF-8), so this keeps its own
/// buffer; a line over the cap is an error, not a truncated message.
#[derive(Default)]
struct LineFramer {
    buffer: Vec<u8>,
}

impl LineFramer {
    /// Adds `bytes`; returns every complete line now available.
    fn push(&mut self, bytes: &[u8]) -> Result<Vec<Vec<u8>>, String> {
        self.buffer.extend_from_slice(bytes);
        let mut lines = Vec::new();
        while let Some(newline) = self.buffer.iter().position(|byte| *byte == b'\n') {
            let line: Vec<u8> = self.buffer.drain(..newline + 1).collect();
            let mut line = line;
            line.pop(); // the newline itself
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            lines.push(line);
        }
        if self.buffer.len() > MAX_LINE_BYTES {
            return Err(format!("a line is over the {MAX_LINE_BYTES}-byte limit"));
        }
        Ok(lines)
    }
}

fn acp_error(code: &str, message: impl Into<String>) -> JsError {
    JsError::Error(message.into()).with_code(code)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lines(bytes: &[u8]) -> Vec<String> {
        LineFramer::default()
            .push(bytes)
            .unwrap()
            .iter()
            .map(|line| String::from_utf8_lossy(line).into_owned())
            .collect()
    }

    #[test]
    fn a_line_split_across_reads_is_one_message() {
        let mut framer = LineFramer::default();
        let full: &[u8] = b"{\"id\":1}\n";
        assert!(framer.push(&full[..5]).unwrap().is_empty());
        assert!(framer.push(&full[5..8]).unwrap().is_empty());
        let lines = framer.push(&full[8..]).unwrap();
        assert_eq!(lines, vec![b"{\"id\":1}".to_vec()]);
    }

    #[test]
    fn several_lines_in_one_read_all_come_out() {
        assert_eq!(lines(b"one\ntwo\nthree\n"), vec!["one", "two", "three"]);
    }

    #[test]
    fn an_unterminated_tail_waits_for_its_newline() {
        let mut framer = LineFramer::default();
        assert!(framer.push(b"partial").unwrap().is_empty());
        assert_eq!(lines_from(&mut framer, b" rest\n"), ["partial rest"]);
    }

    fn lines_from(framer: &mut LineFramer, bytes: &[u8]) -> Vec<String> {
        framer
            .push(bytes)
            .unwrap()
            .iter()
            .map(|line| String::from_utf8_lossy(line).into_owned())
            .collect()
    }

    #[test]
    fn a_carriage_return_is_not_part_of_the_line() {
        assert_eq!(lines(b"line\r\n"), vec!["line"]);
    }

    #[test]
    fn an_empty_line_is_an_empty_frame() {
        assert_eq!(lines(b"\n"), vec![""]);
    }

    #[test]
    fn a_line_over_the_cap_is_an_error_not_a_buffer() {
        let mut framer = LineFramer::default();
        let junk = vec![b'x'; MAX_LINE_BYTES + 1];
        assert!(framer.push(&junk).unwrap_err().contains("over"));
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

    #[test]
    fn an_explicit_command_resolves_or_refuses() {
        let sh = resolve_program("sh").expect("sh is on PATH");
        assert!(sh.is_absolute());
        assert_eq!(
            resolve_program("zu-m12-not-a-real-harness")
                .unwrap_err()
                .code(),
            Some(ERR_COMMAND)
        );
        assert_eq!(
            resolve_program("/definitely/not/a/program")
                .unwrap_err()
                .code(),
            Some(ERR_COMMAND)
        );
    }

    #[test]
    fn multibyte_lines_stay_whole() {
        let body = "你好 world é".as_bytes();
        let mut framed = body.to_vec();
        framed.push(b'\n');
        assert_eq!(lines(&framed), vec![String::from_utf8_lossy(body)]);
    }
}
