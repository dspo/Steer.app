//! Zu's native module: it owns the engine sidecar's process and the external
//! containers' pseudo-terminals.
//!
//! The UI cannot start the sidecar itself — `capabilities.process.execute`
//! takes exact command names or absolute paths and never expands host
//! placeholders, while the sidecar's path follows the app's install
//! location. This module resolves that path at run time and keeps the
//! child alive for the app's lifetime. The PTY side is in [`pty`]: a real
//! shell or agent TUI, its bytes pushed to TSX through a callback rather
//! than the engine wire. [`instance`] owns the single-instance lock: one
//! live Zu per state directory, claimed before the sidecar starts.

use std::{
    io::Write,
    net::TcpStream,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    time::{Duration, Instant},
};

use nsh_core::prelude::*;

mod fs;
mod git;
mod instance;
mod lsp;
mod picker;
mod pty;

/// Lilex, the sheet content's face (§2.3-16, DESIGN §3.4): the crate ships
/// both weights (`registry.assets(assets!())`), and the engine registers
/// them before the first render under the family the files' name tables
/// carry — TS names it as `fonts.ts`'s `SHEET_FONT`.
pub use fs::{Fs, FsEntry, FsExpected, FsFile, FsStat, FsWriteResult};
pub use git::{Git, GitBranch, GitBranches, GitChange, GitCommit, GitDiff, GitStatus};
pub use instance::{Instance, InstanceClaim};
pub use lsp::{Lsp, LspExit, LspOptions};
pub use picker::Picker;
pub use pty::{Pty, PtyExit, PtyOptions};

/// The engine's default loopback port: 0 asks the system for a free one, so
/// a development instance, a test run and the packaged app never collide.
/// An explicit `ZU_PORT` (tests, a deliberate fixed port) still wins.
const ENGINE_PORT: u16 = 0;

fn engine_port() -> u16 {
    std::env::var("ZU_PORT")
        .ok()
        .and_then(|port| port.trim().parse().ok())
        .unwrap_or(ENGINE_PORT)
}

struct EngineState {
    child: Child,
    port: u16,
}

/// The running sidecar; `None` before the first start and after a failure.
static ENGINE: Mutex<Option<EngineState>> = Mutex::new(None);

/// The last exit status the host saw, for the supervision status line.
static LAST_EXIT: Mutex<Option<i32>> = Mutex::new(None);

/// Extension paths the host adds to the standard pi locations (tests and
/// development builds use it; a packaged app leaves it empty).
static EXTRA_EXTENSIONS: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// The state directory beside pi's state (`~/.pi/zu` unless a test points
/// it elsewhere): registry, layouts, token, generation and log.
static STATE_DIR: Mutex<Option<PathBuf>> = Mutex::new(None);

/// Whether the next sidecar skips extensions (tests that only exercise the
/// container registry); a packaged app always loads them.
static NO_EXTENSIONS: Mutex<bool> = Mutex::new(false);

/// pi's home for the sidecar (`~/.pi/agent` unless a test points it
/// elsewhere): credentials and `models.json`. The model list a session
/// reports comes from here, so an empty directory is the no-models state.
static AGENT_DIR: Mutex<Option<PathBuf>> = Mutex::new(None);

/// The engine sidecar: start, stop, and where to reach it.
#[module]
pub struct Engine;

