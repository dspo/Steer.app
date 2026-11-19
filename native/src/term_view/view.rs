//! The AppKit view: draws a terminal session and is its keyboard, mouse and
//! input method.
//!
//! The view owns only what drawing and input need (fonts, metrics, the
//! encoders, the selection gesture, the composition); the emulator is the
//! session's (`crate::session`), taken under its lock for as long as one
//! call needs it. AppKit calls back into the view re-entrantly
//! (`interpretKeyEvents:` calls `insertText:`, `makeFirstResponder:` calls
//! `becomeFirstResponder`), so no borrow of [`State`] is held across a call
//! into AppKit.
//!
//! The pointer is the program's while it tracks the mouse (Shift takes it
//! back for selecting); otherwise it selects, through the terminal's own
//! selection, which stays on its text as output scrolls.

use std::{
    cell::RefCell,
    collections::HashMap,
    ffi::c_void,
    ptr::NonNull,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};

use dispatch2::{DispatchQueue, DispatchTime, MainThreadBound};
use nsh_core::JsonValue;
use nsh_platform_macos::{ComponentContext, NativeComponent};
use objc2::{
    AnyThread, ClassType, DefinedClass, MainThreadMarker, MainThreadOnly, Message, define_class,
    msg_send,
    rc::{Retained, Weak},
    runtime::{AnyObject, NSObjectProtocol, ProtocolObject, Sel},
    sel,
};
use objc2_app_kit::{
    NSAccessibilityTextAreaRole, NSCursor, NSDragOperation, NSDraggingInfo, NSEvent,
    NSEventModifierFlags, NSGraphicsContext, NSMenu, NSMenuItem, NSPasteboardTypeFileURL,
    NSPasteboardTypeString, NSResponder, NSTextInputClient, NSTrackingArea, NSTrackingAreaOptions,
    NSView,
};
use objc2_core_foundation::CFRetained;
use objc2_core_graphics::{
    CGBitmapInfo, CGColorRenderingIntent, CGColorSpace, CGDataProvider, CGImage, CGImageAlphaInfo,
    kCGColorSpaceSRGB,
};
use objc2_foundation::{
    NSArray, NSAttributedString, NSAttributedStringKey, NSNotFound, NSObject, NSPoint, NSRange,
    NSRect, NSSize, NSString, NSUInteger, NSURL,
};
use serde_json::json;
use zu_ghostty::{
    Autoscroll, CursorStyle, GestureGeometry, Image, KeyAction, KeyEncoder, MouseAction,
    MouseButton, MouseEncoder, MouseGeometry, Placement, Pointer, Press, RenderState,
    SelectionGesture, focus_encode,
    sys::{GHOSTTY_CELL_WIDE_SPACER_TAIL, GHOSTTY_TERMINAL_SCREEN_PRIMARY},
};

use super::{
    clock::Clock,
    escape, ime,
    keys::{self, Mods},
    links,
    render::{self, Fonts, Overlay, Palette, Rgba, Scrollbar},
    theme,
};
use crate::session::{self, Emulator, Shared};

/// How often a drag past the view's edge scrolls the selection along.
const AUTOSCROLL: Duration = Duration::from_millis(50);

/// The context menu's titles, in the app's language.
#[derive(Debug, Clone)]
struct MenuTitles {
    copy: String,
    paste: String,
    select_all: String,
    find: String,
    clear: String,
}

impl Default for MenuTitles {
    fn default() -> Self {
        Self {
            copy: "Copy".to_owned(),
            paste: "Paste".to_owned(),
            select_all: "Select All".to_owned(),
            find: "Find…".to_owned(),
            clear: "Clear".to_owned(),
        }
    }
}

/// The link under a Cmd-hover: its viewport row, its columns (half open)
/// and where it goes.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Hover {
    row: u16,
    start: u16,
    end: u16,
    url: String,
}

pub(crate) struct State {
    context: ComponentContext,
    session: Option<Arc<Shared>>,
    /// The attachment that makes the session wake this view.
    attachment: Option<u64>,
    render: RenderState,
    keys: KeyEncoder,
    mouse: MouseEncoder,
    gesture: SelectionGesture,
    fonts: Fonts,
    family: String,
    font_size: f64,
    line_height: f64,
    scale: f64,
    metrics: super::grid::Metrics,
    /// The grid the view last gave its session; `(0, 0)` until it is laid
    /// out with one.
    cols: u16,
    rows: u16,
    palette: Palette,
    cursor_style: CursorStyle,
    cursor_blink: bool,
    /// Option types Meta (`ESC` before the key) instead of the layout's
    /// characters (`å`, `@`).
    option_as_meta: bool,
    menu: MenuTitles,
    focused: bool,
    /// The input method's composition (marked text).
    marked: String,
    /// Text `insertText:` gives during `keyDown:`; `None` outside one.
    typed: Option<Vec<String>>,
    /// Wheel points not yet a whole line.
    wheel: f64,
    /// A `focus` that came before the view had a window.
    wants_focus: bool,
    clock: Clock,
    /// The session's bell count the view last drew; `None` until it drew
    /// one (attaching does not ring).
    bells: Option<u64>,
    /// The viewport's first row and the history's extent, as last drawn.
    bar: zu_ghostty::sys::GhosttyTerminalScrollbar,
    /// While the scrollbar's thumb is dragged: where in it the pointer
    /// grabbed it, in points from its top.
    bar_grab: Option<f64>,
    /// The redraw already scheduled for the clock.
    tick: Option<Instant>,
    /// A press the program took (it tracks the mouse): its button, until
    /// it is let go.
    reported: Option<MouseButton>,
    /// The pointer of a selecting drag, kept for autoscroll ticks.
    selecting: Option<NSPoint>,
    hover: Option<Hover>,
    /// Uploaded bitmaps by image identity, kept until they leave a frame.
    images: HashMap<(u32, u64), CFRetained<CGImage>>,
    /// Each viewport row's graphemes by column, as last drawn: where plain
    /// URLs are looked for.
    rows_text: Vec<Vec<(u16, String)>>,
}

impl State {
    fn new(context: ComponentContext) -> Self {
        let (family, font_size, line_height, scale) = ("Menlo".to_owned(), 13.0, 18.0, 2.0);
        let fonts = Fonts::new(&family, font_size);
        let metrics = fonts.metrics(line_height, scale);
        Self {
            context,
            session: None,
            attachment: None,
            render: RenderState::new().expect("libghostty-vt makes a render state"),
            keys: KeyEncoder::new().expect("libghostty-vt makes a key encoder"),
            mouse: MouseEncoder::new().expect("libghostty-vt makes a mouse encoder"),
            gesture: SelectionGesture::new().expect("libghostty-vt makes a selection gesture"),
            fonts,
            family,
            font_size,
            line_height,
            scale,
            metrics,
            cols: 0,
            rows: 0,
            palette: Palette::default(),
            cursor_style: CursorStyle::Block,
            cursor_blink: true,
            option_as_meta: false,
            menu: MenuTitles::default(),
            focused: false,
            marked: String::new(),
            typed: None,
            wheel: 0.0,
            wants_focus: false,
            clock: Clock::new(Instant::now()),
            bells: None,
            bar: Default::default(),
            bar_grab: None,
            tick: None,
            reported: None,
            selecting: None,
            hover: None,
            images: HashMap::new(),
            rows_text: Vec::new(),
        }
    }

    /// The emulator, while the view draws a session.
    fn with<R>(&self, f: impl FnOnce(&mut Emulator) -> R) -> Option<R> {
        let session = self.session.as_ref()?;
        let mut emulator = session.lock();
        Some(f(&mut emulator))
    }

    fn send(&self, bytes: &[u8]) {
        if let Some(session) = &self.session
            && !bytes.is_empty()
        {
            session.send(bytes);
        }
    }

