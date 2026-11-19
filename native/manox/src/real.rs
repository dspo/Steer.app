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
//! manox-harness session jsonl (durable kernel records, $MANOX_HOME/core/…)
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
//! [`ModelGuardRuntime`]): the kernel's engine-boot fatal ("no model
//! configured") never reaches the AHP channel — the live bridge mirrors
//! journal rows, and a boot fatal writes none — so without the guard a
//! credential-less dispatch would leave the client's accepted turn active
//! forever. The guard settles that turn with a real `chat/error` instead.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use ahp_types::messages::JsonRpcMessage;
use manox_ahp::transport::{HostTransport, Sink, Source, TransportError, TransportFuture};
use manox_ahp_runtime::ahp::runtime::AhpRuntime;
use manox_ahp_runtime::error::RuntimeError;
use manox_ahp_runtime::runtime_trait::{
    ClientToolSpec, ForkIntent, QuestionResponse, RenameOutcome, SessionIntent, SessionRuntime,
    TerminalSnapshot,
};
use serde_json::Value;

/// The error message a model-less turn settles with. It names the fix, not
/// the internals.
const NO_MODEL_MESSAGE: &str = "no model is configured — add a provider in cx Settings ($MANOX_HOME/cx.providers.config.yaml) \
     and try again";

pub(crate) use crate::model_catalog::register_pi_providers;

/// Whether the TS side asked this process's manox host to run hermetic
/// (`Manox.start(cb, /* hermetic */ true)` — set by the gate files before the
/// first connection). The redirect is **opt-in per boot initiator**, never
/// inferred from the process: a shared headless runner also mounts the real
/// app, whose engine/lsp/pi tests need the real `HOME` for the whole process
/// — an unconditional redirect poisons them (rustup resolution, `~/.pi`
/// scans). The dedicated gate invocation sets the flag and owns the process.
pub(crate) static HERMETIC: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

/// Resolves the manox state root before any kernel initialization: hermetic
/// boots keep the throwaway root, an explicit `MANOX_HOME` is respected
/// as-is, and everything else lands at `~/.steer/.manox` (moved from
/// `~/.manox` once when the target is absent). Production boots never set
/// `MANOX_CLAUDE_HOME`, so `~/.claude` stays the shared Claude ecosystem
/// root. Hermetic gate boots still redirect all three env vars to a
/// throwaway root; that isolation predates this home split and keeps the
/// credential-free gate from reading the developer's live Claude state.
fn configure_manox_home() {
    if HERMETIC.load(std::sync::atomic::Ordering::Acquire) {
        if std::env::var_os("MANOX_HOME").is_some() {
            return;
        }
        let home =
            std::env::temp_dir().join(format!("zu-manox-runner-home-{}", std::process::id()));
        let _ = std::fs::create_dir_all(home.join("core"));
        // SAFETY: gate-process setup, before any kernel initialization in
        // this process; the kernel resolves these at call time.
        unsafe {
            std::env::set_var("MANOX_HOME", &home);
            std::env::set_var("MANOX_CLAUDE_HOME", home.join("claude"));
            std::env::set_var("HOME", &home);
        }
        return;
    }
    if std::env::var_os("MANOX_HOME").is_some() {
        return;
    }
    let Some(home) = std::env::var_os("HOME").map(PathBuf::from) else {
        return;
    };
    let legacy = home.join(".manox");
    let steer_root = home.join(".steer");
    let target = steer_root.join(".manox");
    // `rename` does not create the destination's parent. The app usually
    // already has `~/.steer` (it is also the workspace root, and `zu_dir()`
    // creates it during the instance claim), but boot must not depend on that
    // ordering.
    let _ = std::fs::create_dir_all(&steer_root);
    let root = if !target.exists() && legacy.exists() {
        match std::fs::rename(&legacy, &target) {
            Ok(()) => target,
            Err(error) => {
                eprintln!(
                    "zu: manox migration from {} to {} failed: {error}; using the legacy root",
                    legacy.display(),
                    target.display()
                );
                legacy
            }
        }
    } else {
        target
    };
    let _ = std::fs::create_dir_all(&root);
    // SAFETY: boot-time setup, before any kernel initialization in this
    // process; the kernel resolves these at call time.
    unsafe { std::env::set_var("MANOX_HOME", &root) };
}

