//! The in-proc stub host half: a deterministic scripted AHP host for T0.
//!
//! It speaks the same wire the real manox host will (JSON-RPC 2.0 with
//! `initialize` / `subscribe` / `unsubscribe` / `reconnect` / `listSessions` /
//! `createSession` / `createChat` / `ping`, `dispatchAction` notifications
//! echoed as `action` envelopes, `root/sessionAdded` notifications, envelopes
//! stamped with a global `serverSeq`, `origin{clientId, clientSeq}` and
//! `rejectionReason`) so `app/harness/manox/ahp.ts` and the vendored reducers
//! are exercised against a faithful host from day one. Its fold of its own
//! published chat actions ([`fold_chat`]) mirrors the vendored TS reducer for
//! exactly the actions it serves — the TS fold gate (`app/manox.test.ts`)
//! replays the same journal through the vendored reducer and requires deep
//! equality, so any drift fails the gate instead of shipping.
//!
//! The scripted turn (deterministic order; short real delays so streaming is
//! observable, batched steps inside a stage):
//! `chat/turnStarted` echo → `chat/responsePart` (markdown, grown by
//! `chat/delta`) → `chat/responsePart` (reasoning, grown by `chat/reasoning`)
//! → `chat/toolCallStart` → `chat/toolCallReady` (pending-confirmation; the
//! host **waits** for the client) → on approved `chat/toolCallConfirmed`:
//! `chat/toolCallComplete` → more markdown → `chat/inputRequested` (one text
//! elicitation; the host waits) → on `chat/inputCompleted{accept}`: closing
//! markdown → a queued `chat/pendingMessageSet` → `chat/turnComplete` → the
//! queued message auto-starts a second short turn (`queuedMessageId`,
//! `chat/pendingMessageRemoved`). `chat/turnCancelled` (client) and
//! `chat/inputCompleted{decline|cancel}` end the turn cancelled. Refused
//! actions come back as envelopes with `rejectionReason` (fail-closed, the
//! manox rule): an active turn, a confirmation/answer for the wrong object,
//! or anything outside the client-dispatchable set the stub serves.
//!
//! ## M1 swap
//!
//! This whole module is the T0 stand-in for manox's real host half. At M1,
//! `host.rs` swaps it for an adapter over `manox_ahp_runtime::AhpRuntime`
//! (`install_builder` + `Host::accept` on the `transport::inproc` pair) as a
//! git dependency (`tag = "v0.9.1"` or later); the pump, the panic boundary
//! and the TSX side are unchanged.

