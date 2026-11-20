//! The manox harness's in-proc pump: it owns the AHP host half as an
//! application singleton and pushes its frames to TSX as opaque strings.
//!
//! The design (docs/sheet-module-ARCHITECTURE.md §8, docs/architecture.md §3.3)
//! gives the in-proc leg three engineering boundaries, all landed here:
//!
//! - **Crash isolation is asymmetric** (the architecture's largest inherent
//!   cost): there is no process boundary around the host half, so a panic
//!   would otherwise take the whole shell down. [`pump`] runs every host-half
//!   step under `catch_unwind`; a caught panic becomes a `transport-error`
//!   frame event on TSX's callback — never an unwinding crossing into the
//!   engine, and never a killed shell. TSX reacts by showing the error and
//!   calling [`Manox::restart`] + AHP `reconnect`.
//! - **Thread model**: manox is tokio + async_channel, so this crate owns a
//!   **dedicated runtime thread** (`manox-host`, a current-thread runtime with
//!   time enabled). The host half ([`host`]) runs entirely on it; frames cross
//!   to the engine thread through a channel, and a task started with
//!   `CallCx::start` posts them to TSX with `Callback::post` (the exact shape
//!   `zu-app`'s PTY uses — callbacks are engine-thread-only).
//! - **Build and size**: the manox crate chain (ahp / ahp-runtime /
//!   session-core / agent) enters the build graph as **one git tag** —
//!   `dspo/manox` `tag = "v0.12.1"`, the rev locked in Cargo.lock — and its
//!   time/size increment is recorded in the M1 evidence.
//!
//! ## The real host (M1: the T0 stub is gone)
//!
//! [`host`] owns a session of the host half: a task that consumes client
//! frames and produces host frames under the pump's panic boundary. [`real`]
//! assembles the kernel's own host — `manox_session_core::agent_server::global`
//! installs the runtime builder, `manox_ahp_runtime::ahp::runtime::runtime`
//! builds the [`manox_ahp::Host`] over the journal-projection backend, and
//! `Host::accept` takes the in-process transport pair whose frames are the
//! pump's opaque JSON-RPC text strings (the same assembly manox-app's desktop
//! shell uses, minus GPUI). The pump, the frame callback, the catch_unwind
//! boundary and the whole TSX side are unchanged from T0.

use model_catalog::ModelCatalog;
use nsh_core::prelude::*;

pub mod host;
pub mod model_catalog;
pub mod pump;
pub mod real;
pub mod title_bridge;
pub use title_bridge::TitleBridge;

/// The manox host pin the build script extracted from Cargo.toml's one
/// `tag = "…"` line (`ZU_MANOX_PIN`); the module's `version` delegates here.
pub fn pinned_version() -> String {
    env!("ZU_MANOX_PIN").to_owned()
}

/// One event from the pump to TSX. `kind` is one of `"frame"` (an AHP
/// JSON-RPC text frame — opaque here, zero protocol semantics at the pump),
/// `"transport-error"` (the host half died: a caught panic or a transport
/// reset; `error` says why) and `"stopped"` (the pump's host session ended
/// without an error — `stop`, or a `restart`'s teardown).
#[derive(Debug, Clone, Default, JsObject)]
pub struct ManoxFrame {
    kind: String,
    text: Option<String>,
    error: Option<String>,
}

/// The manox native module: the in-proc AHP host half and its frame pump,
/// as one application singleton.
#[module]
pub struct Manox;

#[module]
impl Manox {
    /// Starts the pump: the dedicated runtime thread comes up, the host half
    /// singleton starts on it (its frames answer `initialize` from then on),
    /// and every host frame from then on is posted to `on_frame`.
    ///
    /// A second `start` on a live pump retires it fully and rewires to the
    /// new caller — the old wiring belonged to a previous VM (a hot reload, a
    /// test run's next `open`). After `stop` a `start` runs a fresh host
    /// session (the durable journal persists — TSX reconnects against the
    /// same host).
    pub fn start(
        #[args(frame)] on_frame: Callback<ManoxFrame>,
        hermetic: bool,
        cx: CallCx<'_>,
    ) -> Result<(), String> {
        // The bash output tap must precede the first session (issue #73):
        // one install per process, restarts reuse it.
        title_bridge::ensure_tap_installed()?;
        crate::real::HERMETIC.store(hermetic, std::sync::atomic::Ordering::Release);
        pump::start(on_frame, cx)
    }

