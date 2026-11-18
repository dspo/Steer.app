//! Safe wrapper around libghostty-vt.
//!
//! The C handles have no thread affinity but are not thread-safe. A
//! [`Terminal`] is `Send` so the PTY reader can feed it on its own thread
//! while the UI snapshots it, as long as both sides go through one lock
//! (Ghostty's own IO thread and renderer share a mutex the same way). The
//! helpers that borrow a terminal per call ([`RenderState`], [`KeyEncoder`],
//! [`MouseEncoder`], [`SelectionGesture`]) stay on the UI thread and take
//! the terminal as a parameter, so they only touch it while it is locked.

#![deny(clippy::undocumented_unsafe_blocks)]

use std::{
    cell::RefCell,
    ffi::{CString, c_char, c_int, c_void},
    marker::PhantomData,
};

pub mod sys;

mod mouse;
mod search;
mod selection;

pub use mouse::{MouseAction, MouseButton, MouseEncoder, MouseGeometry, focus_encode};
pub use search::{Match, Search, SearchStatus};
pub use selection::{
    Adjust, Autoscroll, DEFAULT_WORD_BOUNDARIES, GestureGeometry, Pointer, Press, SelectionGesture,
};
pub use sys::key_consts;

/// A color the program set explicitly: a palette index (the UI's own palette)
/// or a 24-bit value. `None` in a [`Cell`] means the default.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Color {
    Palette(u8),
    Rgb(u8, u8, u8),
}

/// An RGB color as libghostty-vt reports it.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Rgb {
    pub r: u8,
    pub g: u8,
    pub b: u8,
}

impl From<sys::GhosttyColorRgb> for Rgb {
    fn from(c: sys::GhosttyColorRgb) -> Self {
        Self {
            r: c.r,
            g: c.g,
            b: c.b,
        }
    }
}

impl From<Rgb> for sys::GhosttyColorRgb {
    fn from(c: Rgb) -> Self {
        Self {
            r: c.r,
            g: c.g,
            b: c.b,
        }
    }
}

impl Rgb {
    pub const fn new(r: u8, g: u8, b: u8) -> Self {
        Self { r, g, b }
    }
}

/// Ghostty's built-in 256-color palette.
pub fn default_palette() -> [Rgb; 256] {
    let mut raw = [sys::GhosttyColorRgb::default(); 256];
    // SAFETY: the callee writes exactly 256 entries into the array.
    unsafe { sys::ghostty_color_palette_default(raw.as_mut_ptr()) };
    raw.map(Rgb::from)
}

/// What the program sees for the cursor after a DECSCUSR reset (`CSI 0 q`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CursorStyle {
    Bar,
    Block,
    Underline,
    BlockHollow,
}

impl CursorStyle {
    fn raw(self) -> c_int {
        match self {
            Self::Bar => sys::GHOSTTY_TERMINAL_CURSOR_STYLE_BAR,
            Self::Block => sys::GHOSTTY_TERMINAL_CURSOR_STYLE_BLOCK,
            Self::Underline => sys::GHOSTTY_TERMINAL_CURSOR_STYLE_UNDERLINE,
            Self::BlockHollow => sys::GHOSTTY_TERMINAL_CURSOR_STYLE_BLOCK_HOLLOW,
        }
    }
}

/// The answer to a color-scheme query (`CSI ? 996 n`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ColorScheme {
    Light,
    Dark,
}

/// The program's progress report (`OSC 9;4`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProgressState {
    Remove,
    Set,
    Error,
    Indeterminate,
    Pause,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Progress {
    pub state: ProgressState,
    /// 0–100; `None` when the program left it out.
    pub percent: Option<u8>,
}

/// One step of a shell-integrated command (`OSC 133`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SemanticPromptKind {
    PromptStart,
    InputStart,
    OutputStart,
    CommandEnd,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SemanticPrompt {
    pub kind: SemanticPromptKind,
    /// Only for [`SemanticPromptKind::CommandEnd`], when the shell sent it.
    pub exit_code: Option<i32>,
    /// The command line, for [`SemanticPromptKind::OutputStart`]; empty when
    /// the shell did not send one.
    pub command: String,
}

/// The answer to XTWINOPS size queries (`CSI 14/16/18/19 t`) and mode-2048
/// reports: the grid and the cell size the view lays out.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SizeReport {
    pub rows: u16,
    pub columns: u16,
    /// A cell's width in device pixels.
    pub cell_width: u32,
    /// A cell's height in device pixels.
    pub cell_height: u32,
}

/// A DA answer's Pp level and feature codes (`CSI ? Pp ; Ps... c`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DeviceAttributesPrimary {
    /// The conformance level: 62 for a VT220, 65 for a VT520.
    pub level: u16,
    pub features: Vec<u16>,
}

/// A DA answer's terminal type, firmware and ROM cartridge numbers.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct DeviceAttributesSecondary {
    /// The terminal type: 1 for a VT220, 64 for a VT520.
    pub device_type: u16,
    pub firmware_version: u16,
    pub rom_cartridge: u16,
}

/// A DA3 answer's unit id, encoded as eight hex digits.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct DeviceAttributesTertiary {
    pub unit_id: u32,
}

/// What `CSI c` (DA1), `CSI > c` (DA2) and `CSI = c` (DA3) are answered
/// with; the terminal encodes whichever the query asked for.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DeviceAttributes {
    pub primary: DeviceAttributesPrimary,
    pub secondary: DeviceAttributesSecondary,
    pub tertiary: DeviceAttributesTertiary,
}

impl DeviceAttributes {
    /// The profile the official esctest driver answers with: a VT520
    /// with ANSI color, esctest's highest VT level.
    pub fn vt520() -> Self {
        Self {
            primary: DeviceAttributesPrimary {
                level: 65,
                features: vec![22],
            },
            secondary: DeviceAttributesSecondary {
                device_type: 64,
                firmware_version: 0,
                rom_cartridge: 0,
            },
            tertiary: DeviceAttributesTertiary { unit_id: 0 },
        }
    }
}

/// A program's request to resize the window (`CSI 8 ; rows ; columns t`);
/// a zero keeps that dimension. The terminal does not resize itself: the
/// embedder decides.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ResizeWindowRequest {
    pub rows: u16,
    pub columns: u16,
}

/// How DECRQCRA (`CSI Pi ; Pg ; Pt ; Pl ; Pb ; Pr * y`) computes its
/// checksum: the bits of xterm's `checksumExtension`, which also survive
/// a reset when set before. 1 negates nothing, 2 skips cell attributes,
/// 4 keeps blanks, 16 counts full codepoints; 8 (never-written cells as
/// spaces) has no flag and stays off.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct XtChecksumFlags {
    pub positive: bool,
    pub no_attributes: bool,
    pub no_trim: bool,
    pub full: bool,
}

impl XtChecksumFlags {
    fn bits(self) -> u8 {
        u8::from(self.positive)
            | u8::from(self.no_attributes) << 1
            | u8::from(self.no_trim) << 2
            | u8::from(self.full) << 4
    }
}

/// A borrowed view of the terminal inside a callback: valid only for the
/// callback's duration, on the thread that runs it. The callback fires
/// while the terminal processes its input, so reads see the state the
/// program has reached so far. The lifetime is what keeps it there — a
/// callback cannot store it and read a terminal that has since gone away.
#[derive(Clone, Copy)]
pub struct TerminalRef<'a> {
    term: sys::GhosttyTerminal,
    _scope: PhantomData<&'a ()>,
}

impl TerminalRef<'_> {
    /// The grid's width, as the kernel sees it right now — including a
    /// resize the same chunk triggered (DECCOLM under DEC mode 40).
    pub fn cols(&self) -> Option<u16> {
        let mut cols: u16 = 0;
        // SAFETY: the handle is live; the data kind writes a `uint16_t`.
        let rc = unsafe {
            sys::ghostty_terminal_get(
                self.term,
                sys::GHOSTTY_TERMINAL_DATA_COLS,
                &mut cols as *mut u16 as *mut c_void,
            )
        };
        (rc == sys::GHOSTTY_SUCCESS).then_some(cols)
    }

    /// The grid's height, likewise.
    pub fn rows(&self) -> Option<u16> {
        let mut rows: u16 = 0;
        // SAFETY: the handle is live; the data kind writes a `uint16_t`.
        let rc = unsafe {
            sys::ghostty_terminal_get(
                self.term,
                sys::GHOSTTY_TERMINAL_DATA_ROWS,
                &mut rows as *mut u16 as *mut c_void,
            )
        };
        (rc == sys::GHOSTTY_SUCCESS).then_some(rows)
    }
}

type WritePtyFn = Box<dyn Fn(&[u8]) + Send>;
type EffectFn = Box<dyn Fn() + Send>;
type SizeFn = Box<dyn for<'a> Fn(TerminalRef<'a>) -> Option<SizeReport> + Send>;
type DeviceAttributesFn = Box<dyn Fn() -> DeviceAttributes + Send>;
type ResizeWindowFn = Box<dyn Fn(ResizeWindowRequest) + Send>;
type ClipboardFn = Box<dyn Fn(&str) + Send>;
type ColorSchemeFn = Box<dyn Fn() -> Option<ColorScheme> + Send>;
type NotificationFn = Box<dyn Fn(&str, &str) + Send>;
type ProgressFn = Box<dyn Fn(Progress) + Send>;
type SemanticPromptFn = Box<dyn Fn(&SemanticPrompt) + Send>;

#[repr(C)]
struct Callbacks {
    write_pty: Option<WritePtyFn>,
    on_title: Option<EffectFn>,
    on_pwd: Option<EffectFn>,
    on_bell: Option<EffectFn>,
    on_clipboard: Option<ClipboardFn>,
    on_color_scheme: Option<ColorSchemeFn>,
    on_notification: Option<NotificationFn>,
    on_progress: Option<ProgressFn>,
    on_semantic_prompt: Option<SemanticPromptFn>,
    on_size: Option<SizeFn>,
    on_device_attributes: Option<DeviceAttributesFn>,
    on_resize_window: Option<ResizeWindowFn>,
    /// The XTVERSION answer; the C side borrows it during the callback.
    xtversion: String,
}

pub struct Terminal {
    term: sys::GhosttyTerminal,
    // Box keeps the address stable for the lifetime of the terminal; the C
    // side only ever sees `&*self.callbacks` as userdata.
    callbacks: Box<Callbacks>,
    word_boundaries: Vec<u32>,
    /// Per screen (primary, alternate): what notices when the installed
    /// selection's rows are pruned or erased, which the terminal itself
    /// does not.
    selection_guards: RefCell<[Option<selection::Guard>; 2]>,
    // Owned here because freeing a search touches the terminal's tracked
    // state, which must happen under the same lock as every other access.
    search: Option<Search>,
}

// SAFETY: the C terminal and the search and tracked references it owns
// have no thread affinity, and every callback it holds is `Send`. Callbacks
// fire synchronously on the thread that calls `write`/`paste`. `Terminal`
// is not `Sync`: shared access from several threads must be serialized by
// the owner (a `Mutex`).
unsafe impl Send for Terminal {}