use std::{
    collections::BTreeMap,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use serde_json::{Value, json};

/// The message of the panic `inject_panic` plants inside the host half.
pub(crate) const INJECTED_PANIC: &str = "manox host half: injected panic (T0 crash-isolation gate)";

/// Everything one inbound frame (or due-schedule tick) produced: the frames
/// to flush now. Wire errors are JSON-RPC error responses inside `outbound`,
/// never a `Result` — only a Rust panic escapes, and only as a caught panic
/// (see `host.rs`), never by unwinding into the pump.
#[derive(Debug, Default)]
pub(crate) struct Outcome {
    pub(crate) outbound: Vec<String>,
}

/// One scripted step waiting for its time.
struct Scheduled {
    at: Instant,
    channel: String,
    action: Value,
}

/// The point a scripted turn is parked at, waiting for the client.
#[derive(Debug, Clone, Copy, PartialEq)]
enum Stage {
    /// `chat/toolCallReady` sent; waiting for `chat/toolCallConfirmed`.
    ToolConfirmation,
    /// `chat/inputRequested` sent; waiting for `chat/inputCompleted`.
    Elicitation,
}

struct TurnWait {
    turn_id: String,
    stage: Stage,
    tool_call_id: String,
    request_id: String,
    started_at_epoch_ms: i64,
    user_text: String,
}

struct ChatRecord {
    session_uri: String,
    state: Value,
    wait: Option<TurnWait>,
}

struct SessionRecord {
    summary: Value,
    state: Value,
}

/// The deterministic stub host's whole state: its journal (the `reconnect`
/// replay leg's source) and its fold of that journal (the snapshot leg's
/// source). Sync by construction: every mutation happens inside
/// [`StubCore::handle_frame`] or [`StubCore::take_due`], which the host task
/// runs under `catch_unwind` (`host.rs`), so a panic cannot tear the state.
pub(crate) struct StubCore {
    seq: i64,
    client_id: Option<String>,
    journal: Vec<Value>,
    root: Value,
    sessions: BTreeMap<String, SessionRecord>,
    chats: BTreeMap<String, ChatRecord>,
    scheduled: Vec<Scheduled>,
    turn_counter: u64,
    request_counter: u64,
}

impl StubCore {
    pub(crate) fn new() -> Self {
        Self {
            seq: 0,
            client_id: None,
            journal: Vec::new(),
            root: json!({
                "agents": [{
                    "provider": "stub",
                    "displayName": "Stub Agent",
                    "description": "The in-proc stub host's scripted agent.",
                    "models": [{
                        "id": "stub-flash",
                        "name": "Stub Flash",
                        "contextWindow": 200000,
                    }],
                }],
                "activeSessions": 0,
            }),
            sessions: BTreeMap::new(),
            chats: BTreeMap::new(),
            scheduled: Vec::new(),
            turn_counter: 0,
            request_counter: 0,
        }
    }

    /// The next moment a scheduled step fires, for the host task's sleep.
    pub(crate) fn next_due(&self) -> Option<Instant> {
        self.scheduled.first().map(|step| step.at)
    }

    /// Fires every scheduled step whose time has come, in schedule order.
    /// A fired `chat/turnComplete` whose chat carries queued messages also
    /// runs the queued follow-up turn (its `turnStarted` names
    /// `queuedMessageId` and the lane entry is removed).
    pub(crate) fn take_due(&mut self, now: Instant, outcome: &mut Outcome) {
        while self.scheduled.first().is_some_and(|step| step.at <= now) {
            let step = self.scheduled.remove(0);
            let channel = step.channel.clone();
            let done = step.action.get("type").and_then(Value::as_str) == Some("chat/turnComplete");
            self.publish(&channel, step.action, outcome);
            if done
                && let Some(record) = self.chats.get(&channel)
                && record
                    .state
                    .get("queuedMessages")
                    .and_then(Value::as_array)
                    .is_some_and(|messages| !messages.is_empty())
            {
                self.run_queued_turn(now, &channel, outcome);
            }
        }
    }

    /// Processes one client frame. A malformed frame answers a JSON-RPC
    /// parse error; a request answers a response; `dispatchAction` answers
    /// with echoed `action` envelopes (and may schedule scripted steps); an
    /// unknown method answers `-32601`.
    pub(crate) fn handle_frame(&mut self, now: Instant, text: &str) -> Outcome {
        let mut outcome = Outcome::default();
        let msg: Value = match serde_json::from_str(text) {
            Ok(msg) => msg,
            Err(_) => {
                outcome.outbound.push(
                    json!({"jsonrpc": "2.0", "id": Value::Null,
                           "error": {"code": -32700, "message": "Parse error"}})
                    .to_string(),
                );
                return outcome;
            }
        };
        let id = msg.get("id").cloned().unwrap_or(Value::Null);
        let method = msg.get("method").and_then(Value::as_str).unwrap_or("");
        let params = msg.get("params").cloned().unwrap_or_else(|| json!({}));
        if method == "dispatchAction" {
            self.dispatch_action(now, &params, &mut outcome);
            return outcome;
        }
        match self.command(method, &params, &mut outcome) {
            Ok(value) => outcome
                .outbound
                .push(json!({"jsonrpc": "2.0", "id": id, "result": value}).to_string()),
            Err((code, message)) => outcome.outbound.push(
                json!({"jsonrpc": "2.0", "id": id,
                       "error": {"code": code, "message": message}})
                .to_string(),
            ),
        }
        outcome
    }

    // ── commands ─────────────────────────────────────────────────────────

    fn command(
        &mut self,
        method: &str,
        params: &Value,
        outcome: &mut Outcome,
    ) -> Result<Value, (i64, &'static str)> {
        match method {
            "initialize" => {
                self.client_id = params
                    .get("clientId")
                    .and_then(Value::as_str)
                    .map(str::to_owned);
                let mut snapshots = Vec::new();
                if let Some(uris) = params.get("initialSubscriptions").and_then(Value::as_array) {
                    for uri in uris {
                        if let Some(snapshot) = self.snapshot(uri.as_str().unwrap_or("")) {
                            snapshots.push(snapshot);
                        }
                    }
                }
                self.publish(
                    "ahp-root://",
                    json!({"type": "root/agentsChanged", "agents": self.root["agents"]}),
                    outcome,
                );
                Ok(json!({
                    "protocolVersion": "1.0.0",
                    "serverSeq": self.seq,
                    "serverInfo": {"name": "manox-stub-host", "version": "0.1.0"},
                    "snapshots": snapshots,
                }))
            }
            "subscribe" => {
                let uri = params.get("channel").and_then(Value::as_str).unwrap_or("");
                match self.snapshot(uri) {
                    Some(snapshot) => Ok(json!({ "snapshot": snapshot })),
                    None => Err((-32008, "the channel does not exist")),
                }
            }
            "unsubscribe" => Ok(json!({})),
            "ping" => Ok(json!({})),
            "listSessions" => {
                let items: Vec<&Value> = self
                    .sessions
                    .values()
                    .map(|record| &record.summary)
                    .collect();
                Ok(json!({ "items": items }))
            }
            "createSession" => {
                let uri = params.get("channel").and_then(Value::as_str).unwrap_or("");
                if uri.is_empty() {
                    return Err((-32602, "createSession needs params.channel"));
                }
                // Idempotent by design (DESIGN §3.4: the client mints the
                // uuid; a retried create lands on the same session).
                if !self.sessions.contains_key(uri) {
                    let id = uri.trim_start_matches("ahp-session:/");
                    let now_iso = iso_now();
                    let summary = json!({
                        "resource": uri,
                        "provider": "stub",
                        "title": format!("manox {id}"),
                        "status": 1,
                        "createdAt": now_iso,
                        "modifiedAt": now_iso,
                        "chats": [],
                    });
                    let state = json!({
                        "resource": uri,
                        "provider": "stub",
                        "title": format!("manox {id}"),
                        "status": 1,
                        "createdAt": now_iso,
                        "modifiedAt": now_iso,
                        "lifecycle": "creating",
                        "activeClients": [],
                        "chats": [],
                    });
                    self.sessions
                        .insert(uri.to_owned(), SessionRecord { summary, state });
                    let count = self.sessions.len() as i64;
                    self.publish(
                        "ahp-root://",
                        json!({"type": "root/activeSessionsChanged", "activeSessions": count}),
                        outcome,
                    );
                    let added = self.sessions[uri].summary.clone();
                    outcome.outbound.push(
                        json!({"jsonrpc": "2.0", "method": "root/sessionAdded",
                               "params": {"channel": "ahp-root://", "summary": added}})
                        .to_string(),
                    );
                    self.publish(uri, json!({"type": "session/ready"}), outcome);
                }
                Ok(Value::Null)
            }
            "createChat" => {
                let session_uri = params.get("channel").and_then(Value::as_str).unwrap_or("");
                let chat_uri = params.get("chat").and_then(Value::as_str).unwrap_or("");
                if session_uri.is_empty() || chat_uri.is_empty() {
                    return Err((-32602, "createChat needs params.channel and params.chat"));
                }
                if !self.sessions.contains_key(session_uri) {
                    return Err((-32001, "the session does not exist"));
                }
                if !self.chats.contains_key(chat_uri) {
                    let id = chat_uri.trim_start_matches("ahp-chat:/");
                    let now_iso = iso_now();
                    let chat_state = json!({
                        "resource": chat_uri,
                        "title": format!("chat {id}"),
                        "status": 1,
                        "modifiedAt": now_iso,
                        "turns": [],
                    });
                    self.chats.insert(
                        chat_uri.to_owned(),
                        ChatRecord {
                            session_uri: session_uri.to_owned(),
                            state: chat_state,
                            wait: None,
                        },
                    );
                    let summary = json!({
                        "resource": chat_uri,
                        "title": format!("chat {id}"),
                        "status": 1,
                        "modifiedAt": now_iso,
                    });
                    self.publish(
                        session_uri,
                        json!({"type": "session/chatAdded", "summary": summary}),
                        outcome,
                    );
                    self.publish(
                        session_uri,
                        json!({"type": "session/defaultChatChanged", "defaultChat": chat_uri}),
                        outcome,
                    );
                }
                Ok(Value::Null)
            }
            "reconnect" => {
                let last_seen = params
                    .get("lastSeenServerSeq")
                    .and_then(Value::as_i64)
                    .unwrap_or(0);
                let subscriptions = params
                    .get("subscriptions")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default();
                Ok(self.reconnect(last_seen, &subscriptions))
            }
            _ => Err((-32601, "method not found")),
        }
    }

    // ── dispatch ─────────────────────────────────────────────────────────

    fn dispatch_action(&mut self, now: Instant, params: &Value, outcome: &mut Outcome) {
        let channel = params.get("channel").and_then(Value::as_str).unwrap_or("");
        let client_seq = params.get("clientSeq").and_then(Value::as_i64).unwrap_or(0);
        let action = params.get("action").cloned().unwrap_or_else(|| json!({}));
        let origin = self
            .client_id
            .clone()
            .map(|client_id| json!({"clientId": client_id, "clientSeq": client_seq}));
        let rejection = self.apply_action(now, channel, &action, outcome);
        self.emit_action(channel, action, origin, rejection, outcome);
    }

    /// Applies one dispatched action; `Some(reason)` refuses it (the reason
    /// travels on the envelope as `rejectionReason`). Derived scripted steps
    /// are scheduled here.
    fn apply_action(
        &mut self,
        now: Instant,
        channel: &str,
        action: &Value,
        _outcome: &mut Outcome,
    ) -> Option<String> {
        let kind = action.get("type").and_then(Value::as_str).unwrap_or("");
        match kind {
            "chat/turnStarted" => {
                let active = self
                    .chats
                    .get(channel)
                    .map(|record| record.wait.is_some())
                    .unwrap_or(false);
                if !self.chats.contains_key(channel) {
                    return Some("the chat does not exist".to_owned());
                }
                if active {
                    return Some("a turn is already active in this chat".to_owned());
                }
                // The client is the writer: its action names the turn id and
                // the started-at stamp; the host echoes them as-is.
                let turn_id = action
                    .get("turnId")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_owned();
                if turn_id.is_empty() {
                    return Some("chat/turnStarted needs turnId".to_owned());
                }
                let started_at = action
                    .get("startedAt")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
                    .unwrap_or_else(iso_now);
                let _ = &started_at;
                let message = action.get("message").cloned().unwrap_or_else(|| json!({}));
                let user_text = message
                    .get("text")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_owned();
                // The fold happens here; the echo itself is emitted by the
                // dispatch caller (publishing here would double the frame).
                self.apply_host_action(channel, action);
                self.turn_counter += 1;
                let wait = TurnWait {
                    turn_id: turn_id.clone(),
                    stage: Stage::ToolConfirmation,
                    tool_call_id: format!("tc-{turn_id}"),
                    request_id: String::new(),
                    started_at_epoch_ms: epoch_now(),
                    user_text: user_text.clone(),
                };
                if let Some(record) = self.chats.get_mut(channel) {
                    record.wait = Some(wait);
                }
                // The scripted stream. Order is what the gates pin; the
                // delays only make the streaming observable.
                let tool_call_id = format!("tc-{turn_id}");
                let script: Vec<(u64, Value)> = vec![
                    (
                        15,
                        json!({"type": "chat/responsePart", "turnId": turn_id, "part": {"kind": "markdown", "id": "p1", "content": ""}}),
                    ),
                    (
                        30,
                        json!({"type": "chat/delta", "turnId": turn_id, "partId": "p1", "content": "## Stub reply\n\n"}),
                    ),
                    (
                        45,
                        json!({"type": "chat/delta", "turnId": turn_id, "partId": "p1", "content": format!("Echo: {user_text}")}),
                    ),
                    (
                        60,
                        json!({"type": "chat/responsePart", "turnId": turn_id, "part": {"kind": "reasoning", "id": "r1", "content": "thinking"}}),
                    ),
                    (
                        75,
                        json!({"type": "chat/reasoning", "turnId": turn_id, "partId": "r1", "content": " — scripted."}),
                    ),
                    (
                        90,
                        json!({"type": "chat/toolCallStart", "turnId": turn_id, "toolCallId": tool_call_id, "toolName": "stub_read", "displayName": "Stub read"}),
                    ),
                    (
                        105,
                        json!({
                            "type": "chat/toolCallReady", "turnId": turn_id, "toolCallId": tool_call_id,
                            "invocationMessage": "Read the stub fixture",
                            "toolInput": "{\"path\": \"stub://fixture\"}",
                            "confirmationTitle": "Run the stub tool"
                        }),
                    ),
                ];
                for (delay, action) in script {
                    self.scheduled.push(Scheduled {
                        at: now + Duration::from_millis(delay),
                        channel: channel.to_owned(),
                        action,
                    });
                }
                self.scheduled.sort_by_key(|step| step.at);
                None
            }
            "chat/toolCallConfirmed" => {
                let record = self.chats.get_mut(channel)?;
                let wait = record.wait.as_ref()?;
                let said_id = action
                    .get("toolCallId")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                if wait.stage != Stage::ToolConfirmation || wait.tool_call_id != said_id {
                    return Some("no tool call is waiting for confirmation".to_owned());
                }
                let approved = action
                    .get("approved")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                let turn_id = wait.turn_id.clone();
                if !approved {
                    // Denied: the tool call folds to cancelled and the turn
                    // ends cancelled right after.
                    let duration = epoch_now().saturating_sub(wait.started_at_epoch_ms).max(1);
                    let turn = self.chats.get_mut(channel).map(|record| {
                        record.state = fold_chat(record.state.clone(), action);
                        record.wait = None;
                    });
                    let _ = turn;
                    self.schedule(now, 15, channel, json!({"type": "chat/turnCancelled", "turnId": turn_id, "duration": duration}));
                    return None;
                }
                let request_number = self.request_counter + 1;
                self.request_counter += 1;
                let request_id = format!("el-{request_number}");
                if let Some(record) = self.chats.get_mut(channel) {
                    record.state = fold_chat(record.state.clone(), action);
                    if let Some(wait) = record.wait.as_mut() {
                        wait.stage = Stage::Elicitation;
                        wait.request_id = request_id.clone();
                    }
                }
                let tool_call_id = format!("tc-{turn_id}");
                let script: Vec<(u64, Value)> = vec![
                    (
                        15,
                        json!({
                            "type": "chat/toolCallComplete", "turnId": turn_id, "toolCallId": tool_call_id,
                            "result": {"success": true, "pastTenseMessage": "Read the stub fixture"}
                        }),
                    ),
                    (
                        30,
                        json!({"type": "chat/responsePart", "turnId": turn_id, "part": {"kind": "markdown", "id": "p2", "content": ""}}),
                    ),
                    (
                        45,
                        json!({"type": "chat/delta", "turnId": turn_id, "partId": "p2", "content": "Tool done. One question:\n"}),
                    ),
                    (
                        60,
                        json!({
                            "type": "chat/inputRequested",
                            "request": {
                                "id": request_id,
                                "message": "The stub host needs one answer to finish.",
                                "questions": [{
                                    "id": "q1", "kind": "text",
                                    "message": "What should the stub record?",
                                    "required": true
                                }]
                            }
                        }),
                    ),
                ];
                for (delay, action) in script {
                    self.scheduled.push(Scheduled {
                        at: now + Duration::from_millis(delay),
                        channel: channel.to_owned(),
                        action,
                    });
                }
                self.scheduled.sort_by_key(|step| step.at);
                None
            }
            "chat/inputAnswerChanged" => {
                // Client-owned draft state; folded by the echo alone.
                if !self.chats.contains_key(channel) {
                    return Some("the chat does not exist".to_owned());
                }
                None
            }
            "chat/inputCompleted" => {
                let record = self.chats.get_mut(channel)?;
                let wait = record.wait.as_ref()?;
                let said_id = action
                    .get("requestId")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                if wait.stage != Stage::Elicitation || wait.request_id != said_id {
                    return Some("no input request is waiting for an answer".to_owned());
                }
                let response = action
                    .get("response")
                    .and_then(Value::as_str)
                    .unwrap_or("cancel")
                    .to_owned();
                let turn_id = wait.turn_id.clone();
                let user_text = wait.user_text.clone();
                let duration = epoch_now().saturating_sub(wait.started_at_epoch_ms).max(1);
                if let Some(record) = self.chats.get_mut(channel) {
                    record.state = fold_chat(record.state.clone(), action);
                    record.wait = None;
                }
                if response != "accept" {
                    self.schedule(now, 15, channel, json!({"type": "chat/turnCancelled", "turnId": turn_id, "duration": duration}));
                    return None;
                }
                let queued_id = format!("queue-{turn_id}");
                let script: Vec<(u64, Value)> = vec![
                    (
                        15,
                        json!({"type": "chat/responsePart", "turnId": turn_id, "part": {"kind": "markdown", "id": "p3", "content": ""}}),
                    ),
                    (
                        30,
                        json!({"type": "chat/delta", "turnId": turn_id, "partId": "p3", "content": "Answered. The stub turn is complete."}),
                    ),
                    (
                        45,
                        json!({
                            "type": "chat/pendingMessageSet", "kind": "queued", "id": queued_id,
                            "message": {"text": format!("follow-up to: {user_text}"), "origin": {"kind": "user"}}
                        }),
                    ),
                    (
                        60,
                        json!({"type": "chat/turnComplete", "turnId": turn_id, "duration": duration}),
                    ),
                ];
                for (delay, action) in script {
                    self.scheduled.push(Scheduled {
                        at: now + Duration::from_millis(delay),
                        channel: channel.to_owned(),
                        action,
                    });
                }
                self.scheduled.sort_by_key(|step| step.at);
                None
            }
            "chat/turnCancelled" => {
                let record = self.chats.get_mut(channel)?;
                let wait = record.wait.as_ref()?;
                let active_turn = wait.turn_id.clone();
                let said_turn = action.get("turnId").and_then(Value::as_str).unwrap_or("");
                if active_turn != said_turn {
                    return Some("no such active turn".to_owned());
                }
                let duration = epoch_now().saturating_sub(wait.started_at_epoch_ms).max(1);
                if let Some(record) = self.chats.get_mut(channel) {
                    record.state = fold_chat(record.state.clone(), action);
                    record.wait = None;
                }
                // The script stops: drop every pending step of this turn.
                self.scheduled
                    .retain(|step| !step_names_turn(&step.action, &active_turn));
                self.schedule(now, 15, channel, json!({"type": "chat/turnCancelled", "turnId": active_turn, "duration": duration}));
                None
            }
            // Accepted, no host work, folded by the echo (drafts, lanes).
            "chat/draftChanged"
            | "chat/pendingMessageSet"
            | "chat/pendingMessageRemoved"
            | "chat/workingDirectorySet"
            | "chat/workingDirectoryRemoved" => {
                if !self.chats.contains_key(channel) {
                    return Some("the chat does not exist".to_owned());
                }
                None
            }
            // Server-produced and not served: fail closed with a reason.
            _ => Some(format!("the stub host does not accept {kind}")),
        }
    }

    /// The queued follow-up turn: `turnStarted` (with `queuedMessageId`),
    /// one streamed line, the lane entry removed, `turnComplete`.
    fn run_queued_turn(&mut self, now: Instant, channel: &str, outcome: &mut Outcome) {
        let (queued_id, message, turn_number) = {
            let record = match self.chats.get(channel) {
                Some(record) => record,
                None => return,
            };
            let queue = record
                .state
                .get("queuedMessages")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let Some(first) = queue.first().cloned() else {
                return;
            };
            let id = first
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_owned();
            self.turn_counter += 1;
            (id, first, self.turn_counter)
        };
        let turn_id = format!("turn-{turn_number}");
        let started_at = iso_now();
        self.publish(
            channel,
            json!({"type": "chat/turnStarted", "turnId": turn_id, "startedAt": started_at, "message": message, "queuedMessageId": queued_id}),
            outcome,
        );
        let script: Vec<(u64, Value)> = vec![
            (
                15,
                json!({"type": "chat/responsePart", "turnId": turn_id, "part": {"kind": "markdown", "id": "q1", "content": ""}}),
            ),
            (
                30,
                json!({"type": "chat/delta", "turnId": turn_id, "partId": "q1", "content": "The queued follow-up ran as its own turn."}),
            ),
            (
                45,
                json!({"type": "chat/pendingMessageRemoved", "kind": "queued", "id": queued_id}),
            ),
            (
                60,
                json!({"type": "chat/turnComplete", "turnId": turn_id, "duration": 60}),
            ),
        ];
        for (delay, action) in script {
            self.scheduled.push(Scheduled {
                at: now + Duration::from_millis(delay),
                channel: channel.to_owned(),
                action,
            });
        }
        self.scheduled.sort_by_key(|step| step.at);
    }

    fn schedule(&mut self, now: Instant, delay_ms: u64, channel: &str, action: Value) {
        self.scheduled.push(Scheduled {
            at: now + Duration::from_millis(delay_ms),
            channel: channel.to_owned(),
            action,
        });
        self.scheduled.sort_by_key(|step| step.at);
    }

    // ── publishing ───────────────────────────────────────────────────────

    /// Stamps, journals and queues one `action` notification frame.
    /// Rejections are stamped and journaled too — folding skips rejection
    /// envelopes on both legs (the gate proves the legs agree anyway).
    fn emit_action(
        &mut self,
        channel: &str,
        action: Value,
        origin: Option<Value>,
        rejection: Option<String>,
        outcome: &mut Outcome,
    ) {
        self.seq += 1;
        let mut envelope = json!({
            "channel": channel,
            "action": action,
            "serverSeq": self.seq,
        });
        if let Some(origin) = origin {
            envelope["origin"] = origin;
        }
        if let Some(reason) = rejection {
            envelope["rejectionReason"] = Value::String(reason);
        }
        self.journal.push(envelope.clone());
        if self.journal.len() > 4096 {
            self.journal.remove(0);
        }
        outcome
            .outbound
            .push(json!({"jsonrpc": "2.0", "method": "action", "params": envelope}).to_string());
    }

    /// Publishes a host-originated action: fold it into the stub's state,
    /// then stamp/journal/queue it.
    fn publish(&mut self, channel: &str, action: Value, outcome: &mut Outcome) {
        self.apply_host_action(channel, &action);
        self.emit_action(channel, action, None, None, outcome);
    }

    /// The stub's fold of its own host actions (the snapshot leg): root and
    /// session folds mirror the vendored reducers; chat folds go through
    /// [`fold_chat`], the mirror of the vendored chat reducer.
    fn apply_host_action(&mut self, channel: &str, action: &Value) {
        match action.get("type").and_then(Value::as_str).unwrap_or("") {
            "root/activeSessionsChanged" => {
                self.root["activeSessions"] = action["activeSessions"].clone();
            }
            "root/agentsChanged" => {
                self.root["agents"] = action["agents"].clone();
            }
            "session/ready" => {
                if let Some(record) = self.sessions.get_mut(channel) {
                    let mut state = record.state.clone();
                    state["lifecycle"] = Value::String("ready".to_owned());
                    record.state = state;
                }
            }
            "session/chatAdded" => {
                let Some(record) = self.sessions.get_mut(channel) else {
                    return;
                };
                let mut state = record.state.clone();
                let mut chats = state["chats"].as_array().cloned().unwrap_or_default();
                let summary = action["summary"].clone();
                match chats
                    .iter()
                    .position(|chat| chat["resource"] == summary["resource"])
                {
                    Some(at) => chats[at] = summary,
                    None => chats.push(summary),
                }
                state["chats"] = Value::Array(chats);
                // The catalog summary mirrors the state's chats
                // (`SessionChatSummary`: resource, title, interactivity).
                record.summary["chats"] = Value::Array(
                    state["chats"]
                        .as_array()
                        .map(|chats| {
                            chats
                                .iter()
                                .map(|chat| {
                                    json!({
                                        "resource": chat["resource"],
                                        "title": chat["title"],
                                        "interactivity": "full",
                                    })
                                })
                                .collect()
                        })
                        .unwrap_or_default(),
                );
                if let Some(default_chat) = state.get("defaultChat") {
                    record.summary["defaultChat"] = default_chat.clone();
                }
                record.state = state;
            }
            "session/defaultChatChanged" => {
                if let Some(record) = self.sessions.get_mut(channel) {
                    let mut state = record.state.clone();
                    state["defaultChat"] = action["defaultChat"].clone();
                    record.summary["defaultChat"] = action["defaultChat"].clone();
                    record.state = state;
                }
            }
            // Everything the chat channels produce goes through the mirror.
            kind if kind.starts_with("chat/") => {
                if let Some(record) = self.chats.get_mut(channel) {
                    record.state = fold_chat(record.state.clone(), action);
                }
            }
            _ => {}
        }
    }

    /// The `Snapshot` of one channel, from the stub's fold.
    fn snapshot(&self, uri: &str) -> Option<Value> {
        let state = if uri == "ahp-root://" {
            self.root.clone()
        } else if let Some(record) = self.sessions.get(uri) {
            record.state.clone()
        } else {
            self.chats.get(uri)?.state.clone()
        };
        Some(json!({
            "resource": uri,
            "state": state,
            "fromSeq": self.seq,
        }))
    }

    /// Answers `reconnect`: replay when the whole gap is journaled, fresh
    /// snapshots when the gap predates the buffer.
    fn reconnect(&self, last_seen: i64, subscriptions: &[Value]) -> Value {
        let have_full_gap = self
            .journal
            .first()
            .map(|first: &Value| first["serverSeq"].as_i64().unwrap_or(0) <= last_seen + 1)
            .unwrap_or(true);
        if have_full_gap {
            let actions: Vec<Value> = self
                .journal
                .iter()
                .filter(|envelope| envelope["serverSeq"].as_i64().unwrap_or(0) > last_seen)
                .cloned()
                .collect();
            json!({"type": "replay", "actions": actions, "missing": []})
        } else {
            let snapshots: Vec<Value> = subscriptions
                .iter()
                .filter_map(|uri| self.snapshot(uri.as_str().unwrap_or("")))
                .collect();
            json!({"type": "snapshot", "snapshots": snapshots})
        }
    }
}

impl ChatRecord {
    #[allow(dead_code)]
    fn session_uri(&self) -> &str {
        &self.session_uri
    }
}

/// Whether a scheduled step belongs to `turn_id` (the cancel path drops them).
fn step_names_turn(step: &Value, turn_id: &str) -> bool {
    step.get("turnId").and_then(Value::as_str) == Some(turn_id)
}

// ── the fold mirror ──────────────────────────────────────────────────────────
//
// `fold_chat` mirrors the vendored `chatReducer` for the actions the stub
// serves. Two representation rules keep the mirror honest against the TS
// side's JSON round-trip:
// - a key the reducer sets to `undefined` is REMOVED here (`set_undefined`
//   helper), because `JSON.stringify` drops `undefined` values;
// - timestamps parse only in the one format this stub emits
//   (`…T…Z`, millisecond precision) — `add_ms` mirrors
//   `addMillisecondsToTimestamp`.

/// Status bits (SessionStatus). Activity bits are 0–4; metadata flags sit at
/// 5 (IsRead) and 6 (IsArchived).
const IDLE: i64 = 1;
const ERROR: i64 = 2;
const IN_PROGRESS: i64 = 8;
const INPUT_NEEDED: i64 = IN_PROGRESS | 16;
const IS_READ: i64 = 32;
const IS_ARCHIVED: i64 = 64;
const ACTIVITY_MASK: i64 = (1 << 5) - 1;

/// `state[key] = value`, where a `null` value means the reducer produced
/// `undefined` (the key is removed, as `JSON.stringify` would).
fn put(state: &mut Value, key: &str, value: Value) {
    let map = state.as_object_mut().expect("chat state is an object");
    if value.is_null() {
        map.remove(key);
    } else {
        map.insert(key.to_owned(), value);
    }
}

fn set_flag(status: i64, flag: i64, set: bool) -> i64 {
    if set { status | flag } else { status & !flag }
}

fn open_input_request(active_turn: Option<&Value>) -> bool {
    active_turn
        .and_then(|turn| turn.get("responseParts"))
        .and_then(Value::as_array)
        .map(|parts| {
            parts.iter().any(|part| {
                part.get("kind").and_then(Value::as_str) == Some("inputRequest")
                    && part.get("response").is_none()
            })
        })
        .unwrap_or(false)
}

fn blocking_tool_call(active_turn: Option<&Value>) -> bool {
    active_turn
        .and_then(|turn| turn.get("responseParts"))
        .and_then(Value::as_array)
        .map(|parts| {
            parts.iter().any(|part| {
                part.get("kind").and_then(Value::as_str) == Some("toolCall")
                    && matches!(
                        part.pointer("/toolCall/status").and_then(Value::as_str),
                        Some("pending-confirmation")
                            | Some("pending-result-confirmation")
                            | Some("auth-required")
                    )
            })
        })
        .unwrap_or(false)
}

/// `summaryStatus`: activity bits from live work, metadata flags preserved.
fn summary_status(state: &Value) -> i64 {
    let active_turn = state.get("activeTurn").filter(|turn| !turn.is_null());
    let activity = if open_input_request(active_turn) || blocking_tool_call(active_turn) {
        INPUT_NEEDED
    } else if active_turn.is_some() {
        IN_PROGRESS
    } else {
        IDLE
    };
    let status = state.get("status").and_then(Value::as_i64).unwrap_or(IDLE);
    (status & !ACTIVITY_MASK) | activity
}

/// Mirrors `updateResponsePart` for markdown/reasoning parts (by `id`) and
/// tool call parts (by `toolCall.toolCallId`) in the ACTIVE turn only.
fn update_part<F>(state: &Value, turn_id: &str, part_id: &str, update: F) -> Value
where
    F: FnOnce(&Value) -> Value,
{
    let Some(active_turn) = state.get("activeTurn").filter(|turn| !turn.is_null()) else {
        return state.clone();
    };
    if active_turn.get("id").and_then(Value::as_str) != Some(turn_id) {
        return state.clone();
    }
    let Some(parts) = active_turn.get("responseParts").and_then(Value::as_array) else {
        return state.clone();
    };
    for part in parts {
        let id = if part.get("kind").and_then(Value::as_str) == Some("toolCall") {
            part.pointer("/toolCall/toolCallId").and_then(Value::as_str)
        } else {
            part.get("id").and_then(Value::as_str)
        };
        if id == Some(part_id) {
            let updated = update(part);
            let mut next = state.clone();
            let mut turn = active_turn.clone();
            let mut next_parts = parts.clone();
            if let Some(at) = parts.iter().position(|candidate| candidate == part) {
                next_parts[at] = updated;
            }
            turn["responseParts"] = Value::Array(next_parts);
            put(&mut next, "activeTurn", turn);
            return next;
        }
    }
    state.clone()
}

/// Mirrors `updateToolCallInParts`: update the named tool call's state.
fn update_tool_call<F>(state: &Value, turn_id: &str, tool_call_id: &str, update: F) -> Value
where
    F: FnOnce(&Value) -> Value,
{
    update_part(state, turn_id, tool_call_id, |part| {
        let tc = part.get("toolCall").cloned().unwrap_or(Value::Null);
        let updated = update(&tc);
        let mut next_part = part.clone();
        next_part["toolCall"] = updated;
        next_part
    })
}

/// Mirrors `endTurn`: finalize the active turn into `turns`, force
/// non-terminal tool calls to cancelled, stamp `modifiedAt`, recompute
/// `status`.
fn end_turn(
    state: &Value,
    turn_id: &str,
    turn_state: &str,
    duration: i64,
    terminal_error: Option<i64>,
    error_part: Option<Value>,
) -> Value {
    let Some(active_turn) = state.get("activeTurn").filter(|turn| !turn.is_null()) else {
        return state.clone();
    };
    if active_turn.get("id").and_then(Value::as_str) != Some(turn_id) {
        return state.clone();
    }
    let duration = duration.max(0);
    let mut parts = active_turn
        .get("responseParts")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    for part in parts.iter_mut() {
        if part.get("kind").and_then(Value::as_str) != Some("toolCall") {
            continue;
        }
        let tc = part.get("toolCall").cloned().unwrap_or(Value::Null);
        let status = tc.get("status").and_then(Value::as_str).unwrap_or("");
        if status == "completed" || status == "cancelled" {
            continue;
        }
        let streaming = status == "streaming";
        let mut cancelled = json!({
            "status": "cancelled",
            "toolCallId": tc.get("toolCallId"),
            "toolName": tc.get("toolName"),
            "displayName": tc.get("displayName"),
            "intention": tc.get("intention"),
            "contributor": tc.get("contributor"),
            "_meta": tc.get("_meta"),
            "invocationMessage": if streaming {
                tc.get("invocationMessage")
                    .filter(|v| !v.is_null())
                    .cloned()
                    .unwrap_or_else(|| Value::String(String::new()))
            } else {
                tc.get("invocationMessage").cloned().unwrap_or(Value::Null)
            },
            "toolInput": if streaming { Value::Null } else { tc.get("toolInput").cloned().unwrap_or(Value::Null) },
            "reason": "skipped",
        });
        if cancelled["invocationMessage"].is_null() {
            cancelled
                .as_object_mut()
                .unwrap()
                .remove("invocationMessage");
        }
        if cancelled["toolInput"].is_null() {
            cancelled.as_object_mut().unwrap().remove("toolInput");
        }
        if cancelled["_meta"].is_null() {
            cancelled.as_object_mut().unwrap().remove("_meta");
        }
        if cancelled["intention"].is_null() {
            cancelled.as_object_mut().unwrap().remove("intention");
        }
        if cancelled["contributor"].is_null() {
            cancelled.as_object_mut().unwrap().remove("contributor");
        }
        *part = json!({"kind": "toolCall", "toolCall": cancelled});
    }
    if let Some(error_part) = error_part {
        parts.push(error_part);
    }
    let started_at = active_turn
        .get("startedAt")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_owned();
    let turn = json!({
        "id": active_turn.get("id"),
        "startedAt": active_turn.get("startedAt"),
        "duration": duration,
        "message": active_turn.get("message"),
        "responseParts": parts,
        "usage": active_turn.get("usage"),
        "state": turn_state,
    });
    let mut next = state.clone();
    let mut turns = next
        .get("turns")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    turns.push(turn);
    put(&mut next, "turns", Value::Array(turns));
    put(&mut next, "activeTurn", Value::Null);
    put(
        &mut next,
        "modifiedAt",
        Value::String(add_ms(&started_at, duration)),
    );
    let status = match terminal_error {
        Some(code) => {
            (next.get("status").and_then(Value::as_i64).unwrap_or(IDLE) & !ACTIVITY_MASK) | code
        }
        None => summary_status(&next),
    };
    put(&mut next, "status", Value::from(status));
    next
}

/// Mirrors `upsertInputRequestPart` (+ the IsRead clearing both call sites do).
fn upsert_input_request(state: &Value, request: &Value) -> Value {
    let Some(active_turn) = state.get("activeTurn").filter(|turn| !turn.is_null()) else {
        return state.clone();
    };
    let mut parts = active_turn
        .get("responseParts")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let existing = parts.iter().position(|part| {
        part.get("kind").and_then(Value::as_str) == Some("inputRequest")
            && part.get("response").is_none()
            && part.pointer("/request/id").and_then(Value::as_str)
                == request.get("id").and_then(Value::as_str)
    });
    let mut merged = request.clone();
    if let Some(at) = existing {
        let old_answers = parts[at]
            .pointer("/request/answers")
            .cloned()
            .unwrap_or(Value::Null);
        if merged.get("answers").map(Value::is_null).unwrap_or(true) {
            put(&mut merged, "answers", old_answers);
        }
        let mut part = json!({"kind": "inputRequest", "request": merged});
        if part["request"]["answers"].is_null() {
            part["request"].as_object_mut().unwrap().remove("answers");
        }
        parts[at] = part;
    } else {
        let mut part = json!({"kind": "inputRequest", "request": merged});
        if part["request"]["answers"].is_null() {
            part["request"].as_object_mut().unwrap().remove("answers");
        }
        parts.push(part);
    }
    let mut next = state.clone();
    let mut turn = active_turn.clone();
    turn["responseParts"] = Value::Array(parts);
    put(&mut next, "activeTurn", turn);
    let status = set_flag(summary_status(&next), IS_READ, false);
    put(&mut next, "status", Value::from(status));
    next
}

/// The chat fold: `chatReducer` for exactly the actions the stub serves.
pub(crate) fn fold_chat(state: Value, action: &Value) -> Value {
    let kind = action.get("type").and_then(Value::as_str).unwrap_or("");
    let mut next = match kind {
        "chat/turnStarted" => {
            let turn_id = action.get("turnId").cloned().unwrap_or(Value::Null);
            let started_at = action.get("startedAt").cloned().unwrap_or(Value::Null);
            let message = action.get("message").cloned().unwrap_or(Value::Null);
            let mut next = state.clone();
            put(
                &mut next,
                "activeTurn",
                json!({
                    "id": turn_id,
                    "startedAt": started_at,
                    "message": message,
                    "responseParts": [],
                }),
            );
            let status = set_flag(summary_status(&next), IS_READ, false);
            put(&mut next, "status", Value::from(status));
            put(&mut next, "modifiedAt", started_at);
            // An auto-start from a queued message removes that entry.
            if let Some(queued_id) = action
                .get("queuedMessageId")
                .filter(|value| !value.is_null())
                .and_then(Value::as_str)
            {
                if next.pointer("/steeringMessage/id").and_then(Value::as_str) == Some(queued_id) {
                    put(&mut next, "steeringMessage", Value::Null);
                }
                if let Some(queue) = next
                    .get("queuedMessages")
                    .and_then(Value::as_array)
                    .cloned()
                {
                    let filtered: Vec<Value> = queue
                        .into_iter()
                        .filter(|entry| entry.get("id").and_then(Value::as_str) != Some(queued_id))
                        .collect();
                    put(
                        &mut next,
                        "queuedMessages",
                        if filtered.is_empty() {
                            Value::Null
                        } else {
                            Value::Array(filtered)
                        },
                    );
                }
            }
            next
        }
        "chat/delta" => {
            let turn_id = action.get("turnId").and_then(Value::as_str).unwrap_or("");
            let part_id = action.get("partId").and_then(Value::as_str).unwrap_or("");
            let content = action
                .get("content")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_owned();
            update_part(&state, turn_id, part_id, |part| {
                if part.get("kind").and_then(Value::as_str) == Some("markdown") {
                    let mut next_part = part.clone();
                    let grown = format!(
                        "{}{}",
                        part.get("content").and_then(Value::as_str).unwrap_or(""),
                        content
                    );
                    next_part["content"] = Value::String(grown);
                    return next_part;
                }
                part.clone()
            })
        }
        "chat/reasoning" => {
            let turn_id = action.get("turnId").and_then(Value::as_str).unwrap_or("");
            let part_id = action.get("partId").and_then(Value::as_str).unwrap_or("");
            let content = action
                .get("content")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_owned();
            update_part(&state, turn_id, part_id, |part| {
                if part.get("kind").and_then(Value::as_str) == Some("reasoning") {
                    let mut next_part = part.clone();
                    let grown = format!(
                        "{}{}",
                        part.get("content").and_then(Value::as_str).unwrap_or(""),
                        content
                    );
                    next_part["content"] = Value::String(grown);
                    return next_part;
                }
                part.clone()
            })
        }
        "chat/responsePart" => {
            let turn_id = action.get("turnId").and_then(Value::as_str).unwrap_or("");
            let part = action.get("part").cloned().unwrap_or(Value::Null);
            if part.get("kind").and_then(Value::as_str) == Some("error") {
                return state;
            }
            let active = state
                .get("activeTurn")
                .filter(|turn| !turn.is_null())
                .filter(|turn| turn.get("id").and_then(Value::as_str) == Some(turn_id));
            let Some(active_turn) = active else {
                return state;
            };
            let mut next = state.clone();
            let mut turn = active_turn.clone();
            let mut parts = turn
                .get("responseParts")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            parts.push(part);
            turn["responseParts"] = Value::Array(parts);
            put(&mut next, "activeTurn", turn);
            next
        }
        "chat/toolCallStart" => {
            let turn_id = action.get("turnId").and_then(Value::as_str).unwrap_or("");
            let active = state
                .get("activeTurn")
                .filter(|turn| !turn.is_null())
                .filter(|turn| turn.get("id").and_then(Value::as_str) == Some(turn_id));
            let Some(active_turn) = active else {
                return state;
            };
            let mut tool_call = json!({
                "toolCallId": action.get("toolCallId"),
                "toolName": action.get("toolName"),
                "displayName": action.get("displayName"),
                "intention": action.get("intention"),
                "contributor": action.get("contributor"),
                "_meta": action.get("_meta"),
                "status": "streaming",
            });
            for optional in ["intention", "contributor", "_meta"] {
                if tool_call[optional].is_null() {
                    tool_call.as_object_mut().unwrap().remove(optional);
                }
            }
            let mut next = state.clone();
            let mut turn = active_turn.clone();
            let mut parts = turn
                .get("responseParts")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            parts.push(json!({"kind": "toolCall", "toolCall": tool_call}));
            turn["responseParts"] = Value::Array(parts);
            put(&mut next, "activeTurn", turn);
            next
        }
        "chat/toolCallReady" => {
            let turn_id = action.get("turnId").and_then(Value::as_str).unwrap_or("");
            let tool_call_id = action
                .get("toolCallId")
                .and_then(Value::as_str)
                .unwrap_or("");
            let mut next = update_tool_call(&state, turn_id, tool_call_id, |tc| {
                let status = tc.get("status").and_then(Value::as_str).unwrap_or("");
                if !matches!(status, "streaming" | "running" | "pending-confirmation") {
                    return tc.clone();
                }
                let mut ready = json!({
                    "status": "pending-confirmation",
                    "toolCallId": tc.get("toolCallId"),
                    "toolName": tc.get("toolName"),
                    "displayName": tc.get("displayName"),
                    "intention": action
                        .get("intention")
                        .filter(|value| !value.is_null())
                        .cloned()
                        .unwrap_or_else(|| tc.get("intention").cloned().unwrap_or(Value::Null)),
                    "contributor": tc.get("contributor"),
                    "_meta": tc.get("_meta"),
                    "invocationMessage": action.get("invocationMessage"),
                    "toolInput": action
                        .get("toolInput")
                        .filter(|value| !value.is_null())
                        .cloned()
                        .unwrap_or(Value::Null),
                    "confirmationTitle": action.get("confirmationTitle"),
                });
                for optional in ["intention", "contributor", "_meta", "confirmationTitle"] {
                    if ready[optional].is_null() {
                        ready.as_object_mut().unwrap().remove(optional);
                    }
                }
                if ready["toolInput"].is_null()
                    && status != "streaming"
                    && let Some(kept) = tc.get("toolInput")
                    && !kept.is_null()
                {
                    ready["toolInput"] = kept.clone();
                }
                if ready["toolInput"].is_null() {
                    ready.as_object_mut().unwrap().remove("toolInput");
                }
                ready
            });
            let status = summary_status(&next);
            put(&mut next, "status", Value::from(status));
            next
        }
        "chat/toolCallConfirmed" => {
            let turn_id = action.get("turnId").and_then(Value::as_str).unwrap_or("");
            let tool_call_id = action
                .get("toolCallId")
                .and_then(Value::as_str)
                .unwrap_or("");
            let approved = action
                .get("approved")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let mut next = update_tool_call(&state, turn_id, tool_call_id, |tc| {
                if tc.get("status").and_then(Value::as_str) != Some("pending-confirmation") {
                    return tc.clone();
                }
                let mut confirmed = if approved {
                    json!({
                        "status": "running",
                        "toolCallId": tc.get("toolCallId"),
                        "toolName": tc.get("toolName"),
                        "displayName": tc.get("displayName"),
                        "intention": tc.get("intention"),
                        "contributor": tc.get("contributor"),
                        "_meta": tc.get("_meta"),
                        "invocationMessage": tc.get("invocationMessage"),
                        "toolInput": tc.get("toolInput"),
                        "confirmed": action.get("confirmed").filter(|v| !v.is_null()).unwrap_or(&Value::String("user-action".to_owned())),
                    })
                } else {
                    json!({
                        "status": "cancelled",
                        "toolCallId": tc.get("toolCallId"),
                        "toolName": tc.get("toolName"),
                        "displayName": tc.get("displayName"),
                        "intention": tc.get("intention"),
                        "contributor": tc.get("contributor"),
                        "_meta": tc.get("_meta"),
                        "invocationMessage": tc.get("invocationMessage"),
                        "toolInput": tc.get("toolInput"),
                        "reason": action.get("reason").filter(|v| !v.is_null()).unwrap_or(&Value::String("denied".to_owned())),
                    })
                };
                for optional in ["intention", "contributor", "_meta"] {
                    if confirmed[optional].is_null() {
                        confirmed.as_object_mut().unwrap().remove(optional);
                    }
                }
                if confirmed["toolInput"].is_null() {
                    confirmed.as_object_mut().unwrap().remove("toolInput");
                }
                confirmed
            });
            let status = summary_status(&next);
            put(&mut next, "status", Value::from(status));
            next
        }
        "chat/toolCallComplete" => {
            let turn_id = action.get("turnId").and_then(Value::as_str).unwrap_or("");
            let tool_call_id = action
                .get("toolCallId")
                .and_then(Value::as_str)
                .unwrap_or("");
            let result = action.get("result").cloned().unwrap_or(Value::Null);
            let mut next = update_tool_call(&state, turn_id, tool_call_id, |tc| {
                let status = tc.get("status").and_then(Value::as_str).unwrap_or("");
                if !matches!(status, "running" | "pending-confirmation" | "auth-required") {
                    return tc.clone();
                }
                let confirmed = if status == "running" || status == "auth-required" {
                    tc.get("confirmed").cloned().unwrap_or(Value::Null)
                } else {
                    Value::Null
                };
                let mut completed = json!({
                    "status": "completed",
                    "toolCallId": tc.get("toolCallId"),
                    "toolName": tc.get("toolName"),
                    "displayName": tc.get("displayName"),
                    "intention": tc.get("intention"),
                    "contributor": tc.get("contributor"),
                    "_meta": tc.get("_meta"),
                    "invocationMessage": tc.get("invocationMessage"),
                    "toolInput": tc.get("toolInput"),
                    "confirmed": confirmed,
                    "success": result.get("success"),
                    "pastTenseMessage": result.get("pastTenseMessage"),
                });
                if completed["confirmed"].is_null() {
                    completed.as_object_mut().unwrap().remove("confirmed");
                }
                for optional in ["intention", "contributor", "_meta"] {
                    if completed[optional].is_null() {
                        completed.as_object_mut().unwrap().remove(optional);
                    }
                }
                if completed["toolInput"].is_null() {
                    completed.as_object_mut().unwrap().remove("toolInput");
                }
                for optional in ["content", "structuredContent", "error"] {
                    if let Some(value) = result.get(optional)
                        && !value.is_null()
                    {
                        completed[optional] = value.clone();
                    }
                }
                completed
            });
            let status = summary_status(&next);
            put(&mut next, "status", Value::from(status));
            next
        }
        "chat/inputRequested" => {
            let request = action.get("request").cloned().unwrap_or(Value::Null);
            upsert_input_request(&state, &request)
        }
        "chat/inputAnswerChanged" => {
            let request_id = action
                .get("requestId")
                .and_then(Value::as_str)
                .unwrap_or("");
            let question_id = action
                .get("questionId")
                .and_then(Value::as_str)
                .unwrap_or("");
            let answer = action.get("answer").cloned().unwrap_or(Value::Null);
            let Some(active_turn) = state.get("activeTurn").filter(|turn| !turn.is_null()) else {
                return state;
            };
            let Some((at, part)) = active_turn
                .get("responseParts")
                .and_then(Value::as_array)
                .map(|parts| {
                    parts
                        .iter()
                        .enumerate()
                        .find(|(_, part)| {
                            part.get("kind").and_then(Value::as_str) == Some("inputRequest")
                                && part.get("response").is_none()
                                && part.pointer("/request/id").and_then(Value::as_str)
                                    == Some(request_id)
                        })
                        .map(|(at, part)| (at, part.clone()))
                })
                .unwrap_or(None)
            else {
                return state;
            };
            let mut request = part.get("request").cloned().unwrap_or(json!({}));
            let mut answers = request
                .get("answers")
                .and_then(Value::as_object)
                .cloned()
                .unwrap_or_default();
            if answer.is_null() {
                answers.remove(question_id);
            } else {
                answers.insert(question_id.to_owned(), answer);
            }
            if answers.is_empty() {
                put(&mut request, "answers", Value::Null);
            } else {
                request["answers"] = Value::Object(answers);
            }
            let mut new_part = part.clone();
            new_part["request"] = request;
            let mut next = state.clone();
            let mut turn = active_turn.clone();
            let mut parts = turn
                .get("responseParts")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            parts[at] = new_part;
            turn["responseParts"] = Value::Array(parts);
            put(&mut next, "activeTurn", turn);
            next
        }
        "chat/inputCompleted" => {
            let request_id = action
                .get("requestId")
                .and_then(Value::as_str)
                .unwrap_or("");
            let response = action.get("response").cloned().unwrap_or(Value::Null);
            let incoming = action.get("answers").cloned().unwrap_or(Value::Null);
            let Some(active_turn) = state.get("activeTurn").filter(|turn| !turn.is_null()) else {
                return state;
            };
            let Some((at, part)) = active_turn
                .get("responseParts")
                .and_then(Value::as_array)
                .map(|parts| {
                    parts
                        .iter()
                        .enumerate()
                        .find(|(_, part)| {
                            part.get("kind").and_then(Value::as_str) == Some("inputRequest")
                                && part.get("response").is_none()
                                && part.pointer("/request/id").and_then(Value::as_str)
                                    == Some(request_id)
                        })
                        .map(|(at, part)| (at, part.clone()))
                })
                .unwrap_or(None)
            else {
                return state;
            };
            let mut request = part.get("request").cloned().unwrap_or(json!({}));
            let mut answers = request
                .get("answers")
                .and_then(Value::as_object)
                .cloned()
                .unwrap_or_default();
            if let Some(incoming) = incoming.as_object() {
                for (key, value) in incoming {
                    answers.insert(key.clone(), value.clone());
                }
            }
            if answers.is_empty() {
                put(&mut request, "answers", Value::Null);
            } else {
                request["answers"] = Value::Object(answers);
            }
            let mut new_part = part.clone();
            new_part["request"] = request;
            new_part["response"] = response;
            let mut next = state.clone();
            let mut turn = active_turn.clone();
            let mut parts = turn
                .get("responseParts")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            parts[at] = new_part;
            turn["responseParts"] = Value::Array(parts);
            put(&mut next, "activeTurn", turn);
            let status = summary_status(&next);
            put(&mut next, "status", Value::from(status));
            next
        }
        "chat/pendingMessageSet" => {
            let entry = json!({
                "id": action.get("id"),
                "message": action.get("message"),
            });
            let mut next = state.clone();
            if action.get("kind").and_then(Value::as_str) == Some("steering") {
                put(&mut next, "steeringMessage", entry);
            } else {
                let mut queue = next
                    .get("queuedMessages")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default();
                match queue.iter().position(|item| {
                    item.get("id").and_then(Value::as_str)
                        == entry.get("id").and_then(Value::as_str)
                }) {
                    Some(at) => queue[at] = entry,
                    None => queue.push(entry),
                }
                put(&mut next, "queuedMessages", Value::Array(queue));
            }
            next
        }
        "chat/pendingMessageRemoved" => {
            let id = action.get("id").and_then(Value::as_str).unwrap_or("");
            let mut next = state.clone();
            if action.get("kind").and_then(Value::as_str) == Some("steering") {
                if next.pointer("/steeringMessage/id").and_then(Value::as_str) == Some(id) {
                    put(&mut next, "steeringMessage", Value::Null);
                }
            } else if let Some(queue) = next
                .get("queuedMessages")
                .and_then(Value::as_array)
                .cloned()
            {
                let filtered: Vec<Value> = queue
                    .into_iter()
                    .filter(|entry| entry.get("id").and_then(Value::as_str) != Some(id))
                    .collect();
                put(
                    &mut next,
                    "queuedMessages",
                    if filtered.is_empty() {
                        Value::Null
                    } else {
                        Value::Array(filtered)
                    },
                );
            }
            next
        }
        "chat/turnComplete" => {
            let turn_id = action.get("turnId").and_then(Value::as_str).unwrap_or("");
            let duration = action.get("duration").and_then(Value::as_i64).unwrap_or(0);
            end_turn(&state, turn_id, "complete", duration, None, None)
        }
        "chat/turnCancelled" => {
            let turn_id = action.get("turnId").and_then(Value::as_str).unwrap_or("");
            let duration = action.get("duration").and_then(Value::as_i64).unwrap_or(0);
            end_turn(&state, turn_id, "cancelled", duration, None, None)
        }
        "chat/error" => {
            let turn_id = action.get("turnId").and_then(Value::as_str).unwrap_or("");
            let duration = action.get("duration").and_then(Value::as_i64).unwrap_or(0);
            let part = action.get("part").cloned().unwrap_or(Value::Null);
            end_turn(&state, turn_id, "error", duration, Some(ERROR), Some(part))
        }
        "chat/draftChanged" => {
            let mut next = state.clone();
            let draft = action.get("draft").cloned().unwrap_or(Value::Null);
            put(&mut next, "draft", draft);
            next
        }
        "chat/isArchivedChanged" => {
            let archived = action
                .get("isArchived")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let mut next = state.clone();
            let status = set_flag(
                next.get("status").and_then(Value::as_i64).unwrap_or(IDLE),
                IS_ARCHIVED,
                archived,
            );
            put(&mut next, "status", Value::from(status));
            next
        }
        _ => state,
    };
    // The TS side JSON-round-trips both fold legs before comparing; the
    // reducer's `undefined` values drop there, so the mirror drops nulls too.
    strip_nulls(&mut next);
    next
}

/// Removes every `null` (the JSON image of the reducer's `undefined`).
fn strip_nulls(value: &mut Value) {
    match value {
        Value::Object(map) => {
            map.retain(|_, entry| !entry.is_null());
            for entry in map.values_mut() {
                strip_nulls(entry);
            }
        }
        Value::Array(items) => {
            for item in items {
                strip_nulls(item);
            }
        }
        _ => {}
    }
}

// ── time ─────────────────────────────────────────────────────────────────────

/// The stub's timestamps: `YYYY-MM-DDTHH:MM:SS.mmmZ`, the one format
/// `add_ms` parses (its own output).
pub(crate) fn iso_now() -> String {
    add_ms("1970-01-01T00:00:00.000Z", epoch_now())
}

fn epoch_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|since| since.as_millis() as i64)
        .unwrap_or(0)
}

