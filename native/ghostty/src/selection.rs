//! The terminal-owned active selection and the pointer gestures that make it.
//!
//! An installed selection is copied into terminal-tracked state, so it stays
//! on its text while output scrolls it into history. When its rows are
//! pruned from the scrollback (or erased) the terminal would keep it,
//! collapsed onto whatever row is now first; the wrapper's guards notice and
//! clear it instead. Consumers address cells only by viewport (column, row);
//! grid references never leave this module.

use std::ffi::{c_int, c_void};

use crate::{Terminal, check, sys};

/// Word boundaries for double-click and word selection: Ghostty's defaults
/// without `:`, so URLs (`https://…`) and `path:line:col` locations select
/// whole. `/`, `.`, `-`, `~` and `_` are never boundaries, so paths do too.
pub const DEFAULT_WORD_BOUNDARIES: &[char] = &[
    '\0', ' ', '\t', '\'', '"', '│', '`', '|', ';', ',', '(', ')', '[', ']', '{', '}', '<', '>',
    '$',
];

/// How [`Terminal::adjust_selection`] moves the selection's moving end.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Adjust {
    Left,
    Right,
    Up,
    Down,
    Home,
    End,
    PageUp,
    PageDown,
    LineStart,
    LineEnd,
}

impl Adjust {
    fn raw(self) -> c_int {
        match self {
            Self::Left => sys::GHOSTTY_SELECTION_ADJUST_LEFT,
            Self::Right => sys::GHOSTTY_SELECTION_ADJUST_RIGHT,
            Self::Up => sys::GHOSTTY_SELECTION_ADJUST_UP,
            Self::Down => sys::GHOSTTY_SELECTION_ADJUST_DOWN,
            Self::Home => sys::GHOSTTY_SELECTION_ADJUST_HOME,
            Self::End => sys::GHOSTTY_SELECTION_ADJUST_END,
            Self::PageUp => sys::GHOSTTY_SELECTION_ADJUST_PAGE_UP,
            Self::PageDown => sys::GHOSTTY_SELECTION_ADJUST_PAGE_DOWN,
            Self::LineStart => sys::GHOSTTY_SELECTION_ADJUST_BEGINNING_OF_LINE,
            Self::LineEnd => sys::GHOSTTY_SELECTION_ADJUST_END_OF_LINE,
        }
    }
}

/// A tracked reference that follows its cell; it loses its value when the
/// cell's row is pruned, erased or reset away.
struct Tracked(sys::GhosttyTrackedGridRef);

impl Tracked {
    fn alive(&self) -> bool {
        // SAFETY: the handle is live until drop.
        unsafe { sys::ghostty_tracked_grid_ref_has_value(self.0) }
    }
}

impl Drop for Tracked {
    fn drop(&mut self) {
        // SAFETY: the handle is live and never used again. Freeing touches
        // the terminal, so guards only drop through `&Terminal`/`&mut
        // Terminal` (under the owner's lock) or after the terminal.
        unsafe { sys::ghostty_tracked_grid_ref_free(self.0) }
    }
}

/// The installed selection's two endpoints, tracked on the screen it was
/// installed on.
pub(crate) struct Guard {
    start: Tracked,
    end: Tracked,
}

impl Guard {
    fn lost(&self) -> bool {
        !self.start.alive() || !self.end.alive()
    }
}

impl Terminal {
    /// The codepoints that end a word for word selection.
    pub fn word_boundaries(&self) -> &[u32] {
        &self.word_boundaries
    }

    /// Replace the word boundaries; `None` restores
    /// [`DEFAULT_WORD_BOUNDARIES`].
    pub fn set_word_boundaries(&mut self, boundaries: Option<&[char]>) {
        let chars = boundaries.unwrap_or(DEFAULT_WORD_BOUNDARIES);
        self.word_boundaries = chars.iter().map(|&c| c as u32).collect();
    }

    /// Select the word under a viewport cell. False (and the selection left
    /// alone) when there is no word there.
    pub fn select_word_at(&self, col: u16, row: u16) -> bool {
        let Some(grid_ref) = self.viewport_ref(col, row) else {
            return false;
        };
        let options = sys::GhosttyTerminalSelectWordOptions {
            size: std::mem::size_of::<sys::GhosttyTerminalSelectWordOptions>(),
            grid_ref,
            boundary_codepoints: self.word_boundaries.as_ptr(),
            boundary_codepoints_len: self.word_boundaries.len(),
        };
        let mut out = sys::GhosttySelection::default();
        // SAFETY: a fresh ref; the boundary slice outlives the call.
        let rc = unsafe { sys::ghostty_terminal_select_word(self.term, &options, &mut out) };
        self.install_result(rc, &out)
    }

    /// Select the (soft-wrapped) line under a viewport cell, stopping at a
    /// shell prompt boundary.
    pub fn select_line_at(&self, col: u16, row: u16) -> bool {
        let Some(grid_ref) = self.viewport_ref(col, row) else {
            return false;
        };
        let options = sys::GhosttyTerminalSelectLineOptions {
            size: std::mem::size_of::<sys::GhosttyTerminalSelectLineOptions>(),
            grid_ref,
            whitespace: std::ptr::null(),
            whitespace_len: 0,
            semantic_prompt_boundary: true,
        };
        let mut out = sys::GhosttySelection::default();
        // SAFETY: a fresh ref; NULL whitespace selects the defaults.
        let rc = unsafe { sys::ghostty_terminal_select_line(self.term, &options, &mut out) };
        self.install_result(rc, &out)
    }

