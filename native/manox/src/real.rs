//! The real manox AHP host half (M1): the kernel's own host, assembled
//! in-process.
//!
//! The assembly is the one `dspo/manox-app`'s desktop shell uses (its
//! `agent-ui/src/workspace.rs` + `steer-agent-chat-ui/src/ahp_store.rs`),
//! minus GPUI: the session store owner installs the AHP runtime builder
//! (`manox_session_core::agent_server::global`), the process-singleton
//! runtime builds the [`manox_ahp::Host`] over the runtime backend
//! (`manox_ahp_runtime::ahp::runtime::runtime`), and the pump's dedicated
//! runtime thread accepts an in-process transport pair whose frames are the
//! pump's opaque JSON-RPC text strings. Layering (manox
//! `docs/ahp-v3-architecture.md` §A):
//!
//! ```text
//! manox-harness session jsonl (durable kernel records, ~/.manox/core/…)
//! manox-ahp-runtime  (kernel journal → AHP action projection, Backend impl)
//! manox-ahp          (Host: channels, serverSeq, JSON-RPC router)
//! native/manox       (this crate: the pump's bridge + panic boundary)
//! ```
//!
//! The kernel's effectful half — engine actors, LLM streaming, journal IO —
//! runs on the process-global tokio runtime `manox_agent::runtime::init()`
//! builds (thread model §3.4: the pump thread owns the protocol face only).
//! Everything this module does per step stays under the pump's
//! `catch_unwind` boundary, so the §3.4 contract holds on the real path
//! exactly as it did on the T0 stub.
//!
//! One glue-level addition wraps the session runtime (see
//! [`ModelGuardRuntime`]): the kernel v0.9.1's engine-boot fatal ("no model
//! configured") never reaches the AHP channel — the live bridge mirrors
//! journal rows, and a boot fatal writes none — so without the guard a
//! credential-less dispatch would leave the client's accepted turn active
//! forever. The guard settles that turn with a real `chat/error` instead.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use ahp_types::messages::JsonRpcMessage;
use serde_json::Value;
use manox_ahp::transport::{HostTransport, Sink, Source, TransportError, TransportFuture};
use manox_ahp_runtime::ahp::runtime::AhpRuntime;
use manox_ahp_runtime::error::RuntimeError;
use manox_ahp_runtime::runtime_trait::{
    ClientToolSpec, ForkIntent, QuestionResponse, RenameOutcome, SessionIntent, SessionRuntime,
    TerminalSnapshot,
};

/// The error message a model-less turn settles with. It names the fix, not
/// the internals.
const NO_MODEL_MESSAGE: &str =
    "no model is configured — add a provider in cx Settings (~/.manox/cx.providers.config.yaml) \
     and try again";

/// Redirects the state roots to a throwaway dir when this process IS the nsh
/// headless test runner (its binary stem ends with `-test` — e.g.
/// `nsh-app-zu-app-<hash>-test`); a plain `nsh test` then runs the harness
/// gates hermetically, with no env prefix on the invocation. `HOME` moves
/// with it, deliberately: the harness's provider-config lookup
/// (`manox_harness::provider::default_config_path`) resolves `$HOME/.manox`
/// directly and does not honor `MANOX_HOME`, so without the HOME redirect a
/// root-environment runner would read the developer's live credentials — the
/// model gate would never fire, and a gate meant to be credential-free
/// would run real model turns. An explicit `MANOX_HOME` always wins (the
/// caller asked for a specific root); the kernel's own
/// `test_support::hermetic_home` takes the same shape for the same reason.
///
/// Only a process that boots the manox host redirects: the function runs at
/// [`boot`], which only the harness's tests call. Other tests sharing the
/// runner process run before or after that boot and see a temp `HOME` —
/// they use fixtures and temp dirs, never the developer's real store.
fn apply_runner_isolation() {
    // An explicit root wins; so does the live-model opt-out — the live gate's
    // documented run (MANOX_RUN_LIVE=1, no MANOX_HOME) wants the process's own
    // credentials, which the hermetic redirect would hide (skip, not fail).
    if std::env::var_os("MANOX_HOME").is_some() || std::env::var("MANOX_RUN_LIVE").as_deref() == Ok("1") {
        return;
    }
    let is_runner = std::env::current_exe()
        .ok()
        .and_then(|exe| {
            exe.file_stem()
                .map(|stem| stem.to_string_lossy().ends_with("-test"))
        })
        .unwrap_or(false);
    if !is_runner {
        return;
    }
    let home = std::env::temp_dir().join(format!("zu-manox-runner-home-{}", std::process::id()));
    let _ = std::fs::create_dir_all(home.join("core"));
    // SAFETY: runner-process setup, before any kernel initialization in this
    // process; the kernel resolves these at call time.
    unsafe {
        std::env::set_var("MANOX_HOME", &home);
        std::env::set_var("MANOX_CLAUDE_HOME", home.join("claude"));
        std::env::set_var("HOME", &home);
    }
}

