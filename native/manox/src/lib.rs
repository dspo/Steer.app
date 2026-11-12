//! The manox harness's in-proc pump: it owns the AHP host half as an
//! application singleton and pushes its frames to TSX as opaque strings.
//!
//! The design (docs/nsh-pi-dual-harness-DESIGN.md §3.4) gives the in-proc leg
//! three engineering boundaries, all landed here:
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
//! - **Build and size**: T0 deliberately pulls **no** manox crates into the
//!   build graph. The host half is this crate's [`stub`], a scripted in-proc
//!   host speaking the same wire (initialize/subscribe/dispatchAction/
//!   reconnect, action envelopes with `serverSeq`/`origin`/`rejectionReason`,
//!   and one deterministic turn script: streaming text + reasoning, one tool
//!   call through `toolCallReady` → `toolCallConfirmed` → complete, one
//!   elicitation through the three answers, pending lanes, cancel).
//!
//! ## The M1 swap point
//!
//! [`host`] defines the `HostHalf` seam: a session of the host half is
//! anything that consumes client frames and produces host frames plus
//! scheduled steps, under the pump's panic boundary. At M1 (manox v3 W4),
//! `stub.rs` is replaced by a thin adapter that builds manox's real
//! `manox_ahp_runtime::AhpRuntime` (`install_builder` + `Host::accept` over
//! the `transport::inproc` pair) on this same runtime thread; the pump, the
//! frame callback, the catch_unwind boundary and the whole TSX side are
//! unchanged. The git dependency (`manox-ahp` / `manox-ahp-runtime` +
//! `manox-session-core`, `tag = "v0.9.1"` or later) lands **then**, per the
//! design's "Rust 依赖最小化" — a stub T0 must not drag the 181k-line kernel
//! into the build graph (v0.9.1's protocol host half exists, but its effectful
//! `Backend` needs the full agent runtime and live provider credentials,
//! which a deterministic T0 gate cannot assume; see the task report).

use nsh_core::prelude::*;

pub mod host;
pub mod pump;
pub mod stub;

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
    /// session (empty journal — TSX then reconnects).
    pub fn start(
        #[args(frame)] on_frame: Callback<ManoxFrame>,
        cx: CallCx<'_>,
    ) -> Result<(), String> {
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
    /// one starts on the same runtime thread. This is the recovery path TSX
    /// takes after a transport error (its journal is fresh, so AHP
    /// `reconnect{lastSeenServerSeq}` is answered with snapshots).
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
}

#[native_module("manox/native")]
fn native(registry: &mut Registry) {
    registry.module::<Manox>();
}
