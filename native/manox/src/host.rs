//! A host-half session: the assembly that owns the real manox AHP runtime
//! on the pump's dedicated runtime thread, under the pump's panic boundary.
//!
//! [`run_half`] is the session's whole loop: inbound client frames, the
//! host's outbound frames, the connection watchdog, and pump control
//! (close / the panic injection), selected on one task. Every synchronous
//! host-half step runs under [`std::panic::catch_unwind`]; a caught panic —
//! including the injected one — becomes a transport-error event and ends
//! the session cleanly. The pump's watcher reports the same for any panic
//! that still escapes (through an await), so no unwinding ever reaches the
//! engine thread: the shell survives, TSX reconnects.
//!
//! The real host's own tasks (the connection's reader/writer, the lanes the
//! router dispatches) are tokio tasks the host spawns itself — the boundary
//! cannot wrap them. Two mechanisms keep their failure modes honest: the
//! host's teardown guard retires a connection whose reader panicked, and
//! the session's watchdog turns the registry's emptiness into the same
//! transport error TSX already knows how to recover from.

use std::{panic::AssertUnwindSafe, time::Duration};

use tokio::sync::{mpsc, oneshot};

use crate::{
    pump::{PumpEvent, PumpSender},
    real::RealHalf,
};

/// The text an injected panic carries (the tests assert on it).
pub(crate) const INJECTED_PANIC: &str = "the injected host-half panic";

/// How often the session checks that the host still holds its connection.
const WATCHDOG_CADENCE: Duration = Duration::from_millis(500);

/// Control from the pump to the running session. (Teardown needs no variant:
/// a restart drops the senders, and the half sees the channels close.)
pub(crate) enum Ctl {
    /// Panic inside the host half, past the pump boundary — the §3.4
    /// crash-isolation gate.
    InjectPanic,
}

/// How a session ended. The watcher turns it into the one end event TSX sees.
#[derive(Debug)]
pub(crate) enum SessionEnd {
    Clean,
    TransportError(String),
}

/// A live session's pump-side handles. Dropping the senders (a restart does,
/// or the pump going away) tells the half to finish.
pub(crate) struct Session {
    pub(crate) inbound: mpsc::UnboundedSender<String>,
    pub(crate) ctl: mpsc::UnboundedSender<Ctl>,
    /// Fires after the end event was posted (a restart waits for it so the
    /// old session's frames never interleave with the new session's).
    pub(crate) ended: oneshot::Receiver<()>,
}

impl Session {
    /// Spawns the session on the calling (the pump's) runtime: the host half
    /// task plus its watcher, which posts exactly one end event.
    pub(crate) fn spawn(events: PumpSender) -> Session {
        let (inbound, inbound_rx) = mpsc::unbounded_channel::<String>();
        let (ctl, ctl_rx) = mpsc::unbounded_channel::<Ctl>();
        let (ended, ended_rx) = oneshot::channel::<()>();
        let worker = tokio::spawn(run_half(inbound_rx, ctl_rx, events.clone()));
        tokio::spawn(async move {
            let end = match worker.await {
                Ok(end) => end,
                Err(join) => SessionEnd::TransportError(panic_text(
                    join.into_panic(),
                    "the manox host half panicked (caught at the pump boundary)",
                )),
            };
            let _ = events.send(end.into_event()).await;
            let _ = ended.send(());
        });
        Session {
            inbound,
            ctl,
            ended: ended_rx,
        }
    }
}

impl SessionEnd {
    fn into_event(self) -> PumpEvent {
        match self {
            SessionEnd::Clean => PumpEvent::Stopped,
            SessionEnd::TransportError(error) => PumpEvent::TransportError(error),
        }
    }
}

/// Text of a caught panic payload, in the one report shape TSX sees.
fn panic_text(payload: Box<dyn std::any::Any + Send>, prefix: &str) -> String {
    let detail = if let Some(text) = payload.downcast_ref::<&'static str>() {
        (*text).to_owned()
    } else if let Some(text) = payload.downcast_ref::<String>() {
        text.clone()
    } else {
        "unknown panic".to_owned()
    };
    format!("{prefix}: {detail}")
}