/// # Safety
/// `ud` must be the `Callbacks` installed as the terminal's userdata.
unsafe fn callbacks<'a>(ud: *mut c_void) -> &'a Callbacks {
    // SAFETY: per the contract, `ud` points at the boxed `Callbacks` that
    // outlives the terminal handle.
    unsafe { &*(ud as *const Callbacks) }
}

/// # Safety
/// `s` must be a valid borrowed string for the duration of the call.
unsafe fn ghostty_str(s: sys::GhosttyString) -> String {
    if s.ptr.is_null() || s.len == 0 {
        return String::new();
    }
    // SAFETY: per the contract, `ptr..ptr+len` is readable.
    String::from_utf8_lossy(unsafe { std::slice::from_raw_parts(s.ptr, s.len) }).into_owned()
}

unsafe extern "C" fn trampoline_write_pty(
    _term: sys::GhosttyTerminal,
    ud: *mut c_void,
    data: *const u8,
    len: usize,
) {
    // SAFETY: userdata is always our `Callbacks`; `data..data+len` is the
    // reply the terminal lends for this call.
    unsafe {
        if let Some(f) = callbacks(ud).write_pty.as_ref() {
            f(std::slice::from_raw_parts(data, len));
        }
    }
}

unsafe extern "C" fn trampoline_title(_term: sys::GhosttyTerminal, ud: *mut c_void) {
    // SAFETY: userdata is always our `Callbacks`.
    if let Some(f) = unsafe { callbacks(ud) }.on_title.as_ref() {
        f();
    }
}

unsafe extern "C" fn trampoline_pwd(_term: sys::GhosttyTerminal, ud: *mut c_void) {
    // SAFETY: userdata is always our `Callbacks`.
    if let Some(f) = unsafe { callbacks(ud) }.on_pwd.as_ref() {
        f();
    }
}

unsafe extern "C" fn trampoline_bell(_term: sys::GhosttyTerminal, ud: *mut c_void) {
    // SAFETY: userdata is always our `Callbacks`.
    if let Some(f) = unsafe { callbacks(ud) }.on_bell.as_ref() {
        f();
    }
}

unsafe extern "C" fn trampoline_clipboard(
    _term: sys::GhosttyTerminal,
    ud: *mut c_void,
    write: *const sys::GhosttyClipboardWrite,
) {
    // SAFETY: userdata is always our `Callbacks`; `write` and the contents
    // it points at are lent for this call, and `reply` expects this `write`.
    unsafe {
        let write = &*write;
        if let Some(f) = callbacks(ud).on_clipboard.as_ref() {
            if write.contents_len == 0 {
                // OSC 52 with no representations clears the clipboard.
                f("");
            } else {
                for i in 0..write.contents_len {
                    let content = &*write.contents.add(i);
                    let mime = std::slice::from_raw_parts(content.mime.ptr, content.mime.len);
                    if mime == b"text/plain" || mime.starts_with(b"text/plain;") {
                        f(&ghostty_str(content.data));
                        break;
                    }
                }
            }
        }
        if let Some(reply) = write.reply {
            let answer = sys::GhosttyClipboardWriteReply {
                size: std::mem::size_of::<sys::GhosttyClipboardWriteReply>(),
                result: sys::GHOSTTY_CLIPBOARD_WRITE_RESULT_SUCCESS,
                remember: false,
            };
            reply(write, &answer);
        }
    }
}

unsafe extern "C" fn trampoline_xtversion(
    _term: sys::GhosttyTerminal,
    ud: *mut c_void,
) -> sys::GhosttyString {
    // SAFETY: userdata is always our `Callbacks`; the string lives in it,
    // so it outlives the callback.
    let version = &unsafe { callbacks(ud) }.xtversion;
    sys::GhosttyString {
        ptr: version.as_ptr(),
        len: version.len(),
    }
}

unsafe extern "C" fn trampoline_color_scheme(
    _term: sys::GhosttyTerminal,
    ud: *mut c_void,
    out: *mut c_int,
) -> bool {
    // SAFETY: userdata is always our `Callbacks`.
    let Some(f) = unsafe { callbacks(ud) }.on_color_scheme.as_ref() else {
        return false;
    };
    let Some(scheme) = f() else {
        return false;
    };
    let raw = match scheme {
        ColorScheme::Light => sys::GHOSTTY_COLOR_SCHEME_LIGHT,
        ColorScheme::Dark => sys::GHOSTTY_COLOR_SCHEME_DARK,
    };
    // SAFETY: `out` is the terminal's writable out-parameter.
    unsafe { *out = raw };
    true
}

unsafe extern "C" fn trampoline_notification(
    _term: sys::GhosttyTerminal,
    ud: *mut c_void,
    notification: *const sys::GhosttyTerminalDesktopNotification,
) {
    // SAFETY: userdata is always our `Callbacks`; the notification and its
    // strings are lent for this call.
    unsafe {
        if let Some(f) = callbacks(ud).on_notification.as_ref() {
            let n = &*notification;
            f(&ghostty_str(n.title), &ghostty_str(n.body));
        }
    }
}

unsafe extern "C" fn trampoline_progress(
    _term: sys::GhosttyTerminal,
    ud: *mut c_void,
    report: *const sys::GhosttyTerminalProgressReport,
) {
    // SAFETY: userdata is always our `Callbacks`; the report is lent for
    // this call.
    let (cbs, report) = unsafe { (callbacks(ud), &*report) };
    let Some(f) = cbs.on_progress.as_ref() else {
        return;
    };
    let state = match report.state {
        sys::GHOSTTY_TERMINAL_PROGRESS_STATE_REMOVE => ProgressState::Remove,
        sys::GHOSTTY_TERMINAL_PROGRESS_STATE_SET => ProgressState::Set,
        sys::GHOSTTY_TERMINAL_PROGRESS_STATE_ERROR => ProgressState::Error,
        sys::GHOSTTY_TERMINAL_PROGRESS_STATE_INDETERMINATE => ProgressState::Indeterminate,
        sys::GHOSTTY_TERMINAL_PROGRESS_STATE_PAUSE => ProgressState::Pause,
        _ => return,
    };
    f(Progress {
        state,
        percent: u8::try_from(report.progress).ok(),
    });
}

unsafe extern "C" fn trampoline_semantic_prompt(
    _term: sys::GhosttyTerminal,
    ud: *mut c_void,
    event: *const sys::GhosttyTerminalSemanticPrompt,
) {
    // SAFETY: userdata is always our `Callbacks`; the event and its
    // strings are lent for this call.
    let (cbs, event) = unsafe { (callbacks(ud), &*event) };
    let Some(f) = cbs.on_semantic_prompt.as_ref() else {
        return;
    };
    let kind = match event.kind {
        sys::GHOSTTY_SEMANTIC_PROMPT_PROMPT_START => SemanticPromptKind::PromptStart,
        sys::GHOSTTY_SEMANTIC_PROMPT_INPUT_START => SemanticPromptKind::InputStart,
        sys::GHOSTTY_SEMANTIC_PROMPT_OUTPUT_START => SemanticPromptKind::OutputStart,
        sys::GHOSTTY_SEMANTIC_PROMPT_COMMAND_END => SemanticPromptKind::CommandEnd,
        _ => return,
    };
    f(&SemanticPrompt {
        kind,
        exit_code: event.has_exit_code.then_some(event.exit_code),
        // SAFETY: the command string is lent for this call.
        command: unsafe { ghostty_str(event.command) },
    });
}

unsafe extern "C" fn trampoline_size(
    term: sys::GhosttyTerminal,
    ud: *mut c_void,
    out: *mut sys::GhosttySizeReportSize,
) -> bool {
    // SAFETY: userdata is always our `Callbacks`; `out` is the terminal's
    // writable out-parameter.
    let Some(f) = unsafe { callbacks(ud) }.on_size.as_ref() else {
        return false;
    };
    let view = TerminalRef {
        term,
        _scope: PhantomData,
    };
    let Some(size) = f(view) else {
        return false;
    };
    // SAFETY: `out` is the terminal's writable out-parameter.
    unsafe {
        *out = sys::GhosttySizeReportSize {
            rows: size.rows,
            columns: size.columns,
            cell_width: size.cell_width,
            cell_height: size.cell_height,
        };
    }
    true
}

unsafe extern "C" fn trampoline_device_attributes(
    _term: sys::GhosttyTerminal,
    ud: *mut c_void,
    out: *mut sys::GhosttyDeviceAttributes,
) -> bool {
    // SAFETY: userdata is always our `Callbacks`; `out` is the terminal's
    // writable out-parameter.
    let Some(f) = unsafe { callbacks(ud) }.on_device_attributes.as_ref() else {
        return false;
    };
    let attrs = f();
    let mut features = [0; 64];
    let len = attrs.primary.features.len().min(64);
    features[..len].copy_from_slice(&attrs.primary.features[..len]);
    // SAFETY: `out` is the terminal's writable out-parameter, and the
    // feature array is filled to `num_features` above.
    unsafe {
        *out = sys::GhosttyDeviceAttributes {
            primary: sys::GhosttyDeviceAttributesPrimary {
                conformance_level: attrs.primary.level,
                features,
                num_features: len,
            },
            secondary: sys::GhosttyDeviceAttributesSecondary {
                device_type: attrs.secondary.device_type,
                firmware_version: attrs.secondary.firmware_version,
                rom_cartridge: attrs.secondary.rom_cartridge,
            },
            tertiary: sys::GhosttyDeviceAttributesTertiary {
                unit_id: attrs.tertiary.unit_id,
            },
        };
    }
    true
}

unsafe extern "C" fn trampoline_resize_window(
    _term: sys::GhosttyTerminal,
    ud: *mut c_void,
    request: *const sys::GhosttyTerminalResizeWindow,
) {
    // SAFETY: userdata is always our `Callbacks`; the request is lent for
    // this call, and the union is read under the tag that names it.
    let Some(f) = unsafe { callbacks(ud) }.on_resize_window.as_ref() else {
        return;
    };
    // SAFETY: the request is lent for this call.
    let request = unsafe { &*request };
    if request.tag != sys::GHOSTTY_TERMINAL_RESIZE_WINDOW_GRID {
        return;
    }
    // SAFETY: the tag is `RESIZE_WINDOW_GRID`, so `grid` is the active
    // field.
    let grid = unsafe { request.value.grid };
    f(ResizeWindowRequest {
        rows: grid.rows,
        columns: grid.columns,
    });
}

