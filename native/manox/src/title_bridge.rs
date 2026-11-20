//! Per-session title bridges (issue #73, the manox half): a headless ghostty
//! terminal fed by the kernel's bash output tap.
//!
//! The kernel (dspo/manox v0.13.0, #1030) exposes a process-level
//! [`install_bash_output_tap`]: every bash execution path hands its raw
//! chunks to it, routed by session id. This module installs the tap at
//! pump start and owns one headless emulator per session — the kernel is
//! the only interpreter (no custom scanner), and each new OSC 0/2 title
//! surfaces to TSX through `TitleBridge`.
//!
//! The channel is fed **in-proc** (the tap fires on this side of the
//! native boundary), so unlike pi's there is no pty transport and no
//! fd inheritance. One bridge per AHP thread; dropped when the thread is
//! deleted.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

use manox_harness::{BashOutputTap, BashOutputTapId, install_bash_output_tap};
use nsh_core::prelude::*;
use zu_ghostty::Terminal as Ghostty;

/// A session's emulator and its observer. The ghostty terminal is the only
/// interpreter: no custom scanner, no policy table — query answers have
/// nowhere to go (no write pty) and are dropped.
struct Bridge {
    term: Mutex<Ghostty>,
    /// The emulator's current title, deduplicated against the last report.
    title: Mutex<String>,
    reports: Reports,
}

/// A bridge's observer slot.
type Reports = Arc<Mutex<Option<Box<dyn Fn(String) + Send + Sync>>>>;

fn bridges() -> &'static Mutex<HashMap<String, Arc<Bridge>>> {
    static BRIDGES: OnceLock<Mutex<HashMap<String, Arc<Bridge>>>> = OnceLock::new();
    BRIDGES.get_or_init(|| Mutex::new(HashMap::new()))
}

fn report_new(reports: &Reports, title: &str) {
    if let Ok(slot) = reports.lock()
        && let Some(report) = slot.as_ref()
    {
        report(title.to_owned());
    }
}

/// Installs the process-level bash output tap. Called once at pump start,
/// before the first session; a restart finds the tap already installed and
/// reuses it (the `OnceLock` outlives runtime rebuilds).
pub(crate) fn ensure_tap_installed() -> Result<(), String> {
    // ...and a restart finds it installed: reuse (the `OnceLock` outlives
    // runtime rebuilds).
    let tap: BashOutputTap = Arc::new(|id: BashOutputTapId, bytes: &[u8]| {
        // No session identity (harness-standalone assemblies): nothing to
        // route, and the bytes were decorative anyway.
        let Some(key) = id.session_id else {
            return;
        };
        let bridge = bridges()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(&key)
            .cloned();
        if let Some(bridge) = bridge {
            bridge.feed(bytes);
        }
        // No bridge for this session: the chunks are decorative and the
        // emulator-less path drops them.
    });
    match install_bash_output_tap(tap) {
        Ok(()) => Ok(()),
        Err(error @ manox_harness::InstallError::AlreadyInstalled) => {
            tracing::debug!(%error, "bash output tap already installed: restart reuse");
            Ok(())
        }
    }
}

/// Opens (or reuses) the thread's bridge; `reports` observes every new
/// title until the bridge is removed.
pub(crate) fn install(key: &str, reports: Box<dyn Fn(String) + Send + Sync>) -> Result<(), String> {
    let mut bridges = bridges().lock().unwrap_or_else(|e| e.into_inner());
    if let Some(existing) = bridges.get(key) {
        if let Ok(mut slot) = existing.reports.lock() {
            *slot = Some(reports);
        }
        return Ok(());
    }
    let term = Ghostty::new(80, 24).map_err(|error| format!("libghostty-vt: {error}"))?;
    // The emulator is a title interpreter, not a display: no scrollback to
    // keep, and no write pty — query answers have nowhere to go and are
    // dropped.
    term.set_scrollback_lines(0);
    bridges.insert(
        key.to_owned(),
        Arc::new(Bridge {
            term: Mutex::new(term),
            title: Mutex::new(String::new()),
            reports: Arc::new(Mutex::new(Some(reports))),
        }),
    );
    Ok(())
}

/// Drops the thread's bridge: only a thread's deletion calls this.
pub(crate) fn remove(key: &str) {
    bridges()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(key);
}

impl Bridge {
    /// Feeds raw bytes as the tap delivered them; a new title reports once,
    /// full value (not a delta).
    fn feed(&self, bytes: &[u8]) {
        let term = self.term.lock().unwrap_or_else(|e| e.into_inner());
        term.write(bytes);
        if let Some(t) = term.title() {
            let mut current = self.title.lock().unwrap_or_else(|e| e.into_inner());
            if *current != t {
                report_new(&self.reports, &t);
                *current = t;
            }
        }
    }
}

