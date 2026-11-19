//! Zu's native module: the capability domains the shell and the sheet
//! modules consume — the per-turn ACP harness process, the filesystem, git,
//! LSP, PTYs, the state store, the single-instance lock and the folder
//! picker.
//!
//! The UI cannot spawn processes itself, and a packaged app's helper paths
//! follow its install location, so this module owns process facts. The PTY
//! side is in [`pty`]: bytes go straight to TSX through a callback, never
//! through a protocol. [`instance`] owns the single-instance lock: one live
//! Zu per state directory.

use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};

use nsh_core::prelude::*;

mod acp;
#[cfg(test)]
mod conformance;
mod fs;
mod ghostty;
mod git;
mod instance;
mod lsp;
mod picker;
mod pty;
mod session;
mod state;
#[cfg(target_os = "macos")]
mod term_view;

/// Geist / Geist Mono, the sheet content's faces (DESIGN §3.4, issue #20
/// §4.7): the crate ships four sans weights and three mono weights
/// (`registry.assets(assets!())`), and the engine registers them before the
/// first render under the families the files' name tables carry — TS names
/// them as `fonts.ts`'s `SHEET_FONT` and `SHEET_MONO`.
pub use acp::{Acp, AcpExit, AcpOptions};
pub use fs::{Fs, FsEntry, FsExpected, FsFile, FsStat, FsWriteResult};
pub use ghostty::Ghostty;
pub use git::{Git, GitBranch, GitBranches, GitChange, GitCommit, GitDiff, GitStatus};
pub use instance::{Instance, InstanceClaim};
pub use lsp::{Lsp, LspExit, LspOptions};
pub use picker::Picker;
pub use pty::{Pty, PtyExit, PtyOptions};
pub use session::{TerminalFind, TerminalSession, TerminalSessionEvent};
pub use state::{ScanSession, SessionScan, State, StateRead, StateWrite};

/// Extension paths the host adds to the standard pi locations (tests and
/// development builds use it; a packaged app leaves it empty).
pub(crate) static EXTRA_EXTENSIONS: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// Zu's state directory (`~/.steer` unless a test points it elsewhere):
/// registry, layouts, settings, subagents and the instance lock.
pub(crate) static STATE_DIR: Mutex<Option<PathBuf>> = Mutex::new(None);

/// Whether the next sidecar skips extensions (tests that only exercise the
/// container registry); a packaged app always loads them.
pub(crate) static NO_EXTENSIONS: Mutex<bool> = Mutex::new(false);

/// The workspace parent (`~/.steer` unless a test points it elsewhere): the
/// `__chat__/` folder and per-container `scratch/` folders live here, apart from
/// the state directory so an agent working in them cannot touch the registry.
pub(crate) static WORKSPACE_DIR: Mutex<Option<PathBuf>> = Mutex::new(None);

/// pi's home for the sidecar (`~/.pi/agent` unless a test points it
/// elsewhere): credentials and `models.json`. The model list a session
/// reports comes from here, so an empty directory is the no-models state.
pub(crate) static AGENT_DIR: Mutex<Option<PathBuf>> = Mutex::new(None);

/// The crate's UI set (`nsh.json` `"rust"`): what TSX imports as `zu/native`.
#[native_module("zu/native")]
fn native(registry: &mut Registry) {
    registry
        .assets(assets!())
        .module::<Fs>()
        .module::<Ghostty>()
        .module::<Git>()
        .module::<Instance>()
        .module::<Picker>()
        .module::<State>()
        .class::<Acp>()
        .class::<Lsp>()
        .class::<Pty>()
        .class::<TerminalSession>();
}

/// The crate's native components on macOS: the terminal sheet's view.
#[native_components(macos)]
fn components(components: &nsh_platform_macos::Components) {
    term_view::register(components);
}

#[cfg(test)]
mod font_tests {
    use nsh_core::element::FontAsset;

    use super::asset;