/// Mirrors `addMillisecondsToTimestamp`: parse the stub's format, add, format
/// back in canonical UTC ISO 8601.
pub(crate) fn add_ms(timestamp: &str, milliseconds: i64) -> String {
    let Some(epoch) = parse_iso_ms(timestamp) else {
        return timestamp.to_owned();
    };
    format_iso_ms(epoch + milliseconds)
}

/// `YYYY-MM-DDTHH:MM:SS.mmmZ` → epoch milliseconds.
fn parse_iso_ms(text: &str) -> Option<i64> {
    let bytes = text.as_bytes();
    if text.len() != 24
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || bytes[10] != b'T'
        || bytes[13] != b':'
        || bytes[16] != b':'
        || bytes[19] != b'.'
        || bytes[23] != b'Z'
    {
        return None;
    }
    let num = |from: usize, to: usize| text.get(from..to)?.parse::<i64>().ok();
    let year = num(0, 4)?;
    let month = num(5, 7)?;
    let day = num(8, 10)?;
    let hour = num(11, 13)?;
    let minute = num(14, 16)?;
    let second = num(17, 19)?;
    let milli = num(20, 23)?;
    let days = days_from_civil(year, month, day);
    Some(((days * 24 + hour) * 60 + minute) * 60 * 1000 + second * 1000 + milli)
}