/// Boots the process-global kernel stack and returns the AHP runtime (the
/// [`manox_ahp::Host`] plus its backend) — idempotent, every layer guards
/// its own singleton.
///
/// The state root resolves through the kernel's own path authority
/// (`manox_agent::paths::manox_home`): `MANOX_HOME` overrides `~/.manox`
/// wholesale at call time, so a test process points it at a temp dir before
/// the first boot and never touches the real store. `manox_agent::init()`
/// covers the kernel's startup bundle (global tokio runtime, object store,
/// provider registry, thread store, skills/commands/plugins).
pub(crate) fn boot() -> Result<Arc<AhpRuntime>, String> {
    // The env must land before any kernel initialization reads it.
    apply_runner_isolation();
    // The steps below are each process singletons, but their handshake is
    // not atomic: the builder must be installed before `runtime` consumes
    // it, so two concurrent boots could race the install. One lock, and a
    // set runtime short-circuits the rest.
    static BOOT_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _guard = BOOT_LOCK
        .lock()
        .map_err(|_| "the manox boot lock is poisoned".to_owned())?;
    if let Some(runtime) = manox_ahp_runtime::ahp::runtime::try_runtime() {
        return Ok(runtime);
    }
    manox_agent::init();
    let cwd = anchor_cwd();
    // The runtime half cannot construct a session runtime itself; the owner
    // of the session store installs the builder. This embedder installs it
    // FIRST, wrapping the gateway in [`ModelGuardRuntime`] — the gateway's
    // own (later) install attempt is then refused, and the AHP face serves
    // exactly the runtime this process talks to.
    let _ = manox_ahp_runtime::ahp::runtime::install_builder(|cwd| {
        let server = manox_session_core::agent_server::global(cwd);
        Arc::new(ModelGuardRuntime::new(
            manox_session_core::ahp_gateway::GatewayRuntime::new(server),
        )) as Arc<dyn SessionRuntime>
    });
    // The gateway claims the process-global server slot (idempotent) and
    // wires the kernel's store watchers.
    let _server = manox_session_core::agent_server::global(cwd.clone());
    Ok(manox_ahp_runtime::ahp::runtime::runtime(cwd))
}

/// The conversation's anchor directory. A GUI launch inherits `/` (or
/// nothing) as cwd — manox-app's mapping: home is the neutral default, so a
/// session's claim never anchors on the filesystem root.
fn anchor_cwd() -> PathBuf {
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    if !cwd.is_absolute() || cwd.as_path() == Path::new("/") {
        if let Some(home) = manox_agent::paths::home_dir() {
            return home;
        }
    }
    cwd
}

/// The session-runtime decorator: everything delegates to the gateway,
/// except a submit with no servable model anywhere. On that path the kernel
/// v0.9.1 would accept the dispatch, boot its engine, hit "no model
/// configured", and die with a `Fatal` that never reaches the AHP channel
/// (the live bridge mirrors journal rows; a boot fatal writes none) — the
/// client's accepted turn would hang forever. The guard refuses the submit
/// instead: the router echoes the refusal on the channel with this reason,
/// the client's optimistic ledger rolls back, and the failure is a bounded,
/// visible wire fact in any credential-less environment.
struct ModelGuardRuntime {
    inner: manox_session_core::ahp_gateway::GatewayRuntime,
}

impl ModelGuardRuntime {
    fn new(inner: manox_session_core::ahp_gateway::GatewayRuntime) -> Self {
        Self { inner }
    }
}

