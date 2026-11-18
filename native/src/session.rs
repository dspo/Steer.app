//! Terminal sessions: a program under a PTY and the emulator that reads it.
//!
//! The emulator (libghostty-vt) is fed on the PTY's reader thread, under the
//! session's lock, and read under the same lock by the view that draws it:
//! output never crosses the engine, and the screen, the scrollback and the
//! program's modes outlive any view. A hidden sheet's terminal keeps up with
//! its program; a view that comes back draws what is there.
//!
//! TSX holds a session as a class handle: it starts and ends the program,
//! hears its effects (title, bell, clipboard writes, exit) through one
//! callback, and reads its text. The view finds the session by [`id`]
//! (`find`) and talks to it directly.
//!
//! [`id`]: TerminalSession::id

use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex, MutexGuard, OnceLock, Weak,
        atomic::{AtomicBool, AtomicU16, AtomicU32, AtomicU64, Ordering},
    },
};

use nsh_core::prelude::*;
use zu_ghostty::{
    ColorScheme, DeviceAttributes, ProgressState, RenderState, SizeReport, Terminal as Ghostty,
    XtChecksumFlags, sys::GHOSTTY_CELL_WIDE_SPACER_TAIL,
};

use crate::pty::{Control, Process, PtyExit, PtyOptions};

/// Lines of history a session keeps.
const SCROLLBACK: usize = 10_000;

/// Something a session's program did that the app hears about.
#[derive(Debug, Clone, Default, JsObject)]
pub struct TerminalSessionEvent {
    /// `"title"`, `"bell"`, `"pwd"`, `"clipboard"`, `"notify"` (OSC 9 /
    /// 777), `"progress"` (OSC 9;4) or `"exit"`.
    kind: String,
    /// The title, the working directory, the clipboard text, a
    /// notification's body, or a progress state (`"set"`, `"error"`,
    /// `"indeterminate"`, `"pause"`, `"remove"`).
    text: Option<String>,
    /// A notification's title.
    title: Option<String>,
    /// A progress report's percent.
    percent: Option<u16>,
    /// An exit's status, `null` when a signal ended the program.
    code: Option<i32>,
    /// The signal that ended the program.
    signal: Option<String>,
}

impl TerminalSessionEvent {
    fn new(kind: &str, text: Option<String>) -> Self {
        Self {
            kind: kind.to_owned(),
            text,
            ..Default::default()
        }
    }
}

/// The emulator and what its callbacks left for the feeder to report.
pub(crate) struct Emulator {
    pub(crate) term: Ghostty,
    effects: Arc<Mutex<Effects>>,
    /// How many times the program rang the bell: the view flashes when it
    /// sees the count move.
    pub(crate) bells: u64,
    /// A window-resize request the resize callback recorded. It must not
    /// apply it itself: the callback fires inside `term.write`, under the
    /// session's lock, and `Shared::resize` takes that same lock. The
    /// feeder applies it after the write released the lock.
    pending_resize: Arc<Mutex<Option<(u16, u16)>>>,
}

impl Emulator {
    /// The recorded request, if one is waiting.
    fn take_pending_resize(&mut self) -> Option<(u16, u16)> {
        self.pending_resize.lock().ok()?.take()
    }
}

/// The grid and cell size of the last layout: what size queries answer
/// with until the view lays out something else. The kernel may move the
/// grid part itself (DECCOLM); `feed` syncs that back after every write.
struct Geometry {
    cols: AtomicU16,
    rows: AtomicU16,
    cell_w: AtomicU32,
    cell_h: AtomicU32,
}

impl Geometry {
    /// 80×24 at 10×20 device pixels a cell — what the official esctest
    /// driver answers before anything lays the view out.
    fn new() -> Self {
        Self {
            cols: AtomicU16::new(80),
            rows: AtomicU16::new(24),
            cell_w: AtomicU32::new(10),
            cell_h: AtomicU32::new(20),
        }
    }
}

#[derive(Default)]
struct Effects {
    title: bool,
    bell: bool,
    pwd: bool,
    clipboard: Option<String>,
    events: Vec<TerminalSessionEvent>,
}