#[module]
impl Engine {
    /// Starts the sidecar unless a healthy one is already running.
    ///
    /// A start is only successful once the child has published the port it
    /// actually bound (an ephemeral one unless `ZU_PORT` names a fixed port).
    /// A child that exits, or stays silent, before publishing is killed and
    /// reaped here, so a failed start leaves no zombie and no stale `ENGINE`
    /// state for the next attempt.
    pub async fn start() -> Result<(), String> {
        let mut guard = ENGINE
            .lock()
            .map_err(|_| "engine lock poisoned".to_owned())?;
        let dir = zu_dir()?;
        let port_file = dir.join("engine.port");
        if let Some(state) = guard.as_mut() {
            match state.child.try_wait() {
                Ok(None) => {
                    // Healthy means the process is up and reachable on the
                    // port this state recorded; a port file from another
                    // process (or a wedged sidecar) is mismatched state.
                    if read_port(&port_file) == Some(state.port) || port_accepts(state.port) {
                        return Ok(());
                    }
                }
                Ok(Some(status)) => record_exit(Ok(status)),
                Err(_) => {}
            }
            let _ = state.child.kill();
            record_exit(state.child.wait());
            *guard = None;
        }
        let token = ensure_token()?;
        let path = engine_path().ok_or_else(|| {
            "engine sidecar not found (build it with `cd pi-harness && bun run build`)".to_owned()
        })?;
        let _ = std::fs::remove_file(&port_file);
        let log = std::fs::File::create(dir.join("engine.log")).map_err(|e| e.to_string())?;
        let stderr = log.try_clone().map_err(|e| e.to_string())?;
        let requested = engine_port();
        let mut command = Command::new(&path);
        let extra = EXTRA_EXTENSIONS
            .lock()
            .map(|paths| paths.join(","))
            .unwrap_or_default();
        if !extra.is_empty() {
            command.env("ZU_EXTENSION_PATHS", extra);
        }
        if let Some(dir) = STATE_DIR.lock().ok().and_then(|dir| dir.clone()) {
            command.env("ZU_STATE_DIR", dir);
        }
        if NO_EXTENSIONS.lock().map(|skip| *skip).unwrap_or(false) {
            command.env("ZU_NO_EXTENSIONS", "1");
        }
        if let Some(dir) = AGENT_DIR.lock().ok().and_then(|dir| dir.clone()) {
            command.env("PI_CODING_AGENT_DIR", dir);
        }
        let mut child = command
            .env("ZU_PORT", requested.to_string())
            .env("ZU_TOKEN", &token)
            .stdin(Stdio::null())
            .stdout(Stdio::from(log))
            .stderr(Stdio::from(stderr))
            .spawn()
            .map_err(|e| format!("cannot start {}: {e}", path.display()))?;
        // The sidecar binds and then writes the port it got (ZU_PORT=0 asks
        // the system for a free one). Wait for it so `port()` has an answer
        // by the time `connect` asks, and fail the start if the child dies.
        let port = match await_engine_port(&mut child, &port_file, requested) {
            Ok(port) => port,
            Err(error) => {
                let _ = child.kill();
                record_exit(child.wait());
                return Err(format!(
                    "{error} — see {}",
                    dir.join("engine.log").display()
                ));
            }
        };
        *guard = Some(EngineState { child, port });
        Ok(())
    }

    /// Stops the sidecar; the next `start` runs a new one.
    pub async fn stop() -> Result<(), String> {
        let mut guard = ENGINE
            .lock()
            .map_err(|_| "engine lock poisoned".to_owned())?;
        if let Some(mut state) = guard.take() {
            let _ = state.child.kill();
            record_exit(state.child.wait());
        }
        Ok(())
    }

    /// Kills the sidecar without a graceful close, as a crash would.
    pub async fn kill() -> Result<(), String> {
        let mut guard = ENGINE
            .lock()
            .map_err(|_| "engine lock poisoned".to_owned())?;
        if let Some(mut state) = guard.take() {
            let _ = state.child.kill();
            record_exit(state.child.wait());
        }
        Ok(())
    }

    /// The last exit status the host collected, if any.
    pub fn exit_code() -> Option<i32> {
        LAST_EXIT.lock().ok().and_then(|code| *code)
    }

    /// The sidecar's process id, 0 when it is not running.
    pub fn pid() -> u32 {
        let Ok(mut guard) = ENGINE.lock() else {
            return 0;
        };
        let Some(state) = guard.as_mut() else {
            return 0;
        };
        match state.child.try_wait() {
            Ok(None) => state.child.id(),
            Ok(Some(status)) => {
                record_exit(Ok(status));
                *guard = None;
                0
            }
            Err(_) => 0,
        }
    }

    /// `"running"` while the sidecar process is alive.
    pub fn status() -> String {
        let Ok(mut guard) = ENGINE.lock() else {
            return "stopped".to_owned();
        };
        let Some(state) = guard.as_mut() else {
            return "stopped".to_owned();
        };
        match state.child.try_wait() {
            Ok(None) => "running".to_owned(),
            Ok(Some(status)) => {
                record_exit(Ok(status));
                *guard = None;
                "stopped".to_owned()
            }
            Err(_) => "stopped".to_owned(),
        }
    }

    /// The port the running sidecar bound; 0 when it is not running. A dead
    /// child is reaped here too, so a caller can never dial a stale port.
    pub fn port() -> u16 {
        let Ok(mut guard) = ENGINE.lock() else {
            return 0;
        };
        let Some(state) = guard.as_mut() else {
            return 0;
        };
        match state.child.try_wait() {
            Ok(None) => state.port,
            Ok(Some(status)) => {
                record_exit(Ok(status));
                *guard = None;
                0
            }
            Err(_) => 0,
        }
    }

