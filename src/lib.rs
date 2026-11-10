//! Zu's native module: it owns the engine sidecar's process.
//!
//! The UI cannot start the sidecar itself — `capabilities.process.execute`
//! takes exact command names or absolute paths and never expands host
//! placeholders, while the sidecar's path follows the app's install
//! location. This module resolves that path at run time and keeps the
//! child alive for the app's lifetime.

use std::{
    io::Write,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
};

use nsh_core::prelude::*;

/// The sidecar's loopback port, fixed so the capability grant can name it.
const ENGINE_PORT: u16 = 47823;

struct EngineState {
    child: Child,
}

/// The running sidecar; `None` before the first start and after a failure.
static ENGINE: Mutex<Option<EngineState>> = Mutex::new(None);

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
        let log = std::fs::File::create(dir.join("engine.log")).map_err(|e| e.to_string())?;
        let stderr = log.try_clone().map_err(|e| e.to_string())?;
        let child = Command::new(&path)
            .env("ZU_PORT", ENGINE_PORT.to_string())
            .env("ZU_TOKEN", &token)
            .stdin(Stdio::null())
            .stdout(Stdio::from(log))
            .stderr(Stdio::from(stderr))
            .spawn()
            .map_err(|e| format!("cannot start {}: {e}", path.display()))?;
        *guard = Some(EngineState { child });
        Ok(())
    }

    /// Stops the sidecar; the next `start` runs a new one.
    pub async fn stop() -> Result<(), String> {
        let mut guard = ENGINE.lock().map_err(|_| "engine lock poisoned".to_owned())?;
        if let Some(mut state) = guard.take() {
            let _ = state.child.kill();
            let _ = state.child.wait();
        }
        Ok(())
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
            _ => {
                *guard = None;
                "stopped".to_owned()
            }
        }
    }

    /// The loopback port the sidecar listens on.
    pub fn port() -> u16 {
        ENGINE_PORT
    }

    /// The handshake token the sidecar expects; created on first use.
    /// Empty when the state directory cannot be written.
    pub fn token() -> String {
        ensure_token().unwrap_or_default()
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
    registry.module::<Engine>();
}

/// `~/.pi/zu`, created on first use.
fn zu_dir() -> Result<PathBuf, String> {
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
