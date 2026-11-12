//! A host-half session: the assembly that owns the stub (and, at M1, the
//! real manox AHP runtime) on the pump's dedicated runtime thread, under the
//! pump's panic boundary.
//!
//! [`run_half`] is the session's whole loop: inbound client frames, the
//! scripted schedule's due steps, and pump control (close / the T0 panic
//! injection), selected on one task. Every synchronous host-half step runs
//! under [`std::panic::catch_unwind`]; a caught panic — including the
//! injected one — becomes a transport-error event and ends the session
//! cleanly. The pump's watcher reports the same for any panic that still
//! escapes (through an await), so no unwinding ever reaches the engine
//! thread: the shell survives, TSX reconnects.

use std::{panic::AssertUnwindSafe, time::Instant};

use tokio::sync::{mpsc, oneshot};

use crate::{
    pump::{PumpEvent, PumpSender},
    stub::{self, Outcome, StubCore},
};

/// Control from the pump to the running session. (Teardown needs no variant:
/// a restart drops the senders, and the half sees the channels close.)
pub(crate) enum Ctl {
    /// Panic inside the host half, past the pump boundary — T0's
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

/// The session's loop. Returns how it ended; the watcher posts the event.
async fn run_half(
    mut inbound_rx: mpsc::UnboundedReceiver<String>,
    mut ctl_rx: mpsc::UnboundedReceiver<Ctl>,
    events: PumpSender,
) -> SessionEnd {
    let mut core = StubCore::new();
    loop {
        if let Some(end) = flush_due(&mut core, Instant::now(), &events) {
            return end;
        }
        let wait = core.next_due().map(tokio::time::Instant::from_std);
        tokio::select! {
            () = async {
                match wait {
                    Some(until) => tokio::time::sleep_until(until).await,
                    None => std::future::pending::<()>().await,
                }
            } => {
                let now = Instant::now();
                let events = events.clone();
                // The schedule tick folds scripted steps into the journal —
                // the same panic surface as a frame.
                let stepped = std::panic::catch_unwind(AssertUnwindSafe(|| {
                    let mut outcome = Outcome::default();
                    core.take_due(now, &mut outcome);
                    outcome
                }));
                match stepped {
                    Ok(outcome) => post_frames(events, outcome.outbound).await,
                    Err(payload) => return caught(payload),
                }
            }
            text = inbound_rx.recv() => {
                let Some(text) = text else {
                    // Every pump-side sender is gone: the pump is over.
                    return SessionEnd::Clean;
                };
                let events = events.clone();
                let framed = std::panic::catch_unwind(AssertUnwindSafe(|| {
                    core.handle_frame(Instant::now(), &text)
                }));
                match framed {
                    Ok(outcome) => post_frames(events, outcome.outbound).await,
                    Err(payload) => return caught(payload),
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
                            panic!("{}", stub::INJECTED_PANIC);
                        }));
                        match planted {
                            Ok(never) => match never {},
                            Err(payload) => return caught(payload),
                        }
                    }
                }
            }
        }
    }
}

/// Fires whatever steps are due right now and posts their frames. A caught
/// panic here ends the session before any step half-applies.
fn flush_due(core: &mut StubCore, now: Instant, events: &PumpSender) -> Option<SessionEnd> {
    core.next_due()?;
    let stepped = std::panic::catch_unwind(AssertUnwindSafe(|| {
        let mut outcome = Outcome::default();
        core.take_due(now, &mut outcome);
        outcome
    }));
    match stepped {
        Ok(outcome) => {
            let events = events.clone();
            post_frames_sync(events, outcome.outbound);
            None
        }
        Err(payload) => Some(caught(payload)),
    }
}

/// Posts frames to TSX. `Callback::post` is engine-thread-only, so frames
/// cross to the engine's own task through the pump's event channel; the
/// channel is bounded, and a wedged TSX back-pressures the host half instead
/// of growing the heap without bound.
async fn post_frames(events: PumpSender, frames: Vec<String>) {
    for frame in frames {
        if events.send(PumpEvent::Frame(frame)).await.is_err() {
            // The pump is gone; the session ends with the next recv.
            return;
        }
    }
}