/// A session's title bridge (issue #73, manox half): the headless emulator
/// the kernel's bash tap feeds. Open it with the thread id before the
/// thread's first turn; drop it only when the thread is deleted
/// (`close`) — chats closing and pump restarts reuse it instead.
#[class]
pub struct TitleBridge {
    key: String,
}

#[class]
impl TitleBridge {
    /// Opens (or reuses) the bridge and posts each new title to
    /// `on_title`, on the engine thread.
    pub fn open(
        key: String,
        #[args(event)] on_title: Callback<String>,
        cx: CallCx<'_>,
    ) -> Result<TitleBridge, String> {
        let (titles, mut received) = tokio::sync::mpsc::unbounded_channel();
        install(
            &key,
            Box::new(move |title| {
                let _ = titles.send(title);
            }),
        )?;
        cx.start(async move {
            while let Some(title) = received.recv().await {
                on_title.post(title);
            }
        });
        Ok(TitleBridge { key })
    }

    /// Drops the bridge: only a thread's deletion calls this.
    pub fn close(&self) {
        remove(&self.key);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    /// Installs the process tap once per test binary (the second test's
    /// install is refused — `AlreadyInstalled` — and that is fine: the
    /// process tap is a singleton and the bridge tests drive `feed`
    /// directly).
    fn ensure_tap_installed() {
        let tap: BashOutputTap = Arc::new(|_id: BashOutputTapId, _bytes: &[u8]| {});
        let _ = install_bash_output_tap(tap);
    }

    /// A bridge whose titles land in a queue the test can read.
    fn installed(key: &str) -> mpsc::Receiver<String> {
        ensure_tap_installed();
        let (sender, receiver) = mpsc::channel::<String>();
        install(
            key,
            Box::new(move |title| {
                let _ = sender.send(title);
            }),
        )
        .expect("the bridge installs");
        receiver
    }

    /// Feeds bytes through the bridge's emulator, as the tap would.
    /// Feeds bytes through the bridge's emulator, as the tap would. A
    /// session without a bridge drops them (the tap's own semantics).
    fn feed(key: &str, bytes: &[u8]) {
        let bridge = bridges()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(key)
            .cloned();
        if let Some(bridge) = bridge {
            bridge.feed(bytes);
        }
    }

    /// Tap bytes for a bridged session surface as new full titles.
    #[test]
    fn fed_bytes_surface_as_titles() {
        let receiver = installed("thread-a");
        feed("thread-a", b"\x1b]2;from the kernel\x07");
        let got = receiver
            .recv_timeout(std::time::Duration::from_secs(5))
            .expect("the title is reported");
        assert_eq!(got, "from the kernel");
    }

    /// Routing is per session: another session's chunks never cross, and a
    /// removed bridge drops its session's later chunks.
    #[test]
    fn routing_is_per_session_and_removal_drops() {
        let receiver = installed("thread-b");
        feed("thread-other", b"\x1b]2;elsewhere\x07");
        feed("thread-b", b"\x1b]2;mine\x07");
        let got = receiver
            .recv_timeout(std::time::Duration::from_secs(5))
            .expect("the title is reported");
        assert_eq!(got, "mine");
        assert!(
            receiver.try_recv().is_err(),
            "nothing leaked across sessions"
        );

        remove("thread-b");
        feed("thread-b", b"\x1b]2;after\x07");
        assert!(receiver.try_recv().is_err(), "no bridge, no title");
    }

    /// An empty title after a real one reports the fallback value; with
    /// nothing before it, nothing reports.
    #[test]
    fn empty_title_semantics_match_the_channel() {
        let receiver = installed("thread-empty");
        feed("thread-empty", b"\x1b]2;\x07");
        assert!(receiver.try_recv().is_err(), "no title before, no change");
        feed("thread-empty", b"\x1b]2;old\x07");
        assert_eq!(
            receiver
                .recv_timeout(std::time::Duration::from_secs(5))
                .expect("reported"),
            "old"
        );
        feed("thread-empty", b"\x1b]2;\x07");
        assert_eq!(
            receiver
                .recv_timeout(std::time::Duration::from_secs(5))
                .expect("the empty title is reported"),
            ""
        );
    }

    /// The process tap is installed exactly once; a second install is
    /// refused loudly (`AlreadyInstalled`), and restarts reuse it.
    #[test]
    fn the_tap_is_a_process_singleton() {
        ensure_tap_installed();
        let tap: BashOutputTap = Arc::new(|_id: BashOutputTapId, _bytes: &[u8]| {});
        let error = install_bash_output_tap(tap).expect_err("a second install must be refused");
        assert_eq!(error, manox_harness::InstallError::AlreadyInstalled);
    }
}