impl Terminal {
    /// A terminal answering XTVERSION as "Zu", with
    /// [`DEFAULT_WORD_BOUNDARIES`] for word selection.
    pub fn new(cols: u16, rows: u16) -> Result<Self, c_int> {
        let mut term: sys::GhosttyTerminal = std::ptr::null_mut();
        // SAFETY: `term` is a valid out-pointer; NULL selects the default
        // allocator.
        check(unsafe { sys::ghostty_terminal_new(std::ptr::null(), &mut term, cols, rows) })?;
        let mut this = Self {
            term,
            callbacks: Box::new(Callbacks {
                write_pty: None,
                on_title: None,
                on_pwd: None,
                on_bell: None,
                on_clipboard: None,
                on_color_scheme: None,
                on_notification: None,
                on_progress: None,
                on_semantic_prompt: None,
                on_size: None,
                on_device_attributes: None,
                on_resize_window: None,
                xtversion: String::new(),
            }),
            word_boundaries: DEFAULT_WORD_BOUNDARIES.iter().map(|&c| c as u32).collect(),
            selection_guards: RefCell::default(),
            search: None,
        };
        let ud = &*this.callbacks as *const Callbacks as *const c_void;
        // SAFETY: the userdata box outlives the handle (both are dropped
        // together, the handle first).
        unsafe { this.set_opt(sys::GHOSTTY_TERMINAL_OPT_USERDATA, ud) };
        this.set_xtversion("Zu");
        Ok(this)
    }

    /// # Safety
    /// `value` must have the type the option documents.
    unsafe fn set_opt(&self, option: c_int, value: *const c_void) {
        // SAFETY: the handle is live; the value type is the caller's contract.
        let _ = unsafe { sys::ghostty_terminal_set(self.term, option, value) };
    }

    /// Route VT query/mode-report replies to the PTY. Must be called before
    /// any [`Self::write`] so queries are answered.
    pub fn set_write_pty(&mut self, f: WritePtyFn) {
        self.callbacks.write_pty = Some(f);
        let cb = trampoline_write_pty as sys::GhosttyTerminalWritePtyFn;
        // SAFETY: the option takes a `GhosttyTerminalWritePtyFn`.
        unsafe { self.set_opt(sys::GHOSTTY_TERMINAL_OPT_WRITE_PTY, cb as *const c_void) };
    }

    /// Notify on OSC 0/2 title changes; read [`Self::title`] in the handler.
    pub fn set_on_title(&mut self, f: EffectFn) {
        self.callbacks.on_title = Some(f);
        let cb = trampoline_title as sys::GhosttyTerminalEffectFn;
        // SAFETY: the option takes a `GhosttyTerminalTitleChangedFn`.
        unsafe { self.set_opt(sys::GHOSTTY_TERMINAL_OPT_TITLE_CHANGED, cb as *const c_void) };
    }

    /// Notify on OSC 7 / OSC 9 / OSC 1337 pwd changes; read [`Self::pwd`]
    /// in the handler (the raw value: OSC 7 gives a `file://` URI).
    pub fn set_on_pwd(&mut self, f: EffectFn) {
        self.callbacks.on_pwd = Some(f);
        let cb = trampoline_pwd as sys::GhosttyTerminalEffectFn;
        // SAFETY: the option takes a `GhosttyTerminalPwdChangedFn`.
        unsafe { self.set_opt(sys::GHOSTTY_TERMINAL_OPT_PWD_CHANGED, cb as *const c_void) };
    }

    /// Notify on BEL.
    pub fn set_on_bell(&mut self, f: EffectFn) {
        self.callbacks.on_bell = Some(f);
        let cb = trampoline_bell as sys::GhosttyTerminalEffectFn;
        // SAFETY: the option takes a `GhosttyTerminalBellFn`.
        unsafe { self.set_opt(sys::GHOSTTY_TERMINAL_OPT_BELL, cb as *const c_void) };
    }

    /// Clipboard writes (`OSC 52`, `OSC 1337`, `OSC 5522`).
    pub fn set_on_clipboard_write(&mut self, f: ClipboardFn) {
        self.callbacks.on_clipboard = Some(f);
        let cb = trampoline_clipboard as sys::GhosttyTerminalClipboardWriteFn;
        // SAFETY: the option takes a `GhosttyTerminalClipboardWriteFn`.
        unsafe {
            self.set_opt(
                sys::GHOSTTY_TERMINAL_OPT_CLIPBOARD_WRITE,
                cb as *const c_void,
            )
        };
    }

    /// Answer color-scheme queries (`CSI ? 996 n`); `None` leaves one
    /// unanswered.
    pub fn set_on_color_scheme(&mut self, f: ColorSchemeFn) {
        self.callbacks.on_color_scheme = Some(f);
        let cb = trampoline_color_scheme as sys::GhosttyTerminalColorSchemeFn;
        // SAFETY: the option takes a `GhosttyTerminalColorSchemeFn`.
        unsafe { self.set_opt(sys::GHOSTTY_TERMINAL_OPT_COLOR_SCHEME, cb as *const c_void) };
    }

    /// Desktop notifications (`OSC 9`, `OSC 777;notify`) as (title, body);
    /// the title is empty when the protocol has none.
    pub fn set_on_notification(&mut self, f: NotificationFn) {
        self.callbacks.on_notification = Some(f);
        let cb = trampoline_notification as sys::GhosttyTerminalDesktopNotificationFn;
        // SAFETY: the option takes a `GhosttyTerminalDesktopNotificationFn`.
        unsafe {
            self.set_opt(
                sys::GHOSTTY_TERMINAL_OPT_DESKTOP_NOTIFICATION,
                cb as *const c_void,
            )
        };
    }

    /// Progress reports (`OSC 9;4`).
    pub fn set_on_progress(&mut self, f: ProgressFn) {
        self.callbacks.on_progress = Some(f);
        let cb = trampoline_progress as sys::GhosttyTerminalProgressReportFn;
        // SAFETY: the option takes a `GhosttyTerminalProgressReportFn`.
        unsafe {
            self.set_opt(
                sys::GHOSTTY_TERMINAL_OPT_PROGRESS_REPORT,
                cb as *const c_void,
            )
        };
    }

    /// Shell-integration steps (`OSC 133`), after the screen has updated.
    pub fn set_on_semantic_prompt(&mut self, f: SemanticPromptFn) {
        self.callbacks.on_semantic_prompt = Some(f);
        let cb = trampoline_semantic_prompt as sys::GhosttyTerminalSemanticPromptFn;
        // SAFETY: the option takes a `GhosttyTerminalSemanticPromptFn`.
        unsafe {
            self.set_opt(
                sys::GHOSTTY_TERMINAL_OPT_SEMANTIC_PROMPT,
                cb as *const c_void,
            )
        };
    }

    /// The XTVERSION (`CSI > q`) answer; empty reports "libghostty".
    pub fn set_xtversion(&mut self, version: &str) {
        self.callbacks.xtversion = version.to_owned();
        let cb = trampoline_xtversion as sys::GhosttyTerminalXtversionFn;
        // SAFETY: the option takes a `GhosttyTerminalXtversionFn`.
        unsafe { self.set_opt(sys::GHOSTTY_TERMINAL_OPT_XTVERSION, cb as *const c_void) };
    }

    /// Answer XTWINOPS size queries (`CSI 14/16/18/19 t`) and mode-2048
    /// reports; `None` leaves one unanswered. The callback sees the
    /// terminal as the program has made it so far.
    pub fn set_on_size(&mut self, f: SizeFn) {
        self.callbacks.on_size = Some(f);
        let cb = trampoline_size as sys::GhosttyTerminalSizeFn;
        // SAFETY: the option takes a `GhosttyTerminalSizeFn`.
        unsafe { self.set_opt(sys::GHOSTTY_TERMINAL_OPT_SIZE, cb as *const c_void) };
    }

    /// Answer device-attributes queries (`CSI c`, `CSI > c`, `CSI = c`).
    /// Unset leaves them unanswered.
    pub fn set_on_device_attributes(&mut self, f: DeviceAttributesFn) {
        self.callbacks.on_device_attributes = Some(f);
        let cb = trampoline_device_attributes as sys::GhosttyTerminalDeviceAttributesFn;
        // SAFETY: the option takes a `GhosttyTerminalDeviceAttributesFn`.
        unsafe {
            self.set_opt(
                sys::GHOSTTY_TERMINAL_OPT_DEVICE_ATTRIBUTES,
                cb as *const c_void,
            )
        };
    }

    /// Hear the program's window-resize requests (`CSI 8 t`); the grid is
    /// not touched, the handler decides.
    pub fn set_on_resize_window(&mut self, f: ResizeWindowFn) {
        self.callbacks.on_resize_window = Some(f);
        let cb = trampoline_resize_window as sys::GhosttyTerminalResizeWindowFn;
        // SAFETY: the option takes a `GhosttyTerminalResizeWindowFn`.
        unsafe { self.set_opt(sys::GHOSTTY_TERMINAL_OPT_RESIZE_WINDOW, cb as *const c_void) };
    }

    /// Whether DECRQCRA (`CSI Pi ; Pg ; Pt ; Pl ; Pb ; Pr * y`) is answered
    /// at all. Off by default: a program can checksum the screen cell by
    /// cell and read back everything on it.
    pub fn set_xt_checksum_report(&self, enabled: bool) {
        // SAFETY: the option takes a `bool*`, copied during the call.
        unsafe {
            self.set_opt(
                sys::GHOSTTY_TERMINAL_OPT_XT_CHECKSUM_REPORT,
                &enabled as *const bool as *const c_void,
            )
        };
    }

    /// How DECRQCRA computes after a reset (and from now on). See
    /// [`XtChecksumFlags`]; esctest's `--xterm-checksum=411` wants the
    /// `23` of xterm's `checksumExtension`.
    pub fn set_xt_checksum_extension(&self, flags: XtChecksumFlags) {
        let bits = flags.bits();
        // SAFETY: the option takes a `uint8_t*`, copied during the call.
        unsafe {
            self.set_opt(
                sys::GHOSTTY_TERMINAL_OPT_XT_CHECKSUM_EXTENSION,
                &bits as *const u8 as *const c_void,
            )
        };
    }

    /// The whole terminal — scrollback and screen — as plain text.
    pub fn text_all(&self) -> String {
        let mut formatter: sys::GhosttyFormatter = std::ptr::null_mut();
        let options = sys::GhosttyFormatterTerminalOptions {
            size: std::mem::size_of::<sys::GhosttyFormatterTerminalOptions>(),
            emit: sys::GHOSTTY_FORMATTER_FORMAT_PLAIN,
            unwrap: false,
            trim: true,
            extra: sys::GhosttyFormatterTerminalExtra {
                size: std::mem::size_of::<sys::GhosttyFormatterTerminalExtra>(),
                ..Default::default()
            },
            selection: std::ptr::null(),
        };
        // SAFETY: the handle is live; the formatter is freed before return
        // and every buffer passed is sized as declared.
        unsafe {
            if sys::ghostty_formatter_terminal_new(
                std::ptr::null(),
                &mut formatter,
                self.term,
                options,
            ) != sys::GHOSTTY_SUCCESS
            {
                return String::new();
            }
            let mut needed = 0usize;
            let _ =
                sys::ghostty_formatter_format_buf(formatter, std::ptr::null_mut(), 0, &mut needed);
            let mut buf = vec![0u8; needed];
            let rc = sys::ghostty_formatter_format_buf(
                formatter,
                buf.as_mut_ptr(),
                buf.len(),
                &mut needed,
            );
            sys::ghostty_formatter_free(formatter);
            if rc != sys::GHOSTTY_SUCCESS {
                return String::new();
            }
            buf.truncate(needed);
            String::from_utf8_lossy(&buf).into_owned()
        }
    }

