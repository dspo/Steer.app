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
mod fs;
mod git;
mod instance;
mod lsp;
mod picker;
mod pimodels;
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
pub use git::{Git, GitBranch, GitBranches, GitChange, GitCommit, GitDiff, GitStatus};
pub use instance::{Instance, InstanceClaim};
pub use lsp::{Lsp, LspExit, LspOptions};
pub use picker::Picker;
pub use pimodels::{PiModelInfo, PiModels, PiProvider};
pub use pty::{Pty, PtyExit, PtyOptions};
pub use session::{TerminalFind, TerminalSession, TerminalSessionEvent};
pub use state::{ScanSession, SessionScan, State, StateRead, StateWrite};

/// Extension paths the host adds to the standard pi locations (tests and
/// development builds use it; a packaged app leaves it empty).
pub(crate) static EXTRA_EXTENSIONS: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// The state directory beside pi's state (`~/.pi/zu` unless a test points
/// it elsewhere): registry, layouts, token, generation and log.
pub(crate) static STATE_DIR: Mutex<Option<PathBuf>> = Mutex::new(None);

/// Whether the next sidecar skips extensions (tests that only exercise the
/// container registry); a packaged app always loads them.
pub(crate) static NO_EXTENSIONS: Mutex<bool> = Mutex::new(false);

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
        .module::<Git>()
        .module::<Instance>()
        .module::<Picker>()
        .module::<PiModels>()
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