    /// Select the command output (`OSC 133;C` … `;D`) around a viewport
    /// cell. False without shell integration marks there.
    pub fn select_output_at(&self, col: u16, row: u16) -> bool {
        let Some(grid_ref) = self.viewport_ref(col, row) else {
            return false;
        };
        let mut out = sys::GhosttySelection::default();
        // SAFETY: a fresh ref.
        let rc = unsafe { sys::ghostty_terminal_select_output(self.term, grid_ref, &mut out) };
        self.install_result(rc, &out)
    }

    /// Select everything, scrollback included.
    pub fn select_all(&self) -> bool {
        let mut out = sys::GhosttySelection::default();
        // SAFETY: the handle is live; `out` is a sized out-struct.
        let rc = unsafe { sys::ghostty_terminal_select_all(self.term, &mut out) };
        self.install_result(rc, &out)
    }

    pub fn clear_selection(&self) {
        self.install(None);
    }

    pub fn has_selection(&self) -> bool {
        self.active_selection().is_some()
    }

    /// The active selection as copy gives it: plain, soft wraps joined,
    /// trailing whitespace trimmed.
    pub fn selected_text(&self) -> Option<String> {
        self.active_selection()?;
        self.format_selection(None, true)
    }

    /// Move the selection's moving end (the one a drag or shift-click put
    /// last). False when there is no selection.
    pub fn adjust_selection(&self, adjust: Adjust) -> bool {
        let Some(mut selection) = self.active_selection() else {
            return false;
        };
        // SAFETY: a fresh snapshot of this terminal's active screen.
        let rc = unsafe {
            sys::ghostty_terminal_selection_adjust(self.term, &mut selection, adjust.raw())
        };
        if rc != sys::GHOSTTY_SUCCESS {
            return false;
        }
        self.install(Some(&selection));
        true
    }

    /// A snapshot of the active selection, valid until the next mutation.
    pub(crate) fn active_selection(&self) -> Option<sys::GhosttySelection> {
        self.drop_lost_selection();
        let mut out = sys::GhosttySelection::default();
        // SAFETY: the data kind writes a `GhosttySelection`.
        unsafe { self.get(sys::GHOSTTY_TERMINAL_DATA_SELECTION, &mut out) }.then_some(out)
    }

    /// Clear the active selection if its rows have gone from under it.
    pub(crate) fn drop_lost_selection(&self) {
        let screen = self.screen_index();
        let lost = self.selection_guards.borrow()[screen]
            .as_ref()
            .is_some_and(Guard::lost);
        if lost {
            self.install(None);
        }
    }

    fn screen_index(&self) -> usize {
        usize::from(self.active_screen() == sys::GHOSTTY_TERMINAL_SCREEN_ALTERNATE)
    }

    /// Install a fresh snapshot as the terminal-tracked selection, or clear
    /// it, and guard it against losing its rows.
    pub(crate) fn install(&self, selection: Option<&sys::GhosttySelection>) {
        let screen = sys::GHOSTTY_POINT_TAG_SCREEN;
        let ends = selection.and_then(|s| {
            Some((
                self.point_of(&s.start, screen)?,
                self.point_of(&s.end, screen)?,
            ))
        });
        let ptr = selection.map_or(std::ptr::null(), |s| s as *const _ as *const c_void);
        // SAFETY: the option takes a `GhosttySelection*` of fresh refs (it is
        // copied into tracked state); NULL clears.
        unsafe { self.set_opt(sys::GHOSTTY_TERMINAL_OPT_SELECTION, ptr) };
        let guard = ends.and_then(|(start, end)| {
            Some(Guard {
                start: self.track(start)?,
                end: self.track(end)?,
            })
        });
        self.selection_guards.borrow_mut()[self.screen_index()] = guard;
    }

    fn track(&self, (x, y): (u16, usize)) -> Option<Tracked> {
        let mut handle: sys::GhosttyTrackedGridRef = std::ptr::null_mut();
        // SAFETY: the handle is live; `handle` is a valid out-pointer.
        let rc = unsafe {
            sys::ghostty_terminal_grid_ref_track(
                self.term,
                sys::GhosttyPoint::screen(x, y),
                &mut handle,
            )
        };
        (rc == sys::GHOSTTY_SUCCESS).then_some(Tracked(handle))
    }

    fn install_result(&self, rc: c_int, selection: &sys::GhosttySelection) -> bool {
        if rc != sys::GHOSTTY_SUCCESS {
            return false;
        }
        self.install(Some(selection));
        true
    }

    /// Install `next` and say whether that changed the active selection.
    /// Both it and the current selection are compared as fresh snapshots.
    pub(crate) fn replace_selection(&self, next: Option<&sys::GhosttySelection>) -> bool {
        let current = self.active_selection();
        let changed = match (current.as_ref(), next) {
            (None, None) => false,
            (Some(a), Some(b)) => !self.same_selection(a, b),
            _ => true,
        };
        if changed {
            self.install(next);
        }
        changed
    }