    /// The hyperlink (`OSC 8`) at a viewport cell — the rows on screen,
    /// wherever the viewport is scrolled — if any.
    pub fn hyperlink_at(&self, x: u16, y: u16) -> Option<String> {
        let reference = self.viewport_ref(x, y)?;
        let mut len = 0usize;
        // SAFETY: a fresh grid ref; a NULL buffer only queries the length.
        let rc = unsafe {
            sys::ghostty_grid_ref_hyperlink_uri(&reference, std::ptr::null_mut(), 0, &mut len)
        };
        if len == 0 || (rc != sys::GHOSTTY_OUT_OF_SPACE && rc != sys::GHOSTTY_SUCCESS) {
            return None;
        }
        let mut buf = vec![0u8; len];
        // SAFETY: the same ref (no mutation since); `buf` holds `len` bytes.
        let rc = unsafe {
            sys::ghostty_grid_ref_hyperlink_uri(&reference, buf.as_mut_ptr(), buf.len(), &mut len)
        };
        if rc != sys::GHOSTTY_SUCCESS {
            return None;
        }
        buf.truncate(len);
        Some(String::from_utf8_lossy(&buf).into_owned())
    }

    /// The text between two screen points (scrollback included, inclusive
    /// cells), one line per row.
    pub fn selection_text(&self, start: (u16, usize), end: (u16, usize)) -> String {
        let total = self.total_rows().max(1);
        let (Some(start_ref), Some(end_ref)) = (
            self.screen_ref(start.0, start.1.min(total - 1)),
            self.screen_ref(end.0, end.1.min(total - 1)),
        ) else {
            return String::new();
        };
        let selection = sys::GhosttySelection {
            start: start_ref,
            end: end_ref,
            ..Default::default()
        };
        self.format_selection(Some(&selection), false)
            .unwrap_or_default()
    }

    /// Format a snapshot selection (or the active one, for `None`) as plain
    /// trimmed text. `None` when there is nothing to format.
    fn format_selection(
        &self,
        selection: Option<&sys::GhosttySelection>,
        unwrap: bool,
    ) -> Option<String> {
        let options = sys::GhosttyTerminalSelectionFormatOptions {
            size: std::mem::size_of::<sys::GhosttyTerminalSelectionFormatOptions>(),
            emit: sys::GHOSTTY_FORMATTER_FORMAT_PLAIN,
            unwrap,
            trim: true,
            selection: selection.map_or(std::ptr::null(), |s| s as *const _),
        };
        let mut needed = 0usize;
        // SAFETY: the handle is live; the selection (if any) is a fresh
        // snapshot; a NULL buffer only queries the size.
        let rc = unsafe {
            sys::ghostty_terminal_selection_format_buf(
                self.term,
                options,
                std::ptr::null_mut(),
                0,
                &mut needed,
            )
        };
        if rc != sys::GHOSTTY_SUCCESS && rc != sys::GHOSTTY_OUT_OF_SPACE {
            return None;
        }
        let mut buf = vec![0u8; needed];
        // SAFETY: as above; `buf` holds `needed` bytes.
        let rc = unsafe {
            sys::ghostty_terminal_selection_format_buf(
                self.term,
                options,
                buf.as_mut_ptr(),
                buf.len(),
                &mut needed,
            )
        };
        if rc != sys::GHOSTTY_SUCCESS {
            return None;
        }
        buf.truncate(needed);
        Some(String::from_utf8_lossy(&buf).into_owned())
    }

    /// An untracked reference to a viewport cell, valid until the next
    /// mutation.
    fn viewport_ref(&self, x: u16, y: u16) -> Option<sys::GhosttyGridRef> {
        self.grid_ref(sys::GhosttyPoint::viewport(x, y))
    }

    fn screen_ref(&self, x: u16, y: usize) -> Option<sys::GhosttyGridRef> {
        self.grid_ref(sys::GhosttyPoint::screen(x, y))
    }

    fn grid_ref(&self, point: sys::GhosttyPoint) -> Option<sys::GhosttyGridRef> {
        let mut reference = sys::GhosttyGridRef::default();
        // SAFETY: the handle is live and `reference` a sized out-struct.
        let rc = unsafe { sys::ghostty_terminal_grid_ref(self.term, point, &mut reference) };
        (rc == sys::GHOSTTY_SUCCESS).then_some(reference)
    }

    /// The (col, row) of a fresh grid ref in `tag`'s coordinate space.
    fn point_of(&self, reference: &sys::GhosttyGridRef, tag: c_int) -> Option<(u16, usize)> {
        let mut out = sys::GhosttyPointCoordinate::default();
        // SAFETY: the ref is a fresh snapshot from this terminal.
        let rc = unsafe {
            sys::ghostty_terminal_point_from_grid_ref(self.term, reference, tag, &mut out)
        };
        (rc == sys::GHOSTTY_SUCCESS).then_some((out.x, out.y as usize))
    }

    /// The scrollable area: total rows, the viewport's offset, its length.
    pub fn scrollbar(&self) -> sys::GhosttyTerminalScrollbar {
        let mut bar = sys::GhosttyTerminalScrollbar::default();
        // SAFETY: the data kind writes a `GhosttyTerminalScrollbar`.
        unsafe { self.get(sys::GHOSTTY_TERMINAL_DATA_SCROLLBAR, &mut bar) };
        bar
    }

    /// Scrolls the viewport so `row` is its first visible row (clamped).
    pub fn scroll_to_row(&self, row: usize) {
        self.scroll(sys::GhosttyTerminalScrollViewport {
            tag: sys::GHOSTTY_SCROLL_VIEWPORT_ROW,
            value: sys::GhosttyTerminalScrollViewportValue { row },
        });
    }

    /// Moves the viewport top by `delta` shell prompts (`OSC 133;A`):
    /// negative is older. A no-op without prompt marks.
    pub fn scroll_to_prompt(&self, delta: isize) {
        self.scroll(sys::GhosttyTerminalScrollViewport::delta_prompt(delta));
    }

    fn scroll(&self, behavior: sys::GhosttyTerminalScrollViewport) {
        // SAFETY: the handle is live; the tag matches the union field set.
        unsafe { sys::ghostty_terminal_scroll_viewport(self.term, behavior) }
    }

    /// How many lines of scrollback to keep (0 disables it).
    pub fn set_scrollback_lines(&self, lines: usize) {
        // SAFETY: the option takes a `size_t*`.
        unsafe {
            self.set_opt(
                sys::GHOSTTY_TERMINAL_OPT_SCROLLBACK_MAX_LINES,
                &lines as *const usize as *const c_void,
            )
        };
    }

    /// # Safety
    /// `T` must be the output type `data` documents.
    unsafe fn get<T>(&self, data: c_int, out: &mut T) -> bool {
        // SAFETY: the handle is live; the output type is the caller's
        // contract.
        let rc =
            unsafe { sys::ghostty_terminal_get(self.term, data, out as *mut T as *mut c_void) };
        rc == sys::GHOSTTY_SUCCESS
    }

    /// Whether the program set a DEC private / ANSI mode.
    pub fn mode(&self, value: u16, ansi: bool) -> bool {
        let mut cfg = sys::GhosttyTerminalModeConfig {
            mode: sys::ghostty_mode_new(value, ansi),
            value: false,
        };
        // SAFETY: the data kind reads and writes a `GhosttyTerminalModeConfig`.
        unsafe { self.get(sys::GHOSTTY_TERMINAL_DATA_MODE, &mut cfg) && cfg.value }
    }

    /// `DECCKM` (application cursor keys).
    pub fn application_cursor(&self) -> bool {
        self.mode(1, false)
    }

    /// Bracketed paste (`?2004`).
    pub fn bracketed_paste(&self) -> bool {
        self.mode(2004, false)
    }

    /// Focus reporting (`?1004`): send [`focus_encode`] on focus changes.
    pub fn focus_reporting(&self) -> bool {
        self.mode(1004, false)
    }

    /// Alternate scroll (`?1007`): on the alternate screen without mouse
    /// tracking, the wheel should send arrow keys instead of scrolling.
    pub fn alternate_scroll(&self) -> bool {
        self.mode(1007, false)
    }

    /// Whether any mouse tracking mode is on.
    pub fn mouse_tracking(&self) -> bool {
        let mut on = false;
        // SAFETY: the data kind writes a `bool`.
        unsafe { self.get(sys::GHOSTTY_TERMINAL_DATA_MOUSE_TRACKING, &mut on) };
        on
    }

    /// Whether the program asked for SGR mouse reports (`?1006`).
    pub fn mouse_sgr(&self) -> bool {
        self.mode(1006, false)
    }

    /// Which tracking mode: `Some(1003)` any-event, `Some(1002)` button,
    /// `Some(1000)` normal, `Some(9)` X10, `None` off.
    pub fn mouse_mode(&self) -> Option<u16> {
        [1003, 1002, 1000, 9]
            .into_iter()
            .find(|&m| self.mode(m, false))
    }

    pub fn cursor_visible(&self) -> bool {
        let mut visible = false;
        // SAFETY: the data kind writes a `bool`.
        unsafe { self.get(sys::GHOSTTY_TERMINAL_DATA_CURSOR_VISIBLE, &mut visible) };
        visible
    }

    /// Whether the cursor sits past the last column: the next printed
    /// character soft-wraps first.
    pub fn cursor_pending_wrap(&self) -> bool {
        let mut pending = false;
        // SAFETY: the data kind writes a `bool`.
        unsafe { self.get(sys::GHOSTTY_TERMINAL_DATA_CURSOR_PENDING_WRAP, &mut pending) };
        pending
    }

    pub fn cursor_position(&self) -> (u16, u16) {
        let (mut x, mut y): (u16, u16) = (0, 0);
        // SAFETY: both data kinds write a `uint16_t`.
        unsafe {
            self.get(sys::GHOSTTY_TERMINAL_DATA_CURSOR_X, &mut x);
            self.get(sys::GHOSTTY_TERMINAL_DATA_CURSOR_Y, &mut y);
        }
        (x, y)
    }

    pub fn total_rows(&self) -> usize {
        let mut rows = 0usize;
        // SAFETY: the data kind writes a `size_t`.
        unsafe { self.get(sys::GHOSTTY_TERMINAL_DATA_TOTAL_ROWS, &mut rows) };
        rows
    }

    pub fn scrollback_rows(&self) -> usize {
        let mut rows = 0usize;
        // SAFETY: the data kind writes a `size_t`.
        unsafe { self.get(sys::GHOSTTY_TERMINAL_DATA_SCROLLBACK_ROWS, &mut rows) };
        rows
    }

    pub fn active_screen(&self) -> c_int {
        let mut screen = sys::GHOSTTY_TERMINAL_SCREEN_PRIMARY;
        // SAFETY: the data kind writes a `GhosttyTerminalScreen` (a C int).
        unsafe { self.get(sys::GHOSTTY_TERMINAL_DATA_ACTIVE_SCREEN, &mut screen) };
        screen
    }

    pub fn scroll_top(&self) {
        self.scroll(sys::GhosttyTerminalScrollViewport {
            tag: sys::GHOSTTY_SCROLL_VIEWPORT_TOP,
            value: sys::GhosttyTerminalScrollViewportValue { delta: 0 },
        });
    }

