//! The pump: the TSX-facing side of the in-proc manox harness.
//!
//! One application singleton. `start` brings up the dedicated runtime thread
//! (`manox-host`, a current-thread tokio runtime with time enabled — the
//! thread model §3.4 fixes), spawns a host-half session on it, and starts a
//! task on the engine's own runtime that posts every pump event to TSX with
//! `Callback::post` (callbacks are engine-thread-only, so the host thread
//! never touches one). `send` queues a client frame into the session;
//! `restart` replaces the session (fresh journal — the AHP `reconnect` leg
//! then answers with snapshots); `stop` ends the runtime thread; and the
//! panic boundary is `catch_unwind` at the host-half seam, reported to TSX
//! as a `transport-error` frame event (never an unwind into the engine).

use std::{
    sync::{
        Mutex,
        atomic::{AtomicBool, Ordering},
    },
    thread,
};

use nsh_core::prelude::*;
use tokio::sync::mpsc;

use crate::host;

/// An event from the pump toward TSX, before it becomes a [`crate::ManoxFrame`].
#[derive(Debug)]
pub(crate) enum PumpEvent {
    /// One AHP JSON-RPC text frame.
    Frame(String),
    /// The host half died (a caught panic or a transport reset); TSX shows
    /// the error and takes the reconnect path.
    TransportError(String),
    /// A session ended without an error (stop, or a restart's teardown).
    Stopped,
}

/// The events channel's sender, cloned into every session task. The engine
/// task owns the receiver; when the last sender drops, the task ends.
#[derive(Clone)]
pub(crate) struct PumpSender {
    tx: mpsc::Sender<PumpEvent>,
}

impl PumpSender {
    pub(crate) async fn send(&self, event: PumpEvent) -> Result<(), String> {
        self.tx
            .send(event)
            .await
            .map_err(|_| "the pump is closed".to_owned())
    }
}

/// Commands the engine thread sends into the runtime thread.
pub(crate) enum Command {
    Frame(String),
    Restart,
    Stop,
    InjectPanic,
}

struct PumpHandle {
    commands: mpsc::UnboundedSender<Command>,
    alive: std::sync::Arc<AtomicBool>,
}

static PUMP: Mutex<Option<PumpHandle>> = Mutex::new(None);

/// Starts the pump (idempotent while running).
pub(crate) fn start(on_frame: Callback<crate::ManoxFrame>, cx: CallCx<'_>) -> Result<(), String> {
    let mut guard = PUMP
        .lock()
        .map_err(|_| "manox pump lock poisoned".to_owned())?;
    if guard.is_some() {
        return Ok(());
    }
    let (commands, commands_rx) = mpsc::unbounded_channel::<Command>();
    let (events, events_rx) = mpsc::channel::<PumpEvent>(1024);
    let alive = std::sync::Arc::new(AtomicBool::new(true));

    // The dedicated runtime thread: it owns the host half and nothing else.
    // Current-thread + enable_all gives the scripted schedule its timers.
    {
        let events = events.clone();
        let commands_tx = commands.clone();
        let alive = alive.clone();
        thread::Builder::new()
            .name("manox-host".to_owned())
            .spawn(move || {
                let runtime = match tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                {
                    Ok(runtime) => runtime,
                    Err(error) => {
                        let _ = events.blocking_send(PumpEvent::TransportError(format!(
                            "the manox runtime thread cannot start: {error}"
                        )));
                        return;
                    }
                };
                runtime.block_on(supervise(commands_tx, commands_rx, events, alive));
            })
            .map_err(|error| format!("cannot start the manox runtime thread: {error}"))?;
    }

    // The forwarder on the engine thread: channel in, `Callback::post` out.
    cx.start(async move {
        let mut received = events_rx;
        while let Some(event) = received.recv().await {
            let frame = match event {
                PumpEvent::Frame(text) => crate::ManoxFrame {
                    kind: "frame".to_owned(),
                    text: Some(text),
                    error: None,
                },
                PumpEvent::TransportError(error) => crate::ManoxFrame {
                    kind: "transport-error".to_owned(),
                    text: None,
                    error: Some(error),
                },
                PumpEvent::Stopped => crate::ManoxFrame {
                    kind: "stopped".to_owned(),
                    text: None,
                    error: None,
                },
            };
            on_frame.post(frame);
        }
    });

    *guard = Some(PumpHandle { commands, alive });
    Ok(())
}