    /// The selection for the clipboard: the app's (`Clipboard` of `nsh`,
    /// under its capability).
    fn copy_selection(&self) {
        if let Some(text) = self.with(|e| e.term.selected_text()).flatten()
            && !text.is_empty()
        {
            self.context.emit("copy", json!({ "text": text }));
        }
    }

    /// A key event as the program asked for it: `text` it typed, or the
    /// key's own sequence (arrows, Return, control keys, kitty reports).
    fn key(
        &mut self,
        action: KeyAction,
        code: u16,
        mods: u16,
        text: Option<&str>,
        unshifted: Option<u32>,
    ) {
        let Some(session) = self.session.clone() else {
            return;
        };
        let bytes = {
            let emulator = session.lock();
            self.keys.sync_from_terminal(&emulator.term);
            self.keys
                .encode(action, keys::key(code), mods, text, unshifted)
        };
        match (bytes.is_empty(), text) {
            (false, _) => session.send(&bytes),
            (true, Some(text)) if action != KeyAction::Release => session.send(text.as_bytes()),
            _ => return,
        }
        if action != KeyAction::Release {
            self.typed_to_program();
        }
    }

    /// What the user sends goes to the live screen, past any selection.
    fn typed_to_program(&mut self) {
        self.clock.restart_blink(Instant::now());
        self.with(|e| {
            e.term.scroll_bottom();
            e.term.clear_selection();
        });
    }

    fn refont(&mut self) {
        self.fonts = Fonts::new(&self.family, self.font_size);
        self.metrics = self.fonts.metrics(self.line_height, self.scale);
        (self.cols, self.rows) = (0, 0);
    }

    /// Uploads new image generations and drops those absent from this frame.
    fn upload_images<'a>(
        images: &'a mut HashMap<(u32, u64), CFRetained<CGImage>>,
        session: &Arc<Shared>,
        placements: &[Placement],
    ) -> Vec<(Placement, &'a CGImage)> {
        let mut uploaded = HashMap::new();
        for p in placements {
            let key = (p.image_id, p.generation);
            if images.contains_key(&key) {
                continue;
            }
            let image = if let Some(image) = uploaded.get(&p.image_id) {
                image
            } else {
                let image = {
                    let emulator = session.lock();
                    emulator.term.kitty_image(p.image_id)
                };
                uploaded.insert(p.image_id, image);
                uploaded.get(&p.image_id).unwrap()
            };
            if let Some(cg) = image.as_ref().and_then(upload_image) {
                images.insert(key, cg);
            }
        }
        images.retain(|key, _| {
            placements
                .iter()
                .any(|p| (p.image_id, p.generation) == *key)
        });
        placements
            .iter()
            .filter_map(|p| {
                let cg = images.get(&(p.image_id, p.generation))?;
                Some((*p, cg.as_ref()))
            })
            .collect()
    }

    /// One cell in device pixels, whole: the unit the encoders and the
    /// gesture count in.
    fn cell_px(&self) -> (u32, u32) {
        let px = |v: f64| (v * self.scale).round().max(1.0) as u32;
        (px(self.metrics.cell_width), px(self.metrics.line_height))
    }

    /// Gives the session the grid `size` holds, when it changed.
    fn layout(&mut self, size: NSSize) {
        // A sheet laid out at no size (hidden, not yet placed) keeps the
        // grid the program has.
        if size.width < self.metrics.cell_width || size.height < self.metrics.line_height {
            return;
        }
        let Some(session) = self.session.clone() else {
            return;
        };
        let (cols, rows) = self.metrics.grid(size.width, size.height);
        if (cols, rows) == (self.cols, self.rows) {
            return;
        }
        let (cw, ch) = self.cell_px();
        session.resize(cols, rows, (cw, ch));
        self.cols = cols;
        self.rows = rows;
        self.mouse.set_geometry(MouseGeometry {
            screen_width: cols as u32 * cw,
            screen_height: rows as u32 * ch,
            cell_width: cw,
            cell_height: ch,
            ..Default::default()
        });
        self.gesture.set_geometry(GestureGeometry {
            columns: cols as u32,
            cell_width: cw,
            padding_left: 0,
            screen_height: rows as u32 * ch,
        });
        self.gesture.set_repeat_distance(Some(cw as f64));
    }

    /// The session's colors and cursor follow the view's.
    fn apply_theme(&self) {
        let Some(session) = &self.session else {
            return;
        };
        let dark = theme::is_dark(self.palette.background);
        session.set_dark(dark);
        let mut emulator = session.lock();
        let term = &mut emulator.term;
        term.set_default_colors(self.palette.foreground.rgb(), self.palette.background.rgb());
        term.set_palette(&theme::palette(self.palette.background));
        term.set_default_cursor_style(self.cursor_style, self.cursor_blink);
    }

    /// The viewport cell under `p` (view points), clamped into the grid,
    /// with its position in the gesture's pixels.
    fn pointer(&self, p: NSPoint) -> Pointer {
        let (cw, ch) = self.cell_px();
        let cols = self.cols.max(1);
        let rows = self.rows.max(1);
        let fx = p.x / self.metrics.cell_width;
        let fy = p.y / self.metrics.line_height;
        Pointer {
            col: fx.floor().clamp(0.0, (cols - 1) as f64) as u16,
            row: fy.floor().clamp(0.0, (rows - 1) as f64) as u16,
            x: fx * cw as f64,
            y: fy * ch as f64,
        }
    }

    /// The program's report of a pointer event, when it tracks the mouse
    /// (and Shift does not take the pointer back).
    fn report(
        &mut self,
        action: MouseAction,
        button: Option<MouseButton>,
        mods: Mods,
        p: NSPoint,
    ) -> bool {
        let Some(session) = self.session.clone() else {
            return false;
        };
        if mods.shift || !session.lock().term.mouse_tracking() {
            return false;
        }
        let at = self.pointer(p);
        let (cw, ch) = self.cell_px();
        let x = (at.x as f32).clamp(0.0, (self.cols as u32 * cw).saturating_sub(1) as f32);
        let y = (at.y as f32).clamp(0.0, (self.rows as u32 * ch).saturating_sub(1) as f32);
        let bytes = {
            let emulator = session.lock();
            self.mouse.sync_from_terminal(&emulator.term);
            self.mouse.encode(action, button, mods.bits(), x, y)
        };
        session.send(&bytes);
        true
    }

    /// The link at viewport cell (`col`, `row`): the program's (OSC 8),
    /// else a URL written in the row.
    fn link_at(&self, col: u16, row: u16) -> Option<Hover> {
        let uri = self.with(|e| e.term.hyperlink_at(col, row)).flatten();
        if let Some(uri) = uri {
            let same = |c: u16| {
                self.with(|e| e.term.hyperlink_at(c, row))
                    .flatten()
                    .as_deref()
                    == Some(uri.as_str())
            };
            let mut start = col;
            while start > 0 && same(start - 1) {
                start -= 1;
            }
            let mut end = col + 1;
            while end < self.cols && same(end) {
                end += 1;
            }
            return Some(Hover {
                row,
                start,
                end,
                url: uri,
            });
        }
        let cells = self.rows_text.get(row as usize)?;
        let cells: Vec<(u16, &str)> = cells.iter().map(|(c, g)| (*c, g.as_str())).collect();
        let found = links::url_at(&cells, col)?;
        Some(Hover {
            row,
            start: found.start,
            end: found.end,
            url: found.url,
        })
    }

    /// Cmd-hover: the link under `p` while Cmd is held.
    fn update_hover(&mut self, p: Option<NSPoint>, cmd: bool) -> bool {
        let next = match p {
            Some(p) if cmd => {
                let at = self.pointer(p);
                self.link_at(at.col, at.row)
            }
            _ => None,
        };
        let changed = next != self.hover;
        self.hover = next;
        changed
    }

    /// Erases the screen and the history and asks the shell for its prompt
    /// again (Cmd+K); a full-screen program's screen is its own.
    fn clear(&mut self) {
        let primary = self
            .with(|e| {
                if e.term.active_screen() != GHOSTTY_TERMINAL_SCREEN_PRIMARY {
                    return false;
                }
                e.term.write(b"\x1b[H\x1b[2J\x1b[3J");
                true
            })
            .unwrap_or(false);
        if primary {
            self.send(b"\x0c");
        }
    }

    /// The cursor's cell in the viewport, `None` while it is scrolled away.
    fn cursor_cell(&self) -> Option<(u16, u16)> {
        self.with(|e| {
            let term = &e.term;
            let bar = term.scrollbar();
            let (x, y) = term.cursor_position();
            let absolute = term.total_rows().saturating_sub(bar.len as usize) + y as usize;
            absolute
                .checked_sub(bar.offset as usize)
                .filter(|row| *row < bar.len as usize)
                .map(|row| (x.min(self.cols.saturating_sub(1)), row as u16))
        })
        .flatten()
    }
}