    // §3.4 (DESIGN, issue #20 §4.7): the sans weights under ONE family and
    // the mono weights under one more, so the layout picks the nearest
    // weight within the right face — body copy reads Geist, the code faces
    // (editor, terminal, Diff, tool I/O, inline code) read Geist Mono.
    // Different names would break that mapping, and `fonts.ts` names the
    // families by these literals.
    const GEIST_LIGHT: FontAsset = asset!("fonts/Geist-Light.ttf");
    const GEIST_REGULAR: FontAsset = asset!("fonts/Geist-Regular.ttf");
    const GEIST_MEDIUM: FontAsset = asset!("fonts/Geist-Medium.ttf");
    const GEIST_SEMIBOLD: FontAsset = asset!("fonts/Geist-SemiBold.ttf");
    const GEIST_MONO_LIGHT: FontAsset = asset!("fonts/GeistMono-Light.ttf");
    const GEIST_MONO_REGULAR: FontAsset = asset!("fonts/GeistMono-Regular.ttf");
    const GEIST_MONO_MEDIUM: FontAsset = asset!("fonts/GeistMono-Medium.ttf");

    #[test]
    fn geist_ships_under_one_family() {
        assert_eq!(GEIST_LIGHT.family, "Geist");
        assert_eq!(GEIST_REGULAR.family, "Geist");
        assert_eq!(GEIST_MEDIUM.family, GEIST_REGULAR.family);
        assert_eq!(GEIST_SEMIBOLD.family, GEIST_REGULAR.family);
    }

    #[test]
    fn geist_mono_ships_under_one_family() {
        assert_eq!(GEIST_MONO_LIGHT.family, "Geist Mono");
        assert_eq!(GEIST_MONO_REGULAR.family, "Geist Mono");
        assert_eq!(GEIST_MONO_MEDIUM.family, GEIST_MONO_REGULAR.family);
    }
}

/// Zu's state root. A test override or an explicit `ZU_STATE_DIR` wins;
/// otherwise the default is `~/.steer`, migrated once from `~/.pi/zu` with a
/// move (never a copy). Migration failure falls back to the legacy root so
/// the app can still start and retry on the next launch.
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
    let target = PathBuf::from(&home).join(".steer");
    let legacy = PathBuf::from(&home).join(".pi").join("zu");
    let dir = match migrate_zu_home(&legacy, &target) {
        Ok(()) => target,
        Err(error) => {
            eprintln!(
                "zu: state migration from {} to {} failed: {error}; using the legacy root",
                legacy.display(),
                target.display()
            );
            legacy
        }
    };
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

const ZU_STATE_ENTRIES: &[&str] = &[
    "registry.json",
    "projects.json",
    "settings.json",
    "layouts",
    "subagents",
];