/// Queues one client frame into the running session.
pub(crate) fn send(frame: String) -> Result<(), String> {
    let guard = PUMP
        .lock()
        .map_err(|_| "manox pump lock poisoned".to_owned())?;
    let Some(handle) = guard.as_ref() else {
        return Err("the manox pump is not running".to_owned());
    };
    handle
        .commands
        .send(Command::Frame(frame))
        .map_err(|_| "the manox runtime thread is gone".to_owned())
}

/// Ends the runtime thread; the next `start` runs a fresh singleton.
pub(crate) fn stop() -> Result<(), String> {
    let mut guard = PUMP
        .lock()
        .map_err(|_| "manox pump lock poisoned".to_owned())?;
    if let Some(handle) = guard.take() {
        let _ = handle.commands.send(Command::Stop);
    }
    Ok(())
}

/// Replaces the host half in place: the old session reports `stopped`, the
/// new one starts with a fresh journal (snapshots answer reconnect).
pub(crate) fn restart() -> Result<(), String> {
    let guard = PUMP
        .lock()
        .map_err(|_| "manox pump lock poisoned".to_owned())?;
    let Some(handle) = guard.as_ref() else {
        return Err("the manox pump is not running".to_owned());
    };
    handle
        .commands
        .send(Command::Restart)
        .map_err(|_| "the manox runtime thread is gone".to_owned())
}

/// Plants a panic inside the host half, past the pump boundary (T0's
/// crash-isolation gate: it must surface as a transport error, not a crash).
pub(crate) fn inject_panic() -> Result<(), String> {
    let guard = PUMP
        .lock()
        .map_err(|_| "manox pump lock poisoned".to_owned())?;
    let Some(handle) = guard.as_ref() else {
        return Err("the manox pump is not running".to_owned());
    };
    handle
        .commands
        .send(Command::InjectPanic)
        .map_err(|_| "the manox runtime thread is gone".to_owned())
}

/// `"running"` while a host session is up.
pub(crate) fn status() -> String {
    let guard = match PUMP.lock() {
        Ok(guard) => guard,
        Err(_) => return "stopped".to_owned(),
    };
    match guard.as_ref() {
        Some(handle) if handle.alive.load(Ordering::Acquire) => "running".to_owned(),
        _ => "stopped".to_owned(),
    }
}

/// The runtime thread's supervisor: owns the current session, applies
/// commands in order, and retires a session fully (its end event posted)
/// before a replacement starts, so old and new frames never interleave.
async fn supervise(
    _commands: mpsc::UnboundedSender<Command>,
    mut commands_rx: mpsc::UnboundedReceiver<Command>,
    events: mpsc::Sender<PumpEvent>,
    alive: std::sync::Arc<AtomicBool>,
) {
    let mut session: Option<host::Session> = None;
    while let Some(command) = commands_rx.recv().await {
        match command {
            Command::Frame(text) => {
                if let Some(session) = session.as_ref() {
                    let _ = session.inbound.send(text);
                }
            }
            Command::Restart => {
                retire(&mut session).await;
                session = Some(host::Session::spawn(PumpSender { tx: events.clone() }));
            }
            Command::Stop => {
                retire(&mut session).await;
                break;
            }
            Command::InjectPanic => {
                if let Some(session) = session.as_ref() {
                    let _ = session.ctl.send(host::Ctl::InjectPanic);
                }
            }
        }
    }
    alive.store(false, Ordering::Release);
}

/// Drops the session's handles and waits for its end event, so a replacement
/// starts on a quiet wire.
async fn retire(session: &mut Option<host::Session>) {
    if let Some(current) = session.take() {
        drop(current.inbound);
        drop(current.ctl);
        let _ = current.ended.await;
    }
}