fn mods_of(flags: NSEventModifierFlags) -> Mods {
    Mods {
        shift: flags.contains(NSEventModifierFlags::Shift),
        ctrl: flags.contains(NSEventModifierFlags::Control),
        alt: flags.contains(NSEventModifierFlags::Option),
        cmd: flags.contains(NSEventModifierFlags::Command),
    }
}

/// The text of what `insertText:` / `setMarkedText:` hand over: an
/// `NSString` or an `NSAttributedString`.
fn string_of(object: &AnyObject) -> String {
    if let Some(attributed) = object.downcast_ref::<NSAttributedString>() {
        return attributed.string().to_string();
    }
    object
        .downcast_ref::<NSString>()
        .map(|s| s.to_string())
        .unwrap_or_default()
}

/// The scrollbar of a viewport, `None` when everything fits.
fn scrollbar(
    bar: zu_ghostty::sys::GhosttyTerminalScrollbar,
    alpha: f64,
    held: bool,
) -> Option<Scrollbar> {
    if bar.total <= bar.len || bar.total == 0 {
        return None;
    }
    let scrollable = (bar.total - bar.len) as f64;
    Some(Scrollbar {
        top: bar.offset as f64 / scrollable,
        size: bar.len as f64 / bar.total as f64,
        alpha,
        wide: held,
    })
}

/// A mouse button by AppKit's number (0 left, 1 right, 2 middle, 3 back, 4
/// forward).
fn button(number: isize) -> Option<MouseButton> {
    match number {
        0 => Some(MouseButton::Left),
        1 => Some(MouseButton::Right),
        2 => Some(MouseButton::Middle),
        3 => Some(MouseButton::Back),
        4 => Some(MouseButton::Forward),
        _ => None,
    }
}

/// The key's character with no modifiers, for kitty's alternate keys.
fn unshifted(event: &NSEvent) -> Option<u32> {
    event
        .charactersByApplyingModifiers(NSEventModifierFlags::empty())
        .and_then(|s| s.to_string().chars().next())
        .filter(|c| !c.is_control())
        .map(|c| c as u32)
}

/// The find's marks on the viewport (row, columns half open, current) and
/// whether it is still searching the history.
fn find_marks(
    emulator: &mut Emulator,
    top: usize,
    cols: u16,
) -> (Vec<(u16, u16, u16, bool)>, bool) {
    let Some(search) = emulator.term.active_search() else {
        return (Vec::new(), false);
    };
    let running = matches!(search.step(), Ok(zu_ghostty::SearchStatus::Running));
    let current = search.selected();
    let mut marks = Vec::new();
    for m in search.viewport_matches() {
        let is_current = current.is_some_and(|c| c.start == (m.start.0, m.start.1 + top));
        for row in m.start.1..=m.end.1 {
            let start = if row == m.start.1 { m.start.0 } else { 0 };
            let end = if row == m.end.1 { m.end.0 + 1 } else { cols };
            marks.push((row as u16, start, end, is_current));
        }
    }
    (marks, running)
}