    fn same_selection(&self, a: &sys::GhosttySelection, b: &sys::GhosttySelection) -> bool {
        let mut equal = false;
        // SAFETY: both are fresh snapshots of the active screen.
        let rc = unsafe { sys::ghostty_terminal_selection_equal(self.term, a, b, &mut equal) };
        rc == sys::GHOSTTY_SUCCESS && equal
    }

    fn ordered(&self, selection: &sys::GhosttySelection) -> Option<sys::GhosttySelection> {
        let mut out = sys::GhosttySelection::default();
        // SAFETY: a fresh snapshot of the active screen.
        let rc = unsafe {
            sys::ghostty_terminal_selection_ordered(
                self.term,
                selection,
                sys::GHOSTTY_SELECTION_ORDER_FORWARD,
                &mut out,
            )
        };
        (rc == sys::GHOSTTY_SUCCESS).then_some(out)
    }
}

// ---------------------------------------------------------------------------
// Gestures
// ---------------------------------------------------------------------------

/// Where the pointer is: the viewport cell under it (clamped into the
/// viewport by the caller) and its position in surface pixels, (0, 0) at
/// the view's top-left.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Pointer {
    pub col: u16,
    pub row: u16,
    pub x: f64,
    pub y: f64,
}

/// The rendered grid, in surface pixels.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct GestureGeometry {
    pub columns: u32,
    pub cell_width: u32,
    pub padding_left: u32,
    pub screen_height: u32,
}

/// Modifiers that change what a press does.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Press {
    /// Extend the existing selection to the pressed cell (shift-click),
    /// keeping its far end; subsequent drags keep extending.
    pub extend: bool,
    /// A triple click selects the command output instead of the line.
    pub triple_click_output: bool,
}

/// Which way a drag past the view's edge wants the viewport to scroll; while
/// not `None`, call [`SelectionGesture::autoscroll_tick`] on a timer.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Autoscroll {
    None,
    Up,
    Down,
}

/// The extend-drag the wrapper drives itself: the gesture machine has no
/// notion of shift-extend, and the far end lives on as the start of the
/// terminal-tracked selection.
#[derive(Clone, Copy, Debug)]
struct Extending {
    autoscroll: Autoscroll,
}

/// The press/drag/release state machine for one pointer, installing each
/// result as the terminal's active selection. Click counting (double/triple)
/// uses the press time and the repeat interval/distance.
///
/// Every call takes the terminal so it only runs while the terminal is
/// locked. Dropping the gesture never touches the terminal; its anchor stays
/// tracked there until [`Self::reset`] or the terminal's own drop.
pub struct SelectionGesture {
    gesture: sys::GhosttySelectionGesture,
    press: sys::GhosttySelectionGestureEvent,
    drag: sys::GhosttySelectionGestureEvent,
    release: sys::GhosttySelectionGestureEvent,
    tick: sys::GhosttySelectionGestureEvent,
    deep: sys::GhosttySelectionGestureEvent,
    geometry: GestureGeometry,
    repeat_distance: Option<f64>,
    /// The boundaries last copied into the events.
    boundaries: Vec<u32>,
    extending: Option<Extending>,
}

/// macOS's default double-click interval.
const DEFAULT_REPEAT_INTERVAL_NS: u64 = 500_000_000;

impl SelectionGesture {
    pub fn new() -> Result<Self, c_int> {
        let mut gesture: sys::GhosttySelectionGesture = std::ptr::null_mut();
        // SAFETY: a valid out-pointer; NULL selects the default allocator.
        check(unsafe { sys::ghostty_selection_gesture_new(std::ptr::null(), &mut gesture) })?;
        let mut this = Self {
            gesture,
            press: std::ptr::null_mut(),
            drag: std::ptr::null_mut(),
            release: std::ptr::null_mut(),
            tick: std::ptr::null_mut(),
            deep: std::ptr::null_mut(),
            geometry: GestureGeometry::default(),
            repeat_distance: None,
            boundaries: Vec::new(),
            extending: None,
        };
        for (slot, kind) in [
            (
                &mut this.press,
                sys::GHOSTTY_SELECTION_GESTURE_EVENT_TYPE_PRESS,
            ),
            (
                &mut this.drag,
                sys::GHOSTTY_SELECTION_GESTURE_EVENT_TYPE_DRAG,
            ),
            (
                &mut this.release,
                sys::GHOSTTY_SELECTION_GESTURE_EVENT_TYPE_RELEASE,
            ),
            (
                &mut this.tick,
                sys::GHOSTTY_SELECTION_GESTURE_EVENT_TYPE_AUTOSCROLL_TICK,
            ),
            (
                &mut this.deep,
                sys::GHOSTTY_SELECTION_GESTURE_EVENT_TYPE_DEEP_PRESS,
            ),
        ] {
            // SAFETY: a valid out-pointer and event type; a failure leaves
            // the remaining slots NULL, which `Drop` frees as no-ops.
            check(unsafe {
                sys::ghostty_selection_gesture_event_new(std::ptr::null(), slot, kind)
            })?;
        }
        this.set_repeat_interval_ns(DEFAULT_REPEAT_INTERVAL_NS);
        Ok(this)
    }