/// Epoch milliseconds → `YYYY-MM-DDTHH:MM:SS.mmmZ`.
fn format_iso_ms(epoch_ms: i64) -> String {
    let days = epoch_ms.div_euclid(86_400_000);
    let rest = epoch_ms.rem_euclid(86_400_000);
    let (year, month, day) = civil_from_days(days);
    let hour = rest / 3_600_000;
    let minute = (rest % 3_600_000) / 60_000;
    let second = (rest % 60_000) / 1000;
    let milli = rest % 1000;
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{milli:03}Z")
}

/// Days since 1970-01-01 (Howard Hinnant's `days_from_civil`).
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let year_of_era = year - era * 400;
    let month_shifted = if month > 2 { month - 3 } else { month + 9 };
    let day_of_era = (153 * month_shifted + 2) / 5 + day - 1;
    era * 146_097 + year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_era - 719_468
}

/// The inverse (`civil_from_days`).
fn civil_from_days(days: i64) -> (i64, i64, i64) {
    // Shift into Hinnant's March-based era scale first.
    let days = days + 719_468;
    let era = if days >= 0 { days } else { days - 146_096 } / 146_097;
    let day_of_era = days - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let shifted_month = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * shifted_month + 2) / 5 + 1;
    let month = if shifted_month < 10 {
        shifted_month + 3
    } else {
        shifted_month - 9
    };
    (if month <= 2 { year + 1 } else { year }, month, day)
}