#[async_trait::async_trait]
impl SessionRuntime for ModelGuardRuntime {
    fn terminal_state(&self, terminal_id: &str) -> Option<TerminalSnapshot> {
        self.inner.terminal_state(terminal_id)
    }

    fn terminal_raw_tap(
        &self,
        terminal_id: &str,
    ) -> Option<tokio::sync::broadcast::Receiver<std::sync::Arc<Vec<u8>>>> {
        self.inner.terminal_raw_tap(terminal_id)
    }

    async fn create_terminal(
        &self,
        session_id: &str,
        terminal_id: &str,
        cols: u16,
        rows: u16,
    ) -> Result<(), RuntimeError> {
        self.inner
            .create_terminal(session_id, terminal_id, cols, rows)
            .await
    }

    async fn dispose_terminal(&self, terminal_id: &str) -> Result<(), RuntimeError> {
        self.inner.dispose_terminal(terminal_id).await
    }

    async fn terminal_input(&self, session_id: &str, data: &str) -> Result<(), RuntimeError> {
        self.inner.terminal_input(session_id, data).await
    }

    async fn terminal_resize(
        &self,
        terminal_id: &str,
        cols: u16,
        rows: u16,
    ) -> Result<(), RuntimeError> {
        self.inner.terminal_resize(terminal_id, cols, rows).await
    }

    async fn create_session(&self, owner: &str, intent: SessionIntent) -> Result<(), RuntimeError> {
        self.inner.create_session(owner, intent.clone()).await?;
        // The catalogue's identity row (v1.0.0 core layout: belonging lives
        // in the object store). The desktop writes it client-side before the
        // createSession; this embedder writes it here, so the journal shards
        // into the client's project bucket instead of the unfiled one when
        // the first turn materializes it. (Catalogue ANNOUNCEMENT is a
        // different fact: the sidebar list scans journal files, so a
        // deferred session joins `root/sessionAdded` at its first turn.)
        if let Some(objects) = manox_agent::object_store::ObjectStore::try_global() {
            if let Some(id) = intent.session_id.as_deref() {
                objects.create_conversation(id, intent.project.as_deref());
            }
        }
        Ok(())
    }

    async fn fork_session(&self, owner: &str, intent: ForkIntent) -> Result<(), RuntimeError> {
        self.inner.fork_session(owner, intent).await
    }

    async fn dispose_session(&self, owner: &str, session_id: &str) -> Result<(), RuntimeError> {
        self.inner.dispose_session(owner, session_id).await
    }

    fn has_session(&self, session_id: &str) -> bool {
        self.inner.has_session(session_id)
    }

    async fn open_session(&self, owner: &str, session_id: &str) -> Result<(), RuntimeError> {
        self.inner.open_session(owner, session_id).await
    }

    async fn submit(
        &self,
        owner: &str,
        session_id: &str,
        text: String,
    ) -> Result<Value, RuntimeError> {
        if manox_agent::provider_glue::default_model().is_none() {
            return Err(RuntimeError::new(NO_MODEL_MESSAGE));
        }
        self.inner.submit(owner, session_id, text).await
    }

    async fn steer(
        &self,
        session_id: &str,
        message_id: &str,
        text: String,
    ) -> Result<Value, RuntimeError> {
        self.inner.steer(session_id, message_id, text).await
    }

    fn drop_queued(&self, session_id: &str, message_id: &str) {
        self.inner.drop_queued(session_id, message_id);
    }

    async fn cancel_turn(&self, session_id: &str) -> Result<(), RuntimeError> {
        self.inner.cancel_turn(session_id).await
    }

    async fn set_model(&self, session_id: &str, model: &str) -> Result<(), RuntimeError> {
        self.inner.set_model(session_id, model).await
    }

    async fn preflight_config(
        &self,
        session_id: &str,
        model: Option<&str>,
        effort: Option<&str>,
        mode: Option<&str>,
        network: Option<&str>,
    ) -> Result<(), RuntimeError> {
        self.inner
            .preflight_config(session_id, model, effort, mode, network)
            .await
    }

    async fn set_reasoning_effort(&self, session_id: &str, effort: &str) -> Result<(), RuntimeError> {
        self.inner.set_reasoning_effort(session_id, effort).await
    }