    /// The longest gap between clicks that still counts as a repeat.
    pub fn set_repeat_interval_ns(&mut self, interval: u64) {
        // SAFETY: the option takes a `uint64_t*`.
        unsafe {
            self.set(
                self.press,
                sys::GHOSTTY_SELECTION_GESTURE_EVENT_OPT_REPEAT_INTERVAL_NS,
                &interval,
            )
        };
    }

    /// The farthest a repeat click may land from the first, in pixels;
    /// `None` uses the cell width.
    pub fn set_repeat_distance(&mut self, pixels: Option<f64>) {
        self.repeat_distance = pixels;
        self.apply_repeat_distance();
    }

    /// The rendered grid; required before drags and autoscroll ticks.
    pub fn set_geometry(&mut self, geometry: GestureGeometry) {
        self.geometry = geometry;
        let raw = sys::GhosttySelectionGestureGeometry {
            columns: geometry.columns.max(1),
            cell_width: geometry.cell_width.max(1),
            padding_left: geometry.padding_left,
            screen_height: geometry.screen_height.max(1),
        };
        for event in [self.drag, self.tick] {
            // SAFETY: the option takes a `GhosttySelectionGestureGeometry*`.
            unsafe {
                self.set(
                    event,
                    sys::GHOSTTY_SELECTION_GESTURE_EVENT_OPT_GEOMETRY,
                    &raw,
                )
            };
        }
        self.apply_repeat_distance();
    }

    fn apply_repeat_distance(&self) {
        let distance = self
            .repeat_distance
            .unwrap_or(self.geometry.cell_width as f64);
        // SAFETY: the option takes a `double*`.
        unsafe {
            self.set(
                self.press,
                sys::GHOSTTY_SELECTION_GESTURE_EVENT_OPT_REPEAT_DISTANCE,
                &distance,
            )
        };
    }

    /// # Safety
    /// `T` must be the value type `option` documents.
    unsafe fn set<T>(&self, event: sys::GhosttySelectionGestureEvent, option: c_int, value: &T) {
        // SAFETY: the event is live; the value type is the caller's contract.
        let _ = unsafe {
            sys::ghostty_selection_gesture_event_set(
                event,
                option,
                value as *const T as *const c_void,
            )
        };
    }

    fn sync_boundaries(&mut self, term: &Terminal) {
        if self.boundaries == term.word_boundaries {
            return;
        }
        self.boundaries = term.word_boundaries.clone();
        let cps = sys::GhosttyCodepoints {
            ptr: self.boundaries.as_ptr(),
            len: self.boundaries.len(),
        };
        for event in [self.press, self.drag, self.tick, self.deep] {
            // SAFETY: the option takes a `GhosttyCodepoints*`, copied into
            // event-owned storage.
            unsafe {
                self.set(
                    event,
                    sys::GHOSTTY_SELECTION_GESTURE_EVENT_OPT_WORD_BOUNDARY_CODEPOINTS,
                    &cps,
                )
            };
        }
    }

    fn set_pointer(
        &self,
        event: sys::GhosttySelectionGestureEvent,
        grid_ref: &sys::GhosttyGridRef,
        at: Pointer,
    ) {
        let position = sys::GhosttySurfacePosition { x: at.x, y: at.y };
        // SAFETY: the options take a `GhosttyGridRef*` (fresh, copied) and a
        // `GhosttySurfacePosition*`.
        unsafe {
            self.set(
                event,
                sys::GHOSTTY_SELECTION_GESTURE_EVENT_OPT_REF,
                grid_ref,
            );
            self.set(
                event,
                sys::GHOSTTY_SELECTION_GESTURE_EVENT_OPT_POSITION,
                &position,
            );
        }
    }

    /// Apply an event; the selection it produces, read as a fresh snapshot.
    fn apply(
        &self,
        term: &Terminal,
        event: sys::GhosttySelectionGestureEvent,
    ) -> Option<sys::GhosttySelection> {
        let mut out = sys::GhosttySelection::default();
        // SAFETY: live handles; `out` is a sized out-struct.
        let rc = unsafe {
            sys::ghostty_selection_gesture_event(self.gesture, term.term, event, &mut out)
        };
        (rc == sys::GHOSTTY_SUCCESS).then_some(out)
    }

    /// A button press at `time_ns` (any monotonic clock). Returns whether
    /// the active selection changed: a single click clears it, a double
    /// click selects the word, a triple click the line (or the output).
    pub fn press(&mut self, term: &Terminal, at: Pointer, time_ns: u64, press: Press) -> bool {
        let Some(grid_ref) = term.viewport_ref(at.col, at.row) else {
            return false;
        };
        if press.extend
            && let Some(changed) = self.extend_to(term, &grid_ref)
        {
            return changed;
        }
        self.extending = None;
        self.sync_boundaries(term);
        let behaviors = sys::GhosttySelectionGestureBehaviors {
            single_click: sys::GHOSTTY_SELECTION_GESTURE_BEHAVIOR_CELL,
            double_click: sys::GHOSTTY_SELECTION_GESTURE_BEHAVIOR_WORD,
            triple_click: if press.triple_click_output {
                sys::GHOSTTY_SELECTION_GESTURE_BEHAVIOR_OUTPUT
            } else {
                sys::GHOSTTY_SELECTION_GESTURE_BEHAVIOR_LINE
            },
        };
        self.set_pointer(self.press, &grid_ref, at);
        // SAFETY: the options take a `uint64_t*` and a
        // `GhosttySelectionGestureBehaviors*`.
        unsafe {
            self.set(
                self.press,
                sys::GHOSTTY_SELECTION_GESTURE_EVENT_OPT_TIME_NS,
                &time_ns,
            );
            self.set(
                self.press,
                sys::GHOSTTY_SELECTION_GESTURE_EVENT_OPT_BEHAVIORS,
                &behaviors,
            );
        }
        let selection = self.apply(term, self.press);
        if selection.is_none() && self.click_count(term) != 1 {
            return false;
        }
        term.replace_selection(selection.as_ref())
    }