define_class!(
    /// The terminal's surface: draws the grid and takes the keyboard, the
    /// mouse and the input method.
    #[unsafe(super(NSView, NSResponder, NSObject))]
    #[thread_kind = MainThreadOnly]
    #[ivars = RefCell<State>]
    #[name = "ZuTerminalView"]
    pub(crate) struct TerminalView;

    unsafe impl NSObjectProtocol for TerminalView {}

    impl TerminalView {
        #[unsafe(method(isFlipped))]
        fn is_flipped(&self) -> bool {
            true
        }

        #[unsafe(method(acceptsFirstResponder))]
        fn accepts_first_responder(&self) -> bool {
            true
        }

        #[unsafe(method(acceptsFirstMouse:))]
        fn accepts_first_mouse(&self, _event: Option<&NSEvent>) -> bool {
            true
        }

        #[unsafe(method(becomeFirstResponder))]
        fn become_first_responder(&self) -> bool {
            let mut s = self.ivars().borrow_mut();
            s.focused = true;
            s.clock.restart_blink(Instant::now());
            if s.with(|e| e.term.focus_reporting()).unwrap_or(false) {
                s.send(&focus_encode(true));
            }
            drop(s);
            self.setNeedsDisplay(true);
            true
        }

        #[unsafe(method(resignFirstResponder))]
        fn resign_first_responder(&self) -> bool {
            // A composition left open would type into the next responder.
            if let Some(input) = self.inputContext() {
                input.discardMarkedText();
            }
            let mut s = self.ivars().borrow_mut();
            s.focused = false;
            s.marked.clear();
            s.hover = None;
            if s.with(|e| e.term.focus_reporting()).unwrap_or(false) {
                s.send(&focus_encode(false));
            }
            drop(s);
            self.setNeedsDisplay(true);
            true
        }

        #[unsafe(method(setFrameSize:))]
        fn set_frame_size(&self, size: NSSize) {
            // SAFETY: NSView's own method.
            let _: () = unsafe { msg_send![super(self), setFrameSize: size] };
            self.relayout();
        }

        #[unsafe(method(viewDidMoveToWindow))]
        fn view_did_move_to_window(&self) {
            let wants = std::mem::take(&mut self.ivars().borrow_mut().wants_focus);
            if wants && let Some(window) = self.window() {
                window.makeFirstResponder(Some(self));
            }
        }

        #[unsafe(method(viewDidChangeBackingProperties))]
        fn view_did_change_backing_properties(&self) {
            let scale = self.window().map_or(2.0, |w| w.backingScaleFactor());
            {
                let mut s = self.ivars().borrow_mut();
                if s.scale == scale {
                    return;
                }
                s.scale = scale;
                s.refont();
            }
            self.relayout();
        }

        #[unsafe(method(resetCursorRects))]
        fn reset_cursor_rects(&self) {
            self.addCursorRect_cursor(self.bounds(), &NSCursor::IBeamCursor());
        }

        #[unsafe(method(drawRect:))]
        fn draw_rect(&self, _dirty: NSRect) {
            let Some(graphics) = NSGraphicsContext::currentContext() else {
                return;
            };
            let cg = graphics.CGContext();
            let bounds = self.bounds();
            let next = {
                let mut s = self.ivars().borrow_mut();
                let s = &mut *s;
                let background = s.palette.background;
                let color = objc2_core_graphics::CGColor::new_srgb(
                    background.r,
                    background.g,
                    background.b,
                    background.a,
                );
                objc2_core_graphics::CGContext::set_fill_color_with_color(Some(&cg), Some(&color));
                objc2_core_graphics::CGContext::fill_rect(Some(&cg), bounds);
                let Some(session) = s.session.clone() else {
                    return;
                };
                let (frame, bells, bar, marks, searching) = {
                    let mut emulator = session.lock();
                    let frame = s.render.snapshot(&emulator.term);
                    let bar = emulator.term.scrollbar();
                    let (marks, searching) =
                        find_marks(&mut emulator, bar.offset as usize, s.cols);
                    (frame, emulator.bells, bar, marks, searching)
                };
                let Ok(frame) = frame else {
                    return;
                };
                let now = Instant::now();
                if s.bells.is_some_and(|seen| seen != bells) {
                    s.clock.ring(now);
                }
                s.bells = Some(bells);
                // The viewport moved into the history: the bar shows where.
                let live = bar.offset + bar.len >= bar.total;
                if bar.offset != s.bar.offset && !live {
                    s.clock.show_bar(now);
                }
                s.bar = bar;
                s.rows_text = frame
                    .cells
                    .iter()
                    .map(|row| {
                        row.iter()
                            .enumerate()
                            .filter(|(_, c)| c.wide != GHOSTTY_CELL_WIDE_SPACER_TAIL)
                            .map(|(x, c)| {
                                let g = if c.text.is_empty() { " " } else { c.text.as_str() };
                                (x as u16, g.to_owned())
                            })
                            .collect()
                    })
                    .collect();
                let blinking = s.focused
                    && frame
                        .cursor
                        .as_ref()
                        .is_some_and(|c| c.visible && c.blinking);
                let overlay = Overlay {
                    focused: s.focused,
                    cursor_on: s.clock.cursor_on(now),
                    selected: frame
                        .selection
                        .iter()
                        .map(|r| r.map(|(a, b)| (a, b.saturating_add(1))))
                        .collect(),
                    preedit: s.marked.clone(),
                    links: s.hover.iter().map(|h| (h.row, h.start, h.end)).collect(),
                    marks,
                    flash: s.clock.flash(now),
                    scrollbar: scrollbar(bar, s.clock.bar(now), s.clock.bar_held()),
                };
                let images = State::upload_images(&mut s.images, &session, &frame.images);
                render::draw(
                    &cg,
                    (bounds.size.width, bounds.size.height),
                    &mut s.fonts,
                    s.metrics,
                    &s.palette,
                    &frame,
                    &overlay,
                    &images,
                );
                let next = s.clock.next(now, blinking);
                // A search still running over the history shows its matches
                // as it finds them.
                if searching {
                    let soon = now + Duration::from_millis(16);
                    Some(next.map_or(soon, |n| n.min(soon)))
                } else {
                    next
                }
            };
            if let Some(at) = next {
                self.redraw_at(at);
            }
        }

        #[unsafe(method(keyDown:))]
        fn key_down(&self, event: &NSEvent) {
            self.key(event);
        }

        /// Command keys reach the views before any `keyDown:`: the
        /// terminal's own (find, clear, prompts) while it has the keyboard.
        #[unsafe(method(performKeyEquivalent:))]
        fn perform_key_equivalent(&self, event: &NSEvent) -> bool {
            self.key_equivalent(event)
        }

        #[unsafe(method(keyUp:))]
        fn key_up(&self, event: &NSEvent) {
            let mods = mods_of(event.modifierFlags());
            let mut s = self.ivars().borrow_mut();
            if !s.marked.is_empty() || mods.cmd {
                return;
            }
            let unshifted = unshifted(event);
            s.key(KeyAction::Release, event.keyCode(), mods.bits(), None, unshifted);
        }

        #[unsafe(method(flagsChanged:))]
        fn flags_changed(&self, event: &NSEvent) {
            let mods = mods_of(event.modifierFlags());
            let code = event.keyCode();
            // Which modifier this key is, and whether it is now held.
            let held = match code {
                0x38 | 0x3C => Some(mods.shift),
                0x3B | 0x3E => Some(mods.ctrl),
                0x3A | 0x3D => Some(mods.alt),
                0x37 | 0x36 => Some(mods.cmd),
                _ => None,
            };
            let p = self.pointer_location();
            let mut s = self.ivars().borrow_mut();
            if let Some(held) = held
                && s.marked.is_empty()
            {
                let action = if held { KeyAction::Press } else { KeyAction::Release };
                s.key(action, code, mods.bits(), None, None);
            }
            let changed = s.update_hover(p, mods.cmd);
            drop(s);
            if changed {
                self.pointer_cursor(mods.cmd);
                self.setNeedsDisplay(true);
            }
        }

        #[unsafe(method(mouseDown:))]
        fn mouse_down(&self, event: &NSEvent) {
            if let Some(window) = self.window() {
                window.makeFirstResponder(Some(self));
            }
            if self.grab_bar(event) {
                return;
            }
            let p = self.local(event);
            let mods = mods_of(event.modifierFlags());
            let mut s = self.ivars().borrow_mut();
            if mods.cmd
                && let Some(link) = s.hover.clone()
            {
                s.context.emit("open", json!({ "url": link.url }));
                return;
            }
            if s.report(MouseAction::Press, Some(MouseButton::Left), mods, p) {
                s.reported = Some(MouseButton::Left);
                return;
            }
            let Some(session) = s.session.clone() else {
                return;
            };
            let at = s.pointer(p);
            let time = (event.timestamp() * 1e9) as u64;
            let press = Press {
                extend: mods.shift,
                triple_click_output: false,
            };
            {
                let emulator = session.lock();
                s.gesture.press(&emulator.term, at, time, press);
            }
            s.selecting = Some(p);
            drop(s);
            self.setNeedsDisplay(true);
        }

        #[unsafe(method(mouseDragged:))]
        fn mouse_dragged(&self, event: &NSEvent) {
            if self.drag_bar(event) {
                return;
            }
            let p = self.local(event);
            let mods = mods_of(event.modifierFlags());
            let mut s = self.ivars().borrow_mut();
            if s.reported.is_some() {
                s.report(MouseAction::Motion, None, mods, p);
                return;
            }
            if s.selecting.is_none() {
                return;
            }
            s.selecting = Some(p);
            let Some(session) = s.session.clone() else {
                return;
            };
            let at = s.pointer(p);
            let scrolling = {
                let emulator = session.lock();
                s.gesture.drag(&emulator.term, at, mods.alt);
                s.gesture.autoscroll(&emulator.term) != Autoscroll::None
            };
            drop(s);
            if scrolling {
                self.autoscroll_later();
            }
            self.setNeedsDisplay(true);
        }

        #[unsafe(method(mouseUp:))]
        fn mouse_up(&self, event: &NSEvent) {
            let p = self.local(event);
            let mods = mods_of(event.modifierFlags());
            let mut s = self.ivars().borrow_mut();
            if s.bar_grab.take().is_some() {
                s.clock.hold_bar(false, Instant::now());
                drop(s);
                self.setNeedsDisplay(true);
                return;
            }
            if let Some(b) = s.reported.take() {
                s.report(MouseAction::Release, Some(b), mods, p);
                return;
            }
            if s.selecting.take().is_none() {
                return;
            }
            let Some(session) = s.session.clone() else {
                return;
            };
            let at = s.pointer(p);
            // A drag or a double/triple click copies what it selected.
            let chose = {
                let emulator = session.lock();
                let chose = s.gesture.dragged(&emulator.term)
                    || s.gesture.click_count(&emulator.term) > 1;
                s.gesture.release(&emulator.term, Some((at.col, at.row)));
                chose && emulator.term.has_selection()
            };
            if chose {
                s.copy_selection();
            }
            drop(s);
            self.setNeedsDisplay(true);
        }

        #[unsafe(method(rightMouseDown:))]
        fn right_mouse_down(&self, event: &NSEvent) {
            let p = self.local(event);
            let mods = mods_of(event.modifierFlags());
            let reported = {
                let mut s = self.ivars().borrow_mut();
                let reported = s.report(MouseAction::Press, Some(MouseButton::Right), mods, p);
                if reported {
                    s.reported = Some(MouseButton::Right);
                }
                reported
            };
            if !reported {
                // SAFETY: NSView's own method: the context menu.
                let _: () = unsafe { msg_send![super(self), rightMouseDown: event] };
            }
        }

        #[unsafe(method(rightMouseUp:))]
        fn right_mouse_up(&self, event: &NSEvent) {
            self.other_up(event);
        }

        #[unsafe(method(rightMouseDragged:))]
        fn right_mouse_dragged(&self, event: &NSEvent) {
            self.other_dragged(event);
        }

        #[unsafe(method(otherMouseDown:))]
        fn other_mouse_down(&self, event: &NSEvent) {
            let p = self.local(event);
            let mods = mods_of(event.modifierFlags());
            let mut s = self.ivars().borrow_mut();
            if let Some(b) = button(event.buttonNumber())
                && s.report(MouseAction::Press, Some(b), mods, p)
            {
                s.reported = Some(b);
            }
        }

        #[unsafe(method(otherMouseUp:))]
        fn other_mouse_up(&self, event: &NSEvent) {
            self.other_up(event);
        }

        #[unsafe(method(otherMouseDragged:))]
        fn other_mouse_dragged(&self, event: &NSEvent) {
            self.other_dragged(event);
        }

        #[unsafe(method(mouseMoved:))]
        fn mouse_moved(&self, event: &NSEvent) {
            let p = self.local(event);
            let mods = mods_of(event.modifierFlags());
            let width = self.bounds().size.width;
            let mut s = self.ivars().borrow_mut();
            // Any-event tracking hears the pointer move with no button.
            s.report(MouseAction::Motion, None, mods, p);
            let mut changed = s.update_hover(Some(p), mods.cmd);
            let over_bar = p.x >= width - 14.0 && s.clock.bar(Instant::now()) > 0.0;
            if over_bar != s.clock.bar_held() && s.bar_grab.is_none() {
                s.clock.hold_bar(over_bar, Instant::now());
                changed = true;
            }
            drop(s);
            if changed {
                self.pointer_cursor(mods.cmd);
                self.setNeedsDisplay(true);
            }
        }

        #[unsafe(method(mouseExited:))]
        fn mouse_exited(&self, _event: &NSEvent) {
            let mut s = self.ivars().borrow_mut();
            s.hover = None;
            if s.bar_grab.is_none() {
                s.clock.hold_bar(false, Instant::now());
            }
            drop(s);
            self.setNeedsDisplay(true);
        }

        #[unsafe(method(scrollWheel:))]
        fn scroll_wheel(&self, event: &NSEvent) {
            let p = self.local(event);
            let mods = mods_of(event.modifierFlags());
            let mut s = self.ivars().borrow_mut();
            let delta = if event.hasPreciseScrollingDeltas() {
                event.scrollingDeltaY()
            } else {
                event.scrollingDeltaY() * s.metrics.line_height
            };
            s.wheel += delta;
            let lines = (s.wheel / s.metrics.line_height).trunc();
            if lines == 0.0 {
                return;
            }
            s.wheel -= lines * s.metrics.line_height;
            let up = lines > 0.0;
            let count = lines.abs() as usize;
            // The program's wheel while it tracks the mouse; arrow keys on a
            // full-screen program's screen (alternate scroll, `?1007`); the
            // history otherwise.
            let wheel = if up {
                MouseButton::WheelUp
            } else {
                MouseButton::WheelDown
            };
            if s.with(|e| e.term.mouse_tracking()).unwrap_or(false) && !mods.shift {
                for _ in 0..count {
                    s.report(MouseAction::Press, Some(wheel), mods, p);
                }
                return;
            }
            let arrows = s
                .with(|e| {
                    e.term.active_screen() != GHOSTTY_TERMINAL_SCREEN_PRIMARY
                        && e.term.alternate_scroll()
                })
                .unwrap_or(false);
            if arrows {
                let code = if up { 0x7e } else { 0x7d };
                for _ in 0..count {
                    s.key(KeyAction::Press, code, 0, None, None);
                }
                return;
            }
            s.with(|e| {
                e.term
                    .scroll_delta(if up { -(count as isize) } else { count as isize })
            });
            s.clock.show_bar(Instant::now());
            drop(s);
            self.setNeedsDisplay(true);
        }

        #[unsafe(method_id(menuForEvent:))]
        fn menu_for_event(&self, _event: &NSEvent) -> Option<Retained<NSMenu>> {
            let titles = self.ivars().borrow().menu.clone();
            let mtm = self.mtm();
            let menu = NSMenu::new(mtm);
            let item = |title: &str, action: Sel| {
                // SAFETY: a new item with a selector the view answers.
                let item = unsafe {
                    NSMenuItem::initWithTitle_action_keyEquivalent(
                        NSMenuItem::alloc(mtm),
                        &NSString::from_str(title),
                        Some(action),
                        &NSString::new(),
                    )
                };
                // SAFETY: the view outlives the menu it hands out.
                unsafe { item.setTarget(Some(self)) };
                menu.addItem(&item);
            };
            item(&titles.copy, sel!(copy:));
            item(&titles.paste, sel!(paste:));
            item(&titles.select_all, sel!(selectAll:));
            menu.addItem(&NSMenuItem::separatorItem(mtm));
            item(&titles.find, sel!(performFindPanelAction:));
            item(&titles.clear, sel!(zuClear:));
            Some(menu)
        }

        #[unsafe(method(copy:))]
        fn copy(&self, _sender: Option<&AnyObject>) {
            self.ivars().borrow().copy_selection();
        }

        /// The app reads its clipboard and pastes through the session.
        #[unsafe(method(paste:))]
        fn paste(&self, _sender: Option<&AnyObject>) {
            self.ivars().borrow().context.emit("paste", JsonValue::Null);
        }

        #[unsafe(method(selectAll:))]
        fn select_all(&self, _sender: Option<&AnyObject>) {
            self.ivars().borrow().with(|e| e.term.select_all());
            self.setNeedsDisplay(true);
        }

        /// Opens the app's find bar.
        #[unsafe(method(performFindPanelAction:))]
        fn find(&self, _sender: Option<&AnyObject>) {
            self.ivars().borrow().context.emit("find", JsonValue::Null);
        }

        #[unsafe(method(zuClear:))]
        fn clear_action(&self, _sender: Option<&AnyObject>) {
            self.ivars().borrow_mut().clear();
            self.setNeedsDisplay(true);
        }

        #[unsafe(method(draggingEntered:))]
        fn dragging_entered(&self, _sender: &ProtocolObject<dyn NSDraggingInfo>) -> NSDragOperation {
            NSDragOperation::Copy
        }

        /// Dropped files are typed as their escaped paths; dropped text as
        /// a paste.
        #[unsafe(method(performDragOperation:))]
        fn perform_drag(&self, sender: &ProtocolObject<dyn NSDraggingInfo>) -> bool {
            self.dropped(sender)
        }

        #[unsafe(method(isAccessibilityElement))]
        fn is_accessibility_element(&self) -> bool {
            true
        }

        #[unsafe(method_id(accessibilityRole))]
        fn accessibility_role(&self) -> Retained<NSString> {
            // SAFETY: AppKit's own constant.
            NSString::from_str(&unsafe { NSAccessibilityTextAreaRole }.to_string())
        }

        /// Text an assistive app inserts (Voice Control, dictation) is
        /// typed into the program, as the keyboard's would be.
        #[unsafe(method(setAccessibilitySelectedText:))]
        fn set_accessibility_selected_text(&self, text: Option<&NSString>) {
            if let Some(text) = text {
                let mut s = self.ivars().borrow_mut();
                s.send(text.to_string().as_bytes());
                s.typed_to_program();
            }
        }

        #[unsafe(method_id(accessibilitySelectedText))]
        fn accessibility_selected_text(&self) -> Retained<NSString> {
            let text = self
                .ivars()
                .borrow()
                .with(|e| e.term.selected_text())
                .flatten()
                .unwrap_or_default();
            NSString::from_str(&text)
        }

        /// What VoiceOver reads: the rows on screen.
        #[unsafe(method_id(accessibilityValue))]
        fn accessibility_value(&self) -> Retained<NSString> {
            let text = self
                .ivars()
                .borrow()
                .with(|e| e.viewport_text())
                .unwrap_or_default();
            NSString::from_str(&text)
        }
    }

    unsafe impl NSTextInputClient for TerminalView {
        #[unsafe(method(insertText:replacementRange:))]
        fn insert_text(&self, string: &AnyObject, _replacement: NSRange) {
            let text = string_of(string);
            let mut s = self.ivars().borrow_mut();
            s.marked.clear();
            match s.typed.as_mut() {
                Some(typed) => typed.push(text),
                // Outside a key press: a commit by click in the candidate
                // window, dictation, the character viewer.
                None => {
                    s.send(text.as_bytes());
                    s.typed_to_program();
                }
            }
            drop(s);
            self.setNeedsDisplay(true);
        }

        #[unsafe(method(doCommandBySelector:))]
        fn do_command(&self, _selector: Sel) {
            // The key's own sequence follows from `keyDown:`; nothing beeps.
        }

        #[unsafe(method(setMarkedText:selectedRange:replacementRange:))]
        fn set_marked_text(&self, string: &AnyObject, _selected: NSRange, _replacement: NSRange) {
            self.ivars().borrow_mut().marked = string_of(string);
            self.setNeedsDisplay(true);
        }

        #[unsafe(method(unmarkText))]
        fn unmark_text(&self) {
            self.ivars().borrow_mut().marked.clear();
            self.setNeedsDisplay(true);
        }

        #[unsafe(method(selectedRange))]
        fn selected_range(&self) -> NSRange {
            NSRange::new(0, 0)
        }

        #[unsafe(method(markedRange))]
        fn marked_range(&self) -> NSRange {
            let s = self.ivars().borrow();
            match s.marked.is_empty() {
                true => NSRange::new(NSNotFound as NSUInteger, 0),
                false => NSRange::new(0, s.marked.encode_utf16().count()),
            }
        }

        #[unsafe(method(hasMarkedText))]
        fn has_marked_text(&self) -> bool {
            !self.ivars().borrow().marked.is_empty()
        }

        #[unsafe(method_id(attributedSubstringForProposedRange:actualRange:))]
        fn attributed_substring(
            &self,
            _range: NSRange,
            _actual: *mut NSRange,
        ) -> Option<Retained<NSAttributedString>> {
            None
        }

        #[unsafe(method_id(validAttributesForMarkedText))]
        fn valid_attributes(&self) -> Retained<NSArray<NSAttributedStringKey>> {
            NSArray::new()
        }

        /// The candidate window opens under the composition, which starts at
        /// the terminal's cursor: the cursor's cell, on screen.
        #[unsafe(method(firstRectForCharacterRange:actualRange:))]
        fn first_rect(&self, range: NSRange, _actual: *mut NSRange) -> NSRect {
            let s = self.ivars().borrow();
            let cursor = s.cursor_cell().unwrap_or((0, s.rows.saturating_sub(1)));
            let (col, row) = ime::anchor(cursor, &s.marked, range.location);
            let cell = s.metrics.cell(col, row, 1);
            drop(s);
            let local = NSRect::new(NSPoint::new(cell.x, cell.y), NSSize::new(0.0, cell.height));
            let in_window = self.convertRect_toView(local, None);
            match self.window() {
                Some(window) => window.convertRectToScreen(in_window),
                None => in_window,
            }
        }

        #[unsafe(method(characterIndexForPoint:))]
        fn character_index(&self, _point: NSPoint) -> NSUInteger {
            NSNotFound as NSUInteger
        }
    }
);