/// The same, from synchronous contexts (the startup flush).
fn post_frames_sync(events: PumpSender, frames: Vec<String>) {
    tokio::spawn(async move { post_frames(events, frames).await });
}

#[cfg(test)]
mod tests {
    use super::{Ctl, Session, SessionEnd};
    use crate::pump::{PumpEvent, PumpSender};
    use crate::stub::INJECTED_PANIC;
    use serde_json::{Value, json};
    use std::time::Duration;

    /// One end of the pump's event channel, read with a timeout so a broken
    /// wire fails the test instead of hanging it.
    struct EventReader {
        rx: tokio::sync::mpsc::Receiver<PumpEvent>,
    }

    impl EventReader {
        async fn next(&mut self, what: &str) -> PumpEvent {
            tokio::time::timeout(Duration::from_secs(10), self.rx.recv())
                .await
                .unwrap_or_else(|_| panic!("timed out waiting for {what}"))
                .expect("the pump's event channel is open")
        }

        /// Collects `Frame` events until `want` is satisfied (or 10s pass).
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

    fn spawn_session() -> (Session, EventReader) {
        let (tx, rx) = tokio::sync::mpsc::channel(1024);
        (Session::spawn(PumpSender { tx }), EventReader { rx })
    }

    /// Frames cross both ways: a client frame in, the host's JSON-RPC answer
    /// and its scripted stream back out — the pump's one job, end to end.
    #[tokio::test]
    async fn a_session_answers_frames_and_streams_the_script() {
        let (session, mut events) = spawn_session();
        let chat_uri = "ahp-chat:/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
        let session_uri = "ahp-session:/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
        for frame in [
            json!({"jsonrpc": "2.0", "id": 1, "method": "initialize",
                   "params": {"channel": "ahp-root://", "protocolVersions": ["1.0.0"],
                              "clientId": "pump-test"}}),
            json!({"jsonrpc": "2.0", "id": 2, "method": "createSession",
                   "params": {"channel": session_uri}}),
            json!({"jsonrpc": "2.0", "id": 3, "method": "createChat",
                   "params": {"channel": session_uri, "chat": chat_uri}}),
            // The dispatch: the echo comes straight back, the script on timers.
            json!({"jsonrpc": "2.0", "method": "dispatchAction", "params": {"channel": chat_uri,
                   "clientSeq": 1, "action": {"type": "chat/turnStarted", "turnId": "t1",
                   "startedAt": "2025-03-10T18:42:03.123Z",
                   "message": {"text": "through the pump", "origin": {"kind": "user"}}}}}),
        ] {
            session.inbound.send(frame.to_string()).unwrap();
        }
        let frames = events
            .frames_until(|frames| {
                frames.iter().any(|frame| {
                    frame["method"] == "action"
                        && frame["params"]["action"]["type"] == "chat/toolCallReady"
                })
            })
            .await;
        // The requests were answered…
        assert!(
            frames.iter().any(|frame| frame["id"] == 1 && frame["result"].is_object()),
            "initialize answered"
        );
        // …the dispatch echoed with the client's origin…
        assert!(
            frames.iter().any(|frame| {
                frame["method"] == "action"
                    && frame["params"]["action"]["type"] == "chat/turnStarted"
                    && frame["params"]["origin"]["clientId"] == "pump-test"
                    && frame["params"]["origin"]["clientSeq"] == 1
            }),
            "the turn echoed"
        );
        // …and the script parked at the confirmation, on schedule.
        assert!(
            frames.iter().any(|frame| {
                frame["method"] == "action"
                    && frame["params"]["action"]["type"] == "chat/toolCallReady"
            }),
            "the script reached toolCallReady"
        );
    }

    /// The panic boundary: a panic planted inside the host half comes out as
    /// exactly one transport-error event and a clean session end — never an
    /// unwind into the caller (the engine), the §3.4 contract.
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
        assert!(matches!(
            SessionEnd::Clean.into_event(),
            PumpEvent::Stopped
        ));
        let PumpEvent::TransportError(text) =
            SessionEnd::TransportError("boom".to_owned()).into_event()
        else {
            panic!("expected a transport error");
        };
        assert_eq!(text, "boom");
    }
}