/// Move the legacy Zu state into `~/.steer`. One directory rename when the
/// target is absent; otherwise a per-entry move that leaves already migrated
/// entries alone. The per-entry branch never moves `instance.lock`: an older
/// process may still hold it. Both branches are idempotent after an
/// interrupted run.
fn migrate_zu_home(legacy: &Path, target: &Path) -> Result<(), String> {
    if !legacy.exists() {
        return Ok(());
    }
    if !target.exists() {
        return std::fs::rename(legacy, target).map_err(|e| e.to_string());
    }
    for entry in ZU_STATE_ENTRIES {
        let from = legacy.join(entry);
        let to = target.join(entry);
        if from.exists() && !to.exists() {
            std::fs::rename(&from, &to).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// A pi-harness helper binary by name (`pi-engine`, `pi-acp`), packaged
/// first and the repository's build second — the resolution the harness
/// spawn policies share.
pub(crate) fn harness_path(name: &str) -> Option<PathBuf> {
    if let Ok(exe) = std::env::current_exe()
        && let Some(parent) = exe.parent()
    {
        let packaged = parent.join(format!("../Helpers/{name}"));
        if packaged.is_file() {
            return Some(packaged);
        }
    }
    let dev = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../pi-harness/dist")
        .join(name);
    dev.is_file().then_some(dev)
}

/// The handshake token, generated once and kept for later launches.
#[cfg(test)]
mod tests {
    /// The browser is UI-only, so its capability must stay the Q32 minimum:
    /// any site in the web view, no trusted input, exactly one explicit
    /// external scheme (the VS Code action), and no file or process grants.
    /// This test reads the declaration itself, so a later capability edit
    /// that widens the UI's blast radius fails here.
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

#[cfg(test)]
mod home_migration_tests {
    use super::*;
    use std::sync::{
        Mutex, OnceLock,
        atomic::{AtomicUsize, Ordering},
    };

    static HOME_LOCK: Mutex<()> = Mutex::new(());

    struct HomeGuard {
        previous: Option<String>,
        zu_state: Option<String>,
    }

    impl HomeGuard {
        fn set(root: &Path) -> Self {
            let guard = Self {
                previous: std::env::var("HOME").ok(),
                zu_state: std::env::var("ZU_STATE_DIR").ok(),
            };
            // SAFETY: serialized by HOME_LOCK and restored on drop; no
            // kernel/native initialization happens inside these tests.
            unsafe {
                std::env::set_var("HOME", root);
                std::env::remove_var("ZU_STATE_DIR");
            }
            *STATE_DIR.lock().unwrap() = None;
            guard
        }
    }

    impl Drop for HomeGuard {
        fn drop(&mut self) {
            unsafe {
                match &self.previous {
                    Some(home) => std::env::set_var("HOME", home),
                    None => std::env::remove_var("HOME"),
                }
                match &self.zu_state {
                    Some(dir) => std::env::set_var("ZU_STATE_DIR", dir),
                    None => std::env::remove_var("ZU_STATE_DIR"),
                }
            }
            *STATE_DIR.lock().unwrap() = None;
        }
    }

    fn root(name: &str) -> PathBuf {
        static SEQ: OnceLock<AtomicUsize> = OnceLock::new();
        let seq = SEQ.get_or_init(|| AtomicUsize::new(0));
        let dir = std::env::temp_dir().join(format!(
            "zu-home-test-{name}-{}-{}",
            std::process::id(),
            seq.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn zu_home_moves_the_whole_directory_when_target_is_absent() {
        let _lock = HOME_LOCK.lock().unwrap();
        let home = root("whole");
        let legacy = home.join(".pi/zu");
        std::fs::create_dir_all(legacy.join("layouts")).unwrap();
        std::fs::write(legacy.join("registry.json"), "{}").unwrap();
        std::fs::write(legacy.join("instance.lock"), "old").unwrap();
        let _guard = HomeGuard::set(&home);

        let dir = zu_dir().unwrap();
        assert_eq!(dir, home.join(".steer"));
        assert_eq!(
            std::fs::read_to_string(dir.join("registry.json")).unwrap(),
            "{}"
        );
        assert!(dir.join("layouts").is_dir());
        assert_eq!(
            std::fs::read_to_string(dir.join("instance.lock")).unwrap(),
            "old"
        );
        assert!(!legacy.exists());
    }

    #[test]
    fn zu_home_moves_entries_and_leaves_the_lock_when_target_exists() {
        let _lock = HOME_LOCK.lock().unwrap();
        let home = root("entries");
        let legacy = home.join(".pi/zu");
        let target = home.join(".steer");
        std::fs::create_dir_all(legacy.join("subagents")).unwrap();
        std::fs::write(legacy.join("projects.json"), "legacy").unwrap();
        std::fs::write(legacy.join("settings.json"), "legacy").unwrap();
        std::fs::write(legacy.join("instance.lock"), "old").unwrap();
        std::fs::create_dir_all(&target).unwrap();
        std::fs::write(target.join("settings.json"), "new").unwrap();
        let _guard = HomeGuard::set(&home);

        let dir = zu_dir().unwrap();
        assert_eq!(dir, target);
        assert_eq!(
            std::fs::read_to_string(target.join("projects.json")).unwrap(),
            "legacy"
        );
        assert_eq!(
            std::fs::read_to_string(target.join("settings.json")).unwrap(),
            "new"
        );
        assert!(target.join("subagents").is_dir());
        assert!(!target.join("instance.lock").exists());
        assert!(legacy.join("instance.lock").exists());
    }

    #[test]
    fn an_explicit_state_dir_never_migrates() {
        let _lock = HOME_LOCK.lock().unwrap();
        let home = root("override");
        let legacy = home.join(".pi/zu");
        std::fs::create_dir_all(&legacy).unwrap();
        std::fs::write(legacy.join("registry.json"), "{}").unwrap();
        let explicit = home.join("custom-state");
        let previous_zu_state = std::env::var("ZU_STATE_DIR").ok();
        // SAFETY: serialized by HOME_LOCK, restored by the guard below.
        unsafe { std::env::set_var("ZU_STATE_DIR", &explicit) };
        let guard = HomeGuard {
            previous: std::env::var("HOME").ok(),
            zu_state: previous_zu_state,
        };
        unsafe { std::env::set_var("HOME", &home) };

        assert_eq!(zu_dir().unwrap(), explicit);
        assert!(legacy.join("registry.json").exists());
        assert!(!home.join(".steer").exists());
        drop(guard);
    }
}