    /// Shift-click: keep the end of the active selection farther from the
    /// click and move the other to the click. `None` without a selection.
    fn extend_to(&mut self, term: &Terminal, click: &sys::GhosttyGridRef) -> Option<bool> {
        let ordered = term.ordered(&term.active_selection()?)?;
        let screen = sys::GHOSTTY_POINT_TAG_SCREEN;
        let key = |p: (u16, usize)| (p.1, p.0);
        let click_at = key(term.point_of(click, screen)?);
        let start_at = key(term.point_of(&ordered.start, screen)?);
        let anchor = if click_at < start_at {
            ordered.end
        } else {
            ordered.start
        };
        // SAFETY: live handles; resetting drops the stale click sequence.
        unsafe { sys::ghostty_selection_gesture_reset(self.gesture, term.term) };
        self.extending = Some(Extending {
            autoscroll: Autoscroll::None,
        });
        let next = sys::GhosttySelection {
            start: anchor,
            end: *click,
            ..Default::default()
        };
        Some(term.replace_selection(Some(&next)))
    }

    /// Re-aim an extend-drag at a fresh ref, anchored on the tracked
    /// selection's start.
    fn extend_drag(&self, term: &Terminal, to: &sys::GhosttyGridRef, rectangle: bool) -> bool {
        let Some(current) = term.active_selection() else {
            return false;
        };
        let next = sys::GhosttySelection {
            start: current.start,
            end: *to,
            rectangle,
            ..Default::default()
        };
        term.replace_selection(Some(&next))
    }

    /// Pointer motion with the button down. `rectangle` asks for a block
    /// selection (option-drag).
    pub fn drag(&mut self, term: &Terminal, at: Pointer, rectangle: bool) -> bool {
        let Some(grid_ref) = term.viewport_ref(at.col, at.row) else {
            return false;
        };
        if let Some(extending) = self.extending.as_mut() {
            extending.autoscroll = edge_autoscroll(at.y, self.geometry.screen_height);
            return self.extend_drag(term, &grid_ref, rectangle);
        }
        if self.click_count(term) == 0 {
            return false;
        }
        self.sync_boundaries(term);
        self.set_pointer(self.drag, &grid_ref, at);
        // SAFETY: the option takes a `bool*`.
        unsafe {
            self.set(
                self.drag,
                sys::GHOSTTY_SELECTION_GESTURE_EVENT_OPT_RECTANGLE,
                &rectangle,
            )
        };
        let selection = self.apply(term, self.drag);
        term.replace_selection(selection.as_ref())
    }

    /// A timer tick while [`Self::autoscroll`] is not `None`: scrolls the
    /// viewport one row and extends the selection to the cell now under the
    /// pointer.
    pub fn autoscroll_tick(&mut self, term: &Terminal, at: Pointer, rectangle: bool) -> bool {
        if let Some(extending) = self.extending {
            let delta = match extending.autoscroll {
                Autoscroll::None => return false,
                Autoscroll::Up => -1,
                Autoscroll::Down => 1,
            };
            term.scroll_delta(delta);
            let Some(grid_ref) = term.viewport_ref(at.col, at.row) else {
                return false;
            };
            return self.extend_drag(term, &grid_ref, rectangle);
        }
        if self.click_count(term) == 0 || self.autoscroll(term) == Autoscroll::None {
            return false;
        }
        self.sync_boundaries(term);
        let viewport = sys::GhosttyPointCoordinate {
            x: at.col,
            y: at.row as u32,
        };
        let position = sys::GhosttySurfacePosition { x: at.x, y: at.y };
        // SAFETY: the options take a `GhosttyPointCoordinate*`, a
        // `GhosttySurfacePosition*` and a `bool*`.
        unsafe {
            self.set(
                self.tick,
                sys::GHOSTTY_SELECTION_GESTURE_EVENT_OPT_VIEWPORT,
                &viewport,
            );
            self.set(
                self.tick,
                sys::GHOSTTY_SELECTION_GESTURE_EVENT_OPT_POSITION,
                &position,
            );
            self.set(
                self.tick,
                sys::GHOSTTY_SELECTION_GESTURE_EVENT_OPT_RECTANGLE,
                &rectangle,
            );
        }
        let selection = self.apply(term, self.tick);
        if self.click_count(term) == 0 {
            // The anchor's screen went away: the gesture ended itself.
            return false;
        }
        term.replace_selection(selection.as_ref())
    }