/// What the PTY's reader, the view and the TSX handle share.
pub(crate) struct Shared {
    id: u64,
    emulator: Mutex<Emulator>,
    control: OnceLock<Arc<Control>>,
    events: tokio::sync::mpsc::UnboundedSender<TerminalSessionEvent>,
    /// Asks the attached view to draw again; called after every change.
    waker: Mutex<Option<Waker>>,
    /// Whether the background the view draws on is dark: the answer to a
    /// program's color-scheme query.
    dark: Arc<AtomicBool>,
    /// The grid and cell size size queries answer with.
    geometry: Geometry,
}

/// A view's request to be drawn again, with the attachment it belongs to.
type Waker = (u64, Arc<dyn Fn() + Send + Sync>);

impl Shared {
    /// The wiring every session shares: an emulator with the query answers
    /// set, events flowing into `events`. No program and no view attached
    /// yet; the caller spawns the process, wires the control and (for a
    /// real session) registers the id.
    pub(crate) fn build(
        events: tokio::sync::mpsc::UnboundedSender<TerminalSessionEvent>,
    ) -> Arc<Shared> {
        static NEXT: AtomicU64 = AtomicU64::new(1);
        let id = NEXT.fetch_add(1, Ordering::Relaxed);
        let dark = Arc::new(AtomicBool::new(false));
        Arc::new_cyclic(|weak: &Weak<Shared>| Shared {
            id,
            geometry: Geometry::new(),
            emulator: Mutex::new(Emulator::new(weak.clone(), dark.clone())),
            control: OnceLock::new(),
            events,
            waker: Mutex::new(None),
            dark,
        })
    }

    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    pub(crate) fn id(&self) -> u64 {
        self.id
    }

    /// The emulator, for as long as the guard lives. Callers keep it short:
    /// the PTY's reader waits on it.
    pub(crate) fn lock(&self) -> MutexGuard<'_, Emulator> {
        self.emulator.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Gives the session its program's control: resize requests and typed
    /// input flow to it from here on.
    pub(crate) fn adopt(&self, control: Arc<Control>) {
        let _ = self.control.set(control);
    }

    /// Bytes for the program: typed keys, pastes, mouse reports.
    pub(crate) fn send(&self, bytes: &[u8]) {
        if let Some(control) = self.control.get() {
            let _ = control.write(bytes.to_vec());
        }
    }

    /// Makes the grid `cols` × `rows` cells of `cell_px` device pixels, and
    /// tells the program. A zero `cell_px` keeps the one before (size
    /// queries need a cell size even before the view laid out).
    pub(crate) fn resize(&self, cols: u16, rows: u16, cell_px: (u32, u32)) {
        let g = &self.geometry;
        g.cols.store(cols, Ordering::Relaxed);
        g.rows.store(rows, Ordering::Relaxed);
        if cell_px.0 > 0 {
            g.cell_w.store(cell_px.0, Ordering::Relaxed);
        }
        if cell_px.1 > 0 {
            g.cell_h.store(cell_px.1, Ordering::Relaxed);
        }
        let _ = self.lock().term.resize(cols, rows, cell_px.0, cell_px.1);
        if let Some(control) = self.control.get() {
            let _ = control.resize(cols, rows);
        }
        self.wake();
    }

    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    pub(crate) fn set_dark(&self, dark: bool) {
        self.dark.store(dark, Ordering::Relaxed);
    }

    pub(crate) fn alive(&self) -> bool {
        self.control.get().is_some_and(|c| c.alive())
    }

    /// Calls `waker` after every change from now on, in place of the view
    /// attached before; returns the attachment to [`Self::detach`] with.
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    pub(crate) fn attach(&self, waker: Arc<dyn Fn() + Send + Sync>) -> u64 {
        static NEXT: AtomicU64 = AtomicU64::new(1);
        let token = NEXT.fetch_add(1, Ordering::Relaxed);
        if let Ok(mut slot) = self.waker.lock() {
            *slot = Some((token, waker));
        }
        token
    }

    /// Stops waking the view of `token`, unless another took its place.
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    pub(crate) fn detach(&self, token: u64) {
        if let Ok(mut slot) = self.waker.lock()
            && slot.as_ref().is_some_and(|(t, _)| *t == token)
        {
            *slot = None;
        }
    }

    pub(crate) fn wake(&self) {
        let waker = self
            .waker
            .lock()
            .ok()
            .and_then(|w| w.as_ref().map(|(_, f)| f.clone()));
        if let Some(waker) = waker {
            waker();
        }
    }