    /// Whether the running sidecar is the process the shell is talking to:
    /// same pid, same port, still alive. The socket handshake checks this
    /// before declaring the engine connected; a mismatch means stale state
    /// or a foreign process, and the shell then restarts the sidecar.
    pub fn verify(pid: u32, port: u16) -> bool {
        if pid == 0 || port == 0 {
            return false;
        }
        let Ok(mut guard) = ENGINE.lock() else {
            return false;
        };
        let Some(state) = guard.as_mut() else {
            return false;
        };
        match state.child.try_wait() {
            Ok(None) => state.child.id() == pid && state.port == port,
            Ok(Some(status)) => {
                record_exit(Ok(status));
                *guard = None;
                false
            }
            Err(_) => false,
        }
    }

    /// Whether the sidecar's loopback port is free. With the default
    /// `ZU_PORT=0` the system always chooses a free port, so this reports
    /// true; an explicit `ZU_PORT` is probed so the shell can say "the port
    /// is in use" instead of showing a bare timeout.
    pub fn port_available() -> bool {
        let requested = engine_port();
        requested == 0 || port_available_on(requested)
    }

    /// The handshake token the sidecar expects; created on first use.
    /// Empty when the state directory cannot be written.
    pub fn token() -> String {
        ensure_token().unwrap_or_default()
    }

    /// Adds extension paths to the standard pi locations for the next start
    /// (comma-separated absolute paths; the packaged app leaves it empty).
    pub fn set_extension_paths(paths: String) {
        if let Ok(mut extra) = EXTRA_EXTENSIONS.lock() {
            *extra = paths
                .split(',')
                .map(str::trim)
                .filter(|path| !path.is_empty())
                .map(str::to_owned)
                .collect();
        }
    }

    /// Points the engine's state (registry, layouts, token, log) at `path`
    /// for the next start; an empty string restores `~/.pi/zu`. Tests use it
    /// so a run never touches the user's containers.
    pub fn set_state_dir(path: String) {
        if let Ok(mut dir) = STATE_DIR.lock() {
            *dir = if path.trim().is_empty() {
                None
            } else {
                Some(PathBuf::from(path.trim()))
            };
        }
    }

    /// Skips extension discovery in the next start (tests of the container
    /// registry, where loading every installed extension only adds time).
    pub fn set_no_extensions(skip: bool) {
        if let Ok(mut flag) = NO_EXTENSIONS.lock() {
            *flag = skip;
        }
    }

    /// Points pi's home for the next start at `path`; an empty string
    /// restores `~/.pi/agent`. Tests use it to reach the no-models state
    /// without touching the user's credentials.
    pub fn set_agent_dir(path: String) {
        if let Ok(mut dir) = AGENT_DIR.lock() {
            *dir = if path.trim().is_empty() {
                None
            } else {
                Some(PathBuf::from(path.trim()))
            };
        }
    }

    /// The sidecar's log file (`~/.pi/zu/engine.log`).
    pub fn log_path() -> String {
        zu_dir()
            .map(|dir| dir.join("engine.log").display().to_string())
            .unwrap_or_default()
    }
}

/// The crate's UI set (`nsh.json` `"rust"`): what TSX imports as `zu/native`.
#[native_module("zu/native")]
fn native(registry: &mut Registry) {
    registry
        .assets(assets!())
        .module::<Engine>()
        .module::<Fs>()
        .module::<Git>()
        .module::<Instance>()
        .module::<Picker>()
        .class::<Lsp>()
        .class::<Pty>();
}

#[cfg(test)]
mod font_tests {
    use nsh_core::element::FontAsset;

    use super::asset;

    // §2.3-16 (DESIGN §3.4): both weights under ONE family, so the layout
    // picks the nearest weight — body's 400 reads Light (300), bold's 600+
    // reads Medium (500). Two different names would break that mapping, and
    // `fonts.ts` names the family by this literal.
    const LILEX_LIGHT: FontAsset = asset!("fonts/Lilex-Light.ttf");
    const LILEX_MEDIUM: FontAsset = asset!("fonts/Lilex-Medium.ttf");