/// Boots the process-global kernel stack and returns the AHP runtime (the
/// [`manox_ahp::Host`] plus its backend) — idempotent, every layer guards
/// its own singleton.
///
/// The state root resolves through the kernel's own path authority
/// (`manox_agent::paths::manox_home`): `MANOX_HOME` overrides the default root
/// wholesale at call time, so a test process points it at a temp dir before
/// the first boot and never touches the real store. `manox_agent::init()`
/// covers the kernel's startup bundle (global tokio runtime, object store,
/// provider registry, thread store, skills/commands/plugins).
pub(crate) fn boot() -> Result<Arc<AhpRuntime>, String> {
    // The env must land before any kernel initialization reads it.
    configure_manox_home();
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
    // The kernel's registry must carry pi's providers before any session
    // resolves its config model (the Hero's selection).
    register_pi_providers();
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
    if (!cwd.is_absolute() || cwd.as_path() == Path::new("/"))
        && let Some(home) = manox_agent::paths::home_dir()
    {
        return home;
    }
    cwd
}

/// The session-runtime decorator: everything delegates to the gateway,
/// except a submit with no servable model anywhere. On that path the kernel
/// would accept the dispatch, boot its engine, hit "no model
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
        if let Some(objects) = manox_agent::object_store::ObjectStore::try_global()
            && let Some(id) = intent.session_id.as_deref()
        {
            objects.create_conversation(id, intent.project.as_deref());
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

    async fn set_reasoning_effort(
        &self,
        session_id: &str,
        effort: &str,
    ) -> Result<(), RuntimeError> {
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

    fn journal_feed(&self, session_id: &str) -> Option<manox_agent::thread::ThreadHandle> {
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
            let home =
                std::env::temp_dir().join(format!("zu-manox-test-home-{}", std::process::id()));
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

#[cfg(test)]
mod pi_bridge_tests {
    use crate::model_catalog::pi_providers_yaml;

    #[test]
    fn the_yaml_carries_the_cx_shape() {
        let dir = std::env::temp_dir().join("zu-pi-bridge-test");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("models.json"),
            r#"{"providers": {"bailian": {"api": "anthropic-messages", "baseUrl": "https://x.example",
                "models": [{"id": "qwen3.8-max", "contextWindow": 1000000, "maxTokens": 131072}]}}}"#,
        )
        .unwrap();
        std::fs::write(
            dir.join("auth.json"),
            r#"{"bailian": {"type": "api_key", "key": "k"}}"#,
        )
        .unwrap();
        let yaml = pi_providers_yaml(&dir).unwrap();
        assert!(yaml.contains("providers:"), "{yaml}");
        assert!(yaml.contains("  - name: bailian"), "{yaml}");
        assert!(
            yaml.contains("apikey_source: env:ZU_PI_KEY_BAILIAN"),
            "{yaml}"
        );
        assert!(yaml.contains("anthropic: https://x.example"), "{yaml}");
        assert!(yaml.contains("      qwen3.8-max:"), "{yaml}");
        assert!(yaml.contains("context: 1000000"), "{yaml}");
        assert!(yaml.contains("max_tokens: 131072"), "{yaml}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_provider_without_an_api_key_is_skipped() {
        let dir = std::env::temp_dir().join("zu-pi-bridge-none");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("models.json"),
            r#"{"providers": {"oauthish": {"api": "anthropic-messages", "baseUrl": "https://x",
                "models": [{"id": "m"}]}}}"#,
        )
        .unwrap();
        std::fs::write(dir.join("auth.json"), r#"{"oauthish": {"type": "oauth"}}"#).unwrap();
        assert!(pi_providers_yaml(&dir).is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// The real wiring proof, run on demand against the developer's own
    /// machine: the generated YAML registers into a fresh kernel registry
    /// and the composed registration-qualified ref resolves.
    #[test]
    #[ignore = "reads the developer's real ~/.pi credentials"]
    fn the_real_pi_config_registers_and_resolves() {
        let dir = std::path::PathBuf::from(
            std::env::var("PI_CODING_AGENT_DIR")
                .unwrap_or_else(|_| format!("{}/.pi/agent", std::env::var("HOME").unwrap())),
        );
        let yaml = pi_providers_yaml(&dir).expect("this machine's pi config bridges");
        let registry = manox_harness::core::provider_registry::ProviderRegistry::new();
        let count = manox_harness::provider::register_providers_yaml(&registry, &yaml).unwrap();
        assert!(count > 0, "registered {count}");
        // The composed ref the app sends: bailian-anthropic/<first model>.
        let models: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(dir.join("models.json")).unwrap())
                .unwrap();
        let provider = models["providers"]
            .as_object()
            .unwrap()
            .keys()
            .next()
            .unwrap()
            .clone();
        let model = models["providers"][&provider]["models"][0]["id"]
            .as_str()
            .unwrap()
            .to_owned();
        let reference = format!("bailian-anthropic/{model}");
        assert!(
            manox_harness::model_ref::resolve_model_ref(&registry, &reference).is_some(),
            "the ref {reference} resolves"
        );
    }
}