impl TerminalView {
    fn new(mtm: MainThreadMarker, context: ComponentContext) -> Retained<Self> {
        let this = Self::alloc(mtm).set_ivars(RefCell::new(State::new(context)));
        // SAFETY: NSView's designated initializer.
        let view: Retained<Self> = unsafe { msg_send![super(this), initWithFrame: NSRect::ZERO] };
        let options = NSTrackingAreaOptions::MouseMoved
            | NSTrackingAreaOptions::MouseEnteredAndExited
            | NSTrackingAreaOptions::ActiveInKeyWindow
            | NSTrackingAreaOptions::InVisibleRect;
        // SAFETY: a tracking area the view owns, over its visible rect.
        let area = unsafe {
            NSTrackingArea::initWithRect_options_owner_userInfo(
                NSTrackingArea::alloc(),
                NSRect::ZERO,
                options,
                Some(&view),
                None,
            )
        };
        view.addTrackingArea(&area);
        // SAFETY: AppKit's own pasteboard types.
        let types = unsafe { [NSPasteboardTypeFileURL, NSPasteboardTypeString] };
        view.registerForDraggedTypes(&NSArray::from_slice(&types));
        view
    }

    /// Draws session `id` from now on (`None`: none). The session wakes the
    /// view after each change; redraws coalesce into one per run loop turn.
    fn attach(&self, id: Option<u64>) {
        let mtm = self.mtm();
        let next = id.and_then(session::find);
        {
            let mut s = self.ivars().borrow_mut();
            if s.session.as_ref().map(|x| x.id()) == next.as_ref().map(|x| x.id()) {
                return;
            }
            if let (Some(old), Some(token)) = (s.session.take(), s.attachment.take()) {
                old.detach(token);
            }
            (s.cols, s.rows) = (0, 0);
            s.bells = None;
            if let Some(session) = &next {
                let view = Arc::new(MainThreadBound::new(
                    Weak::from_retained(&self.retain()),
                    mtm,
                ));
                let pending = Arc::new(AtomicBool::new(false));
                s.attachment = Some(session.attach(Arc::new(move || {
                    if pending.swap(true, Ordering::AcqRel) {
                        return;
                    }
                    let (view, pending) = (view.clone(), pending.clone());
                    DispatchQueue::main().exec_async(move || {
                        pending.store(false, Ordering::Release);
                        // SAFETY: the main queue runs on the main thread.
                        let mtm = unsafe { MainThreadMarker::new_unchecked() };
                        if let Some(view) = view.get(mtm).load() {
                            view.setNeedsDisplay(true);
                        }
                    });
                })));
            }
            s.session = next;
            s.apply_theme();
        }
        self.relayout();
    }