    /// A full reset (`ESC c`): clears the screen and the scrollback and
    /// returns the modes to their defaults.
    pub fn reset(&self) {
        // SAFETY: the handle is live.
        unsafe { sys::ghostty_terminal_reset(self.term) }
    }

    /// Feed raw PTY output into the emulation core. Fires callbacks (pty
    /// replies, title changes) synchronously on the calling thread.
    pub fn write(&self, bytes: &[u8]) {
        // SAFETY: the handle is live; `bytes` is a valid slice.
        unsafe { sys::ghostty_terminal_vt_write(self.term, bytes.as_ptr(), bytes.len()) }
    }

    pub fn resize(
        &self,
        cols: u16,
        rows: u16,
        cell_w_px: u32,
        cell_h_px: u32,
    ) -> Result<(), c_int> {
        // SAFETY: the handle is live.
        check(unsafe { sys::ghostty_terminal_resize(self.term, cols, rows, cell_w_px, cell_h_px) })
    }

    pub fn scroll_delta(&self, lines: isize) {
        self.scroll(sys::GhosttyTerminalScrollViewport::delta(lines));
    }

    pub fn scroll_bottom(&self) {
        self.scroll(sys::GhosttyTerminalScrollViewport::bottom());
    }

    pub fn title(&self) -> Option<String> {
        self.get_string(sys::GHOSTTY_TERMINAL_DATA_TITLE)
    }

    /// The grid's width in cells, as the kernel sees it. The kernel can
    /// resize itself (DECCOLM under DEC mode 40) without the embedder.
    pub fn cols(&self) -> Option<u16> {
        let mut cols: u16 = 0;
        // SAFETY: the data kind writes a `uint16_t`.
        unsafe { self.get(sys::GHOSTTY_TERMINAL_DATA_COLS, &mut cols) }.then_some(cols)
    }

    /// The grid's height in cells, as the kernel sees it.
    pub fn rows(&self) -> Option<u16> {
        let mut rows: u16 = 0;
        // SAFETY: the data kind writes a `uint16_t`.
        unsafe { self.get(sys::GHOSTTY_TERMINAL_DATA_ROWS, &mut rows) }.then_some(rows)
    }

    pub fn pwd(&self) -> Option<String> {
        self.get_string(sys::GHOSTTY_TERMINAL_DATA_PWD)
    }

    /// Set the default foreground/background the render state resolves
    /// against (palette overrides from programs still win per-index).
    pub fn set_default_colors(&self, fg: Rgb, bg: Rgb) {
        let (f, b): (sys::GhosttyColorRgb, sys::GhosttyColorRgb) = (fg.into(), bg.into());
        // SAFETY: both options take a `GhosttyColorRgb*`.
        unsafe {
            self.set_opt(
                sys::GHOSTTY_TERMINAL_OPT_COLOR_FOREGROUND,
                &f as *const _ as *const c_void,
            );
            self.set_opt(
                sys::GHOSTTY_TERMINAL_OPT_COLOR_BACKGROUND,
                &b as *const _ as *const c_void,
            );
        }
    }

    /// The default 256-color palette; programs' OSC 4 overrides still win.
    pub fn set_palette(&self, palette: &[Rgb; 256]) {
        let raw: [sys::GhosttyColorRgb; 256] = palette.map(Into::into);
        // SAFETY: the option takes a pointer to exactly 256 colors.
        unsafe {
            self.set_opt(
                sys::GHOSTTY_TERMINAL_OPT_COLOR_PALETTE,
                raw.as_ptr() as *const c_void,
            )
        };
    }

    /// The default cursor color; `None` leaves the cursor to the renderer.
    pub fn set_default_cursor_color(&self, color: Option<Rgb>) {
        let raw: Option<sys::GhosttyColorRgb> = color.map(Into::into);
        let ptr = raw
            .as_ref()
            .map_or(std::ptr::null(), |c| c as *const _ as *const c_void);
        // SAFETY: the option takes a `GhosttyColorRgb*`; NULL clears it.
        unsafe { self.set_opt(sys::GHOSTTY_TERMINAL_OPT_COLOR_CURSOR, ptr) };
    }

    /// The cursor a DECSCUSR reset (`CSI 0 q`) returns to, and the one
    /// shown before the program picks its own.
    pub fn set_default_cursor_style(&self, style: CursorStyle, blink: bool) {
        let raw = style.raw();
        // SAFETY: the options take a `GhosttyTerminalCursorStyle*` and a
        // `bool*`.
        unsafe {
            self.set_opt(
                sys::GHOSTTY_TERMINAL_OPT_DEFAULT_CURSOR_STYLE,
                &raw as *const c_int as *const c_void,
            );
            self.set_opt(
                sys::GHOSTTY_TERMINAL_OPT_DEFAULT_CURSOR_BLINK,
                &blink as *const bool as *const c_void,
            );
        }
    }

    pub fn kitty_keyboard_flags(&self) -> u8 {
        let mut flags: u8 = 0;
        // SAFETY: the data kind writes a `uint8_t`.
        unsafe { self.get(sys::GHOSTTY_TERMINAL_DATA_KITTY_KEYBOARD_FLAGS, &mut flags) };
        flags
    }

    /// The find-bar search over this terminal (scrollback included),
    /// created on first use. It lives until [`Self::end_search`] or the
    /// terminal's drop.
    pub fn search(&mut self) -> Result<&mut Search, c_int> {
        if self.search.is_none() {
            self.search = Some(Search::new(self.term)?);
        }
        Ok(self.search.as_mut().expect("the search was just created"))
    }

    /// The search while one is open; `None` after [`Self::end_search`].
    pub fn active_search(&mut self) -> Option<&mut Search> {
        self.search.as_mut()
    }

    /// Make the search's selected match the active selection (what copy
    /// takes). False without a search or a selected match.
    pub fn select_found(&self) -> bool {
        let Some(found) = self.search.as_ref().and_then(Search::selected_raw) else {
            return false;
        };
        self.install(Some(&found));
        true
    }

    /// Close the search and release what it tracks in the terminal.
    pub fn end_search(&mut self) {
        self.search = None;
    }

    /// Paste text: handles bracketed-paste mode and unsafe-paste rejection
    /// internally. Returns whether the bytes were written to the pty.
    pub fn paste(&self, text: &str) -> Result<bool, c_int> {
        struct PasteCtx {
            ptr: *const u8,
            len: usize,
        }

        unsafe extern "C" fn read_mime(
            ud: *mut c_void,
            _mime: sys::GhosttyString,
            writer: sys::GhosttyWriter,
        ) -> bool {
            // SAFETY: `ud` is the `PasteCtx` on the caller's stack, alive for
            // the whole paste call; the writer is the library's.
            unsafe {
                let ctx = &*(ud as *const PasteCtx);
                (writer.write.unwrap())(writer.userdata, ctx.ptr, ctx.len)
            }
        }

        let mime = CString::new("text/plain").unwrap();
        let mime = sys::GhosttyString {
            ptr: mime.as_ptr() as *const u8,
            len: mime.as_bytes_with_nul().len() - 1,
        };
        let mimes = [mime];
        let ctx = PasteCtx {
            ptr: text.as_ptr(),
            len: text.len(),
        };
        let paste = sys::GhosttyPaste {
            size: std::mem::size_of::<sys::GhosttyPaste>(),
            location: sys::GHOSTTY_CLIPBOARD_LOCATION_STANDARD,
            source: sys::GHOSTTY_PASTE_SOURCE_TEXT,
            mimes: mimes.as_ptr(),
            mimes_len: mimes.len(),
            reader: sys::GhosttyMimeReader {
                read: Some(read_mime),
                userdata: &ctx as *const PasteCtx as *mut c_void,
            },
            allow_unsafe: false,
        };
        let mut written = false;
        // SAFETY: every pointer in `paste` outlives the call.
        let rc = unsafe { sys::ghostty_terminal_paste(self.term, &paste, &mut written) };
        check(rc).map(|()| written)
    }

    fn get_string(&self, data: c_int) -> Option<String> {
        let mut s = sys::GhosttyString {
            ptr: std::ptr::null(),
            len: 0,
        };
        // SAFETY: the data kind writes a borrowed `GhosttyString`, copied
        // out before any mutation.
        unsafe {
            if !self.get(data, &mut s) || s.ptr.is_null() {
                return None;
            }
            Some(ghostty_str(s))
        }
    }
}

impl Drop for Terminal {
    fn drop(&mut self) {
        self.search = None;
        *self.selection_guards.get_mut() = Default::default();
        // SAFETY: the handle is live and never used again.
        unsafe { sys::ghostty_terminal_free(self.term) }
    }
}

// ---------------------------------------------------------------------------
// Render state
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Dirty {
    Clean,
    Partial,
    Full,
}

pub struct CursorPos {
    pub x: u16,
    pub y: u16,
    pub wide_tail: bool,
    pub visible: bool,
    /// Follows DECSCUSR (odd styles blink) and the default set with
    /// [`Terminal::set_default_cursor_style`].
    pub blinking: bool,
    pub style: c_int,
}

#[derive(Clone)]
pub struct Cell {
    /// UTF-8 grapheme cluster; empty means a blank cell.
    pub text: String,
    /// `GHOSTTY_CELL_WIDE_*`: a wide cell takes two columns; a spacer tail
    /// is the cell after it and draws nothing.
    pub wide: c_int,
    /// What the program set, `None` the default.
    pub fg: Option<Color>,
    pub bg: Option<Color>,
    /// The colors the program asked for, resolved (palette applied).
    pub fg_resolved: Rgb,
    pub bg_resolved: Rgb,
    pub bold: bool,
    pub italic: bool,
    pub faint: bool,
    pub inverse: bool,
    pub strikethrough: bool,
    pub invisible: bool,
    /// One of the `GHOSTTY_SGR_UNDERLINE_*` values.
    pub underline: c_int,
}

pub struct FrameColors {
    pub background: Rgb,
    pub foreground: Rgb,
    /// `Some` only when the program set an explicit cursor color.
    pub cursor: Option<Rgb>,
}

pub struct Frame {
    pub cols: u16,
    pub rows: u16,
    pub colors: FrameColors,
    pub cursor: Option<CursorPos>,
    /// Exactly `rows` rows of `cols` cells.
    pub cells: Vec<Vec<Cell>>,
    /// Per row (parallel to `cells`): the terminal's active selection on
    /// it as inclusive columns.
    pub selection: Vec<Option<(u16, u16)>>,
}

pub struct RenderState {
    rs: sys::GhosttyRenderState,
    row_iter: sys::GhosttyRenderStateRowIterator,
    cells: sys::GhosttyRenderStateRowCells,
}