#[cfg(test)]
mod home_tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Mutex, OnceLock};

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    struct EnvGuard {
        home: Option<std::ffi::OsString>,
        manox_home: Option<std::ffi::OsString>,
        manox_claude_home: Option<std::ffi::OsString>,
    }

    impl EnvGuard {
        fn set_home(home: &Path) -> Self {
            let guard = Self {
                home: std::env::var_os("HOME"),
                manox_home: std::env::var_os("MANOX_HOME"),
                manox_claude_home: std::env::var_os("MANOX_CLAUDE_HOME"),
            };
            unsafe {
                std::env::set_var("HOME", home);
                std::env::remove_var("MANOX_HOME");
                std::env::remove_var("MANOX_CLAUDE_HOME");
            }
            guard
        }
    }

    impl Drop for EnvGuard {
        fn drop(&mut self) {
            unsafe {
                restore("HOME", &self.home);
                restore("MANOX_HOME", &self.manox_home);
                restore("MANOX_CLAUDE_HOME", &self.manox_claude_home);
            }
        }
    }

    unsafe fn restore(name: &str, value: &Option<std::ffi::OsString>) {
        match value {
            Some(value) => unsafe { std::env::set_var(name, value) },
            None => unsafe { std::env::remove_var(name) },
        }
    }

    fn root() -> PathBuf {
        static SEQ: OnceLock<AtomicUsize> = OnceLock::new();
        let seq = SEQ.get_or_init(|| AtomicUsize::new(0));
        let dir = std::env::temp_dir().join(format!(
            "zu-manox-home-test-{}-{}",
            std::process::id(),
            seq.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn manox_home_moves_legacy_state_and_does_not_set_claude_home() {
        let _lock = ENV_LOCK.lock().unwrap();
        let home = root();
        let legacy = home.join(".manox");
        std::fs::create_dir_all(legacy.join("core")).unwrap();
        std::fs::write(legacy.join("settings.toml"), "x").unwrap();
        let _guard = EnvGuard::set_home(&home);
        HERMETIC.store(false, Ordering::Release);

        configure_manox_home();

        let target = home.join(".steer/.manox");
        assert_eq!(std::env::var_os("MANOX_HOME").unwrap(), target.as_os_str());
        assert!(target.join("core").is_dir());
        assert_eq!(
            std::fs::read_to_string(target.join("settings.toml")).unwrap(),
            "x"
        );
        assert!(!legacy.exists());
        assert!(std::env::var_os("MANOX_CLAUDE_HOME").is_none());
    }

    #[test]
    fn manox_home_keeps_an_explicit_override() {
        let _lock = ENV_LOCK.lock().unwrap();
        let home = root();
        let explicit = home.join("custom-manox");
        let _guard = EnvGuard::set_home(&home);
        unsafe { std::env::set_var("MANOX_HOME", &explicit) };
        HERMETIC.store(false, Ordering::Release);

        configure_manox_home();
        assert_eq!(
            std::env::var_os("MANOX_HOME").unwrap(),
            explicit.as_os_str()
        );
    }
}