    /// The button came up; `at` is the cell under it, `None` when the
    /// pointer is off the grid. The selection is left as is.
    pub fn release(&mut self, term: &Terminal, at: Option<(u16, u16)>) {
        if let Some(extending) = self.extending.as_mut() {
            extending.autoscroll = Autoscroll::None;
            return;
        }
        let grid_ref = at.and_then(|(col, row)| term.viewport_ref(col, row));
        match grid_ref.as_ref() {
            // SAFETY: the option takes a `GhosttyGridRef*` (fresh, copied).
            Some(r) => unsafe {
                self.set(
                    self.release,
                    sys::GHOSTTY_SELECTION_GESTURE_EVENT_OPT_REF,
                    r,
                )
            },
            // SAFETY: NULL clears the option.
            None => unsafe {
                let _ = sys::ghostty_selection_gesture_event_set(
                    self.release,
                    sys::GHOSTTY_SELECTION_GESTURE_EVENT_OPT_REF,
                    std::ptr::null(),
                );
            },
        }
        let _ = self.apply(term, self.release);
    }

    /// A force click while pressed: selects the word under the press and
    /// ends the gesture.
    pub fn deep_press(&mut self, term: &Terminal) -> bool {
        if self.extending.is_some() {
            return false;
        }
        self.sync_boundaries(term);
        match self.apply(term, self.deep) {
            Some(selection) => term.replace_selection(Some(&selection)),
            None => false,
        }
    }

    /// Abandon the gesture (mouse reporting took over, capture lost) and
    /// release its anchor; the next press is a fresh single click.
    pub fn reset(&mut self, term: &Terminal) {
        self.extending = None;
        // SAFETY: live handles.
        unsafe { sys::ghostty_selection_gesture_reset(self.gesture, term.term) };
    }

    /// 1–3 while a click sequence is live, 0 otherwise.
    pub fn click_count(&self, term: &Terminal) -> u8 {
        if self.extending.is_some() {
            return 1;
        }
        let mut count: u8 = 0;
        // SAFETY: the data kind writes a `uint8_t`.
        unsafe {
            self.get(
                term,
                sys::GHOSTTY_SELECTION_GESTURE_DATA_CLICK_COUNT,
                &mut count,
            )
        };
        count
    }

    /// Whether the press moved off its cell (or selected): a release should
    /// then not act as a click (opening a link).
    pub fn dragged(&self, term: &Terminal) -> bool {
        if self.extending.is_some() {
            return true;
        }
        let mut dragged = false;
        // SAFETY: the data kind writes a `bool`.
        unsafe {
            self.get(
                term,
                sys::GHOSTTY_SELECTION_GESTURE_DATA_DRAGGED,
                &mut dragged,
            )
        };
        dragged
    }

    pub fn autoscroll(&self, term: &Terminal) -> Autoscroll {
        if let Some(extending) = self.extending {
            return extending.autoscroll;
        }
        let mut raw = sys::GHOSTTY_SELECTION_GESTURE_AUTOSCROLL_NONE;
        // SAFETY: the data kind writes a `GhosttySelectionGestureAutoscroll`.
        unsafe {
            self.get(
                term,
                sys::GHOSTTY_SELECTION_GESTURE_DATA_AUTOSCROLL,
                &mut raw,
            )
        };
        match raw {
            sys::GHOSTTY_SELECTION_GESTURE_AUTOSCROLL_UP => Autoscroll::Up,
            sys::GHOSTTY_SELECTION_GESTURE_AUTOSCROLL_DOWN => Autoscroll::Down,
            _ => Autoscroll::None,
        }
    }

    /// # Safety
    /// `T` must be the output type `data` documents.
    unsafe fn get<T>(&self, term: &Terminal, data: c_int, out: &mut T) -> bool {
        // SAFETY: live handles; the output type is the caller's contract.
        let rc = unsafe {
            sys::ghostty_selection_gesture_get(
                self.gesture,
                term.term,
                data,
                out as *mut T as *mut c_void,
            )
        };
        rc == sys::GHOSTTY_SUCCESS
    }
}

/// Matches the gesture machine's own edge test (a 1px buffer).
fn edge_autoscroll(y: f64, screen_height: u32) -> Autoscroll {
    if y <= 1.0 {
        Autoscroll::Up
    } else if y > screen_height as f64 - 1.0 {
        Autoscroll::Down
    } else {
        Autoscroll::None
    }
}

