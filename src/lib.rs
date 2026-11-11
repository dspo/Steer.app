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
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
};

use nsh_core::prelude::*;

mod fs;
mod git;
mod instance;
mod lsp;
mod pty;

pub use fs::{Fs, FsEntry, FsExpected, FsFile, FsStat, FsWriteResult};
pub use git::{
    Git, GitBranch, GitBranches, GitChange, GitCommit, GitDiff, GitStatus,
};
pub use instance::{Instance, InstanceClaim};
pub use lsp::{Lsp, LspExit, LspOptions};
pub use pty::{Pty, PtyExit, PtyOptions};

/// The sidecar's default loopback port; `ZU_PORT` overrides it for a second
/// development instance and for tests that must not touch a running app.
const ENGINE_PORT: u16 = 47823;

fn engine_port() -> u16 {
    std::env::var("ZU_PORT")
        .ok()
        .and_then(|port| port.parse().ok())
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

/// The engine sidecar: start, stop, and where to reach it.
#[module]
pub struct Engine;

#[module]
impl Engine {
    /// Starts the sidecar unless it is already running.
    pub async fn start() -> Result<(), String> {
        let mut guard = ENGINE.lock().map_err(|_| "engine lock poisoned".to_owned())?;
        if let Some(state) = guard.as_mut() {
            if state.child.try_wait().map_err(|e| e.to_string())?.is_none() {
                return Ok(());
            }
        }
        let token = ensure_token()?;
        let path = engine_path().ok_or_else(|| {
            "engine sidecar not found (build it with `cd engine && bun run build`)".to_owned()
        })?;
        let dir = zu_dir()?;
        let port_file = dir.join("engine.port");
        let _ = std::fs::remove_file(&port_file);
        let log = std::fs::File::create(dir.join("engine.log")).map_err(|e| e.to_string())?;
        let stderr = log.try_clone().map_err(|e| e.to_string())?;
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
        let child = command
            .env("ZU_PORT", engine_port().to_string())
            .env("ZU_TOKEN", &token)
            .stdin(Stdio::null())
            .stdout(Stdio::from(log))
            .stderr(Stdio::from(stderr))
            .spawn()
            .map_err(|e| format!("cannot start {}: {e}", path.display()))?;
        // The sidecar binds and then writes the port it got (ZU_PORT=0 asks
        // the system for a free one). Wait for it so `port()` has an answer
        // by the time `connect` asks.
        let port = wait_for_port(&port_file, engine_port());
        *guard = Some(EngineState { child, port });
        Ok(())
    }

    /// Stops the sidecar; the next `start` runs a new one.
    pub async fn stop() -> Result<(), String> {
        let mut guard = ENGINE.lock().map_err(|_| "engine lock poisoned".to_owned())?;
        if let Some(mut state) = guard.take() {
            let _ = state.child.kill();
            record_exit(state.child.wait());
        }
        Ok(())
    }

    /// Kills the sidecar without a graceful close, as a crash would.
    pub async fn kill() -> Result<(), String> {
        let mut guard = ENGINE.lock().map_err(|_| "engine lock poisoned".to_owned())?;
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
            _ => 0,
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

    /// The port the running sidecar bound; 0 before a start.
    pub fn port() -> u16 {
        ENGINE
            .lock()
            .ok()
            .and_then(|guard| guard.as_ref().map(|state| state.port))
            .unwrap_or(0)
    }

    /// Whether the sidecar's loopback port is free. A bind that fails means
    /// another process (another Zu, an orphaned sidecar) holds it, which the
    /// shell shows as "the port is in use" instead of a bare timeout.
    pub fn port_available() -> bool {
        port_available_on(engine_port())
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
        .module::<Engine>()
        .module::<Fs>()
        .module::<Git>()
        .module::<Instance>()
        .class::<Lsp>()
        .class::<Pty>();
}

/// Waits (briefly) for the sidecar to publish the port it bound; falls back
/// to the requested one when the file never appears.
fn wait_for_port(path: &std::path::Path, fallback: u16) -> u16 {
    for _ in 0..50 {
        if let Ok(text) = std::fs::read_to_string(path) {
            if let Ok(port) = text.trim().parse::<u16>() {
                if port != 0 {
                    return port;
                }
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    fallback
}

/// Whether `port` can be bound on the sidecar's loopback address.
fn port_available_on(port: u16) -> bool {
    std::net::TcpListener::bind(("127.0.0.1", port)).is_ok()
}

/// Remembers an exit status for `exit_code`.
fn record_exit(status: std::io::Result<std::process::ExitStatus>) {
    if let Ok(status) = status {
        if let Ok(mut code) = LAST_EXIT.lock() {
            *code = status.code();
        }
    }
}

/// `~/.pi/zu`, created on first use.
pub(crate) fn zu_dir() -> Result<PathBuf, String> {
    if let Some(dir) = STATE_DIR.lock().ok().and_then(|dir| dir.clone()) {
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        return Ok(dir);
    }
    if let Ok(dir) = std::env::var("ZU_STATE_DIR") {
        if !dir.trim().is_empty() {
            let dir = PathBuf::from(dir.trim());
            std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            return Ok(dir);
        }
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
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let packaged = parent.join("../Helpers/pi-engine");
            if packaged.is_file() {
                return Some(packaged);
            }
        }
    }
    let dev = Path::new(env!("CARGO_MANIFEST_DIR")).join("engine/dist/pi-engine");
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
    file.write_all(token.as_bytes()).map_err(|e| e.to_string())?;
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
    use super::port_available_on;

    /// The browser is UI-only, so its capability must stay the Q32 minimum:
    /// any site in the web view, no trusted input, no external opener, and no
    /// file or process grants. This test reads the declaration itself, so a
    /// later capability edit that widens the UI's blast radius fails here.
    #[test]
    fn a_port_held_by_another_process_is_not_available() {
        let listener =
            std::net::TcpListener::bind(("127.0.0.1", 0)).expect("bind an ephemeral port");
        let port = listener.local_addr().expect("local address").port();
        assert!(!port_available_on(port), "a bound port is not free");
        drop(listener);
    }

    #[test]
    fn browser_capabilities_are_the_ui_only_minimum() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("nsh.json");
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
        assert!(
            capabilities.get("openUrl").is_none(),
            "M10 keeps links in the sheet; no external opener is granted"
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