#[cfg(test)]
mod tests {
    use super::{add_ms, civil_from_days, days_from_civil, format_iso_ms, parse_iso_ms};

    #[test]
    fn timestamps_round_trip_like_the_ts_helper() {
        let text = "2025-03-10T18:42:03.123Z";
        assert_eq!(parse_iso_ms(text), Some(1_741_632_123_123));
        assert_eq!(format_iso_ms(1_741_632_123_123), text);
        // `addMillisecondsToTimestamp` on the same pair.
        assert_eq!(add_ms(text, 877), "2025-03-10T18:42:04.000Z");
        assert_eq!(add_ms(text, 61_000), "2025-03-10T18:43:04.123Z");
    }

    #[test]
    fn the_civil_conversions_round_trip() {
        for days in [-11017, 0, 1, 19723, 20480] {
            let (year, month, day) = civil_from_days(days);
            assert_eq!(days_from_civil(year, month, day), days);
        }
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        // 2025-03-10 is day 20157.
        assert_eq!(days_from_civil(2025, 3, 10), 20_157);
    }
}

#[cfg(test)]
mod stub_tests {
    use super::{INJECTED_PANIC, Outcome, StubCore, fold_chat};
    use serde_json::{Value, json};
    use std::time::{Duration, Instant};

    /// Drives `core` until nothing is scheduled (or `max` ticks), collecting
    /// every outbound frame in order.
    fn drain(core: &mut StubCore, max: usize) -> Vec<Value> {
        let mut frames = Vec::new();
        for _ in 0..max {
            let Some(at) = core.next_due() else { break };
            let mut outcome = Outcome::default();
            core.take_due(at + Duration::from_millis(1), &mut outcome);
            frames.extend(
                outcome
                    .outbound
                    .iter()
                    .map(|text| serde_json::from_str(text).unwrap()),
            );
        }
        frames
    }