impl Drop for SelectionGesture {
    fn drop(&mut self) {
        // SAFETY: the handles are live (or NULL, a no-op) and never used
        // again. A NULL terminal frees without touching any terminal, so
        // the drop is safe while another thread holds it.
        unsafe {
            for event in [self.press, self.drag, self.release, self.tick, self.deep] {
                sys::ghostty_selection_gesture_event_free(event);
            }
            sys::ghostty_selection_gesture_free(self.gesture, std::ptr::null_mut());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::RenderState;

    const MS: u64 = 1_000_000;

    fn geometry() -> GestureGeometry {
        GestureGeometry {
            columns: 40,
            cell_width: 10,
            padding_left: 0,
            screen_height: 80,
        }
    }

    /// Left of the cell's 60% selection threshold, where presses land.
    fn at(col: u16, row: u16) -> Pointer {
        Pointer {
            col,
            row,
            x: col as f64 * 10.0 + 2.0,
            y: row as f64 * 20.0 + 10.0,
        }
    }

    /// Right of the threshold: a drag here takes in the cell.
    fn over(col: u16, row: u16) -> Pointer {
        Pointer {
            x: col as f64 * 10.0 + 8.0,
            ..at(col, row)
        }
    }

    #[test]
    fn words_keep_urls_and_paths_whole() {
        let term = Terminal::new(60, 4).unwrap();
        term.write(b"see https://example.com/a?b=1 and ~/src/zu/lib.rs:12:5 (ok)");
        assert!(term.select_word_at(8, 0));
        assert_eq!(
            term.selected_text().as_deref(),
            Some("https://example.com/a?b=1")
        );
        assert!(term.select_word_at(40, 0));
        assert_eq!(
            term.selected_text().as_deref(),
            Some("~/src/zu/lib.rs:12:5")
        );
        assert!(term.select_word_at(57, 0));
        assert_eq!(term.selected_text().as_deref(), Some("ok"));

        let mut term = term;
        term.set_word_boundaries(Some(&[' ', ':', '/']));
        assert!(term.select_word_at(14, 0));
        assert_eq!(term.selected_text().as_deref(), Some("example.com"));
    }

    #[test]
    fn lines_output_all_and_clear() {
        let term = Terminal::new(20, 6).unwrap();
        term.write(b"\x1b]133;A\x07$ ls\r\n\x1b]133;C\x07alpha\r\nbeta\r\n\x1b]133;D;0\x07");
        term.write(b"\x1b]133;A\x07$ ");
        assert!(!term.has_selection());
        assert!(term.select_line_at(2, 1));
        assert_eq!(term.selected_text().as_deref(), Some("alpha"));
        assert!(term.select_output_at(0, 2));
        assert_eq!(term.selected_text().as_deref(), Some("alpha\nbeta"));
        assert!(term.select_all());
        let all = term.selected_text().unwrap();
        assert!(all.starts_with("$ ls") && all.contains("beta"), "{all:?}");
        term.clear_selection();
        assert!(!term.has_selection());
        assert_eq!(term.selected_text(), None);
        assert!(!term.select_word_at(10, 4), "a blank cell has no word");
    }

    #[test]
    fn adjust_moves_the_moving_end() {
        let term = Terminal::new(20, 4).unwrap();
        term.write(b"hello world\r\nnext line");
        assert!(term.select_word_at(0, 0));
        assert!(term.adjust_selection(Adjust::Right));
        assert!(term.adjust_selection(Adjust::Right));
        assert_eq!(term.selected_text().as_deref(), Some("hello w"));
        assert!(term.adjust_selection(Adjust::LineEnd));
        assert_eq!(term.selected_text().as_deref(), Some("hello world"));
        assert!(term.adjust_selection(Adjust::Down));
        assert!(
            term.selected_text()
                .unwrap()
                .starts_with("hello world\nnext")
        );
        term.clear_selection();
        assert!(!term.adjust_selection(Adjust::Left));
    }

    #[test]
    fn the_terminal_tracks_its_selection_across_output_and_pruning() {
        let term = Terminal::new(20, 4).unwrap();
        term.set_scrollback_lines(10);
        term.write(b"alpha beta gamma\r\n");
        assert!(term.select_word_at(7, 0));
        for i in 0..6 {
            term.write(format!("filler {i}\r\n").as_bytes());
        }
        assert!(term.scrollback_rows() > 0, "the word scrolled into history");
        assert_eq!(term.selected_text().as_deref(), Some("beta"));

        let mut rs = RenderState::new().unwrap();
        term.scroll_top();
        let frame = rs.snapshot(&term).unwrap();
        assert_eq!(frame.selection[0], Some((6, 9)));
        assert!(frame.selection[1..].iter().all(Option::is_none));
        term.scroll_bottom();
        let frame = rs.snapshot(&term).unwrap();
        assert!(frame.selection.iter().all(Option::is_none), "off screen");

        for i in 0..5000 {
            term.write(format!("prune {i}\r\n").as_bytes());
        }
        assert!(term.scrollback_rows() < 5000, "history was pruned");
        assert_eq!(term.selected_text(), None, "pruned rows drop the selection");
        assert!(!term.has_selection());
    }

    #[test]
    fn single_click_drag_selects_cells_and_clears_on_click() {
        let term = Terminal::new(40, 4).unwrap();
        term.write(b"hello world\r\nsecond line");
        let mut gesture = SelectionGesture::new().unwrap();
        gesture.set_geometry(geometry());

        assert!(!gesture.press(&term, at(0, 0), 0, Press::default()));
        assert_eq!(gesture.click_count(&term), 1);
        assert!(gesture.drag(&term, over(4, 0), false));
        assert_eq!(term.selected_text().as_deref(), Some("hello"));
        assert!(gesture.dragged(&term));
        assert!(gesture.drag(&term, over(2, 1), false));
        assert_eq!(term.selected_text().as_deref(), Some("hello world\nsec"));
        assert!(
            !gesture.drag(&term, over(2, 1), false),
            "same cell, no change"
        );
        gesture.release(&term, Some((2, 1)));
        assert_eq!(gesture.autoscroll(&term), Autoscroll::None);

        assert!(gesture.press(&term, at(20, 3), 10_000 * MS, Press::default()));
        assert!(!term.has_selection(), "a fresh click clears");
        gesture.release(&term, Some((20, 3)));
        assert!(!gesture.dragged(&term));
    }

    #[test]
    fn repeat_clicks_select_words_then_lines_or_output() {
        let term = Terminal::new(40, 6).unwrap();
        term.write(b"\x1b]133;A\x07$ make\r\n\x1b]133;C\x07cc ~/zu/a.c\r\nld out\r\n");
        term.write(b"\x1b]133;D;0\x07\x1b]133;A\x07$ ");
        let mut gesture = SelectionGesture::new().unwrap();
        gesture.set_geometry(geometry());
        let click = |g: &mut SelectionGesture, t, press| {
            let changed = g.press(&term, at(6, 1), t, press);
            g.release(&term, Some((6, 1)));
            changed
        };

        click(&mut gesture, 0, Press::default());
        assert!(click(&mut gesture, 100 * MS, Press::default()));
        assert_eq!(gesture.click_count(&term), 2);
        assert_eq!(term.selected_text().as_deref(), Some("~/zu/a.c"));
        assert!(click(&mut gesture, 200 * MS, Press::default()));
        assert_eq!(term.selected_text().as_deref(), Some("cc ~/zu/a.c"));

        let output = Press {
            triple_click_output: true,
            ..Press::default()
        };
        click(&mut gesture, 5_000 * MS, output);
        click(&mut gesture, 5_100 * MS, output);
        assert!(click(&mut gesture, 5_200 * MS, output));
        assert_eq!(term.selected_text().as_deref(), Some("cc ~/zu/a.c\nld out"));

        click(&mut gesture, 9_000 * MS, Press::default());
        click(&mut gesture, 9_900 * MS, Press::default());
        assert_eq!(gesture.click_count(&term), 1, "too slow for a double click");
        assert!(!term.has_selection());
    }

    #[test]
    fn shift_click_extends_from_the_far_end() {
        let term = Terminal::new(40, 4).unwrap();
        term.write(b"one two three four");
        let mut gesture = SelectionGesture::new().unwrap();
        gesture.set_geometry(geometry());
        assert!(term.select_word_at(8, 0));
        assert_eq!(term.selected_text().as_deref(), Some("three"));

        let extend = Press {
            extend: true,
            ..Press::default()
        };
        assert!(gesture.press(&term, at(16, 0), 0, extend));
        assert_eq!(term.selected_text().as_deref(), Some("three fou"));
        assert!(gesture.press(&term, at(4, 0), 10 * MS, extend));
        assert_eq!(term.selected_text().as_deref(), Some("two three fou"));
        assert!(gesture.drag(&term, at(0, 0), false));
        assert_eq!(term.selected_text().as_deref(), Some("one two three fou"));
        assert!(gesture.dragged(&term));
        gesture.release(&term, Some((0, 0)));

        term.clear_selection();
        assert!(!gesture.press(&term, at(4, 0), 20 * MS, extend));
        assert_eq!(gesture.click_count(&term), 1, "no selection: a plain click");
    }

    #[test]
    fn dragging_past_the_edge_autoscrolls() {
        let term = Terminal::new(40, 4).unwrap();
        term.set_scrollback_lines(100);
        for i in 0..20 {
            term.write(format!("row {i:02}\r\n").as_bytes());
        }
        term.write(b"last");
        let mut gesture = SelectionGesture::new().unwrap();
        gesture.set_geometry(geometry());
        gesture.press(&term, at(3, 2), 0, Press::default());
        let top = Pointer { y: 0.0, ..at(0, 0) };
        gesture.drag(&term, top, false);
        assert_eq!(gesture.autoscroll(&term), Autoscroll::Up);
        let offset = term.scrollbar().offset;
        assert!(gesture.autoscroll_tick(&term, top, false));
        assert_eq!(term.scrollbar().offset, offset - 1);
        assert!(term.selected_text().unwrap().starts_with("row 16"));
        gesture.release(&term, None);
        assert_eq!(gesture.autoscroll(&term), Autoscroll::None);
        assert!(!gesture.autoscroll_tick(&term, top, false));
    }

    #[test]
    fn deep_press_selects_the_pressed_word() {
        let term = Terminal::new(40, 4).unwrap();
        term.write(b"hello world");
        let mut gesture = SelectionGesture::new().unwrap();
        gesture.set_geometry(geometry());
        gesture.press(&term, at(7, 0), 0, Press::default());
        assert!(gesture.deep_press(&term));
        assert_eq!(term.selected_text().as_deref(), Some("world"));
        assert_eq!(gesture.click_count(&term), 0, "the deep press ends it");
        assert!(!gesture.drag(&term, at(1, 0), false));
    }

    #[test]
    fn a_gesture_may_outlive_its_terminal() {
        let mut gesture = SelectionGesture::new().unwrap();
        {
            let term = Terminal::new(10, 2).unwrap();
            term.write(b"abc");
            gesture.press(&term, at(1, 0), 0, Press::default());
        }
        drop(gesture);
    }
}
