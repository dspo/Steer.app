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