    fn relayout(&self) {
        let size = self.bounds().size;
        self.ivars().borrow_mut().layout(size);
        if let Some(input) = self.inputContext() {
            input.invalidateCharacterCoordinates();
        }
        self.setNeedsDisplay(true);
    }

    /// `f` on the main thread after `delay`, while the view lives.
    fn later(&self, delay: Duration, f: fn(&TerminalView)) {
        let view = MainThreadBound::new(Weak::from_retained(&self.retain()), self.mtm());
        let when = DispatchTime::try_from(delay).unwrap_or(DispatchTime::NOW);
        let _ = DispatchQueue::main().after(when, move || {
            // SAFETY: the main queue runs on the main thread.
            let mtm = unsafe { MainThreadMarker::new_unchecked() };
            if let Some(view) = view.get(mtm).load() {
                f(&view);
            }
        });
    }

    /// Draws again at `at`, once, unless a redraw for an earlier time is
    /// already on its way.
    fn redraw_at(&self, at: Instant) {
        {
            let mut s = self.ivars().borrow_mut();
            if s.tick.is_some_and(|t| t <= at) {
                return;
            }
            s.tick = Some(at);
        }
        self.later(at.saturating_duration_since(Instant::now()), |view| {
            view.ivars().borrow_mut().tick = None;
            view.setNeedsDisplay(true);
        });
    }