    fn actions_of(frames: &[Value]) -> Vec<Value> {
        frames
            .iter()
            .filter(|frame| frame.get("method").and_then(Value::as_str) == Some("action"))
            .map(|frame| frame["params"]["action"].clone())
            .collect()
    }

    fn envelopes_of(frames: &[Value]) -> Vec<Value> {
        frames
            .iter()
            .filter(|frame| frame.get("method").and_then(Value::as_str) == Some("action"))
            .map(|frame| frame["params"].clone())
            .collect()
    }

    fn ready_core() -> (StubCore, String, String) {
        let mut core = StubCore::new();
        let session_uri = "ahp-session:/11111111-1111-4111-8111-111111111111";
        let chat_uri = "ahp-chat:/22222222-2222-4222-8222-222222222222";
        core.handle_frame(
            Instant::now(),
            &json!({"jsonrpc": "2.0", "id": 1, "method": "initialize",
                "params": {"channel": "ahp-root://", "protocolVersions": ["1.0.0"], "clientId": "test-client"}})
                .to_string(),
        );
        core.handle_frame(
            Instant::now(),
            &json!({"jsonrpc": "2.0", "id": 2, "method": "createSession", "params": {"channel": session_uri}})
                .to_string(),
        );
        core.handle_frame(
            Instant::now(),
            &json!({"jsonrpc": "2.0", "id": 3, "method": "createChat",
                    "params": {"channel": session_uri, "chat": chat_uri}})
            .to_string(),
        );
        (core, session_uri.to_owned(), chat_uri.to_owned())
    }