impl RenderState {
    pub fn new() -> Result<Self, c_int> {
        // SAFETY: valid out-pointers; NULL selects the default allocator.
        unsafe {
            let mut rs: sys::GhosttyRenderState = std::ptr::null_mut();
            check(sys::ghostty_render_state_new(std::ptr::null(), &mut rs))?;
            let mut row_iter: sys::GhosttyRenderStateRowIterator = std::ptr::null_mut();
            check(sys::ghostty_render_state_row_iterator_new(
                std::ptr::null(),
                &mut row_iter,
            ))?;
            let mut cells: sys::GhosttyRenderStateRowCells = std::ptr::null_mut();
            check(sys::ghostty_render_state_row_cells_new(
                std::ptr::null(),
                &mut cells,
            ))?;
            Ok(Self {
                rs,
                row_iter,
                cells,
            })
        }
    }

    /// Snapshot the whole viewport into owned data so the terminal lock can be
    /// released before shaping/painting.
    pub fn snapshot(&mut self, term: &Terminal) -> Result<Frame, c_int> {
        term.drop_lost_selection();
        // SAFETY: all handles are live; every out-parameter has the type its
        // data kind documents; row and cell data are read before the next
        // update.
        unsafe {
            check(sys::ghostty_render_state_update(self.rs, term.term))?;

            let mut cols: u16 = 0;
            let mut rows: u16 = 0;
            check(sys::ghostty_render_state_get(
                self.rs,
                sys::GHOSTTY_RENDER_STATE_DATA_COLS,
                &mut cols as *mut _ as *mut c_void,
            ))?;
            check(sys::ghostty_render_state_get(
                self.rs,
                sys::GHOSTTY_RENDER_STATE_DATA_ROWS,
                &mut rows as *mut _ as *mut c_void,
            ))?;

            let mut colors = sys::GhosttyRenderStateColors::default();
            check(sys::ghostty_render_state_get(
                self.rs,
                sys::GHOSTTY_RENDER_STATE_DATA_COLORS,
                &mut colors as *mut _ as *mut c_void,
            ))?;

            let mut cursor = sys::GhosttyRenderStateCursor::default();
            let has_cursor = sys::ghostty_render_state_get(
                self.rs,
                sys::GHOSTTY_RENDER_STATE_DATA_CURSOR,
                &mut cursor as *mut _ as *mut c_void,
            ) == sys::GHOSTTY_SUCCESS;

            let mut out = Frame {
                cols,
                rows,
                colors: FrameColors {
                    background: colors.background.into(),
                    foreground: colors.foreground.into(),
                    cursor: colors.cursor_has_value.then(|| colors.cursor.into()),
                },
                cursor: None,
                cells: Vec::with_capacity(rows as usize),
                selection: Vec::with_capacity(rows as usize),
            };

            check(sys::ghostty_render_state_get(
                self.rs,
                sys::GHOSTTY_RENDER_STATE_DATA_ROW_ITERATOR,
                &mut self.row_iter as *mut _ as *mut c_void,
            ))?;
            while sys::ghostty_render_state_row_iterator_next(self.row_iter) {
                let mut selection = sys::GhosttyRenderStateRowSelection::default();
                let selected = sys::ghostty_render_state_row_get(
                    self.row_iter,
                    sys::GHOSTTY_RENDER_STATE_ROW_DATA_SELECTION,
                    &mut selection as *mut _ as *mut c_void,
                ) == sys::GHOSTTY_SUCCESS;
                out.selection
                    .push(selected.then_some((selection.start_x, selection.end_x)));

                let mut row_cells: Vec<Cell> = Vec::with_capacity(cols as usize);
                check(sys::ghostty_render_state_row_get(
                    self.row_iter,
                    sys::GHOSTTY_RENDER_STATE_ROW_DATA_CELLS,
                    &mut self.cells as *mut _ as *mut c_void,
                ))?;
                let default_fg = colors.foreground;
                let default_bg = colors.background;
                while sys::ghostty_render_state_row_cells_next(self.cells) {
                    row_cells.push(self.read_cell(default_fg, default_bg));
                }
                out.cells.push(row_cells);
            }

            if has_cursor && cursor.viewport_has_value {
                out.cursor = Some(CursorPos {
                    x: cursor.viewport_x,
                    y: cursor.viewport_y,
                    wide_tail: cursor.wide_tail,
                    visible: cursor.visible,
                    blinking: cursor.blinking,
                    style: cursor.visual_style,
                });
            }

            check(sys::ghostty_render_state_clean(self.rs))?;
            Ok(out)
        }
    }

    /// Cells without explicit styling report `GHOSTTY_INVALID_VALUE` for
    /// their resolved colors (with zeroed RGB); fall back to the frame's
    /// default colors there.
    ///
    /// # Safety
    /// `self.cells` must be positioned on a cell of the current update.
    unsafe fn read_cell(
        &self,
        default_fg: sys::GhosttyColorRgb,
        default_bg: sys::GhosttyColorRgb,
    ) -> Cell {
        // SAFETY: per the contract the cell iterator is valid; each
        // out-parameter has its data kind's type and buffers their stated
        // capacity.
        unsafe {
            let mut raw: sys::GhosttyCell = 0;
            let mut wide = sys::GHOSTTY_CELL_WIDE_NARROW;
            if sys::ghostty_render_state_row_cells_get(
                self.cells,
                sys::GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_RAW,
                &mut raw as *mut _ as *mut c_void,
            ) == sys::GHOSTTY_SUCCESS
            {
                let _ = sys::ghostty_cell_get(
                    raw,
                    sys::GHOSTTY_CELL_DATA_WIDE,
                    &mut wide as *mut _ as *mut c_void,
                );
            }
            let mut buf = [0u8; 64];
            let mut gb = sys::GhosttyBuffer::sized(&mut buf);
            let mut rc = sys::ghostty_render_state_row_cells_get(
                self.cells,
                sys::GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_GRAPHEMES_UTF8,
                &mut gb as *mut _ as *mut c_void,
            );
            let mut heap: Vec<u8>;
            if rc == sys::GHOSTTY_OUT_OF_SPACE {
                heap = vec![0u8; gb.len];
                gb = sys::GhosttyBuffer::sized(&mut heap);
                rc = sys::ghostty_render_state_row_cells_get(
                    self.cells,
                    sys::GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_GRAPHEMES_UTF8,
                    &mut gb as *mut _ as *mut c_void,
                );
            }
            let text = if rc == sys::GHOSTTY_SUCCESS && gb.len > 0 {
                String::from_utf8_lossy(std::slice::from_raw_parts(gb.ptr, gb.len)).into_owned()
            } else {
                String::new()
            };

            let mut style = sys::GhosttyStyle::default();
            sys::ghostty_render_state_row_cells_get(
                self.cells,
                sys::GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_STYLE,
                &mut style as *mut _ as *mut c_void,
            );
            let mut fg = default_fg;
            let mut bg = default_bg;
            let fg_rc = sys::ghostty_render_state_row_cells_get(
                self.cells,
                sys::GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_FG_COLOR,
                &mut fg as *mut _ as *mut c_void,
            );
            if fg_rc != sys::GHOSTTY_SUCCESS {
                fg = default_fg;
            }
            let bg_rc = sys::ghostty_render_state_row_cells_get(
                self.cells,
                sys::GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_BG_COLOR,
                &mut bg as *mut _ as *mut c_void,
            );
            if bg_rc != sys::GHOSTTY_SUCCESS {
                bg = default_bg;
            }

            Cell {
                text,
                wide,
                fg: style_color(style.fg_color),
                bg: style_color(style.bg_color),
                fg_resolved: fg.into(),
                bg_resolved: bg.into(),
                bold: style.bold,
                italic: style.italic,
                faint: style.faint,
                inverse: style.inverse,
                strikethrough: style.strikethrough,
                invisible: style.invisible,
                underline: style.underline,
            }
        }
    }
}

impl Drop for RenderState {
    fn drop(&mut self) {
        // SAFETY: the handles are live and never used again.
        unsafe {
            sys::ghostty_render_state_row_cells_free(self.cells);
            sys::ghostty_render_state_row_iterator_free(self.row_iter);
            sys::ghostty_render_state_free(self.rs);
        }
    }
}

fn check(rc: c_int) -> Result<(), c_int> {
    (rc == sys::GHOSTTY_SUCCESS).then_some(()).ok_or(rc)
}

// ---------------------------------------------------------------------------
// Key encoding
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum KeyAction {
    Press,
    Repeat,
    Release,
}

/// Wraps a `GhosttyKeyEncoder` + one reusable `GhosttyKeyEvent`.
pub struct KeyEncoder {
    enc: sys::GhosttyKeyEncoder,
    event: sys::GhosttyKeyEvent,
}

impl KeyEncoder {
    pub fn new() -> Result<Self, c_int> {
        // SAFETY: valid out-pointers; NULL selects the default allocator.
        unsafe {
            let mut enc: sys::GhosttyKeyEncoder = std::ptr::null_mut();
            check(sys::ghostty_key_encoder_new(std::ptr::null(), &mut enc))?;
            let mut event: sys::GhosttyKeyEvent = std::ptr::null_mut();
            check(sys::ghostty_key_event_new(std::ptr::null(), &mut event))?;
            Ok(Self { enc, event })
        }
    }

    /// Pull cursor-key/keypad modes and kitty keyboard flags from the
    /// terminal's current state. Call before every encode — programs flip
    /// these modes at runtime.
    pub fn sync_from_terminal(&mut self, term: &Terminal) {
        // SAFETY: both handles are live.
        unsafe { sys::ghostty_key_encoder_setopt_from_terminal(self.enc, term.term) }
    }

    /// Encode a key press. `key` is one of the `GHOSTTY_KEY_*` consts,
    /// `mods` a `GHOSTTY_MODS_*` bitmask, `utf8` the layout text for the key
    /// (printable keys only). Empty result = the key produces no bytes (e.g.
    /// a bare modifier).
    pub fn encode_press(&mut self, key: c_int, mods: u16, utf8: Option<&str>) -> Vec<u8> {
        self.encode(KeyAction::Press, key, mods, utf8, None)
    }

    /// Encode any key event. Releases, repeats and bare modifiers only
    /// produce bytes when the program enabled the kitty flags that report
    /// them. `unshifted_codepoint` is the key's character without
    /// modifiers, which kitty's alternate-key reporting needs.
    pub fn encode(
        &mut self,
        action: KeyAction,
        key: c_int,
        mods: u16,
        utf8: Option<&str>,
        unshifted_codepoint: Option<u32>,
    ) -> Vec<u8> {
        let action = match action {
            KeyAction::Press => sys::GHOSTTY_KEY_ACTION_PRESS,
            KeyAction::Repeat => sys::GHOSTTY_KEY_ACTION_REPEAT,
            KeyAction::Release => sys::GHOSTTY_KEY_ACTION_RELEASE,
        };
        // SAFETY: the handles are live; the UTF-8 slice outlives the encode
        // and the output buffer holds `buf.len()` bytes.
        unsafe {
            sys::ghostty_key_event_set_action(self.event, action);
            sys::ghostty_key_event_set_key(self.event, key);
            sys::ghostty_key_event_set_mods(self.event, mods);
            sys::ghostty_key_event_set_unshifted_codepoint(
                self.event,
                unshifted_codepoint.unwrap_or(0),
            );
            match utf8 {
                Some(text) => {
                    sys::ghostty_key_event_set_utf8(
                        self.event,
                        text.as_ptr() as *const c_char,
                        text.len(),
                    );
                }
                None => sys::ghostty_key_event_set_utf8(self.event, std::ptr::null(), 0),
            }
            let mut buf = [0 as c_char; 128];
            let mut written: usize = 0;
            let rc = sys::ghostty_key_encoder_encode(
                self.enc,
                self.event,
                buf.as_mut_ptr(),
                buf.len(),
                &mut written,
            );
            if rc != sys::GHOSTTY_SUCCESS {
                return Vec::new();
            }
            std::slice::from_raw_parts(buf.as_ptr() as *const u8, written).to_vec()
        }
    }
}