    /// While a selecting drag is past the view's edge, the viewport scrolls
    /// and the selection follows, one row per tick.
    fn autoscroll_later(&self) {
        self.later(AUTOSCROLL, |view| {
            let mut s = view.ivars().borrow_mut();
            let (Some(p), Some(session)) = (s.selecting, s.session.clone()) else {
                return;
            };
            let at = s.pointer(p);
            let again = {
                let emulator = session.lock();
                if s.gesture.autoscroll(&emulator.term) == Autoscroll::None {
                    return;
                }
                s.gesture.autoscroll_tick(&emulator.term, at, false);
                s.gesture.autoscroll(&emulator.term) != Autoscroll::None
            };
            drop(s);
            view.setNeedsDisplay(true);
            if again {
                view.autoscroll_later();
            }
        });
    }

    fn dropped(&self, sender: &ProtocolObject<dyn NSDraggingInfo>) -> bool {
        let board = sender.draggingPasteboard();
        let classes = NSArray::from_slice(&[NSURL::class()]);
        // SAFETY: an array of classes and no options.
        let urls = unsafe { board.readObjectsForClasses_options(&classes, None) };
        let paths: Vec<String> = urls
            .map(|urls| {
                urls.iter()
                    .filter_map(|u| u.downcast::<NSURL>().ok())
                    .filter_map(|u| u.path().map(|p| p.to_string()))
                    .collect()
            })
            .unwrap_or_default();
        let text = if paths.is_empty() {
            // SAFETY: AppKit's own pasteboard type.
            board
                .stringForType(unsafe { NSPasteboardTypeString })
                .map(|s| s.to_string())
                .unwrap_or_default()
        } else {
            escape::dropped(&paths)
        };
        if text.is_empty() {
            return false;
        }
        self.ivars().borrow().with(|e| e.term.paste(&text));
        if let Some(window) = self.window() {
            window.makeFirstResponder(Some(self));
        }
        true
    }

    fn local(&self, event: &NSEvent) -> NSPoint {
        self.convertPoint_fromView(event.locationInWindow(), None)
    }

    /// The pointer in the view, when it is over it.
    fn pointer_location(&self) -> Option<NSPoint> {
        let window = self.window()?;
        let p = self.convertPoint_fromView(window.mouseLocationOutsideOfEventStream(), None);
        let b = self.bounds();
        (p.x >= 0.0 && p.y >= 0.0 && p.x < b.size.width && p.y < b.size.height).then_some(p)
    }

    /// A pointing hand over a Cmd-hovered link, the I-beam elsewhere.
    fn pointer_cursor(&self, cmd: bool) {
        if cmd && self.ivars().borrow().hover.is_some() {
            NSCursor::pointingHandCursor().set();
        } else {
            NSCursor::IBeamCursor().set();
        }
    }

    fn other_up(&self, event: &NSEvent) {
        let p = self.local(event);
        let mods = mods_of(event.modifierFlags());
        let mut s = self.ivars().borrow_mut();
        if let Some(b) = s.reported.take() {
            s.report(MouseAction::Release, Some(b), mods, p);
        }
    }

    fn other_dragged(&self, event: &NSEvent) {
        let p = self.local(event);
        let mods = mods_of(event.modifierFlags());
        let mut s = self.ivars().borrow_mut();
        if s.reported.is_some() {
            s.report(MouseAction::Motion, None, mods, p);
        }
    }

    /// The scrollbar's thumb under `event`, while the bar is shown: the
    /// drag that follows moves the viewport. A press on the track beside
    /// the thumb pages toward it.
    fn grab_bar(&self, event: &NSEvent) -> bool {
        let p = self.local(event);
        let size = self.bounds().size;
        let now = Instant::now();
        let mut s = self.ivars().borrow_mut();
        let Some(bar) = scrollbar(s.bar, s.clock.bar(now), s.clock.bar_held()) else {
            return false;
        };
        if bar.alpha <= 0.0 || p.x < size.width - 14.0 {
            return false;
        }
        let thumb = bar.thumb(size.width, size.height);
        if p.y >= thumb.y && p.y <= thumb.y + thumb.height {
            s.bar_grab = Some(p.y - thumb.y);
            s.clock.hold_bar(true, now);
        } else {
            let page = s.bar.len as isize - 1;
            let lines = if p.y < thumb.y { -page } else { page };
            s.with(|e| e.term.scroll_delta(lines));
            s.clock.show_bar(now);
        }
        drop(s);
        self.setNeedsDisplay(true);
        true
    }

    fn drag_bar(&self, event: &NSEvent) -> bool {
        let p = self.local(event);
        let size = self.bounds().size;
        let s = self.ivars().borrow();
        let Some(grab) = s.bar_grab else {
            return false;
        };
        let Some(bar) = scrollbar(s.bar, 1.0, true) else {
            return true;
        };
        let thumb = bar.thumb(size.width, size.height);
        let room = (size.height - 4.0 - thumb.height).max(1.0);
        let top = ((p.y - grab - 2.0) / room).clamp(0.0, 1.0);
        let scrollable = s.bar.total.saturating_sub(s.bar.len) as f64;
        s.with(|e| e.term.scroll_to_row((top * scrollable).round() as usize));
        drop(s);
        self.setNeedsDisplay(true);
        true
    }

    fn key_equivalent(&self, event: &NSEvent) -> bool {
        let first = self
            .window()
            .and_then(|w| w.firstResponder())
            .is_some_and(|r| std::ptr::eq(&*r as *const _ as *const Self, self));
        if !first || !self.ivars().borrow().marked.is_empty() {
            return false;
        }
        self.shortcut(event, mods_of(event.modifierFlags()))
    }

    /// Shortcuts of the terminal itself; `true` when `event` was one.
    fn shortcut(&self, event: &NSEvent, mods: Mods) -> bool {
        if !mods.cmd || mods.ctrl {
            return false;
        }
        let key = event
            .charactersIgnoringModifiers()
            .map(|s| s.to_string().to_lowercase())
            .unwrap_or_default();
        let mut s = self.ivars().borrow_mut();
        match (key.as_str(), event.keyCode(), mods.shift) {
            ("f", _, false) => s.context.emit("find", JsonValue::Null),
            ("g", _, shift) => s
                .context
                .emit("findStep", json!({ "step": if shift { -1 } else { 1 } })),
            ("k", _, false) => s.clear(),
            // Cmd+Up / Cmd+Down: the previous / next shell prompt (OSC 133).
            (_, 0x7e, false) => {
                s.with(|e| e.term.scroll_to_prompt(-1));
            }
            (_, 0x7d, false) => {
                s.with(|e| e.term.scroll_to_prompt(1));
            }
            // Cmd+Home / Cmd+End: the history's top / the live screen.
            (_, 0x73, false) => {
                s.with(|e| e.term.scroll_top());
            }
            (_, 0x77, false) => {
                s.with(|e| e.term.scroll_bottom());
            }
            _ => return false,
        }
        s.clock.show_bar(Instant::now());
        drop(s);
        self.setNeedsDisplay(true);
        true
    }