    fn start_turn(core: &mut StubCore, chat: &str) -> Vec<Value> {
        let frames = core.handle_frame(
            Instant::now(),
            &json!({"jsonrpc": "2.0", "method": "dispatchAction", "params": {"channel": chat, "clientSeq": 1,
                "action": {"type": "chat/turnStarted", "turnId": "turn-1", "startedAt": "2025-03-10T18:42:03.123Z",
                           "message": {"text": "trace the stub", "origin": {"kind": "user"}}}}})
                .to_string(),
        );
        frames
            .outbound
            .iter()
            .map(|text| serde_json::from_str(text).unwrap())
            .collect()
    }

    fn open_request_id(core: &StubCore, chat: &str) -> String {
        core.snapshot(chat)
            .and_then(|snapshot| {
                snapshot["state"]["activeTurn"]["responseParts"]
                    .as_array()
                    .and_then(|parts| {
                        parts
                            .iter()
                            .find(|part| part["kind"] == "inputRequest")
                            .map(|part| part["request"]["id"].as_str().unwrap().to_owned())
                    })
            })
            .expect("an open elicitation")
    }

    /// `initialize` answers the negotiated protocol and the seq watermark;
    /// a subscribe for an unknown channel errors instead of guessing.
    #[test]
    fn initialize_answers_protocol_and_snapshots() {
        let mut core = StubCore::new();
        let response = core.handle_frame(
            Instant::now(),
            &json!({"jsonrpc": "2.0", "id": 1, "method": "initialize",
                "params": {"channel": "ahp-root://", "protocolVersions": ["1.0.0"], "clientId": "c1"}})
                .to_string(),
        );
        let reply = response
            .outbound
            .iter()
            .map(|text| serde_json::from_str::<Value>(text).unwrap())
            .find(|frame| frame["id"] == 1)
            .expect("the initialize reply");
        let result = &reply["result"];
        assert_eq!(result["protocolVersion"], "1.0.0");
        assert_eq!(result["serverInfo"]["name"], "manox-stub-host");
        let subscribe = core.handle_frame(
            Instant::now(),
            &json!({"jsonrpc": "2.0", "id": 2, "method": "subscribe",
                    "params": {"channel": "ahp-session:/nope"}})
            .to_string(),
        );
        assert_eq!(
            serde_json::from_str::<Value>(&subscribe.outbound[0]).unwrap()["error"]["code"],
            -32008
        );
    }

    /// A malformed frame is a parse error, not a panic.
    #[test]
    fn a_malformed_frame_is_a_parse_error() {
        let mut core = StubCore::new();
        let response = core.handle_frame(Instant::now(), "not json at all");
        assert_eq!(
            serde_json::from_str::<Value>(&response.outbound[0]).unwrap()["error"]["code"],
            -32700
        );
    }

    /// createSession is idempotent (the client mints the uuid) and announces
    /// the session on the root channel; createChat adds the chat.
    #[test]
    fn create_session_is_idempotent_and_create_chat_announces() {
        let mut core = StubCore::new();
        let session_uri = "ahp-session:/abc";
        let create = |core: &mut StubCore| {
            core.handle_frame(
                Instant::now(),
                &json!({"jsonrpc": "2.0", "id": 9, "method": "createSession",
                        "params": {"channel": session_uri}})
                .to_string(),
            )
        };
        let first = create(&mut core);
        assert_eq!(
            serde_json::from_str::<Value>(&first.outbound[0]).unwrap()["result"],
            Value::Null
        );
        let second = create(&mut core);
        assert_eq!(
            serde_json::from_str::<Value>(&second.outbound[0]).unwrap()["result"],
            Value::Null
        );
        let methods: Vec<String> = first
            .outbound
            .iter()
            .filter_map(|text| {
                serde_json::from_str::<Value>(text).unwrap()["method"]
                    .as_str()
                    .map(str::to_owned)
            })
            .collect();
        assert!(
            methods.contains(&"root/sessionAdded".to_owned()),
            "the catalog learns the session: {methods:?}"
        );
        let chat = core.handle_frame(
            Instant::now(),
            &json!({"jsonrpc": "2.0", "id": 10, "method": "createChat",
                    "params": {"channel": session_uri, "chat": "ahp-chat:/xyz"}})
            .to_string(),
        );
        let actions = actions_of(
            &chat
                .outbound
                .iter()
                .map(|text| serde_json::from_str(text).unwrap())
                .collect::<Vec<_>>(),
        );
        assert!(
            actions
                .iter()
                .any(|action| action["type"] == "session/chatAdded"),
            "the session catalog learns the chat"
        );
        assert!(
            actions
                .iter()
                .any(|action| action["type"] == "session/defaultChatChanged"),
            "defaultChat points at the new chat"
        );
    }