impl Drop for KeyEncoder {
    fn drop(&mut self) {
        // SAFETY: the handles are live and never used again.
        unsafe {
            sys::ghostty_key_event_free(self.event);
            sys::ghostty_key_encoder_free(self.enc);
        }
    }
}

/// The explicit color a style carries, `None` when it is the default.
fn style_color(c: sys::GhosttyStyleColor) -> Option<Color> {
    match c.tag {
        // SAFETY: the tag says which union field is set.
        sys::GHOSTTY_STYLE_COLOR_PALETTE => Some(Color::Palette(unsafe { c.value.palette })),
        sys::GHOSTTY_STYLE_COLOR_RGB => {
            // SAFETY: the tag says which union field is set.
            let rgb = unsafe { c.value.rgb };
            Some(Color::Rgb(rgb.r, rgb.g, rgb.b))
        }
        _ => None,
    }
}

#[cfg(test)]
pub(crate) mod test_util {
    use super::*;

    pub fn row_text(frame: &Frame, row: usize) -> String {
        frame
            .cells
            .get(row)
            .map(|cells| cells.iter().map(|c| c.text.as_str()).collect())
            .unwrap_or_default()
    }

    /// A terminal whose PTY replies land in the returned buffer.
    pub fn with_replies(
        cols: u16,
        rows: u16,
    ) -> (Terminal, std::sync::Arc<std::sync::Mutex<Vec<u8>>>) {
        let mut term = Terminal::new(cols, rows).unwrap();
        let replies = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let sink = replies.clone();
        term.set_write_pty(Box::new(move |bytes| {
            sink.lock().unwrap().extend_from_slice(bytes)
        }));
        (term, replies)
    }
}

#[cfg(test)]
mod tests {
    use super::test_util::*;
    use super::*;

    #[test]
    fn writes_and_snapshots() {
        let term = Terminal::new(40, 6).unwrap();
        term.write(b"hello\x1b]0;zu-spike\x07");
        assert_eq!(term.title().as_deref(), Some("zu-spike"));

        let mut rs = RenderState::new().unwrap();
        let frame = rs.snapshot(&term).unwrap();
        assert_eq!((frame.cols, frame.rows), (40, 6));
        assert!(row_text(&frame, 0).starts_with("hello"));
        assert_eq!(frame.selection, vec![None; 6]);
    }

    #[test]
    fn resize_reflows_scrollback() {
        let term = Terminal::new(20, 4).unwrap();
        term.write(b"0123456789012345678901234567890123456789\r\n");
        term.resize(10, 4, 0, 0).unwrap();
        let mut rs = RenderState::new().unwrap();
        let frame = rs.snapshot(&term).unwrap();
        let text = row_text(&frame, 0);
        assert_eq!(text.trim_end(), "0123456789");
        assert_eq!(row_text(&frame, 1).trim_end(), "0123456789");
    }

    #[test]
    fn modes_follow_the_program() {
        let term = Terminal::new(20, 4).unwrap();
        assert!(!term.bracketed_paste() && !term.application_cursor());
        assert!(!term.focus_reporting());
        assert!(term.alternate_scroll(), "?1007 is on by default");
        term.write(b"\x1b[?1h\x1b[?2004h\x1b[?1000h\x1b[?1006h\x1b[?1004h\x1b[?1007l");
        assert!(term.application_cursor() && term.bracketed_paste());
        assert!(term.focus_reporting() && !term.alternate_scroll());
        assert_eq!(term.mouse_mode(), Some(1000));
        assert!(term.mouse_sgr());
        term.write(b"\x1b[?1000l\x1b[?1006l");
        assert!(!term.mouse_tracking());
    }

    #[test]
    fn scrollback_and_text_read_back() {
        let term = Terminal::new(10, 3).unwrap();
        term.set_scrollback_lines(100);
        term.write(b"one\r\ntwo\r\nthree\r\nfour\r\nfive");
        assert!(term.total_rows() >= 5);
        assert!(term.scrollback_rows() >= 2);
    }

    #[test]
    fn the_terminal_moves_between_threads() {
        fn assert_send<T: Send>() {}
        assert_send::<Terminal>();

        let (term, replies) = with_replies(20, 4);
        let term = std::thread::spawn(move || {
            term.write(b"from the reader\x1b[c");
            term
        })
        .join()
        .unwrap();
        assert!(!replies.lock().unwrap().is_empty(), "DA1 answered there");
        let frame = RenderState::new().unwrap().snapshot(&term).unwrap();
        assert!(row_text(&frame, 0).starts_with("from the reader"));
    }

    #[test]
    fn pending_wrap_follows_the_last_column() {
        let term = Terminal::new(5, 3).unwrap();
        term.write(b"abcd");
        assert!(!term.cursor_pending_wrap());
        term.write(b"e");
        assert!(term.cursor_pending_wrap());
        term.write(b"f");
        assert!(!term.cursor_pending_wrap());
        assert_eq!(term.cursor_position(), (1, 1));
    }
}

#[cfg(test)]
mod more_tests {
    use super::test_util::*;
    use super::*;
    use crate::sys::{GHOSTTY_MODS_CTRL, GHOSTTY_MODS_SHIFT};
    use key_consts::*;
    use std::sync::{Arc, Mutex};

    #[test]
    fn text_all_includes_scrollback() {
        let term = Terminal::new(10, 3).unwrap();
        term.set_scrollback_lines(100);
        term.write(b"one\r\ntwo\r\nthree\r\nfour\r\nfive");
        let text = term.text_all();
        assert!(text.contains("one"), "{text:?}");
        assert!(text.contains("five"), "{text:?}");
        assert!(text.lines().count() >= 5, "{text:?}");
    }

    #[test]
    fn selection_text_reads_scrollback_by_screen_rows() {
        let term = Terminal::new(10, 3).unwrap();
        term.set_scrollback_lines(100);
        term.write(b"one\r\ntwo\r\nthree\r\nfour\r\nfive");
        let total = term.total_rows();
        assert!(total >= 5, "{total}");
        let all = term.selection_text((0, 0), (9, total - 1));
        assert!(all.contains("one") && all.contains("five"), "{all:?}");
        let middle = term.selection_text((0, 1), (9, 2));
        assert!(
            middle.contains("two") && middle.contains("three") && !middle.contains("one"),
            "{middle:?}"
        );
    }

    #[test]
    fn osc52_writes_reach_the_clipboard_callback() {
        let mut term = Terminal::new(20, 4).unwrap();
        let seen = Arc::new(Mutex::new(String::new()));
        let sink = seen.clone();
        term.set_on_clipboard_write(Box::new(move |text| {
            *sink.lock().unwrap() = text.to_owned();
        }));
        term.write(b"\x1b]52;c;SGVsbG8=\x07");
        assert_eq!(&*seen.lock().unwrap(), "Hello");
    }

    #[test]
    fn hyperlinks_resolve_at_their_cells() {
        let term = Terminal::new(20, 4).unwrap();
        term.write(b"\x1b]8;;https://example.com\x07link\x1b]8;;\x07");
        assert_eq!(
            term.hyperlink_at(0, 0).as_deref(),
            Some("https://example.com")
        );
        assert_eq!(
            term.hyperlink_at(3, 0).as_deref(),
            Some("https://example.com")
        );
        assert_eq!(term.hyperlink_at(4, 0), None);
    }

    #[test]
    fn hyperlinks_resolve_in_a_viewport_scrolled_into_history() {
        let term = Terminal::new(20, 3).unwrap();
        term.set_scrollback_lines(100);
        term.write(b"\x1b]8;;https://old.example\x07old\x1b]8;;\x07\r\n");
        for i in 0..10 {
            term.write(format!("line {i}\r\n").as_bytes());
        }
        assert_eq!(term.hyperlink_at(0, 0), None, "the link is in history");
        term.scroll_top();
        assert_eq!(
            term.hyperlink_at(1, 0).as_deref(),
            Some("https://old.example")
        );
        assert_eq!(term.hyperlink_at(1, 1), None);
    }

    #[test]
    fn the_scrollbar_reports_the_scrollable_area() {
        let term = Terminal::new(20, 3).unwrap();
        term.set_scrollback_lines(100);
        term.write(b"1\r\n2\r\n3\r\n4\r\n5\r\n6\r\n7\r\n8");
        let bar = term.scrollbar();
        assert!(bar.total > bar.len, "{bar:?}");
        assert_eq!(bar.len, 3);
        assert_eq!(bar.offset, bar.total - bar.len);
    }

    #[test]
    fn keys_encode_through_ghostty_including_kitty() {
        let term = Terminal::new(20, 4).unwrap();
        let mut encoder = KeyEncoder::new().unwrap();
        encoder.sync_from_terminal(&term);
        assert_eq!(
            encoder.encode_press(GHOSTTY_KEY_C, GHOSTTY_MODS_CTRL, Some("c")),
            b"\x03"
        );
        assert_eq!(
            encoder.encode_press(GHOSTTY_KEY_ARROW_UP, 0, None),
            b"\x1b[A"
        );

        term.write(b"\x1b[?1h");
        encoder.sync_from_terminal(&term);
        assert_eq!(
            encoder.encode_press(GHOSTTY_KEY_ARROW_UP, 0, None),
            b"\x1bOA"
        );

        term.write(b"\x1b[>1u");
        encoder.sync_from_terminal(&term);
        let kitty = encoder.encode_press(GHOSTTY_KEY_C, GHOSTTY_MODS_CTRL, Some("c"));
        assert_ne!(kitty, b"\x03", "kitty flags change the encoding: {kitty:?}");
    }

    #[test]
    fn kitty_reports_releases_repeats_and_bare_modifiers() {
        let term = Terminal::new(20, 4).unwrap();
        let mut encoder = KeyEncoder::new().unwrap();
        encoder.sync_from_terminal(&term);
        let release = |e: &mut KeyEncoder| {
            e.encode(
                KeyAction::Release,
                GHOSTTY_KEY_A,
                0,
                Some("a"),
                Some('a' as u32),
            )
        };
        assert!(
            release(&mut encoder).is_empty(),
            "legacy keys have no release"
        );
        assert!(
            encoder
                .encode(
                    KeyAction::Press,
                    GHOSTTY_KEY_SHIFT_LEFT,
                    GHOSTTY_MODS_SHIFT,
                    None,
                    None
                )
                .is_empty()
        );

        // Disambiguate | report event types | report all keys as escapes.
        term.write(b"\x1b[>11u");
        encoder.sync_from_terminal(&term);
        assert_eq!(
            encoder.encode(
                KeyAction::Press,
                GHOSTTY_KEY_A,
                0,
                Some("a"),
                Some('a' as u32)
            ),
            b"\x1b[97u"
        );
        assert_eq!(
            encoder.encode(
                KeyAction::Repeat,
                GHOSTTY_KEY_A,
                0,
                Some("a"),
                Some('a' as u32)
            ),
            b"\x1b[97;1:2u"
        );
        assert_eq!(release(&mut encoder), b"\x1b[97;1:3u");
        let shift = encoder.encode(
            KeyAction::Press,
            GHOSTTY_KEY_SHIFT_LEFT,
            GHOSTTY_MODS_SHIFT,
            None,
            None,
        );
        assert!(shift.starts_with(b"\x1b[57441;"), "{shift:?}");
    }