/// Catches a panic payload into the standard transport-error text.
fn caught(payload: Box<dyn std::any::Any + Send>) -> SessionEnd {
    SessionEnd::TransportError(panic_text(
        payload,
        "the manox host half panicked (caught at the pump boundary)",
    ))
}

/// The session's loop over the real host. Returns how it ended; the watcher
/// posts the event.
async fn run_half(
    mut inbound_rx: mpsc::UnboundedReceiver<String>,
    mut ctl_rx: mpsc::UnboundedReceiver<Ctl>,
    events: PumpSender,
) -> SessionEnd {
    // The boot runs under the boundary too: a kernel startup panic is a
    // transport error, not a killed shell.
    let runtime = match std::panic::catch_unwind(crate::real::boot) {
        Ok(Ok(runtime)) => runtime,
        Ok(Err(error)) => {
            return SessionEnd::TransportError(format!("the manox host cannot start: {error}"));
        }
        Err(payload) => return caught(payload),
    };
    let mut half = RealHalf::connect(runtime);
    let mut watchdog = tokio::time::interval(WATCHDOG_CADENCE);
    watchdog.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        tokio::select! {
            text = inbound_rx.recv() => {
                let Some(text) = text else {
                    // Every pump-side sender is gone: the pump is over.
                    return SessionEnd::Clean;
                };
                let stepped = std::panic::catch_unwind(AssertUnwindSafe(|| {
                    half.accept_frame(&text)
                }));
                match stepped {
                    Ok(Ok(())) => {}
                    Ok(Err(error)) => return SessionEnd::TransportError(error),
                    Err(payload) => return caught(payload),
                }
            }
            frame = half.next_frame() => {
                let Some(text) = frame else {
                    return SessionEnd::TransportError(
                        "the manox host connection closed".to_owned(),
                    );
                };
                if events.send(PumpEvent::Frame(text)).await.is_err() {
                    // The pump is gone; the session ends with the next recv.
                    return SessionEnd::Clean;
                }
            }
            ctl = ctl_rx.recv() => {
                match ctl {
                    None => {
                        // The pump dropped its senders: this session is over.
                        return SessionEnd::Clean;
                    }
                    Some(Ctl::InjectPanic) => {
                        let planted = std::panic::catch_unwind(AssertUnwindSafe(|| {
                            panic!("{}", INJECTED_PANIC);
                        }));
                        match planted {
                            Ok(never) => match never {},
                            Err(payload) => return caught(payload),
                        }
                    }
                }
            }
            _ = watchdog.tick() => {
                if !half.connection_alive() {
                    return SessionEnd::TransportError(
                        "the manox host connection died".to_owned(),
                    );
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{Ctl, Session, SessionEnd, INJECTED_PANIC};
    use crate::pump::{PumpEvent, PumpSender};
    use crate::real::test_support::isolated_home;
    use serde_json::{Value, json};
    use std::time::Duration;

    /// One end of the pump's event channel, read with a timeout so a broken
    /// wire fails the test instead of hanging it.
    struct EventReader {
        rx: tokio::sync::mpsc::Receiver<PumpEvent>,
    }

    impl EventReader {
        async fn next(&mut self, what: &str) -> PumpEvent {
            tokio::time::timeout(Duration::from_secs(30), self.rx.recv())
                .await
                .unwrap_or_else(|_| panic!("timed out waiting for {what}"))
                .expect("the pump's event channel is open")
        }

        /// Collects `Frame` events until `want` is satisfied (or 30s pass).
        async fn frames_until(&mut self, want: impl Fn(&[Value]) -> bool) -> Vec<Value> {
            let mut frames = Vec::new();
            loop {
                if want(&frames) {
                    return frames;
                }
                match self.next("a frame").await {
                    PumpEvent::Frame(text) => frames.push(serde_json::from_str(&text).unwrap()),
                    PumpEvent::TransportError(error) => panic!("the host half died: {error}"),
                    PumpEvent::Stopped => panic!("the host half stopped mid-turn"),
                }
            }
        }
    }

    /// The isolated state root, before the first boot in this process.
    fn prepare() {
        isolated_home();
    }

    fn spawn_session() -> (Session, EventReader) {
        prepare();
        let (tx, rx) = tokio::sync::mpsc::channel(1024);
        (Session::spawn(PumpSender { tx }), EventReader { rx })
    }

    /// Sends one request frame and returns its answer. AHP orders messages
    /// per channel and says nothing across channels — the host's lanes may
    /// answer a later subscribe before an earlier create on another lane —
    /// so a test, like the real client, awaits each answer before the next
    /// step.
    async fn request_and_wait(
        session: &Session,
        events: &mut EventReader,
        frame: Value,
    ) -> Value {
        let id = frame["id"].as_f64().expect("test frames carry ids");
        session.inbound.send(frame.to_string()).unwrap();
        loop {
            match events.next("an answer").await {
                PumpEvent::Frame(text) => {
                    let parsed: Value = serde_json::from_str(&text).unwrap();
                    // Any response shape counts: a `null` result is a real
                    // answer (createSession answers null).
                    let is_response =
                        parsed["id"] == id && (parsed.get("result").is_some() || parsed.get("error").is_some());
                    if is_response {
                        return parsed;
                    }
                }
                PumpEvent::TransportError(error) => panic!("the host half died: {error}"),
                PumpEvent::Stopped => panic!("the host half stopped mid-turn"),
            }
        }
    }

    /// The handshake and the create flow get their answers, and the session's
    /// default chat — one journal per session, so the chat exists from the
    /// create, named by the session's own id — answers its subscribe with a
    /// snapshot: the real host, end to end, on the pump's own seam.
    #[tokio::test]
    async fn a_session_answers_the_handshake_and_creates_channels() {
        let (session, mut events) = spawn_session();
        let session_uri = "ahp-session:/11111111-1111-4111-8111-111111111111";
        let chat_uri = "ahp-chat:/11111111-1111-4111-8111-111111111111";
        let initialized = request_and_wait(
            &session,
            &mut events,
            json!({"jsonrpc": "2.0", "id": 1, "method": "initialize",
                   "params": {"channel": "ahp-root://", "protocolVersions": ["1.0.0"],
                              "clientId": "host-test"}}),
        )
        .await;
        assert!(
            initialized["result"].is_object(),
            "initialize answered: {initialized}"
        );
        let created = request_and_wait(
            &session,
            &mut events,
            json!({"jsonrpc": "2.0", "id": 2, "method": "createSession",
                   "params": {"channel": session_uri}}),
        )
        .await;
        assert!(
            created.get("error").is_none(),
            "createSession answered without error: {created}"
        );
        // The chat channel exists the moment the create answered: the
        // session's one journal IS the chat.
        let chat_snapshot = request_and_wait(
            &session,
            &mut events,
            json!({"jsonrpc": "2.0", "id": 3, "method": "subscribe",
                   "params": {"channel": chat_uri}}),
        )
        .await;
        assert_eq!(chat_snapshot["result"]["snapshot"]["resource"], chat_uri);
    }

    /// The panic boundary on the real host: a panic planted inside the host
    /// half comes out as exactly one transport-error event and a clean
    /// session end — never an unwind into the caller (the engine), the §3.4
    /// contract.
    #[tokio::test]
    async fn an_injected_panic_becomes_one_transport_error() {
        let (session, mut events) = spawn_session();
        session.ctl.send(Ctl::InjectPanic).unwrap();
        match events.next("the end event").await {
            PumpEvent::TransportError(error) => {
                assert!(error.contains("caught at the pump boundary"), "{error}");
                assert!(error.contains(INJECTED_PANIC), "{error}");
            }
            other => panic!("expected a transport error, got {other:?}"),
        }
        // The session retires cleanly after the event: a restart waits on
        // `ended` so old and new frames never interleave.
        tokio::time::timeout(Duration::from_secs(5), session.ended)
            .await
            .expect("the session retired after its end event")
            .expect("the oneshot is intact");
        // The wire is quiet: no second end event, no stray frames (the
        // channel closing is fine — the watcher is gone after its one send).
        match tokio::time::timeout(Duration::from_millis(100), events.rx.recv()).await {
            Err(_elapsed) => {}
            Ok(None) => {}
            Ok(Some(stray)) => panic!("a second event arrived: {stray:?}"),
        }
    }

    /// A session whose pump-side handles drop ends clean — the shape a
    /// restart's teardown takes.
    #[tokio::test]
    async fn a_session_whose_senders_drop_ends_stopped() {
        let (session, mut events) = spawn_session();
        drop(session.inbound);
        drop(session.ctl);
        match events.next("the end event").await {
            PumpEvent::Stopped => {}
            other => panic!("expected a clean stop, got {other:?}"),
        }
    }

    /// `SessionEnd` maps to the one event shape TSX sees.
    #[test]
    fn session_ends_map_to_their_events() {
        assert!(matches!(SessionEnd::Clean.into_event(), PumpEvent::Stopped));
        let PumpEvent::TransportError(text) =
            SessionEnd::TransportError("boom".to_owned()).into_event()
        else {
            panic!("expected a transport error");
        };
        assert_eq!(text, "boom");
    }

    /// A dispatched turn with no model configured surfaces on the channel —
    /// a refusal envelope or a `chat/error` fold the client renders — never
    /// a hang (the credential-less determinism the TS gates build on).
    #[tokio::test]
    async fn a_model_less_turn_lands_a_visible_chat_error() {
        let (session, mut events) = spawn_session();
        let session_uri = "ahp-session:/33333333-3333-4333-8333-333333333333";
        let chat_uri = "ahp-chat:/33333333-3333-4333-8333-333333333333";
        let initialized = request_and_wait(
            &session,
            &mut events,
            json!({"jsonrpc": "2.0", "id": 1, "method": "initialize",
                   "params": {"channel": "ahp-root://", "protocolVersions": ["1.0.0"],
                              "clientId": "host-test-error"}}),
        )
        .await;
        assert!(
            initialized["result"].is_object(),
            "initialize answered: {initialized}"
        );
        let created = request_and_wait(
            &session,
            &mut events,
            json!({"jsonrpc": "2.0", "id": 2, "method": "createSession",
                   "params": {"channel": session_uri}}),
        )
        .await;
        assert!(
            created.get("error").is_none(),
            "createSession answered without error: {created}"
        );
        let subscribed = request_and_wait(
            &session,
            &mut events,
            json!({"jsonrpc": "2.0", "id": 3, "method": "subscribe",
                   "params": {"channel": chat_uri}}),
        )
        .await;
        assert_eq!(subscribed["result"]["snapshot"]["resource"], chat_uri);
        session
            .inbound
            .send(
                json!({"jsonrpc": "2.0", "method": "dispatchAction", "params": {"channel": chat_uri,
                       "clientSeq": 1, "action": {"type": "chat/turnStarted", "turnId": "t1",
                       "startedAt": "2026-11-12T00:00:00.000Z",
                       "message": {"text": "no model here", "origin": {"kind": "user"}}}}})
                    .to_string(),
            )
            .unwrap();
        // Either the echo is refused outright (a rejection envelope) or the
        // turn starts and settles into a `chat/error` fold — both are
        // visible channel facts. What must not happen is silence.
        let frames = events
            .frames_until(|frames| {
                frames.iter().any(|frame| {
                    frame["method"] == "action"
                        && (frame["params"]["rejectionReason"].is_string()
                            || frame["params"]["action"]["type"] == "chat/error"
                            || frame["params"]["action"]["type"] == "chat/turnSettled")
                })
            })
            .await;
        assert!(
            frames.iter().any(|frame| frame["method"] == "action"),
            "the failed turn is reported on the channel"
        );
    }
}