    /// Emulates the program's output, reports its effects and applies a
    /// window-resize request it made mid-stream — with the session lock
    /// released between the two.
    pub(crate) fn feed(&self, bytes: &[u8]) {
        let (events, asked) = {
            let mut emulator = self.lock();
            emulator.term.write(bytes);
            // The kernel can resize itself (DECCOLM under DEC mode 40),
            // ahead of the view: size queries must answer what it is now.
            let g = &self.geometry;
            if let Some(cols) = emulator.term.cols() {
                g.cols.store(cols, Ordering::Relaxed);
            }
            if let Some(rows) = emulator.term.rows() {
                g.rows.store(rows, Ordering::Relaxed);
            }
            // The resize request was recorded by a callback that ran inside
            // `write`, under this lock; taking it here is safe, applying it
            // happens below, with the lock released.
            (emulator.drain(), emulator.take_pending_resize())
        };
        for event in events {
            let _ = self.events.send(event);
        }
        if let Some(asked) = asked {
            let g = &self.geometry;
            let cols = if asked.1 == 0 {
                g.cols.load(Ordering::Relaxed)
            } else {
                asked.1
            };
            let rows = if asked.0 == 0 {
                g.rows.load(Ordering::Relaxed)
            } else {
                asked.0
            };
            self.resize(
                cols,
                rows,
                (
                    g.cell_w.load(Ordering::Relaxed),
                    g.cell_h.load(Ordering::Relaxed),
                ),
            );
        }
        self.wake();
    }
}

impl Emulator {
    fn new(shared: Weak<Shared>, dark: Arc<AtomicBool>) -> Self {
        let mut term = Ghostty::new(80, 24).expect("libghostty-vt makes a terminal");
        term.set_scrollback_lines(SCROLLBACK);
        let effects = Arc::new(Mutex::new(Effects::default()));
        let pending_resize = Arc::new(Mutex::new(None));

        // esctest (and other decoders of real terminals) ask what they are
        // talking to; the answers come from the session's own state.
        let ask = shared.clone();
        term.set_on_size(Box::new(move |view| {
            let session = ask.upgrade()?;
            let g = &session.geometry;
            Some(SizeReport {
                // The grid as the kernel has it now: a resize the same
                // chunk triggered (DECCOLM) must be part of the answer.
                rows: view.rows()?,
                columns: view.cols()?,
                cell_width: g.cell_w.load(Ordering::Relaxed),
                cell_height: g.cell_h.load(Ordering::Relaxed),
            })
        }));
        term.set_on_device_attributes(Box::new(DeviceAttributes::vt520));
        term.set_xt_checksum_report(true);
        term.set_xt_checksum_extension(XtChecksumFlags {
            positive: true,
            no_attributes: true,
            no_trim: true,
            full: true,
        });
        let ask = pending_resize.clone();
        term.set_on_resize_window(Box::new(move |request| {
            if request.rows != 0 || request.columns != 0 {
                *ask.lock().unwrap() = Some((request.rows, request.columns));
            }
        }));
        term.set_write_pty(Box::new(move |bytes| {
            if let Some(shared) = shared.upgrade() {
                shared.send(bytes);
            }
        }));
        let e = effects.clone();
        term.set_on_title(Box::new(move || {
            if let Ok(mut e) = e.lock() {
                e.title = true;
            }
        }));
        let e = effects.clone();
        term.set_on_bell(Box::new(move || {
            if let Ok(mut e) = e.lock() {
                e.bell = true;
            }
        }));
        let e = effects.clone();
        term.set_on_pwd(Box::new(move || {
            if let Ok(mut e) = e.lock() {
                e.pwd = true;
            }
        }));
        let e = effects.clone();
        term.set_on_clipboard_write(Box::new(move |text| {
            if let Ok(mut e) = e.lock() {
                e.clipboard = Some(text.to_owned());
            }
        }));
        let e = effects.clone();
        term.set_on_notification(Box::new(move |title, body| {
            if let Ok(mut e) = e.lock() {
                e.events.push(TerminalSessionEvent {
                    kind: "notify".to_owned(),
                    title: Some(title.to_owned()),
                    text: Some(body.to_owned()),
                    ..Default::default()
                });
            }
        }));
        let e = effects.clone();
        term.set_on_progress(Box::new(move |progress| {
            let state = match progress.state {
                ProgressState::Remove => "remove",
                ProgressState::Set => "set",
                ProgressState::Error => "error",
                ProgressState::Indeterminate => "indeterminate",
                ProgressState::Pause => "pause",
            };
            if let Ok(mut e) = e.lock() {
                e.events.push(TerminalSessionEvent {
                    kind: "progress".to_owned(),
                    text: Some(state.to_owned()),
                    percent: progress.percent.map(u16::from),
                    ..Default::default()
                });
            }
        }));
        term.set_on_color_scheme(Box::new(move || {
            Some(if dark.load(Ordering::Relaxed) {
                ColorScheme::Dark
            } else {
                ColorScheme::Light
            })
        }));
        Self {
            term,
            effects,
            bells: 0,
            pending_resize,
        }
    }