    /// The full scripted turn: streaming text and reasoning, the tool call
    /// through pending-confirmation, the elicitation, the queued follow-up
    /// turn, and every envelope carrying a monotonic `serverSeq`.
    #[test]
    fn the_scripted_turn_runs_to_two_completed_turns() {
        let (mut core, _session, chat) = ready_core();
        let mut frames = start_turn(&mut core, &chat);
        frames.extend(drain(&mut core, 64));
        // Parked at the tool-call confirmation: the confirm dispatch answers
        // accepted, and the parked script resumes.
        let confirm = core.handle_frame(
            Instant::now(),
            &json!({"jsonrpc": "2.0", "method": "dispatchAction", "params": {"channel": chat, "clientSeq": 2,
                "action": {"type": "chat/toolCallConfirmed", "turnId": "turn-1", "toolCallId": "tc-turn-1",
                           "approved": true, "confirmed": "user-action"}}})
                .to_string(),
        );
        assert!(
            serde_json::from_str::<Value>(&confirm.outbound[0]).unwrap()["params"]
                .get("rejectionReason")
                .is_none(),
            "the confirmation is accepted"
        );
        frames.extend(
            confirm
                .outbound
                .iter()
                .map(|text| serde_json::from_str(text).unwrap()),
        );
        frames.extend(drain(&mut core, 64));
        let request_id = open_request_id(&core, &chat);
        core.handle_frame(
            Instant::now(),
            &json!({"jsonrpc": "2.0", "method": "dispatchAction", "params": {"channel": chat, "clientSeq": 3,
                "action": {"type": "chat/inputCompleted", "requestId": request_id, "response": "accept"}}})
                .to_string(),
        );
        frames.extend(drain(&mut core, 64));
        let actions = actions_of(&frames);
        let kinds: Vec<&str> = actions
            .iter()
            .filter_map(|action| action["type"].as_str())
            .collect();
        for wanted in [
            "chat/turnStarted",
            "chat/responsePart",
            "chat/delta",
            "chat/reasoning",
            "chat/toolCallStart",
            "chat/toolCallReady",
            "chat/toolCallConfirmed",
            "chat/toolCallComplete",
            "chat/inputRequested",
            "chat/pendingMessageSet",
            "chat/turnComplete",
            "chat/pendingMessageRemoved",
        ] {
            assert!(
                kinds.contains(&wanted),
                "the script names {wanted}: {kinds:?}"
            );
        }
        // Two turns ran; the second one is the queued follow-up.
        let starts: Vec<Value> = actions
            .iter()
            .filter(|action| action["type"] == "chat/turnStarted")
            .cloned()
            .collect();
        assert_eq!(starts.len(), 2);
        assert!(
            starts[1].get("queuedMessageId").is_some(),
            "the follow-up names its queued message"
        );
        // The chat folded to two completed turns and no active one.
        let chat_state = core.snapshot(&chat).unwrap()["state"].clone();
        assert_eq!(chat_state["turns"].as_array().map(Vec::len), Some(2));
        assert_eq!(chat_state["turns"][0]["state"], "complete");
        assert_eq!(chat_state["turns"][1]["state"], "complete");
        assert!(chat_state.get("activeTurn").is_none());
        // Envelope discipline: serverSeq grows; our echoes carry our origin.
        let envelopes = envelopes_of(&frames);
        let mut last = 0;
        for envelope in &envelopes {
            let seq = envelope["serverSeq"].as_i64().unwrap();
            assert!(seq > last, "serverSeq grows: {seq} after {last}");
            last = seq;
        }
        assert!(
            envelopes
                .iter()
                .any(|envelope| envelope["origin"]["clientId"] == json!("test-client")),
            "our echoes carry our origin"
        );
    }

    /// A refusal travels on the envelope with `rejectionReason`, stamped
    /// like any other (fail-closed, the manox rule).
    #[test]
    fn a_refused_action_is_echoed_with_a_rejection_reason() {
        let (mut core, _session, chat) = ready_core();
        let refused = core.handle_frame(
            Instant::now(),
            &json!({"jsonrpc": "2.0", "method": "dispatchAction", "params": {"channel": chat, "clientSeq": 7,
                "action": {"type": "chat/toolCallStart", "turnId": "turn-x", "toolCallId": "tc-x",
                           "toolName": "stub_read", "displayName": "Stub read"}}})
                .to_string(),
        );
        let envelope =
            serde_json::from_str::<Value>(&refused.outbound[0]).unwrap()["params"].clone();
        assert!(
            envelope.get("rejectionReason").is_some(),
            "fail-closed: {envelope}"
        );
        assert_eq!(envelope["origin"]["clientSeq"], 7);
        // A confirmation for the wrong object is refused too.
        let _ = start_turn(&mut core, &chat);
        let _ = drain(&mut core, 64);
        let wrong = core.handle_frame(
            Instant::now(),
            &json!({"jsonrpc": "2.0", "method": "dispatchAction", "params": {"channel": chat, "clientSeq": 8,
                "action": {"type": "chat/toolCallConfirmed", "turnId": "turn-1", "toolCallId": "tc-other",
                           "approved": true}}})
                .to_string(),
        );
        assert!(
            serde_json::from_str::<Value>(&wrong.outbound[0]).unwrap()["params"]
                .get("rejectionReason")
                .is_some()
        );
    }

    /// `chat/turnCancelled` stops the script: the pending steps of the turn
    /// are dropped and the host ends the turn cancelled.
    #[test]
    fn cancelling_mid_stream_ends_the_turn_cancelled() {
        let (mut core, _session, chat) = ready_core();
        start_turn(&mut core, &chat);
        let _ = drain(&mut core, 2);
        core.handle_frame(
            Instant::now(),
            &json!({"jsonrpc": "2.0", "method": "dispatchAction", "params": {"channel": chat, "clientSeq": 2,
                "action": {"type": "chat/turnCancelled", "turnId": "turn-1", "duration": 12}}})
                .to_string(),
        );
        let frames = drain(&mut core, 64);
        let kinds: Vec<String> = actions_of(&frames)
            .iter()
            .filter_map(|action| action["type"].as_str().map(str::to_owned))
            .collect();
        assert!(
            kinds.contains(&"chat/turnCancelled".to_owned()),
            "{kinds:?}"
        );
        assert!(
            !kinds.contains(&"chat/toolCallStart".to_owned()),
            "the script stopped: {kinds:?}"
        );
        let chat_state = core.snapshot(&chat).unwrap()["state"].clone();
        assert!(
            chat_state.get("activeTurn").is_none(),
            "no active turn remains"
        );
        assert_eq!(chat_state["turns"].as_array().map(Vec::len), Some(1));
        assert_eq!(chat_state["turns"][0]["state"], "cancelled");
    }

    /// The two reconnect legs agree: folding the replay's envelopes (skipping
    /// rejections, as the client does) through the same mirror equals the
    /// fresh snapshot's fold.
    #[test]
    fn reconnect_replay_and_snapshot_legs_agree() {
        let (mut core, session, chat) = ready_core();
        let before = core.snapshot(&chat).expect("the initial chat snapshot");
        let _ = start_turn(&mut core, &chat);
        let _ = drain(&mut core, 64);
        core.handle_frame(
            Instant::now(),
            &json!({"jsonrpc": "2.0", "method": "dispatchAction", "params": {"channel": chat, "clientSeq": 2,
                "action": {"type": "chat/toolCallConfirmed", "turnId": "turn-1", "toolCallId": "tc-turn-1",
                           "approved": true, "confirmed": "user-action"}}})
                .to_string(),
        );
        let _ = drain(&mut core, 64);
        // A refused dispatch too: the replay carries it, folding skips it.
        core.handle_frame(
            Instant::now(),
            &json!({"jsonrpc": "2.0", "method": "dispatchAction", "params": {"channel": chat, "clientSeq": 3,
                "action": {"type": "chat/notARealAction"}}})
                .to_string(),
        );
        let after = core.snapshot(&chat).expect("the chat snapshot");
        let reconnect = core.handle_frame(
            Instant::now(),
            &json!({"jsonrpc": "2.0", "id": 1, "method": "reconnect",
                "params": {"channel": "ahp-root://", "clientId": "test-client",
                           "lastSeenServerSeq": 0, "subscriptions": [chat, session]}})
            .to_string(),
        );
        let result = &serde_json::from_str::<Value>(&reconnect.outbound[0]).unwrap()["result"];
        assert_eq!(result["type"], "replay");
        let mut folded = before["state"].clone();
        for envelope in result["actions"].as_array().unwrap() {
            if envelope.get("rejectionReason").is_some() {
                continue;
            }
            folded = fold_chat(folded, &envelope["action"]);
        }
        assert_eq!(folded, after["state"], "replay leg == snapshot leg");
        assert!(
            result["actions"]
                .as_array()
                .unwrap()
                .iter()
                .any(|envelope| envelope.get("rejectionReason").is_some()),
            "the replay carries refusals so clients can reconcile"
        );
    }

    /// The injected panic's message is the transport-error detail shape.
    #[test]
    fn the_injected_panic_names_itself() {
        assert!(INJECTED_PANIC.contains("injected panic"));
        assert!(INJECTED_PANIC.contains("T0 crash-isolation gate"));
    }

    /// `fold_chat` mirrors the reducer's turn lifecycle stamps (the TS gate
    /// covers the full wire; this pins the timestamp mirror).
    #[test]
    fn the_fold_stamps_modified_at_like_the_reducer() {
        let state = json!({"resource": "ahp-chat:/x", "title": "chat x", "status": 1,
            "modifiedAt": "2025-03-10T18:42:03.123Z", "turns": []});
        let started = fold_chat(
            state,
            &json!({"type": "chat/turnStarted", "turnId": "t1",
                "startedAt": "2025-03-10T18:42:03.123Z",
                "message": {"text": "hi", "origin": {"kind": "user"}}}),
        );
        assert_eq!(started["modifiedAt"], "2025-03-10T18:42:03.123Z");
        // InProgress activity; the read bit (32) was never set on 1.
        assert_eq!(started["status"], 8);
        let done = fold_chat(
            started,
            &json!({"type": "chat/turnComplete", "turnId": "t1", "duration": 1500}),
        );
        assert_eq!(done["modifiedAt"], "2025-03-10T18:42:04.623Z");
        assert_eq!(done["status"], 1, "idle again");
        assert_eq!(done["turns"][0]["state"], "complete");
        assert_eq!(done["turns"][0]["duration"], 1500);
        assert!(done.get("activeTurn").is_none(), "undefined drops");
    }
}