    async fn set_access_mode(&self, session_id: &str, mode: &str) -> Result<(), RuntimeError> {
        self.inner.set_access_mode(session_id, mode).await
    }

    async fn set_network_access(&self, session_id: &str, access: &str) -> Result<(), RuntimeError> {
        self.inner.set_network_access(session_id, access).await
    }

    async fn set_cwd(&self, session_id: &str, cwd: &str) -> Result<(), RuntimeError> {
        self.inner.set_cwd(session_id, cwd).await
    }

    fn archive_session(&self, owner: &str, session_id: &str, archived: bool) {
        self.inner.archive_session(owner, session_id, archived);
    }

    fn rename_session(&self, session_id: &str, title: &str) -> RenameOutcome {
        self.inner.rename_session(session_id, title)
    }

    fn set_annotation(&self, session_id: &str, annotation: &serde_json::Value) -> bool {
        self.inner.set_annotation(session_id, annotation)
    }

    fn remove_annotation(&self, session_id: &str, annotation_id: &str) -> bool {
        self.inner.remove_annotation(session_id, annotation_id)
    }

    fn pin_session(&self, session_id: &str, pinned: bool) -> bool {
        self.inner.pin_session(session_id, pinned)
    }

    fn order_session(&self, session_id: &str, before: Option<&str>) -> bool {
        self.inner.order_session(session_id, before)
    }

    fn set_project_alias(&self, path: &str, alias: Option<&str>) -> bool {
        self.inner.set_project_alias(path, alias)
    }

    async fn compact(
        &self,
        session_id: &str,
        instructions: Option<String>,
    ) -> Result<(), RuntimeError> {
        self.inner.compact(session_id, instructions).await
    }

    async fn goal(
        &self,
        session_id: &str,
        action: &str,
        objective: Option<String>,
        budget: Option<u64>,
        max_rounds: Option<u64>,
    ) -> Result<(), RuntimeError> {
        self.inner
            .goal(session_id, action, objective, budget, max_rounds)
            .await
    }

    async fn confirm_tool_call(
        &self,
        session_id: &str,
        auth_id: &str,
        approved: bool,
        selected_option_id: Option<String>,
    ) -> Result<(), RuntimeError> {
        self.inner
            .confirm_tool_call(session_id, auth_id, approved, selected_option_id)
            .await
    }

    async fn answer_question(
        &self,
        session_id: &str,
        request_id: &str,
        response: QuestionResponse,
        answers: Vec<manox_agent::permission::AskAnswer>,
    ) -> Result<(), RuntimeError> {
        self.inner
            .answer_question(session_id, request_id, response, answers)
            .await
    }

    fn journal_feed(
        &self,
        session_id: &str,
    ) -> Option<manox_agent::thread::ThreadHandle> {
        self.inner.journal_feed(session_id)
    }

    async fn set_embedder_tools(
        &self,
        session_id: &str,
        client_id: &str,
        tools: Vec<ClientToolSpec>,
    ) {
        self.inner
            .set_embedder_tools(session_id, client_id, tools)
            .await;
    }
}

/// The client→host pipe's tail: what the host's reader task drains.
struct MpscSource {
    rx: tokio::sync::mpsc::UnboundedReceiver<JsonRpcMessage>,
}

impl Source for MpscSource {
    fn recv(&mut self) -> TransportFuture<'_, Result<Option<JsonRpcMessage>, TransportError>> {
        Box::pin(async move { Ok(self.rx.recv().await) })
    }
}

/// The host→client pipe's head: what the host's writer task fills.
struct MpscSink {
    tx: tokio::sync::mpsc::UnboundedSender<JsonRpcMessage>,
}

impl Sink for MpscSink {
    fn send(&mut self, msg: JsonRpcMessage) -> TransportFuture<'_, Result<(), TransportError>> {
        Box::pin(async move {
            self.tx
                .send(msg)
                .map_err(|_| TransportError("connection closed".into()))
        })
    }
}