    /// The effects of the last write, as events.
    fn drain(&mut self) -> Vec<TerminalSessionEvent> {
        let effects = match self.effects.lock() {
            Ok(mut e) => std::mem::take(&mut *e),
            Err(_) => return Vec::new(),
        };
        let mut out = Vec::new();
        if effects.title {
            out.push(TerminalSessionEvent::new("title", self.term.title()));
        }
        if effects.pwd {
            out.push(TerminalSessionEvent::new("pwd", self.term.pwd()));
        }
        if effects.bell {
            self.bells += 1;
            out.push(TerminalSessionEvent::new("bell", None));
        }
        if let Some(text) = effects.clipboard {
            out.push(TerminalSessionEvent::new("clipboard", Some(text)));
        }
        out.extend(effects.events);
        out
    }

    /// Runs the search for `needle` (`None`: the current one) and moves
    /// `step` matches from the selected one.
    pub(crate) fn find(&mut self, needle: Option<&str>, step: i32) -> TerminalFind {
        let empty = needle.is_some_and(str::is_empty);
        if empty {
            self.term.end_search();
            return TerminalFind::default();
        }
        let Ok(search) = self.term.search() else {
            return TerminalFind::default();
        };
        if let Some(needle) = needle {
            let _ = search.set_needle(needle);
        }
        let _ = search.run();
        let moved = match step.signum() {
            1 => search.select_next(),
            -1 => search.select_prev(),
            _ => search.selected_index().is_some() || search.select_next(),
        };
        let found = TerminalFind {
            total: search.total() as u32,
            index: search.selected_index().map(|i| i as u32),
        };
        if moved {
            self.term.select_found();
        }
        found
    }

    /// The visible rows, as text: a wide character's spacer tail is part of
    /// it, a blank cell a space, each row's trailing blanks dropped.
    pub(crate) fn viewport_text(&self) -> String {
        let Ok(mut render) = RenderState::new() else {
            return String::new();
        };
        let Ok(frame) = render.snapshot(&self.term) else {
            return String::new();
        };
        frame
            .cells
            .iter()
            .map(|row| {
                let line: String = row
                    .iter()
                    .filter(|c| c.wide != GHOSTTY_CELL_WIDE_SPACER_TAIL)
                    .map(|c| {
                        if c.text.is_empty() {
                            " "
                        } else {
                            c.text.as_str()
                        }
                    })
                    .collect();
                line.trim_end().to_owned()
            })
            .collect::<Vec<_>>()
            .join("\n")
    }
}

/// Where a find stands: how many matches, and which one is selected
/// (0 the newest).
#[derive(Debug, Clone, Default, JsObject)]
pub struct TerminalFind {
    total: u32,
    index: Option<u32>,
}

/// Live sessions by id, for the views to find.
fn registry() -> &'static Mutex<HashMap<u64, Weak<Shared>>> {
    static SESSIONS: OnceLock<Mutex<HashMap<u64, Weak<Shared>>>> = OnceLock::new();
    SESSIONS.get_or_init(Default::default)
}

/// The session `id` names, while its handle lives. The terminal view
/// (macOS) is the only caller.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(crate) fn find(id: u64) -> Option<Arc<Shared>> {
    registry().lock().ok()?.get(&id)?.upgrade()
}