    #[test]
    fn lilex_ships_under_one_family() {
        assert_eq!(LILEX_LIGHT.family, "Lilex");
        assert_eq!(LILEX_MEDIUM.family, LILEX_LIGHT.family);
    }
}

/// The port published in `engine.port`, if it parses and is non-zero.
fn read_port(path: &Path) -> Option<u16> {
    let text = std::fs::read_to_string(path).ok()?;
    let port = text.trim().parse::<u16>().ok()?;
    (port != 0).then_some(port)
}

/// Waits for the sidecar to publish the port it bound. The child is watched
/// as well as the file: a process that exits before publishing fails the
/// start immediately instead of leaving a 10 s timeout and a zombie behind.
/// With an explicit `ZU_PORT` the requested port is the fallback when the
/// state directory is read-only and the file can never appear.
fn await_engine_port(child: &mut Child, path: &Path, requested: u16) -> Result<u16, String> {
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let code = status
                    .code()
                    .map(|code| code.to_string())
                    .unwrap_or_else(|| "signal".to_owned());
                return Err(format!(
                    "the engine exited before it published a port (exit {code})"
                ));
            }
            Ok(None) => {}
            Err(error) => return Err(format!("cannot check the engine process: {error}")),
        }
        if let Some(port) = read_port(path) {
            if requested == 0 || port == requested {
                return Ok(port);
            }
            return Err(format!(
                "the engine published port {port}, but ZU_PORT asked for {requested}"
            ));
        }
        if Instant::now() >= deadline {
            if requested != 0 {
                return Ok(requested);
            }
            return Err("the engine did not publish a port within 10 s".to_owned());
        }
        std::thread::sleep(Duration::from_millis(25));
    }
}

/// Whether something accepts TCP connections on the sidecar's loopback port.
fn port_accepts(port: u16) -> bool {
    TcpStream::connect_timeout(
        &std::net::SocketAddr::from(([127, 0, 0, 1], port)),
        Duration::from_millis(250),
    )
    .is_ok()
}

/// Whether `port` can be bound on the sidecar's loopback address.
fn port_available_on(port: u16) -> bool {
    std::net::TcpListener::bind(("127.0.0.1", port)).is_ok()
}

/// Remembers an exit status for `exit_code`.
fn record_exit(status: std::io::Result<std::process::ExitStatus>) {
    if let Ok(status) = status
        && let Ok(mut code) = LAST_EXIT.lock()
    {
        *code = status.code();
    }
}