    /// A key press: the terminal's shortcuts, then the input method (it
    /// composes, commits, or leaves the key alone), then libghostty's
    /// encoding of what is left.
    fn key(&self, event: &NSEvent) {
        let flags = event.modifierFlags();
        let mods = mods_of(flags);
        let code = event.keyCode();
        let action = if event.isARepeat() {
            KeyAction::Repeat
        } else {
            KeyAction::Press
        };
        let unshifted = unshifted(event);
        let (composing, meta) = {
            let s = self.ivars().borrow();
            (!s.marked.is_empty(), s.option_as_meta)
        };
        if !composing && self.shortcut(event, mods) {
            return;
        }
        // Shift+PageUp / Shift+PageDown page the history.
        if !composing && mods.shift && !mods.cmd && (code == 0x74 || code == 0x79) {
            let mut s = self.ivars().borrow_mut();
            let page = s.rows.saturating_sub(1) as isize;
            s.with(|e| e.term.scroll_delta(if code == 0x74 { -page } else { page }));
            s.clock.show_bar(Instant::now());
            drop(s);
            self.setNeedsDisplay(true);
            return;
        }
        // Control chords are the program's (^C, ^R), and so is Option as
        // Meta: an input method never sees them unless it is composing.
        if !composing && !mods.cmd && (mods.ctrl || (mods.alt && meta)) {
            let shift_only = flags & NSEventModifierFlags::Shift;
            let base = event
                .charactersByApplyingModifiers(shift_only)
                .map(|s| s.to_string())
                .filter(|s| !s.is_empty() && s.chars().all(|c| !c.is_control()));
            let base = if mods.ctrl {
                base.map(|s| s.to_lowercase())
            } else {
                base
            };
            self.ivars()
                .borrow_mut()
                .key(action, code, mods.bits(), base.as_deref(), unshifted);
            self.setNeedsDisplay(true);
            return;
        }
        self.ivars().borrow_mut().typed = Some(Vec::new());
        let events = NSArray::from_slice(&[event]);
        self.interpretKeyEvents(&events);
        let mut s = self.ivars().borrow_mut();
        let typed = s.typed.take().unwrap_or_default();
        match ime::outcome(composing, !s.marked.is_empty(), typed) {
            ime::Outcome::Commit(texts) => {
                if !texts.is_empty() {
                    for text in texts {
                        s.send(text.as_bytes());
                    }
                    s.typed_to_program();
                }
            }
            ime::Outcome::Typed(texts) => {
                for text in texts {
                    s.key(action, code, mods.after_text(), Some(&text), unshifted);
                }
            }
            ime::Outcome::Key => s.key(action, code, mods.bits(), None, unshifted),
        }
        drop(s);
        if let Some(input) = self.inputContext() {
            input.invalidateCharacterCoordinates();
        }
        self.setNeedsDisplay(true);
    }
}

/// The component nsh hosts: the view, and the props and commands TSX sends.
pub(crate) struct Component {
    view: Retained<TerminalView>,
}

impl Component {
    pub(crate) fn new(context: ComponentContext) -> Self {
        let mtm = MainThreadMarker::new().expect("components are made on the main thread");
        Self {
            view: TerminalView::new(mtm, context),
        }
    }

    fn state(&self) -> std::cell::RefMut<'_, State> {
        self.view.ivars().borrow_mut()
    }
}

impl Drop for Component {
    fn drop(&mut self) {
        self.view.attach(None);
    }
}

impl NativeComponent for Component {
    fn view(&self) -> Retained<NSView> {
        Retained::into_super(self.view.clone())
    }

    fn set_prop(&mut self, name: &str, value: Option<&JsonValue>) {
        if name == "session" {
            let id = value.and_then(JsonValue::as_f64).map(|id| id as u64);
            self.view.attach(id);
            return;
        }
        {
            let mut s = self.state();
            let text = |key: &str| {
                value
                    .and_then(|v| v.get(key))
                    .and_then(JsonValue::as_str)
                    .map(str::to_owned)
            };
            match name {
                "fontFamily" => {
                    s.family = value
                        .and_then(JsonValue::as_str)
                        .unwrap_or("Menlo")
                        .to_owned();
                    s.refont();
                }
                "fontSize" => {
                    s.font_size = value.and_then(JsonValue::as_f64).unwrap_or(13.0);
                    s.refont();
                }
                "lineHeight" => {
                    s.line_height = value.and_then(JsonValue::as_f64).unwrap_or(18.0);
                    s.refont();
                }
                "colors" => {
                    let pick = |key: &str| text(key).as_deref().and_then(Rgba::parse);
                    let d = Palette::default();
                    s.palette = Palette {
                        foreground: pick("foreground").unwrap_or(d.foreground),
                        background: pick("background").unwrap_or(d.background),
                        cursor: pick("cursor").unwrap_or(d.cursor),
                        selection: pick("selection").unwrap_or(d.selection),
                        preedit: pick("preedit").unwrap_or(d.preedit),
                        link: pick("link").unwrap_or(d.link),
                        mark: pick("mark").unwrap_or(d.mark),
                        mark_current: pick("markCurrent").unwrap_or(d.mark_current),
                        scrollbar: pick("scrollbar").unwrap_or(d.scrollbar),
                    };
                    s.apply_theme();
                }
                "cursorStyle" => {
                    s.cursor_style = match value.and_then(JsonValue::as_str) {
                        Some("bar") => CursorStyle::Bar,
                        Some("underline") => CursorStyle::Underline,
                        _ => CursorStyle::Block,
                    };
                    s.apply_theme();
                }
                "cursorBlink" => {
                    s.cursor_blink = value.and_then(JsonValue::as_bool).unwrap_or(true);
                    s.apply_theme();
                }
                "optionAsMeta" => {
                    s.option_as_meta = value.and_then(JsonValue::as_bool).unwrap_or(false);
                }
                "menu" => {
                    let d = MenuTitles::default();
                    s.menu = MenuTitles {
                        copy: text("copy").unwrap_or(d.copy),
                        paste: text("paste").unwrap_or(d.paste),
                        select_all: text("selectAll").unwrap_or(d.select_all),
                        find: text("find").unwrap_or(d.find),
                        clear: text("clear").unwrap_or(d.clear),
                    };
                    return;
                }
                _ => return,
            }
        }
        self.view.relayout();
    }

    fn command(&mut self, name: &str, _args: &JsonValue) {
        match name {
            "focus" => match self.view.window() {
                Some(window) => {
                    window.makeFirstResponder(Some(&self.view));
                }
                None => self.state().wants_focus = true,
            },
            "snapshot" => {
                let s = self.state();
                let cursor = s.cursor_cell();
                let metrics = s.metrics;
                s.context.emit(
                    "snapshot",
                    json!({
                        "cursor": cursor.map(|(c, r)| [c, r]),
                        "cell": [metrics.cell_width, metrics.line_height, metrics.baseline],
                        "grid": [s.cols, s.rows],
                        "focused": s.focused,
                        "font": s.fonts.family(),
                    }),
                );
            }
            _ => return,
        }
        self.view.setNeedsDisplay(true);
    }
}

/// Turns RGBA bytes into a sRGB CoreGraphics bitmap. The provider retains
/// the vector's allocation; the release callback frees it when CG is done.
fn upload_image(image: &Image) -> Option<CFRetained<CGImage>> {
    if image.width == 0 || image.height == 0 {
        return None;
    }
    let len = (image.width as usize)
        .checked_mul(image.height as usize)?
        .checked_mul(4)?;
    if image.rgba.len() != len {
        return None;
    }
    let boxed = image.rgba.clone().into_boxed_slice();
    let (ptr, len) = (boxed.as_ptr(), boxed.len());
    // SAFETY: `boxed` is leaked here and freed by the provider's release
    // callback once CoreGraphics no longer needs the bytes.
    let provider = unsafe {
        CGDataProvider::with_data(
            std::ptr::null_mut(),
            ptr as *const c_void,
            len,
            Some(release_rgba),
        )
    }?;
    Box::leak(boxed);
    let space = CGColorSpace::with_name(Some(unsafe { kCGColorSpaceSRGB }));
    // SAFETY: the provider holds exactly `len` RGBA bytes and every other
    // argument describes that same buffer.
    unsafe {
        CGImage::new(
            image.width as usize,
            image.height as usize,
            8,
            32,
            image.width as usize * 4,
            space.as_deref(),
            CGBitmapInfo(CGImageAlphaInfo::Last.0),
            Some(&provider),
            std::ptr::null(),
            true,
            CGColorRenderingIntent::RenderingIntentDefault,
        )
    }
}

unsafe extern "C-unwind" fn release_rgba(_info: *mut c_void, data: NonNull<c_void>, len: usize) {
    // SAFETY: `data` and `len` are the boxed slice handed to the provider.
    unsafe {
        drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(
            data.as_ptr() as *mut u8,
            len,
        )));
    }
}