/// A program under a pseudo-terminal and its terminal emulator.
///
/// The program starts in a new session with the pty as its controlling
/// terminal; its output goes into the emulator, which the terminal view
/// (`zu.terminal`, given this session's `id`) draws. `onEvent` hears what
/// the program does besides drawing: its title (`"title"`), the bell,
/// its working directory (`"pwd"`, OSC 7), a clipboard write (`"clipboard"`,
/// OSC 52) and its end (`"exit"`, once). Closing or dropping the handle
/// hangs up and kills the program.
#[class]
pub struct TerminalSession {
    shared: Arc<Shared>,
    process: Process,
}

impl Drop for TerminalSession {
    fn drop(&mut self) {
        if let Ok(mut sessions) = registry().lock() {
            sessions.remove(&self.shared.id);
        }
    }
}

#[class]
impl TerminalSession {
    /// Starts `options` under a new pseudo-terminal, with an emulator of
    /// its size.
    ///
    /// # Rust
    ///
    /// Takes `cx` to start the task that posts events to `onEvent`.
    pub fn open(
        options: PtyOptions,
        #[args(event)] on_event: Callback<TerminalSessionEvent>,
        cx: CallCx<'_>,
    ) -> Result<TerminalSession, String> {
        let (events, mut received) = tokio::sync::mpsc::unbounded_channel();
        let shared = Shared::build(events.clone());
        let feeder = shared.clone();
        let process = Process::spawn(
            options,
            move |bytes| feeder.feed(bytes),
            move |exit: PtyExit| {
                let _ = events.send(TerminalSessionEvent {
                    kind: "exit".to_owned(),
                    code: exit.code,
                    signal: exit.signal,
                    ..Default::default()
                });
            },
        )?;
        let (cols, rows) = process.control.size();
        shared.resize(cols, rows, (0, 0));
        shared.adopt(process.control.clone());
        if let Ok(mut sessions) = registry().lock() {
            sessions.insert(shared.id(), Arc::downgrade(&shared));
        }
        cx.start(async move {
            while let Some(event) = received.recv().await {
                let last = event.kind == "exit";
                on_event.post(event);
                if last {
                    break;
                }
            }
        });
        Ok(TerminalSession { shared, process })
    }

    /// What the view names the session by (`zu.terminal`'s `session`).
    #[getter]
    pub fn id(&self) -> f64 {
        self.shared.id as f64
    }

    /// Sends text to the program as if typed (a paste is `paste`).
    pub fn write(&self, data: String) -> Result<(), String> {
        self.process.control.write(data.into_bytes())
    }

    /// Pastes `text`: bracketed when the program asked for it, unsafe
    /// control sequences refused.
    pub fn paste(&self, text: String) -> bool {
        let written = self.shared.lock().term.paste(&text).unwrap_or(false);
        self.shared.lock().term.scroll_bottom();
        self.shared.wake();
        written
    }

    /// Makes the grid `cols` × `rows` and tells the program (the view does
    /// this itself as it is laid out).
    pub fn resize(&self, cols: u16, rows: u16) {
        self.shared.resize(cols, rows, (0, 0));
    }

    /// Every line, history and screen, one per row.
    pub fn text(&self) -> String {
        self.shared.lock().term.text_all()
    }

    /// The rows the viewport shows, one per row, trailing blanks dropped.
    pub fn viewport_text(&self) -> String {
        self.shared.lock().viewport_text()
    }

    /// Scrolls the viewport by `lines` (negative toward the history).
    pub fn scroll_by(&self, lines: i32) {
        self.shared.lock().term.scroll_delta(lines as isize);
        self.shared.wake();
    }

    /// Returns the viewport to the live screen.
    pub fn scroll_to_bottom(&self) {
        self.shared.lock().term.scroll_bottom();
        self.shared.wake();
    }

    /// Selects every line, history and screen.
    pub fn select_all(&self) {
        self.shared.lock().term.select_all();
        self.shared.wake();
    }

    /// The selected text, as a copy gives it (empty without a selection).
    pub fn selected_text(&self) -> String {
        self.shared.lock().term.selected_text().unwrap_or_default()
    }

    /// Finds `needle` in the history and the screen, newest match first,
    /// and selects it; an empty needle ends the search.
    pub fn find(&self, needle: String) -> TerminalFind {
        let found = self.shared.lock().find(Some(&needle), 0);
        self.shared.wake();
        found
    }