    #[test]
    fn prompts_navigate_the_viewport() {
        let term = Terminal::new(20, 4).unwrap();
        term.set_scrollback_lines(1000);
        let mut prompt_rows = Vec::new();
        for cmd in 0..3 {
            prompt_rows.push(term.total_rows() - 4 + term.cursor_position().1 as usize);
            term.write(format!("\x1b]133;A\x07$ cmd{cmd}\r\n\x1b]133;C\x07").as_bytes());
            for line in 0..10 {
                term.write(format!("out {cmd}.{line}\r\n").as_bytes());
            }
        }
        let bottom = term.scrollbar().offset;
        term.scroll_to_prompt(-1);
        assert_eq!(term.scrollbar().offset as usize, prompt_rows[2]);
        term.scroll_to_prompt(-1);
        assert_eq!(term.scrollbar().offset as usize, prompt_rows[1]);
        term.scroll_to_prompt(1);
        assert_eq!(term.scrollbar().offset as usize, prompt_rows[2]);
        term.scroll_bottom();
        assert_eq!(term.scrollbar().offset, bottom);
    }

    #[test]
    fn colors_and_cursor_defaults_apply() {
        let term = Terminal::new(10, 2).unwrap();
        let mut palette = default_palette();
        assert_ne!(palette[1], Rgb::default(), "the built-in red");
        palette[1] = Rgb::new(1, 2, 3);
        term.set_palette(&palette);
        term.set_default_cursor_color(Some(Rgb::new(9, 8, 7)));
        term.write(b"\x1b[31mx");
        let mut rs = RenderState::new().unwrap();
        let frame = rs.snapshot(&term).unwrap();
        assert_eq!(frame.cells[0][0].fg_resolved, Rgb::new(1, 2, 3));
        assert_eq!(frame.colors.cursor, Some(Rgb::new(9, 8, 7)));
        term.set_default_cursor_color(None);
        assert_eq!(rs.snapshot(&term).unwrap().colors.cursor, None);

        term.set_default_cursor_style(CursorStyle::Bar, true);
        let cursor = rs.snapshot(&term).unwrap().cursor.unwrap();
        assert_eq!(
            (cursor.style, cursor.blinking),
            (sys::GHOSTTY_RENDER_STATE_CURSOR_VISUAL_STYLE_BAR, true),
            "the default shows before the program picks a cursor"
        );
        term.write(b"\x1b[2 q");
        let cursor = rs.snapshot(&term).unwrap().cursor.unwrap();
        assert_eq!(
            cursor.style,
            sys::GHOSTTY_RENDER_STATE_CURSOR_VISUAL_STYLE_BLOCK
        );
        assert!(!cursor.blinking, "DECSCUSR 2 is a steady block");
        term.write(b"\x1b[5 q");
        let cursor = rs.snapshot(&term).unwrap().cursor.unwrap();
        assert_eq!(
            cursor.style,
            sys::GHOSTTY_RENDER_STATE_CURSOR_VISUAL_STYLE_BAR
        );
        assert!(cursor.blinking, "DECSCUSR 5 is a blinking bar");
        term.write(b"\x1b[4 q\x1b[0 q");
        let cursor = rs.snapshot(&term).unwrap().cursor.unwrap();
        assert_eq!(
            cursor.style,
            sys::GHOSTTY_RENDER_STATE_CURSOR_VISUAL_STYLE_BAR
        );
        assert!(
            cursor.blinking,
            "DECSCUSR 0 returns to the configured default"
        );
    }

    #[test]
    fn effects_fire_from_their_sequences() {
        let (mut term, replies) = with_replies(20, 4);
        let seen: Arc<Mutex<Vec<String>>> = Arc::default();

        let sink = seen.clone();
        term.set_on_notification(Box::new(move |title, body| {
            sink.lock()
                .unwrap()
                .push(format!("notify {title:?} {body:?}"));
        }));
        let sink = seen.clone();
        term.set_on_progress(Box::new(move |p| {
            sink.lock()
                .unwrap()
                .push(format!("progress {:?} {:?}", p.state, p.percent));
        }));
        let sink = seen.clone();
        term.set_on_pwd(Box::new(move || sink.lock().unwrap().push("pwd".into())));
        let sink = seen.clone();
        term.set_on_semantic_prompt(Box::new(move |p| {
            sink.lock().unwrap().push(format!(
                "prompt {:?} {:?} {:?}",
                p.kind, p.exit_code, p.command
            ));
        }));
        term.set_on_color_scheme(Box::new(|| Some(ColorScheme::Dark)));

        term.write(b"\x1b]9;build done\x07");
        term.write(b"\x1b]777;notify;Zu;tests passed\x07");
        term.write(b"\x1b]9;4;1;42\x07\x1b]9;4;3\x07\x1b]9;4;0\x07");
        term.write(b"\x1b]7;file://host/tmp\x07");
        term.write(b"\x1b]133;A\x07$ \x1b]133;B\x07\x1b]133;C\x07\x1b]133;D;3\x07");
        assert_eq!(term.pwd().as_deref(), Some("file://host/tmp"));
        assert_eq!(
            *seen.lock().unwrap(),
            [
                r#"notify "" "build done""#,
                r#"notify "Zu" "tests passed""#,
                "progress Set Some(42)",
                "progress Indeterminate None",
                "progress Remove None",
                "pwd",
                r#"prompt PromptStart None """#,
                r#"prompt InputStart None """#,
                r#"prompt OutputStart None """#,
                r#"prompt CommandEnd Some(3) """#,
            ]
        );

        term.write(b"\x1b[?996n");
        assert_eq!(&*replies.lock().unwrap(), b"\x1b[?997;1n");
        replies.lock().unwrap().clear();
        term.write(b"\x1b[>q");
        assert_eq!(&*replies.lock().unwrap(), b"\x1bP>|Zu\x1b\\");
    }
}

/// The query-answer wiring the esctest conformance run needs: size
/// reports, device attributes, DECRQCRA and window-resize requests.
#[cfg(test)]
mod query_tests {
    use super::test_util::*;
    use super::*;

    /// `CSI 18 t` answers with the grid, `CSI 14/16 t` with the pixels
    /// the size callback reported.
    #[test]
    fn size_queries_answer_the_reported_geometry() {
        let (mut term, replies) = with_replies(80, 25);
        term.set_on_size(Box::new(|view| {
            Some(SizeReport {
                rows: view.rows()?,
                columns: view.cols()?,
                cell_width: 10,
                cell_height: 20,
            })
        }));
        term.write(b"\x1b[18t");
        assert_eq!(&*replies.lock().unwrap(), b"\x1b[8;25;80t");
        replies.lock().unwrap().clear();
        term.write(b"\x1b[14t");
        assert_eq!(&*replies.lock().unwrap(), b"\x1b[4;500;800t");
        replies.lock().unwrap().clear();
        term.write(b"\x1b[16t");
        assert_eq!(&*replies.lock().unwrap(), b"\x1b[6;20;10t");
    }

    /// A mode change and its size query in one chunk: the query answers
    /// what the chunk has already made the terminal (DECCOLM under mode
    /// 40 resizes the kernel itself).
    #[test]
    fn size_query_answers_a_self_resize_in_the_same_chunk() {
        let (mut term, replies) = with_replies(80, 25);
        term.set_on_size(Box::new(|view| {
            Some(SizeReport {
                rows: view.rows()?,
                columns: view.cols()?,
                cell_width: 10,
                cell_height: 20,
            })
        }));
        term.write(b"\x1b[?40h\x1b[?3h\x1b[18t");
        assert_eq!(&*replies.lock().unwrap(), b"\x1b[8;25;132t");
    }

    /// The DA answers go out as the profile describes them.
    #[test]
    fn device_attributes_answer_with_the_reported_profile() {
        let (mut term, replies) = with_replies(80, 25);
        term.set_on_device_attributes(Box::new(DeviceAttributes::vt520));
        term.write(b"\x1b[c\x1b[>c\x1b[=c");
        let answered = String::from_utf8_lossy(&*replies.lock().unwrap()).into_owned();
        assert_eq!(
            answered, "\x1b[?65;22c\x1b[>64;0;0c\x1bP!|00000000\x1b\\",
            "DA1/DA2/DA3 as the VT520 profile"
        );
    }

    /// DECRQCRA reports a checksum when enabled, as the extension bits
    /// describe, and stays silent when disabled.
    #[test]
    fn decrqcra_reports_a_checksum_when_enabled() {
        let (mut term, replies) = with_replies(80, 25);
        term.write(b"ab");
        term.set_xt_checksum_extension(XtChecksumFlags {
            positive: true,
            no_attributes: true,
            no_trim: true,
            full: true,
        });
        term.write(b"\x1b[2;1;1;1;1;2*y");
        assert!(
            replies.lock().unwrap().is_empty(),
            "no checksum without the opt-in"
        );
        term.set_xt_checksum_report(true);
        term.write(b"\x1b[2;1;1;1;1;2*y");
        let answered = String::from_utf8_lossy(&*replies.lock().unwrap()).into_owned();
        // The DEC form: DCS Pi ! ~ <four hex digits> ST.
        assert!(
            answered.starts_with("\x1bP2!~") && answered.ends_with("\x1b\\"),
            "the request echoed with a checksum, got {answered:?}"
        );
        replies.lock().unwrap().clear();
        term.write(b"\x1b[2;1;1;1;1;2*y");
        let again = String::from_utf8_lossy(&*replies.lock().unwrap()).into_owned();
        assert_eq!(answered, again, "the checksum is deterministic");
    }

    /// `CSI 8 t` reaches the callback and touches no grid: the embedder
    /// decides.
    #[test]
    fn resize_requests_reach_the_callback_not_the_grid() {
        let (mut term, replies) = with_replies(80, 25);
        let asked = std::sync::Arc::new(std::sync::Mutex::new(None));
        let sink = asked.clone();
        term.set_on_resize_window(Box::new(move |request| {
            *sink.lock().unwrap() = Some(request);
        }));
        term.write(b"\x1b[8;30;100t");
        assert_eq!(
            *asked.lock().unwrap(),
            Some(ResizeWindowRequest {
                rows: 30,
                columns: 100,
            })
        );
        let frame = RenderState::new().unwrap().snapshot(&term).unwrap();
        assert_eq!((frame.cols, frame.rows), (80, 25), "the grid is untouched");
        assert!(replies.lock().unwrap().is_empty());
    }
}