/// One live real-host session's bridge halves.
pub(crate) struct RealHalf {
    /// The AHP runtime (process singleton; the watchdog reads its
    /// connection registry).
    runtime: Arc<AhpRuntime>,
    /// Client frames the bridge accepted, awaiting the host's reader.
    inbound: tokio::sync::mpsc::UnboundedSender<JsonRpcMessage>,
    /// Host frames awaiting the pump's event channel.
    outbound: tokio::sync::mpsc::UnboundedReceiver<JsonRpcMessage>,
}

impl RealHalf {
    /// Builds the in-process pair and hands the host end to the host. Must
    /// run inside the pump's runtime context — `Host::accept` spawns the
    /// connection's reader/writer tasks onto the calling reactor, which is
    /// what keeps the protocol face on the dedicated thread (§3.4).
    pub(crate) fn connect(runtime: Arc<AhpRuntime>) -> RealHalf {
        let (inbound, inbound_rx) = tokio::sync::mpsc::unbounded_channel::<JsonRpcMessage>();
        let (outbound_tx, outbound) = tokio::sync::mpsc::unbounded_channel::<JsonRpcMessage>();
        let transport = HostTransport::new(
            Box::new(MpscSink { tx: outbound_tx }),
            Box::new(MpscSource { rx: inbound_rx }),
        );
        runtime.accept(transport);
        RealHalf {
            runtime,
            inbound,
            outbound,
        }
    }

    /// One synchronous host-half step: parse the pump's text frame and hand
    /// the typed message to the host's reader. The pump boundary wraps this
    /// call, so a panic here (a kernel step reached synchronously through
    /// the parse path) still becomes a transport error, never an unwind
    /// into the engine.
    pub(crate) fn accept_frame(&mut self, text: &str) -> Result<(), String> {
        match manox_ahp::wire::parse_text(text) {
            // An unparseable frame is dropped: the engine's `JSON.stringify`
            // cannot produce one, and a malformed frame has no id to answer
            // `-32700` with.
            Ok(message) => self
                .inbound
                .send(message)
                .map_err(|_| "the manox host connection is gone".to_owned()),
            Err(_) => Ok(()),
        }
    }

    /// The next host frame, as the pump's text frame — `None` when the
    /// host's writer half closed (the connection died).
    pub(crate) async fn next_frame(&mut self) -> Option<String> {
        let message = self.outbound.recv().await?;
        Some(manox_ahp::wire::to_text(&message))
    }

    /// Whether the host still holds our connection. A host-internal task
    /// panic retires the connection through its teardown guard; the pump
    /// boundary cannot see a task it does not own, so this poll is what
    /// turns such a death into the transport error TSX recovers from
    /// instead of a quiet wire.
    pub(crate) fn connection_alive(&self) -> bool {
        self.runtime.host().connection_count() > 0
    }
}

#[cfg(test)]
pub(crate) mod test_support {
    use std::path::PathBuf;
    use std::sync::OnceLock;

    /// The test process's isolated state root: `MANOX_HOME` (and the
    /// Claude-ecosystem root with it) point at one temp dir for the whole
    /// test process, set before the first [`super::boot`]. `HOME` is
    /// redirected too — deliberately: the harness's provider-config lookup
    /// (`manox_harness::provider::default_config_path`) resolves
    /// `$HOME/.manox` directly and does not honor `MANOX_HOME`, so without
    /// the HOME redirect a test process would read the developer's live
    /// credentials and run real model turns. HOME covers that one bypass;
    /// the kernel's own `test_support::hermetic_home` takes the same shape.
    /// The real `~/.manox` is never read or written by a test run.
    pub(crate) fn isolated_home() -> PathBuf {
        static HOME: OnceLock<PathBuf> = OnceLock::new();
        HOME.get_or_init(|| {
            let home = std::env::temp_dir().join(format!(
                "zu-manox-test-home-{}",
                std::process::id()
            ));
            let _ = std::fs::remove_dir_all(&home);
            std::fs::create_dir_all(home.join("core")).expect("create the isolated manox home");
            // SAFETY: test-process setup, before any kernel boot in this
            // process; the env is read at call time by the kernel's paths.
            unsafe {
                std::env::set_var("MANOX_HOME", &home);
                std::env::set_var("MANOX_CLAUDE_HOME", home.join("claude"));
                std::env::set_var("HOME", &home);
            }
            home
        })
        .clone()
    }
}