    /// Moves to the next older match (`step` 1) or newer one (`-1`),
    /// scrolling to it.
    pub fn find_step(&self, step: i32) -> TerminalFind {
        let found = self.shared.lock().find(None, step);
        self.shared.wake();
        found
    }

    /// Ends the search, keeping the selection on its last match.
    pub fn end_find(&self) {
        self.shared.lock().term.end_search();
        self.shared.wake();
    }

    /// Clears the screen and the history, as a reset (`ESC c`) does.
    pub fn reset(&self) {
        self.shared.lock().term.reset();
        self.shared.wake();
    }

    /// Hangs up and kills the program; a second call does nothing. The
    /// emulator keeps what it showed.
    pub fn close(&self) {
        self.process.control.close();
    }

    /// Whether the program is still running.
    pub fn alive(&self) -> bool {
        self.shared.alive()
    }

    /// The program's id, `null` when the platform has none.
    #[getter]
    pub fn pid(&self) -> Option<u32> {
        self.process.pid
    }

    /// The program's name (the default shell's path when it was not given).
    #[getter]
    pub fn program(&self) -> String {
        self.process.program.clone()
    }

    /// The title the program set (OSC 0/2), empty before it sets one.
    #[getter]
    pub fn title(&self) -> String {
        self.shared.lock().term.title().unwrap_or_default()
    }

    /// The grid's size: columns and rows.
    #[getter]
    pub fn size(&self) -> Vec<u16> {
        let (cols, rows) = self.process.control.size();
        vec![cols, rows]
    }

    /// The exit status, `null` while running or when a signal ended it.
    #[getter]
    pub fn exit_code(&self) -> Option<i32> {
        self.process.control.exit().code
    }

    /// The signal that ended the program, `null` after a normal exit.
    #[getter]
    pub fn exit_signal(&self) -> Option<String> {
        self.process.control.exit().signal
    }
}

/// The feed path without a real PTY: the query-answer wiring and the
/// resize-request plumbing every session and the conformance driver share.
#[cfg(test)]
mod tests {
    use super::*;

    fn shared() -> Arc<Shared> {
        let (events, _) = tokio::sync::mpsc::unbounded_channel();
        Shared::build(events)
    }

    fn grid(shared: &Shared) -> (u16, u16) {
        let mut render = RenderState::new().unwrap();
        let frame = render.snapshot(&shared.lock().term).unwrap();
        (frame.cols, frame.rows)
    }

    /// A window-resize request applies after the write released the lock,
    /// never from inside its own callback.
    #[test]
    fn resize_request_applies_after_the_write_released_the_lock() {
        let shared = shared();
        shared.feed(b"\x1b[8;30;100t");
        assert_eq!(grid(&shared), (100, 30));
        // A zero keeps the dimension the program left out.
        shared.feed(b"\x1b[8;0;40t");
        assert_eq!(grid(&shared), (40, 30));
    }

    /// The kernel can resize itself (DECCOLM under DEC mode 40), ahead of
    /// the view: query answers follow what it is now, not the last layout.
    #[test]
    fn kernel_self_resize_reaches_the_query_answers() {
        let shared = shared();
        shared.feed(b"\x1b[?40h\x1b[?3h");
        assert_eq!(grid(&shared), (132, 24));
        assert_eq!(shared.geometry.cols.load(Ordering::Relaxed), 132);
        // And back, since the mode is what carries the size.
        shared.feed(b"\x1b[?3l");
        assert_eq!(grid(&shared), (80, 24));
    }

    /// Writes and resize requests at once do not deadlock, and a request
    /// that comes after them wins.
    #[test]
    fn concurrent_writes_and_resize_requests_do_not_deadlock() {
        let shared = shared();
        let feeder = shared.clone();
        let writer = std::thread::spawn(move || {
            for _ in 0..2000 {
                feeder.feed(b"hello\r\n");
            }
        });
        for i in 0..200 {
            shared.feed(format!("\x1b[8;{};{}t", 10 + i % 20, 40 + i % 30).as_bytes());
        }
        writer.join().unwrap();
        shared.feed(b"\x1b[8;33;77t");
        assert_eq!(grid(&shared), (77, 33));
        assert!(shared.lock().term.text_all().contains("hello"));
    }
}