    /// Sends one client frame (a JSON-RPC text string) to the host half.
    /// Queued, never blocking the engine thread; a dead pump reports the
    /// error.
    pub fn send(frame: String) -> Result<(), String> {
        pump::send(frame)
    }

    /// Tears the host session down and ends the runtime thread. The next
    /// `start` runs a fresh singleton.
    pub fn stop() -> Result<(), String> {
        pump::stop()
    }

    /// Replaces the host half in place: the old session is torn down, a new
    /// one opens on the same runtime thread. This is the recovery path TSX
    /// takes after a transport error — the host singleton and its durable
    /// journal persist, so AHP `reconnect{lastSeenServerSeq}` reconciles
    /// against the same host (snapshots or replay, per the gap).
    pub fn restart() -> Result<(), String> {
        pump::restart()
    }

    /// Injects a panic **inside** the host half, past the pump boundary.
    /// T0's crash-isolation gate: the panic must surface as a
    /// `transport-error` frame event — the shell must survive it (§3.4).
    pub fn inject_panic() -> Result<(), String> {
        pump::inject_panic()
    }

    /// `"running"` while the pump's host session is up, `"stopped"` otherwise.
    pub fn status() -> String {
        pump::status()
    }

    /// The manox host pin (`v0.12.1`), as the build script read it from
    /// Cargo.toml's one `tag = "…"`. The About surface reports it.
    pub fn version() -> String {
        pinned_version()
    }

    /// The host's callable model directory. Drives the manox composer's model
    /// menu; it is the same snapshot the boot registered, so every ref here
    /// was callable for the sessions created after boot. A pi config change
    /// is a restart fact: AHP fixes a session's provider registry at creation.
    pub fn models() -> Result<ModelCatalog, String> {
        if let Some(catalog) = model_catalog::boot_catalog() {
            return Ok(catalog);
        }
        let dir = model_catalog::pi_catalog_dir()
            .ok_or_else(|| "no pi agent directory to read".to_owned())?;
        let catalog = model_catalog::model_catalog(&dir)
            .ok_or_else(|| "no api-key model is available to manox".to_owned())?;
        // A boot-less caller (a unit test) gets the same registration path;
        // the boot itself already did this and cached the snapshot.
        model_catalog::register_pi_providers();
        Ok(model_catalog::boot_catalog().unwrap_or(catalog))
    }

    /// Points the host's catalogue at `path` (an empty string restores the
    /// env/HOME lookup). Tests use it to seed a deterministic provider; the
    /// packaged app never calls it.
    pub fn set_catalog_dir(path: String) {
        let dir = path.trim();
        model_catalog::set_catalog_dir(if dir.is_empty() {
            None
        } else {
            Some(std::path::PathBuf::from(dir))
        });
    }
}

#[native_module("manox/native")]
fn native(registry: &mut Registry) {
    registry.module::<Manox>();
    registry.class::<TitleBridge>();
}

#[cfg(test)]
mod tests {
    use super::pinned_version;

    /// The build script and this scan must agree: every `tag = "…"` inside
    /// Cargo.toml's dependency tables is the family's one pin, and the
    /// compiled constant is it.
    #[test]
    fn pinned_version_is_the_cargo_toml_tag() {
        let manifest = include_str!("../Cargo.toml");
        let mut tags: Vec<&str> = manifest
            .lines()
            .map(str::trim)
            .filter(|line| !line.starts_with('#'))
            .filter_map(|line| {
                let start = line.find("tag = \"")?;
                line[start + "tag = \"".len()..].split('"').next()
            })
            .filter(|tag| !tag.is_empty())
            .collect();
        assert!(!tags.is_empty(), "no `tag = \"…\"` pin in Cargo.toml");
        let pin = pinned_version();
        assert!(pin.starts_with('v'), "the pin is a tag: {pin}");
        while let Some(tag) = tags.pop() {
            assert_eq!(pin, tag);
        }
    }
}