/// `~/.pi/zu`, created on first use.
pub(crate) fn zu_dir() -> Result<PathBuf, String> {
    if let Some(dir) = STATE_DIR.lock().ok().and_then(|dir| dir.clone()) {
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        return Ok(dir);
    }
    if let Ok(dir) = std::env::var("ZU_STATE_DIR")
        && !dir.trim().is_empty()
    {
        let dir = PathBuf::from(dir.trim());
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        return Ok(dir);
    }
    let home = std::env::var("HOME").map_err(|_| "HOME is not set".to_owned())?;
    let dir = PathBuf::from(home).join(".pi").join("zu");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// The sidecar binary. A packaged app's `Contents/Helpers` comes first: the
/// checkout that built it may still be on the machine, and the shipped
/// engine must not be shadowed by it. Development falls back to the
/// repository's build.
fn engine_path() -> Option<PathBuf> {
    if let Ok(exe) = std::env::current_exe()
        && let Some(parent) = exe.parent()
    {
        let packaged = parent.join("../Helpers/pi-engine");
        if packaged.is_file() {
            return Some(packaged);
        }
    }
    let dev = Path::new(env!("CARGO_MANIFEST_DIR")).join("../pi-harness/dist/pi-engine");
    dev.is_file().then_some(dev)
}

/// The handshake token, generated once and kept for later launches.
fn ensure_token() -> Result<String, String> {
    let path = zu_dir()?.join("engine.token");
    if let Ok(token) = std::fs::read_to_string(&path) {
        let token = token.trim().to_owned();
        if token.len() >= 32 {
            return Ok(token);
        }
    }
    let token = random_token();
    let mut file = std::fs::File::create(&path).map_err(|e| e.to_string())?;
    file.write_all(token.as_bytes())
        .map_err(|e| e.to_string())?;
    Ok(token)
}

/// 32 hex characters from the system's random source.
fn random_token() -> String {
    let mut bytes = [0u8; 16];
    if let Ok(mut source) = std::fs::File::open("/dev/urandom") {
        use std::io::Read;
        let _ = source.read_exact(&mut bytes);
    }
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::{await_engine_port, port_available_on, read_port};

    /// A path this test owns; no other test writes the same name.
    fn temp_port_file(name: &str) -> std::path::PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock after the epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("zu-port-{name}-{}-{nanos}", std::process::id()))
    }

    /// The browser is UI-only, so its capability must stay the Q32 minimum:
    /// any site in the web view, no trusted input, exactly one explicit
    /// external scheme (the VS Code action), and no file or process grants.
    /// This test reads the declaration itself, so a later capability edit
    /// that widens the UI's blast radius fails here.
    #[test]
    fn a_port_held_by_another_process_is_not_available() {
        let listener =
            std::net::TcpListener::bind(("127.0.0.1", 0)).expect("bind an ephemeral port");
        let port = listener.local_addr().expect("local address").port();
        assert!(!port_available_on(port), "a bound port is not free");
        drop(listener);
    }

    /// The process manager's failure path: a child that dies before writing
    /// its port must fail the start at once, leaving no zombie and no port to
    /// dial. `/bin/sh -c 'exit 7'` is the sidecar that crashed on boot.
    #[test]
    fn a_child_that_exits_before_the_port_fails_the_start() {
        let path = temp_port_file("exit");
        let mut child = std::process::Command::new("sh")
            .arg("-c")
            .arg("exit 7")
            .spawn()
            .expect("spawn a child that exits immediately");
        let error = await_engine_port(&mut child, &path, 0).expect_err("a dead child must fail");
        assert!(
            error.contains("exited before it published a port"),
            "the failure names the exit, not a timeout: {error}"
        );
        assert!(
            error.contains("exit 7"),
            "the exit status is reported: {error}"
        );
        assert!(
            child.try_wait().expect("reap the child").is_some(),
            "the failed child was reaped (no zombie)"
        );
    }

    /// The published port is the authority: with `ZU_PORT=0` the host cannot
    /// know the free port the system picked until the sidecar writes it.
    #[test]
    fn the_published_port_is_the_one_the_host_uses() {
        let path = temp_port_file("published");
        let mut child = std::process::Command::new("sh")
            .arg("-c")
            .arg(r#"printf '%s' "$1" > "$2"; exec sleep 5"#)
            .arg("sh")
            .arg("54321")
            .arg(&path)
            .spawn()
            .expect("spawn a child that publishes its port");
        let port = await_engine_port(&mut child, &path, 0).expect("the published port");
        assert_eq!(port, 54321);
        let _ = child.kill();
        let _ = child.wait();
        let _ = std::fs::remove_file(&path);
    }

    /// A zero or malformed port is not a published port: the host must keep
    /// waiting rather than dial 0.
    #[test]
    fn a_zero_or_malformed_port_is_not_a_published_port() {
        let path = temp_port_file("invalid");
        std::fs::write(&path, "0").expect("write a zero port");
        assert_eq!(read_port(&path), None);
        std::fs::write(&path, "not-a-port").expect("write garbage");
        assert_eq!(read_port(&path), None);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn browser_capabilities_are_the_ui_only_minimum() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../app/nsh.json");
        let manifest = std::fs::read_to_string(path).expect("read nsh.json");
        let json: serde_json::Value = serde_json::from_str(&manifest).expect("nsh.json is JSON");
        let capabilities = json.get("capabilities").expect("capabilities");

        assert_eq!(
            capabilities.pointer("/webview/hosts"),
            Some(&serde_json::json!(["*"])),
            "the address bar may open any site (Q32)"
        );
        assert!(
            capabilities.pointer("/webview/input").is_none(),
            "trusted web input is never granted unless a feature needs it"
        );
        assert_eq!(
            capabilities.pointer("/openUrl/schemes"),
            Some(&serde_json::json!(["vscode"])),
            "only the VS Code action may open an external app"
        );
        assert_eq!(
            capabilities
                .get("openUrl")
                .and_then(|open| open.as_object().map(|open| open.len())),
            Some(1),
            "no grants beyond the one scheme list"
        );
        assert_eq!(
            capabilities.get("notifications"),
            Some(&serde_json::json!(true)),
            "M12 shows system notifications through nsh's Notifications"
        );
        assert!(capabilities.get("fs").is_none(), "files go through zu/fs");
        assert!(
            capabilities.pointer("/process/execute").is_none(),
            "processes go through the native module"
        );
    }
}
