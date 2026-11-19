//! Raw FFI bindings to libghostty-vt.
//!
//! Hand-transcribed from `include/ghostty/vt/*.h` at the Ghostty rev pinned
//! in `build.rs`. The upstream API is pre-1.0 and unstable: bump the pinned
//! rev by diffing the headers and updating this file (Ghostty's own ABI
//! manifest test is the upstream cross-check).
//!
//! Sized structs follow the `GHOSTTY_INIT_SIZED` convention: the first field
//! is `size` and must be set to `size_of::<T>()` before the call.
//!
//! The lint escapes below are inherent to a C-API transcription: C naming
//! (non_camel_case_types/non_snake_case), and the bindings carry the full
//! surface of the consumed headers while the view uses a subset (dead_code).

#![allow(non_camel_case_types, non_snake_case, dead_code)]

use std::ffi::{c_char, c_int, c_void};

#[path = "key_consts.rs"]
pub mod key_consts;
pub use key_consts::*;

// ---------------------------------------------------------------------------
// Common types (types.h, color.h)
// ---------------------------------------------------------------------------

pub type GhosttyTerminal = *mut c_void;
pub type GhosttyRenderState = *mut c_void;
pub type GhosttyRenderStateRowIterator = *mut c_void;
pub type GhosttyRenderStateRowCells = *mut c_void;
pub type GhosttyRenderStateImageIterator = *mut c_void;
pub type GhosttyKittyGraphics = *mut c_void;
pub type GhosttyKittyGraphicsImage = *mut c_void;
pub type GhosttyKeyEncoder = *mut c_void;
pub type GhosttyKeyEvent = *mut c_void;

pub const GHOSTTY_SUCCESS: c_int = 0;
pub const GHOSTTY_OUT_OF_MEMORY: c_int = -1;
pub const GHOSTTY_INVALID_VALUE: c_int = -2;
pub const GHOSTTY_OUT_OF_SPACE: c_int = -3;
pub const GHOSTTY_NO_VALUE: c_int = -4;
pub const GHOSTTY_IO_ERROR: c_int = -5;
pub const GHOSTTY_LIMIT_EXCEEDED: c_int = -6;
pub const GHOSTTY_REJECTED: c_int = -7;

/// Borrowed byte string produced by the library.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct GhosttyString {
    pub ptr: *const u8,
    pub len: usize,
}

/// Caller-provided byte buffer. `len` receives bytes written on success or
/// the required capacity on `GHOSTTY_OUT_OF_SPACE`.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct GhosttyBuffer {
    pub ptr: *mut u8,
    pub cap: usize,
    pub len: usize,
}

impl GhosttyBuffer {
    pub fn sized(buf: &mut [u8]) -> Self {
        Self {
            ptr: buf.as_mut_ptr(),
            cap: buf.len(),
            len: 0,
        }
    }
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct GhosttyColorRgb {
    pub r: u8,
    pub g: u8,
    pub b: u8,
}

/// A NULL allocator selects the library default everywhere we call it.
pub type GhosttyAllocator = c_void;

// ---------------------------------------------------------------------------
// Terminal (terminal.h)
// ---------------------------------------------------------------------------

/// `GHOSTTY_TERMINAL_OPT_*`
pub const GHOSTTY_TERMINAL_OPT_USERDATA: c_int = 0;
pub const GHOSTTY_TERMINAL_OPT_WRITE_PTY: c_int = 1;
pub const GHOSTTY_TERMINAL_OPT_BELL: c_int = 2;
pub const GHOSTTY_TERMINAL_OPT_XTVERSION: c_int = 4;
pub const GHOSTTY_TERMINAL_OPT_TITLE_CHANGED: c_int = 5;
pub const GHOSTTY_TERMINAL_OPT_SIZE: c_int = 6;
pub const GHOSTTY_TERMINAL_OPT_COLOR_SCHEME: c_int = 7;
pub const GHOSTTY_TERMINAL_OPT_DEVICE_ATTRIBUTES: c_int = 8;
pub const GHOSTTY_TERMINAL_OPT_COLOR_FOREGROUND: c_int = 11;
pub const GHOSTTY_TERMINAL_OPT_COLOR_BACKGROUND: c_int = 12;
pub const GHOSTTY_TERMINAL_OPT_COLOR_CURSOR: c_int = 13;
pub const GHOSTTY_TERMINAL_OPT_COLOR_PALETTE: c_int = 14;
pub const GHOSTTY_TERMINAL_OPT_SELECTION: c_int = 21;
pub const GHOSTTY_TERMINAL_OPT_DEFAULT_CURSOR_STYLE: c_int = 22;
pub const GHOSTTY_TERMINAL_OPT_DEFAULT_CURSOR_BLINK: c_int = 23;
pub const GHOSTTY_TERMINAL_OPT_PWD_CHANGED: c_int = 25;
pub const GHOSTTY_TERMINAL_OPT_SCROLLBACK_MAX_BYTES: c_int = 27;
pub const GHOSTTY_TERMINAL_OPT_SCROLLBACK_MAX_LINES: c_int = 28;
pub const GHOSTTY_TERMINAL_OPT_DESKTOP_NOTIFICATION: c_int = 29;
pub const GHOSTTY_TERMINAL_OPT_PROGRESS_REPORT: c_int = 30;
pub const GHOSTTY_TERMINAL_OPT_TERMINFO_NAME: c_int = 37;
pub const GHOSTTY_TERMINAL_OPT_SEMANTIC_PROMPT: c_int = 42;
pub const GHOSTTY_TERMINAL_OPT_XT_CHECKSUM_REPORT: c_int = 44;
pub const GHOSTTY_TERMINAL_OPT_XT_CHECKSUM_EXTENSION: c_int = 45;
pub const GHOSTTY_TERMINAL_OPT_RESIZE_WINDOW: c_int = 47;
pub const GHOSTTY_TERMINAL_OPT_KITTY_IMAGE_STORAGE_LIMIT: c_int = 15;
pub const GHOSTTY_TERMINAL_OPT_KITTY_IMAGE_MEDIUM_FILE: c_int = 16;
pub const GHOSTTY_TERMINAL_OPT_KITTY_IMAGE_MEDIUM_TEMP_FILE: c_int = 17;
pub const GHOSTTY_TERMINAL_OPT_KITTY_IMAGE_MEDIUM_SHARED_MEM: c_int = 18;

/// `GHOSTTY_TERMINAL_DATA_*`
pub const GHOSTTY_TERMINAL_DATA_COLS: c_int = 1;
pub const GHOSTTY_TERMINAL_DATA_ROWS: c_int = 2;
pub const GHOSTTY_TERMINAL_DATA_CURSOR_X: c_int = 3;
pub const GHOSTTY_TERMINAL_DATA_CURSOR_Y: c_int = 4;
pub const GHOSTTY_TERMINAL_DATA_CURSOR_PENDING_WRAP: c_int = 5;
pub const GHOSTTY_TERMINAL_DATA_ACTIVE_SCREEN: c_int = 6;
pub const GHOSTTY_TERMINAL_DATA_KITTY_KEYBOARD_FLAGS: c_int = 8;
pub const GHOSTTY_TERMINAL_DATA_TITLE: c_int = 12;
pub const GHOSTTY_TERMINAL_DATA_PWD: c_int = 13;
pub const GHOSTTY_TERMINAL_DATA_SCROLLBACK_ROWS: c_int = 15;
pub const GHOSTTY_TERMINAL_DATA_COLOR_PALETTE_DEFAULT: c_int = 25;
pub const GHOSTTY_TERMINAL_DATA_SELECTION: c_int = 31;
pub const GHOSTTY_TERMINAL_DATA_VIEWPORT_ACTIVE: c_int = 32;
pub const GHOSTTY_TERMINAL_DATA_CURSOR_AT_PROMPT: c_int = 39;
pub const GHOSTTY_TERMINAL_DATA_KITTY_IMAGE_STORAGE_LIMIT: c_int = 26;
pub const GHOSTTY_TERMINAL_DATA_KITTY_IMAGE_MEDIUM_FILE: c_int = 27;
pub const GHOSTTY_TERMINAL_DATA_KITTY_IMAGE_MEDIUM_TEMP_FILE: c_int = 28;
pub const GHOSTTY_TERMINAL_DATA_KITTY_IMAGE_MEDIUM_SHARED_MEM: c_int = 29;
pub const GHOSTTY_TERMINAL_DATA_KITTY_GRAPHICS: c_int = 30;

/// `GHOSTTY_SCROLL_VIEWPORT_*`
pub const GHOSTTY_SCROLL_VIEWPORT_TOP: c_int = 0;
pub const GHOSTTY_SCROLL_VIEWPORT_BOTTOM: c_int = 1;
pub const GHOSTTY_SCROLL_VIEWPORT_DELTA: c_int = 2;
pub const GHOSTTY_SCROLL_VIEWPORT_ROW: c_int = 3;
pub const GHOSTTY_SCROLL_VIEWPORT_DELTA_PROMPT: c_int = 4;

#[repr(C)]
#[derive(Clone, Copy)]
pub union GhosttyTerminalScrollViewportValue {
    pub delta: isize,
    pub row: usize,
    pub delta_prompt: isize,
    pub _padding: [u64; 2],
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct GhosttyTerminalScrollViewport {
    pub tag: c_int,
    pub value: GhosttyTerminalScrollViewportValue,
}

impl GhosttyTerminalScrollViewport {
    pub fn delta(lines: isize) -> Self {
        Self {
            tag: GHOSTTY_SCROLL_VIEWPORT_DELTA,
            value: GhosttyTerminalScrollViewportValue { delta: lines },
        }
    }

    pub fn bottom() -> Self {
        Self {
            tag: GHOSTTY_SCROLL_VIEWPORT_BOTTOM,
            value: GhosttyTerminalScrollViewportValue { delta: 0 },
        }
    }

    pub fn delta_prompt(prompts: isize) -> Self {
        Self {
            tag: GHOSTTY_SCROLL_VIEWPORT_DELTA_PROMPT,
            value: GhosttyTerminalScrollViewportValue {
                delta_prompt: prompts,
            },
        }
    }
}

/// `GHOSTTY_TERMINAL_CURSOR_STYLE_*` (terminal.h) — mirrors the render-state
/// cursor visual style values.
pub const GHOSTTY_TERMINAL_CURSOR_STYLE_BLOCK: c_int = 1;

/// `GhosttyTerminalWritePtyFn`
pub type GhosttyTerminalWritePtyFn = unsafe extern "C" fn(
    terminal: GhosttyTerminal,
    userdata: *mut c_void,
    data: *const u8,
    len: usize,
);

/// Effect callbacks that only report an occurrence (bell, title, pwd).
pub type GhosttyTerminalEffectFn =
    unsafe extern "C" fn(terminal: GhosttyTerminal, userdata: *mut c_void);

unsafe extern "C" {
    pub fn ghostty_terminal_new(
        allocator: *const GhosttyAllocator,
        terminal: *mut GhosttyTerminal,
        cols: u16,
        rows: u16,
    ) -> c_int;
    pub fn ghostty_terminal_free(terminal: GhosttyTerminal);
    pub fn ghostty_terminal_reset(terminal: GhosttyTerminal);
    pub fn ghostty_terminal_resize(
        terminal: GhosttyTerminal,
        cols: u16,
        rows: u16,
        cell_width_px: u32,
        cell_height_px: u32,
    ) -> c_int;
    pub fn ghostty_terminal_set(
        terminal: GhosttyTerminal,
        option: c_int,
        value: *const c_void,
    ) -> c_int;
    pub fn ghostty_terminal_get(terminal: GhosttyTerminal, data: c_int, out: *mut c_void) -> c_int;
    pub fn ghostty_terminal_vt_write(terminal: GhosttyTerminal, data: *const u8, len: usize);
    pub fn ghostty_terminal_scroll_viewport(
        terminal: GhosttyTerminal,
        behavior: GhosttyTerminalScrollViewport,
    );
}

// ---------------------------------------------------------------------------
// Allocator (allocator.h)
// ---------------------------------------------------------------------------

unsafe extern "C" {
    pub fn ghostty_alloc(allocator: *const GhosttyAllocator, len: usize) -> *mut u8;
    pub fn ghostty_free(allocator: *const GhosttyAllocator, ptr: *mut u8, len: usize);
}

// ---------------------------------------------------------------------------
// System callbacks (sys.h)
// ---------------------------------------------------------------------------

/// `GhosttySysImage`: 8-bit RGBA rows from the top left, no row padding.
#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct GhosttySysImage {
    pub width: u32,
    pub height: u32,
    pub data: *mut u8,
    pub data_len: usize,
}

/// `GhosttySysDecodePngFn`: the library owns `out.data` on success.
pub type GhosttySysDecodePngFn = unsafe extern "C-unwind" fn(
    userdata: *mut c_void,
    allocator: *const GhosttyAllocator,
    data: *const u8,
    data_len: usize,
    out: *mut GhosttySysImage,
) -> bool;

/// `GHOSTTY_SYS_OPT_*`
pub const GHOSTTY_SYS_OPT_USERDATA: c_int = 0;
pub const GHOSTTY_SYS_OPT_DECODE_PNG: c_int = 1;

unsafe extern "C" {
    pub fn ghostty_sys_set(option: c_int, value: *const c_void) -> c_int;
}

// --- paste (paste.h) ---

pub const GHOSTTY_CLIPBOARD_LOCATION_STANDARD: c_int = 0;
pub const GHOSTTY_PASTE_SOURCE_TEXT: c_int = 1;

/// `GhosttyMimeReaderFn` — stream one MIME representation into `writer`.
pub type GhosttyMimeReaderFn =
    unsafe extern "C" fn(userdata: *mut c_void, mime: GhosttyString, writer: GhosttyWriter) -> bool;

/// `GhosttyWriterFn` — must accept the whole slice; return false is fatal.
pub type GhosttyWriterFn =
    unsafe extern "C" fn(userdata: *mut c_void, data: *const u8, len: usize) -> bool;

/// Passed by value into `GhosttyMimeReaderFn`.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct GhosttyWriter {
    pub write: Option<GhosttyWriterFn>,
    pub userdata: *mut c_void,
}

#[repr(C)]
pub struct GhosttyMimeReader {
    pub read: Option<GhosttyMimeReaderFn>,
    pub userdata: *mut c_void,
}

/// Sized struct (`GHOSTTY_INIT_SIZED`).
#[repr(C)]
pub struct GhosttyPaste {
    pub size: usize,
    pub location: c_int,
    pub source: c_int,
    pub mimes: *const GhosttyString,
    pub mimes_len: usize,
    pub reader: GhosttyMimeReader,
    pub allow_unsafe: bool,
}

unsafe extern "C" {
    pub fn ghostty_terminal_paste(
        terminal: GhosttyTerminal,
        paste: *const GhosttyPaste,
        out_written: *mut bool,
    ) -> c_int;
    pub fn ghostty_paste_is_safe(data: *const c_char, len: usize) -> bool;
}

// ---------------------------------------------------------------------------
// Render state (render.h, style.h)
// ---------------------------------------------------------------------------

/// `GHOSTTY_RENDER_STATE_DIRTY_*`
pub const GHOSTTY_RENDER_STATE_DIRTY_FALSE: c_int = 0;
pub const GHOSTTY_RENDER_STATE_DIRTY_PARTIAL: c_int = 1;
pub const GHOSTTY_RENDER_STATE_DIRTY_FULL: c_int = 2;

/// `GHOSTTY_RENDER_STATE_DATA_*`
pub const GHOSTTY_RENDER_STATE_DATA_COLS: c_int = 1;
pub const GHOSTTY_RENDER_STATE_DATA_ROWS: c_int = 2;
pub const GHOSTTY_RENDER_STATE_DATA_DIRTY: c_int = 3;
pub const GHOSTTY_RENDER_STATE_DATA_ROW_ITERATOR: c_int = 4;
pub const GHOSTTY_RENDER_STATE_DATA_COLOR_BACKGROUND: c_int = 5;
pub const GHOSTTY_RENDER_STATE_DATA_COLOR_FOREGROUND: c_int = 6;
pub const GHOSTTY_RENDER_STATE_DATA_COLOR_CURSOR: c_int = 7;
pub const GHOSTTY_RENDER_STATE_DATA_COLOR_CURSOR_HAS_VALUE: c_int = 8;
pub const GHOSTTY_RENDER_STATE_DATA_COLOR_PALETTE: c_int = 9;
pub const GHOSTTY_RENDER_STATE_DATA_CURSOR: c_int = 18;
pub const GHOSTTY_RENDER_STATE_DATA_COLORS: c_int = 19;
pub const GHOSTTY_RENDER_STATE_DATA_IMAGE_ITERATOR: c_int = 22;
pub const GHOSTTY_RENDER_STATE_DATA_IMAGE_PLACEMENTS_GENERATION: c_int = 23;

/// `GHOSTTY_IMAGE_PROTOCOL_*`
pub const GHOSTTY_IMAGE_PROTOCOL_KITTY: c_int = 0;

/// `GHOSTTY_RENDER_STATE_IMAGE_LAYER_*`
pub const GHOSTTY_RENDER_STATE_IMAGE_LAYER_BELOW_BACKGROUND: c_int = 0;
pub const GHOSTTY_RENDER_STATE_IMAGE_LAYER_BELOW_TEXT: c_int = 1;
pub const GHOSTTY_RENDER_STATE_IMAGE_LAYER_ABOVE_TEXT: c_int = 2;

/// `GHOSTTY_RENDER_STATE_IMAGE_DATA_*`
pub const GHOSTTY_RENDER_STATE_IMAGE_DATA_PROTOCOL: c_int = 1;
pub const GHOSTTY_RENDER_STATE_IMAGE_DATA_IMAGE_ID: c_int = 2;
pub const GHOSTTY_RENDER_STATE_IMAGE_DATA_IMAGE_GENERATION: c_int = 3;
pub const GHOSTTY_RENDER_STATE_IMAGE_DATA_LAYER: c_int = 4;
pub const GHOSTTY_RENDER_STATE_IMAGE_DATA_Z: c_int = 5;
pub const GHOSTTY_RENDER_STATE_IMAGE_DATA_VIEWPORT_COL: c_int = 6;
pub const GHOSTTY_RENDER_STATE_IMAGE_DATA_VIEWPORT_ROW: c_int = 7;
pub const GHOSTTY_RENDER_STATE_IMAGE_DATA_GRID_COLS: c_int = 8;
pub const GHOSTTY_RENDER_STATE_IMAGE_DATA_GRID_ROWS: c_int = 9;
pub const GHOSTTY_RENDER_STATE_IMAGE_DATA_CELL_OFFSET_X: c_int = 10;
pub const GHOSTTY_RENDER_STATE_IMAGE_DATA_CELL_OFFSET_Y: c_int = 11;
pub const GHOSTTY_RENDER_STATE_IMAGE_DATA_PIXEL_WIDTH: c_int = 12;
pub const GHOSTTY_RENDER_STATE_IMAGE_DATA_PIXEL_HEIGHT: c_int = 13;
pub const GHOSTTY_RENDER_STATE_IMAGE_DATA_SOURCE_X: c_int = 14;
pub const GHOSTTY_RENDER_STATE_IMAGE_DATA_SOURCE_Y: c_int = 15;
pub const GHOSTTY_RENDER_STATE_IMAGE_DATA_SOURCE_WIDTH: c_int = 16;
pub const GHOSTTY_RENDER_STATE_IMAGE_DATA_SOURCE_HEIGHT: c_int = 17;

/// `GHOSTTY_RENDER_STATE_CURSOR_VISUAL_STYLE_*`
pub const GHOSTTY_RENDER_STATE_CURSOR_VISUAL_STYLE_BAR: c_int = 0;
pub const GHOSTTY_RENDER_STATE_CURSOR_VISUAL_STYLE_BLOCK: c_int = 1;
pub const GHOSTTY_RENDER_STATE_CURSOR_VISUAL_STYLE_UNDERLINE: c_int = 2;
pub const GHOSTTY_RENDER_STATE_CURSOR_VISUAL_STYLE_BLOCK_HOLLOW: c_int = 3;

/// `GHOSTTY_RENDER_STATE_ROW_DATA_*`
pub const GHOSTTY_RENDER_STATE_ROW_DATA_DIRTY: c_int = 1;
pub const GHOSTTY_RENDER_STATE_ROW_DATA_CELLS: c_int = 3;
pub const GHOSTTY_RENDER_STATE_ROW_DATA_SELECTION: c_int = 4;
pub const GHOSTTY_RENDER_STATE_ROW_DATA_VIEWPORT_Y: c_int = 6;
pub const GHOSTTY_RENDER_STATE_ROW_DATA_ID: c_int = 7;

/// `GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_*`
pub const GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_STYLE: c_int = 2;
pub const GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_GRAPHEMES_LEN: c_int = 3;
pub const GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_GRAPHEMES_BUF: c_int = 4;
pub const GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_BG_COLOR: c_int = 5;
pub const GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_FG_COLOR: c_int = 6;
pub const GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_GRAPHEMES_UTF8: c_int = 9;

/// Sized struct (`GHOSTTY_INIT_SIZED`).
#[repr(C)]
#[derive(Clone, Copy)]
pub struct GhosttyRenderStateCursor {
    pub size: usize,
    pub viewport_has_value: bool,
    pub viewport_x: u16,
    pub viewport_y: u16,
    pub wide_tail: bool,
    pub visible: bool,
    pub blinking: bool,
    pub password_input: bool,
    pub visual_style: c_int,
}

impl Default for GhosttyRenderStateCursor {
    fn default() -> Self {
        // SAFETY: a plain C struct of integers, bools and nullable pointers;
        // all-zero is a valid value.
        let mut v: Self = unsafe { std::mem::zeroed() };
        v.size = std::mem::size_of::<Self>();
        v
    }
}

/// Sized struct (`GHOSTTY_INIT_SIZED`).
#[repr(C)]
pub struct GhosttyRenderStateColors {
    pub size: usize,
    pub background: GhosttyColorRgb,
    pub foreground: GhosttyColorRgb,
    pub cursor: GhosttyColorRgb,
    pub cursor_has_value: bool,
    pub palette: [GhosttyColorRgb; 256],
}

impl Default for GhosttyRenderStateColors {
    fn default() -> Self {
        // SAFETY: a plain C struct of integers, bools and nullable pointers;
        // all-zero is a valid value.
        let mut v: Self = unsafe { std::mem::zeroed() };
        v.size = std::mem::size_of::<Self>();
        v
    }
}

/// Sized struct (`GHOSTTY_INIT_SIZED`).
#[repr(C)]
#[derive(Clone, Copy)]
pub struct GhosttyRenderStateRowSelection {
    pub size: usize,
    pub start_x: u16,
    pub end_x: u16,
}

impl Default for GhosttyRenderStateRowSelection {
    fn default() -> Self {
        // SAFETY: a plain C struct of integers, bools and nullable pointers;
        // all-zero is a valid value.
        let mut v: Self = unsafe { std::mem::zeroed() };
        v.size = std::mem::size_of::<Self>();
        v
    }
}

unsafe extern "C" {
    pub fn ghostty_render_state_new(
        allocator: *const GhosttyAllocator,
        state: *mut GhosttyRenderState,
    ) -> c_int;
    pub fn ghostty_render_state_free(state: GhosttyRenderState);
    pub fn ghostty_render_state_update(
        state: GhosttyRenderState,
        terminal: GhosttyTerminal,
    ) -> c_int;
    pub fn ghostty_render_state_clean(state: GhosttyRenderState) -> c_int;
    pub fn ghostty_render_state_get(
        state: GhosttyRenderState,
        data: c_int,
        out: *mut c_void,
    ) -> c_int;
    pub fn ghostty_render_state_row_iterator_new(
        allocator: *const GhosttyAllocator,
        out_iterator: *mut GhosttyRenderStateRowIterator,
    ) -> c_int;
    pub fn ghostty_render_state_row_iterator_free(iterator: GhosttyRenderStateRowIterator);
    pub fn ghostty_render_state_row_iterator_next_dirty(
        iterator: GhosttyRenderStateRowIterator,
        out_y: *mut u16,
    ) -> bool;
    pub fn ghostty_render_state_row_iterator_next(iterator: GhosttyRenderStateRowIterator) -> bool;
    pub fn ghostty_render_state_row_get(
        iterator: GhosttyRenderStateRowIterator,
        data: c_int,
        out: *mut c_void,
    ) -> c_int;
    pub fn ghostty_render_state_row_cells_new(
        allocator: *const GhosttyAllocator,
        out_cells: *mut GhosttyRenderStateRowCells,
    ) -> c_int;
    pub fn ghostty_render_state_row_cells_free(cells: GhosttyRenderStateRowCells);
    pub fn ghostty_render_state_row_cells_next(cells: GhosttyRenderStateRowCells) -> bool;
    pub fn ghostty_render_state_row_cells_get(
        cells: GhosttyRenderStateRowCells,
        data: c_int,
        out: *mut c_void,
    ) -> c_int;
    pub fn ghostty_render_state_image_iterator_new(
        allocator: *const GhosttyAllocator,
        out_iterator: *mut GhosttyRenderStateImageIterator,
    ) -> c_int;
    pub fn ghostty_render_state_image_iterator_free(iterator: GhosttyRenderStateImageIterator);
    pub fn ghostty_render_state_image_iterator_next(
        iterator: GhosttyRenderStateImageIterator,
    ) -> bool;
    pub fn ghostty_render_state_image_get(
        iterator: GhosttyRenderStateImageIterator,
        data: c_int,
        out: *mut c_void,
    ) -> c_int;
}

// ---------------------------------------------------------------------------
// Kitty graphics (kitty_graphics.h)
// ---------------------------------------------------------------------------

/// `GHOSTTY_KITTY_IMAGE_FORMAT_*`. PNG payloads reach storage as RGBA.
pub const GHOSTTY_KITTY_IMAGE_FORMAT_RGB: c_int = 0;
pub const GHOSTTY_KITTY_IMAGE_FORMAT_RGBA: c_int = 1;
pub const GHOSTTY_KITTY_IMAGE_FORMAT_PNG: c_int = 2;
pub const GHOSTTY_KITTY_IMAGE_FORMAT_GRAY_ALPHA: c_int = 3;
pub const GHOSTTY_KITTY_IMAGE_FORMAT_GRAY: c_int = 4;

/// `GHOSTTY_KITTY_IMAGE_DATA_*`
pub const GHOSTTY_KITTY_IMAGE_DATA_ID: c_int = 1;
pub const GHOSTTY_KITTY_IMAGE_DATA_WIDTH: c_int = 3;
pub const GHOSTTY_KITTY_IMAGE_DATA_HEIGHT: c_int = 4;
pub const GHOSTTY_KITTY_IMAGE_DATA_FORMAT: c_int = 5;
pub const GHOSTTY_KITTY_IMAGE_DATA_DATA_PTR: c_int = 7;
pub const GHOSTTY_KITTY_IMAGE_DATA_DATA_LEN: c_int = 8;
pub const GHOSTTY_KITTY_IMAGE_DATA_GENERATION: c_int = 9;

unsafe extern "C" {
    pub fn ghostty_kitty_graphics_get(
        graphics: GhosttyKittyGraphics,
        data: c_int,
        out: *mut c_void,
    ) -> c_int;
    pub fn ghostty_kitty_graphics_image(
        graphics: GhosttyKittyGraphics,
        image_id: u32,
    ) -> GhosttyKittyGraphicsImage;
    pub fn ghostty_kitty_graphics_image_get(
        image: GhosttyKittyGraphicsImage,
        data: c_int,
        out: *mut c_void,
    ) -> c_int;
}

// --- style (style.h, sgr.h) ---

/// `GHOSTTY_STYLE_COLOR_*`
pub const GHOSTTY_STYLE_COLOR_NONE: c_int = 0;
pub const GHOSTTY_STYLE_COLOR_PALETTE: c_int = 1;
pub const GHOSTTY_STYLE_COLOR_RGB: c_int = 2;

/// `GHOSTTY_SGR_UNDERLINE_*`
pub const GHOSTTY_SGR_UNDERLINE_NONE: c_int = 0;
pub const GHOSTTY_SGR_UNDERLINE_SINGLE: c_int = 1;
pub const GHOSTTY_SGR_UNDERLINE_DOUBLE: c_int = 2;
pub const GHOSTTY_SGR_UNDERLINE_CURLY: c_int = 3;
pub const GHOSTTY_SGR_UNDERLINE_DOTTED: c_int = 4;
pub const GHOSTTY_SGR_UNDERLINE_DASHED: c_int = 5;

#[repr(C)]
#[derive(Clone, Copy)]
pub union GhosttyStyleColorValue {
    pub palette: u8,
    pub rgb: GhosttyColorRgb,
    pub _padding: u64,
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct GhosttyStyleColor {
    pub tag: c_int,
    pub value: GhosttyStyleColorValue,
}

/// Sized struct (`GHOSTTY_INIT_SIZED`).
#[repr(C)]
#[derive(Clone, Copy)]
pub struct GhosttyStyle {
    pub size: usize,
    pub fg_color: GhosttyStyleColor,
    pub bg_color: GhosttyStyleColor,
    pub underline_color: GhosttyStyleColor,
    pub bold: bool,
    pub italic: bool,
    pub faint: bool,
    pub blink: bool,
    pub inverse: bool,
    pub invisible: bool,
    pub strikethrough: bool,
    pub overline: bool,
    pub underline: c_int,
}

impl Default for GhosttyStyle {
    fn default() -> Self {
        // SAFETY: a plain C struct of integers, bools and nullable pointers;
        // all-zero is a valid value.
        let mut v: Self = unsafe { std::mem::zeroed() };
        v.size = std::mem::size_of::<Self>();
        v
    }
}

// ---------------------------------------------------------------------------
// Key encoding (key.h, key/event.h, key/encoder.h)
// ---------------------------------------------------------------------------

/// `GHOSTTY_KEY_ACTION_*`
pub const GHOSTTY_KEY_ACTION_RELEASE: c_int = 0;
pub const GHOSTTY_KEY_ACTION_PRESS: c_int = 1;
pub const GHOSTTY_KEY_ACTION_REPEAT: c_int = 2;

/// `GHOSTTY_MODS_*`
pub const GHOSTTY_MODS_SHIFT: u16 = 1 << 0;
pub const GHOSTTY_MODS_CTRL: u16 = 1 << 1;
pub const GHOSTTY_MODS_ALT: u16 = 1 << 2;
pub const GHOSTTY_MODS_SUPER: u16 = 1 << 3;
pub const GHOSTTY_MODS_CAPS_LOCK: u16 = 1 << 4;
pub const GHOSTTY_MODS_NUM_LOCK: u16 = 1 << 5;

/// `GHOSTTY_KITTY_KEY_*`
pub const GHOSTTY_KITTY_KEY_DISABLED: u8 = 0;
pub const GHOSTTY_KITTY_KEY_DISAMBIGUATE: u8 = 1 << 0;
pub const GHOSTTY_KITTY_KEY_REPORT_EVENTS: u8 = 1 << 1;
pub const GHOSTTY_KITTY_KEY_REPORT_ALTERNATES: u8 = 1 << 2;
pub const GHOSTTY_KITTY_KEY_REPORT_ALL: u8 = 1 << 3;
pub const GHOSTTY_KITTY_KEY_REPORT_ASSOCIATED: u8 = 1 << 4;

/// `GHOSTTY_KEY_ENCODER_OPT_*`
pub const GHOSTTY_KEY_ENCODER_OPT_CURSOR_KEY_APPLICATION: c_int = 0;
pub const GHOSTTY_KEY_ENCODER_OPT_KEYPAD_KEY_APPLICATION: c_int = 1;
pub const GHOSTTY_KEY_ENCODER_OPT_IGNORE_KEYPAD_WITH_NUMLOCK: c_int = 2;
pub const GHOSTTY_KEY_ENCODER_OPT_ALT_ESC_PREFIX: c_int = 3;
pub const GHOSTTY_KEY_ENCODER_OPT_MODIFY_OTHER_KEYS_STATE_2: c_int = 4;
pub const GHOSTTY_KEY_ENCODER_OPT_KITTY_FLAGS: c_int = 5;
pub const GHOSTTY_KEY_ENCODER_OPT_MACOS_OPTION_AS_ALT: c_int = 6;
pub const GHOSTTY_KEY_ENCODER_OPT_BACKARROW_KEY_MODE: c_int = 7;

/// `GHOSTTY_OPTION_AS_ALT_*`
pub const GHOSTTY_OPTION_AS_ALT_FALSE: c_int = 0;
pub const GHOSTTY_OPTION_AS_ALT_TRUE: c_int = 1;

unsafe extern "C" {
    pub fn ghostty_key_event_new(
        allocator: *const GhosttyAllocator,
        event: *mut GhosttyKeyEvent,
    ) -> c_int;
    pub fn ghostty_key_event_free(event: GhosttyKeyEvent);
    pub fn ghostty_key_event_set_action(event: GhosttyKeyEvent, action: c_int);
    pub fn ghostty_key_event_set_key(event: GhosttyKeyEvent, key: c_int);
    pub fn ghostty_key_event_set_mods(event: GhosttyKeyEvent, mods: u16);
    pub fn ghostty_key_event_set_utf8(event: GhosttyKeyEvent, utf8: *const c_char, len: usize);
    pub fn ghostty_key_event_set_unshifted_codepoint(event: GhosttyKeyEvent, codepoint: u32);

    pub fn ghostty_key_encoder_new(
        allocator: *const GhosttyAllocator,
        encoder: *mut GhosttyKeyEncoder,
    ) -> c_int;
    pub fn ghostty_key_encoder_free(encoder: GhosttyKeyEncoder);
    pub fn ghostty_key_encoder_setopt(
        encoder: GhosttyKeyEncoder,
        option: c_int,
        value: *const c_void,
    );
    pub fn ghostty_key_encoder_setopt_from_terminal(
        encoder: GhosttyKeyEncoder,
        terminal: GhosttyTerminal,
    );
    pub fn ghostty_key_encoder_encode(
        encoder: GhosttyKeyEncoder,
        event: GhosttyKeyEvent,
        out_buf: *mut c_char,
        out_buf_size: usize,
        out_len: *mut usize,
    ) -> c_int;
}

// ---------------------------------------------------------------------------
// Spike additions: the data and cell surface the terminal component needs
// (terminal.h, screen.h, render.h)
// ---------------------------------------------------------------------------

/// `GHOSTTY_TERMINAL_DATA_*` beyond the emulator subset above.
pub const GHOSTTY_TERMINAL_DATA_CURSOR_VISIBLE: c_int = 7;
pub const GHOSTTY_TERMINAL_DATA_CURSOR_STYLE_DATA: c_int = 10;
pub const GHOSTTY_TERMINAL_DATA_MOUSE_TRACKING: c_int = 11;
pub const GHOSTTY_TERMINAL_DATA_TOTAL_ROWS: c_int = 14;
pub const GHOSTTY_TERMINAL_DATA_MODE: c_int = 37;

/// `GHOSTTY_TERMINAL_SCREEN_*`
pub const GHOSTTY_TERMINAL_SCREEN_PRIMARY: c_int = 0;
pub const GHOSTTY_TERMINAL_SCREEN_ALTERNATE: c_int = 1;

/// `GHOSTTY_TERMINAL_CURSOR_STYLE_*` (the full set; `BLOCK` above is 1).
pub const GHOSTTY_TERMINAL_CURSOR_STYLE_BAR: c_int = 0;
pub const GHOSTTY_TERMINAL_CURSOR_STYLE_UNDERLINE: c_int = 2;
pub const GHOSTTY_TERMINAL_CURSOR_STYLE_BLOCK_HOLLOW: c_int = 3;

/// A terminal mode and its value, for configuring and querying
/// `GHOSTTY_TERMINAL_DATA_MODE` (terminal.h).
#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct GhosttyTerminalModeConfig {
    pub mode: u16,
    pub value: bool,
}

/// `ghostty_mode_new` (modes.h) — a static inline in C.
pub const fn ghostty_mode_new(value: u16, ansi: bool) -> u16 {
    (value & 0x7FFF) | ((ansi as u16) << 15)
}

/// `GHOSTTY_ROW_CELLS_DATA_RAW` — the packed `GhosttyCell`, which carries the
/// wide property the render-state style does not.
pub const GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_RAW: c_int = 1;

/// `GhosttyCell` (screen.h): a packed cell value decoded with `ghostty_cell_get`.
pub type GhosttyCell = u64;

/// `GHOSTTY_CELL_DATA_*`
pub const GHOSTTY_CELL_DATA_CODEPOINT: c_int = 1;
pub const GHOSTTY_CELL_DATA_CONTENT_TAG: c_int = 2;
pub const GHOSTTY_CELL_DATA_WIDE: c_int = 3;
pub const GHOSTTY_CELL_DATA_HAS_TEXT: c_int = 4;
pub const GHOSTTY_CELL_DATA_HAS_STYLING: c_int = 5;

/// `GHOSTTY_CELL_WIDE_*`
pub const GHOSTTY_CELL_WIDE_NARROW: c_int = 0;
pub const GHOSTTY_CELL_WIDE_WIDE: c_int = 1;
pub const GHOSTTY_CELL_WIDE_SPACER_TAIL: c_int = 2;
pub const GHOSTTY_CELL_WIDE_SPACER_HEAD: c_int = 3;

unsafe extern "C" {
    pub fn ghostty_cell_get(cell: GhosttyCell, data: c_int, out: *mut c_void) -> c_int;
}

// ---------------------------------------------------------------------------
// Formatter (formatter.h, types.h)
// ---------------------------------------------------------------------------

pub type GhosttyFormatter = *mut c_void;

/// `GHOSTTY_FORMATTER_FORMAT_*`
pub const GHOSTTY_FORMATTER_FORMAT_PLAIN: c_int = 0;
pub const GHOSTTY_FORMATTER_FORMAT_VT: c_int = 1;

/// Sized struct (`GHOSTTY_INIT_SIZED`).
#[repr(C)]
#[derive(Default)]
pub struct GhosttyFormatterScreenExtra {
    pub size: usize,
    pub cursor: bool,
    pub style: bool,
    pub hyperlink: bool,
    pub protection: bool,
    pub kitty_keyboard: bool,
    pub charsets: bool,
}

/// Sized struct (`GHOSTTY_INIT_SIZED`).
#[repr(C)]
#[derive(Default)]
pub struct GhosttyFormatterTerminalExtra {
    pub size: usize,
    pub palette: bool,
    pub modes: bool,
    pub scrolling_region: bool,
    pub tabstops: bool,
    pub pwd: bool,
    pub keyboard: bool,
    pub screen: GhosttyFormatterScreenExtra,
}

/// Sized struct (`GHOSTTY_INIT_SIZED`).
#[repr(C)]
pub struct GhosttyFormatterTerminalOptions {
    pub size: usize,
    pub emit: c_int,
    pub unwrap: bool,
    pub trim: bool,
    pub extra: GhosttyFormatterTerminalExtra,
    pub selection: *const c_void,
}

unsafe extern "C" {
    pub fn ghostty_formatter_terminal_new(
        allocator: *const GhosttyAllocator,
        formatter: *mut GhosttyFormatter,
        terminal: GhosttyTerminal,
        options: GhosttyFormatterTerminalOptions,
    ) -> c_int;
    pub fn ghostty_formatter_format_buf(
        formatter: GhosttyFormatter,
        buf: *mut u8,
        buf_len: usize,
        out_written: *mut usize,
    ) -> c_int;
    pub fn ghostty_formatter_free(formatter: GhosttyFormatter);
}

// ---------------------------------------------------------------------------
// Points, grid references and hyperlinks (point.h, grid_ref.h, terminal.h)
// ---------------------------------------------------------------------------

/// `GHOSTTY_POINT_TAG_VIEWPORT`: the visible viewport.
pub const GHOSTTY_POINT_TAG_VIEWPORT: c_int = 1;

#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct GhosttyPointCoordinate {
    pub x: u16,
    pub y: u32,
}

#[repr(C)]
#[derive(Clone, Copy)]
pub union GhosttyPointValue {
    pub coordinate: GhosttyPointCoordinate,
    pub _padding: [u64; 2],
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct GhosttyPoint {
    pub tag: c_int,
    pub value: GhosttyPointValue,
}

impl GhosttyPoint {
    pub fn viewport(x: u16, y: u16) -> Self {
        Self {
            tag: GHOSTTY_POINT_TAG_VIEWPORT,
            value: GhosttyPointValue {
                coordinate: GhosttyPointCoordinate { x, y: y as u32 },
            },
        }
    }

    /// A point in the full screen, scrollback included (`y` 0 is history's top).
    pub fn screen(x: u16, y: usize) -> Self {
        Self {
            tag: GHOSTTY_POINT_TAG_SCREEN,
            value: GhosttyPointValue {
                coordinate: GhosttyPointCoordinate {
                    x,
                    y: y.min(u32::MAX as usize) as u32,
                },
            },
        }
    }
}

/// Sized struct (`GHOSTTY_INIT_SIZED`).
#[repr(C)]
#[derive(Clone, Copy)]
pub struct GhosttyGridRef {
    pub size: usize,
    pub node: *mut c_void,
    pub x: u16,
    pub y: u16,
}

impl Default for GhosttyGridRef {
    fn default() -> Self {
        Self {
            size: std::mem::size_of::<Self>(),
            node: std::ptr::null_mut(),
            x: 0,
            y: 0,
        }
    }
}

unsafe extern "C" {
    pub fn ghostty_terminal_grid_ref(
        terminal: GhosttyTerminal,
        point: GhosttyPoint,
        out_ref: *mut GhosttyGridRef,
    ) -> c_int;
    pub fn ghostty_grid_ref_hyperlink_uri(
        grid_ref: *const GhosttyGridRef,
        buf: *mut u8,
        buf_len: usize,
        out_len: *mut usize,
    ) -> c_int;
}

// ---------------------------------------------------------------------------
// Scrollbar (terminal.h)
// ---------------------------------------------------------------------------

/// `GHOSTTY_TERMINAL_DATA_SCROLLBAR`
pub const GHOSTTY_TERMINAL_DATA_SCROLLBAR: c_int = 9;

#[repr(C)]
#[derive(Clone, Copy, Default, Debug)]
pub struct GhosttyTerminalScrollbar {
    pub total: u64,
    pub offset: u64,
    pub len: u64,
}

// ---------------------------------------------------------------------------
// Clipboard write (terminal.h): OSC 52 / OSC 1337 / OSC 5522
// ---------------------------------------------------------------------------

pub const GHOSTTY_TERMINAL_OPT_CLIPBOARD_WRITE: c_int = 26;

/// `GHOSTTY_CLIPBOARD_WRITE_RESULT_SUCCESS`
pub const GHOSTTY_CLIPBOARD_WRITE_RESULT_SUCCESS: c_int = 0;

#[repr(C)]
#[derive(Clone, Copy)]
pub struct GhosttyClipboardContent {
    pub mime: GhosttyString,
    pub data: GhosttyString,
}

/// Sized struct (`GHOSTTY_INIT_SIZED`).
#[repr(C)]
#[derive(Clone, Copy)]
pub struct GhosttyClipboardWriteReply {
    pub size: usize,
    pub result: c_int,
    pub remember: bool,
}

pub type GhosttyClipboardWriteReplyFn = unsafe extern "C" fn(
    write: *const GhosttyClipboardWrite,
    reply: *const GhosttyClipboardWriteReply,
);

#[repr(C)]
pub struct GhosttyClipboardWrite {
    pub size: usize,
    pub location: c_int,
    pub contents: *const GhosttyClipboardContent,
    pub contents_len: usize,
    pub name: GhosttyString,
    pub granted: bool,
    pub can_remember: bool,
    pub ctx: *const c_void,
    pub reply: Option<GhosttyClipboardWriteReplyFn>,
}

pub type GhosttyTerminalClipboardWriteFn = unsafe extern "C" fn(
    terminal: GhosttyTerminal,
    userdata: *mut c_void,
    write: *const GhosttyClipboardWrite,
);

// ---------------------------------------------------------------------------
// Selection (selection.h)
// ---------------------------------------------------------------------------

/// `GHOSTTY_POINT_TAG_SCREEN`: the full screen including scrollback.
pub const GHOSTTY_POINT_TAG_SCREEN: c_int = 2;

/// Sized struct: two inclusive grid references (direction preserved).
#[repr(C)]
#[derive(Clone, Copy)]
pub struct GhosttySelection {
    pub size: usize,
    pub start: GhosttyGridRef,
    pub end: GhosttyGridRef,
    pub rectangle: bool,
}

impl Default for GhosttySelection {
    fn default() -> Self {
        Self {
            size: std::mem::size_of::<Self>(),
            start: GhosttyGridRef::default(),
            end: GhosttyGridRef::default(),
            rectangle: false,
        }
    }
}

/// Sized struct for the one-shot selection formatter.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct GhosttyTerminalSelectionFormatOptions {
    pub size: usize,
    pub emit: c_int,
    pub unwrap: bool,
    pub trim: bool,
    pub selection: *const GhosttySelection,
}

unsafe extern "C" {
    pub fn ghostty_terminal_selection_format_buf(
        terminal: GhosttyTerminal,
        options: GhosttyTerminalSelectionFormatOptions,
        buf: *mut u8,
        buf_len: usize,
        out_written: *mut usize,
    ) -> c_int;
}

/// Sized struct (`GHOSTTY_INIT_SIZED`).
#[repr(C)]
pub struct GhosttyTerminalSelectWordOptions {
    pub size: usize,
    pub grid_ref: GhosttyGridRef,
    pub boundary_codepoints: *const u32,
    pub boundary_codepoints_len: usize,
}

/// Sized struct (`GHOSTTY_INIT_SIZED`).
#[repr(C)]
pub struct GhosttyTerminalSelectLineOptions {
    pub size: usize,
    pub grid_ref: GhosttyGridRef,
    pub whitespace: *const u32,
    pub whitespace_len: usize,
    pub semantic_prompt_boundary: bool,
}

/// `GHOSTTY_SELECTION_ORDER_*`
pub const GHOSTTY_SELECTION_ORDER_FORWARD: c_int = 0;
pub const GHOSTTY_SELECTION_ORDER_REVERSE: c_int = 1;
pub const GHOSTTY_SELECTION_ORDER_MIRRORED_FORWARD: c_int = 2;
pub const GHOSTTY_SELECTION_ORDER_MIRRORED_REVERSE: c_int = 3;

/// `GHOSTTY_SELECTION_ADJUST_*`
pub const GHOSTTY_SELECTION_ADJUST_LEFT: c_int = 0;
pub const GHOSTTY_SELECTION_ADJUST_RIGHT: c_int = 1;
pub const GHOSTTY_SELECTION_ADJUST_UP: c_int = 2;
pub const GHOSTTY_SELECTION_ADJUST_DOWN: c_int = 3;
pub const GHOSTTY_SELECTION_ADJUST_HOME: c_int = 4;
pub const GHOSTTY_SELECTION_ADJUST_END: c_int = 5;
pub const GHOSTTY_SELECTION_ADJUST_PAGE_UP: c_int = 6;
pub const GHOSTTY_SELECTION_ADJUST_PAGE_DOWN: c_int = 7;
pub const GHOSTTY_SELECTION_ADJUST_BEGINNING_OF_LINE: c_int = 8;
pub const GHOSTTY_SELECTION_ADJUST_END_OF_LINE: c_int = 9;

/// `GhosttySelectionBuffer`: `len` receives the entries written, or the
/// required capacity on `GHOSTTY_OUT_OF_SPACE`.
#[repr(C)]
pub struct GhosttySelectionBuffer {
    pub ptr: *mut GhosttySelection,
    pub cap: usize,
    pub len: usize,
}

/// `GhosttyCodepoints` (types.h)
#[repr(C)]
pub struct GhosttyCodepoints {
    pub ptr: *const u32,
    pub len: usize,
}

/// `GhosttySurfacePosition` (types.h): surface pixels, (0, 0) top-left.
#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct GhosttySurfacePosition {
    pub x: f64,
    pub y: f64,
}

unsafe extern "C" {
    pub fn ghostty_terminal_select_word(
        terminal: GhosttyTerminal,
        options: *const GhosttyTerminalSelectWordOptions,
        out_selection: *mut GhosttySelection,
    ) -> c_int;
    pub fn ghostty_terminal_select_line(
        terminal: GhosttyTerminal,
        options: *const GhosttyTerminalSelectLineOptions,
        out_selection: *mut GhosttySelection,
    ) -> c_int;
    pub fn ghostty_terminal_select_all(
        terminal: GhosttyTerminal,
        out_selection: *mut GhosttySelection,
    ) -> c_int;
    pub fn ghostty_terminal_select_output(
        terminal: GhosttyTerminal,
        grid_ref: GhosttyGridRef,
        out_selection: *mut GhosttySelection,
    ) -> c_int;
    pub fn ghostty_terminal_selection_adjust(
        terminal: GhosttyTerminal,
        selection: *mut GhosttySelection,
        adjustment: c_int,
    ) -> c_int;
    pub fn ghostty_terminal_selection_ordered(
        terminal: GhosttyTerminal,
        selection: *const GhosttySelection,
        desired: c_int,
        out_selection: *mut GhosttySelection,
    ) -> c_int;
    pub fn ghostty_terminal_selection_equal(
        terminal: GhosttyTerminal,
        a: *const GhosttySelection,
        b: *const GhosttySelection,
        out_equal: *mut bool,
    ) -> c_int;
    pub fn ghostty_terminal_point_from_grid_ref(
        terminal: GhosttyTerminal,
        grid_ref: *const GhosttyGridRef,
        tag: c_int,
        out: *mut GhosttyPointCoordinate,
    ) -> c_int;
}

// --- selection gestures (selection.h) ---

pub type GhosttySelectionGesture = *mut c_void;
pub type GhosttySelectionGestureEvent = *mut c_void;

/// `GHOSTTY_SELECTION_GESTURE_BEHAVIOR_*`
pub const GHOSTTY_SELECTION_GESTURE_BEHAVIOR_CELL: c_int = 0;
pub const GHOSTTY_SELECTION_GESTURE_BEHAVIOR_WORD: c_int = 1;
pub const GHOSTTY_SELECTION_GESTURE_BEHAVIOR_LINE: c_int = 2;
pub const GHOSTTY_SELECTION_GESTURE_BEHAVIOR_OUTPUT: c_int = 3;

#[repr(C)]
#[derive(Clone, Copy)]
pub struct GhosttySelectionGestureBehaviors {
    pub single_click: c_int,
    pub double_click: c_int,
    pub triple_click: c_int,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct GhosttySelectionGestureGeometry {
    pub columns: u32,
    pub cell_width: u32,
    pub padding_left: u32,
    pub screen_height: u32,
}

/// `GHOSTTY_SELECTION_GESTURE_AUTOSCROLL_*`
pub const GHOSTTY_SELECTION_GESTURE_AUTOSCROLL_NONE: c_int = 0;
pub const GHOSTTY_SELECTION_GESTURE_AUTOSCROLL_UP: c_int = 1;
pub const GHOSTTY_SELECTION_GESTURE_AUTOSCROLL_DOWN: c_int = 2;

/// `GHOSTTY_SELECTION_GESTURE_DATA_*`
pub const GHOSTTY_SELECTION_GESTURE_DATA_CLICK_COUNT: c_int = 0;
pub const GHOSTTY_SELECTION_GESTURE_DATA_DRAGGED: c_int = 1;
pub const GHOSTTY_SELECTION_GESTURE_DATA_AUTOSCROLL: c_int = 2;
pub const GHOSTTY_SELECTION_GESTURE_DATA_BEHAVIOR: c_int = 3;
pub const GHOSTTY_SELECTION_GESTURE_DATA_ANCHOR: c_int = 4;

/// `GHOSTTY_SELECTION_GESTURE_EVENT_TYPE_*`
pub const GHOSTTY_SELECTION_GESTURE_EVENT_TYPE_PRESS: c_int = 0;
pub const GHOSTTY_SELECTION_GESTURE_EVENT_TYPE_RELEASE: c_int = 1;
pub const GHOSTTY_SELECTION_GESTURE_EVENT_TYPE_DRAG: c_int = 2;
pub const GHOSTTY_SELECTION_GESTURE_EVENT_TYPE_AUTOSCROLL_TICK: c_int = 3;
pub const GHOSTTY_SELECTION_GESTURE_EVENT_TYPE_DEEP_PRESS: c_int = 4;

/// `GHOSTTY_SELECTION_GESTURE_EVENT_OPT_*`
pub const GHOSTTY_SELECTION_GESTURE_EVENT_OPT_REF: c_int = 0;
pub const GHOSTTY_SELECTION_GESTURE_EVENT_OPT_POSITION: c_int = 1;
pub const GHOSTTY_SELECTION_GESTURE_EVENT_OPT_REPEAT_DISTANCE: c_int = 2;
pub const GHOSTTY_SELECTION_GESTURE_EVENT_OPT_TIME_NS: c_int = 3;
pub const GHOSTTY_SELECTION_GESTURE_EVENT_OPT_REPEAT_INTERVAL_NS: c_int = 4;
pub const GHOSTTY_SELECTION_GESTURE_EVENT_OPT_WORD_BOUNDARY_CODEPOINTS: c_int = 5;
pub const GHOSTTY_SELECTION_GESTURE_EVENT_OPT_BEHAVIORS: c_int = 6;
pub const GHOSTTY_SELECTION_GESTURE_EVENT_OPT_RECTANGLE: c_int = 7;
pub const GHOSTTY_SELECTION_GESTURE_EVENT_OPT_GEOMETRY: c_int = 8;
pub const GHOSTTY_SELECTION_GESTURE_EVENT_OPT_VIEWPORT: c_int = 9;

unsafe extern "C" {
    pub fn ghostty_selection_gesture_event_new(
        allocator: *const GhosttyAllocator,
        out_event: *mut GhosttySelectionGestureEvent,
        event_type: c_int,
    ) -> c_int;
    pub fn ghostty_selection_gesture_event_free(event: GhosttySelectionGestureEvent);
    pub fn ghostty_selection_gesture_event_set(
        event: GhosttySelectionGestureEvent,
        option: c_int,
        value: *const c_void,
    ) -> c_int;
    pub fn ghostty_selection_gesture_event(
        gesture: GhosttySelectionGesture,
        terminal: GhosttyTerminal,
        event: GhosttySelectionGestureEvent,
        out_selection: *mut GhosttySelection,
    ) -> c_int;
    pub fn ghostty_selection_gesture_new(
        allocator: *const GhosttyAllocator,
        out_gesture: *mut GhosttySelectionGesture,
    ) -> c_int;
    pub fn ghostty_selection_gesture_free(
        gesture: GhosttySelectionGesture,
        terminal: GhosttyTerminal,
    );
    pub fn ghostty_selection_gesture_reset(
        gesture: GhosttySelectionGesture,
        terminal: GhosttyTerminal,
    );
    pub fn ghostty_selection_gesture_get(
        gesture: GhosttySelectionGesture,
        terminal: GhosttyTerminal,
        data: c_int,
        value: *mut c_void,
    ) -> c_int;
}

// ---------------------------------------------------------------------------
// Tracked grid references (grid_ref_tracked.h, terminal.h)
// ---------------------------------------------------------------------------

pub type GhosttyTrackedGridRef = *mut c_void;

unsafe extern "C" {
    pub fn ghostty_terminal_grid_ref_track(
        terminal: GhosttyTerminal,
        point: GhosttyPoint,
        out_ref: *mut GhosttyTrackedGridRef,
    ) -> c_int;
    pub fn ghostty_tracked_grid_ref_free(grid_ref: GhosttyTrackedGridRef);
    pub fn ghostty_tracked_grid_ref_has_value(grid_ref: GhosttyTrackedGridRef) -> bool;
    pub fn ghostty_tracked_grid_ref_snapshot(
        grid_ref: GhosttyTrackedGridRef,
        out_ref: *mut GhosttyGridRef,
    ) -> c_int;
}

// ---------------------------------------------------------------------------
// Mouse encoding (mouse.h, mouse/event.h, mouse/encoder.h)
// ---------------------------------------------------------------------------

pub type GhosttyMouseEncoder = *mut c_void;
pub type GhosttyMouseEvent = *mut c_void;

/// `GHOSTTY_MOUSE_ACTION_*`
pub const GHOSTTY_MOUSE_ACTION_PRESS: c_int = 0;
pub const GHOSTTY_MOUSE_ACTION_RELEASE: c_int = 1;
pub const GHOSTTY_MOUSE_ACTION_MOTION: c_int = 2;

/// `GHOSTTY_MOUSE_BUTTON_*`: four/five are the vertical wheel, six/seven
/// the horizontal wheel, eight/nine back/forward.
pub const GHOSTTY_MOUSE_BUTTON_UNKNOWN: c_int = 0;
pub const GHOSTTY_MOUSE_BUTTON_LEFT: c_int = 1;
pub const GHOSTTY_MOUSE_BUTTON_RIGHT: c_int = 2;
pub const GHOSTTY_MOUSE_BUTTON_MIDDLE: c_int = 3;
pub const GHOSTTY_MOUSE_BUTTON_FOUR: c_int = 4;
pub const GHOSTTY_MOUSE_BUTTON_FIVE: c_int = 5;
pub const GHOSTTY_MOUSE_BUTTON_SIX: c_int = 6;
pub const GHOSTTY_MOUSE_BUTTON_SEVEN: c_int = 7;
pub const GHOSTTY_MOUSE_BUTTON_EIGHT: c_int = 8;
pub const GHOSTTY_MOUSE_BUTTON_NINE: c_int = 9;
pub const GHOSTTY_MOUSE_BUTTON_TEN: c_int = 10;
pub const GHOSTTY_MOUSE_BUTTON_ELEVEN: c_int = 11;

/// `GHOSTTY_MOUSE_TRACKING_*`
pub const GHOSTTY_MOUSE_TRACKING_NONE: c_int = 0;
pub const GHOSTTY_MOUSE_TRACKING_X10: c_int = 1;
pub const GHOSTTY_MOUSE_TRACKING_NORMAL: c_int = 2;
pub const GHOSTTY_MOUSE_TRACKING_BUTTON: c_int = 3;
pub const GHOSTTY_MOUSE_TRACKING_ANY: c_int = 4;

/// `GHOSTTY_MOUSE_FORMAT_*`
pub const GHOSTTY_MOUSE_FORMAT_X10: c_int = 0;
pub const GHOSTTY_MOUSE_FORMAT_UTF8: c_int = 1;
pub const GHOSTTY_MOUSE_FORMAT_SGR: c_int = 2;
pub const GHOSTTY_MOUSE_FORMAT_URXVT: c_int = 3;
pub const GHOSTTY_MOUSE_FORMAT_SGR_PIXELS: c_int = 4;

/// `GHOSTTY_MOUSE_ENCODER_OPT_*`
pub const GHOSTTY_MOUSE_ENCODER_OPT_EVENT: c_int = 0;
pub const GHOSTTY_MOUSE_ENCODER_OPT_FORMAT: c_int = 1;
pub const GHOSTTY_MOUSE_ENCODER_OPT_SIZE: c_int = 2;
pub const GHOSTTY_MOUSE_ENCODER_OPT_ANY_BUTTON_PRESSED: c_int = 3;
pub const GHOSTTY_MOUSE_ENCODER_OPT_TRACK_LAST_CELL: c_int = 4;

/// Sized struct (`GHOSTTY_INIT_SIZED`). Cell sizes must be non-zero.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct GhosttyMouseEncoderSize {
    pub size: usize,
    pub screen_width: u32,
    pub screen_height: u32,
    pub cell_width: u32,
    pub cell_height: u32,
    pub padding_top: u32,
    pub padding_bottom: u32,
    pub padding_right: u32,
    pub padding_left: u32,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct GhosttyMousePosition {
    pub x: f32,
    pub y: f32,
}

unsafe extern "C" {
    pub fn ghostty_mouse_event_new(
        allocator: *const GhosttyAllocator,
        event: *mut GhosttyMouseEvent,
    ) -> c_int;
    pub fn ghostty_mouse_event_free(event: GhosttyMouseEvent);
    pub fn ghostty_mouse_event_set_action(event: GhosttyMouseEvent, action: c_int);
    pub fn ghostty_mouse_event_set_button(event: GhosttyMouseEvent, button: c_int);
    pub fn ghostty_mouse_event_clear_button(event: GhosttyMouseEvent);
    pub fn ghostty_mouse_event_set_mods(event: GhosttyMouseEvent, mods: u16);
    pub fn ghostty_mouse_event_set_position(
        event: GhosttyMouseEvent,
        position: GhosttyMousePosition,
    );

    pub fn ghostty_mouse_encoder_new(
        allocator: *const GhosttyAllocator,
        encoder: *mut GhosttyMouseEncoder,
    ) -> c_int;
    pub fn ghostty_mouse_encoder_free(encoder: GhosttyMouseEncoder);
    pub fn ghostty_mouse_encoder_setopt(
        encoder: GhosttyMouseEncoder,
        option: c_int,
        value: *const c_void,
    );
    pub fn ghostty_mouse_encoder_setopt_from_terminal(
        encoder: GhosttyMouseEncoder,
        terminal: GhosttyTerminal,
    );
    pub fn ghostty_mouse_encoder_reset(encoder: GhosttyMouseEncoder);
    pub fn ghostty_mouse_encoder_encode(
        encoder: GhosttyMouseEncoder,
        event: GhosttyMouseEvent,
        out_buf: *mut c_char,
        out_buf_size: usize,
        out_len: *mut usize,
    ) -> c_int;
}

// ---------------------------------------------------------------------------
// Focus reporting (focus.h)
// ---------------------------------------------------------------------------

/// `GHOSTTY_FOCUS_*`
pub const GHOSTTY_FOCUS_GAINED: c_int = 0;
pub const GHOSTTY_FOCUS_LOST: c_int = 1;

unsafe extern "C" {
    pub fn ghostty_focus_encode(
        event: c_int,
        buf: *mut c_char,
        buf_len: usize,
        out_written: *mut usize,
    ) -> c_int;
}

// ---------------------------------------------------------------------------
// Default palette (color.h)
// ---------------------------------------------------------------------------

unsafe extern "C" {
    /// Writes exactly 256 entries.
    pub fn ghostty_color_palette_default(out: *mut GhosttyColorRgb);
}

// ---------------------------------------------------------------------------
// Effect callbacks beyond the occurrence-only ones (terminal.h, device.h)
// ---------------------------------------------------------------------------

/// `GhosttyTerminalXtversionFn`: the string must stay valid until return;
/// an empty one reports the default "libghostty".
pub type GhosttyTerminalXtversionFn =
    unsafe extern "C" fn(terminal: GhosttyTerminal, userdata: *mut c_void) -> GhosttyString;

/// `GHOSTTY_COLOR_SCHEME_*` (device.h)
pub const GHOSTTY_COLOR_SCHEME_LIGHT: c_int = 0;
pub const GHOSTTY_COLOR_SCHEME_DARK: c_int = 1;

/// `GhosttyTerminalColorSchemeFn`: false leaves the query unanswered.
pub type GhosttyTerminalColorSchemeFn = unsafe extern "C" fn(
    terminal: GhosttyTerminal,
    userdata: *mut c_void,
    out_scheme: *mut c_int,
) -> bool;

/// Sized struct; the strings are borrowed for the callback only.
#[repr(C)]
pub struct GhosttyTerminalDesktopNotification {
    pub size: usize,
    pub title: GhosttyString,
    pub body: GhosttyString,
}

pub type GhosttyTerminalDesktopNotificationFn = unsafe extern "C" fn(
    terminal: GhosttyTerminal,
    userdata: *mut c_void,
    notification: *const GhosttyTerminalDesktopNotification,
);

/// `GHOSTTY_TERMINAL_PROGRESS_STATE_*`
pub const GHOSTTY_TERMINAL_PROGRESS_STATE_REMOVE: c_int = 0;
pub const GHOSTTY_TERMINAL_PROGRESS_STATE_SET: c_int = 1;
pub const GHOSTTY_TERMINAL_PROGRESS_STATE_ERROR: c_int = 2;
pub const GHOSTTY_TERMINAL_PROGRESS_STATE_INDETERMINATE: c_int = 3;
pub const GHOSTTY_TERMINAL_PROGRESS_STATE_PAUSE: c_int = 4;

/// Sized struct. `progress` is 0–100, or -1 when the program omitted it.
#[repr(C)]
pub struct GhosttyTerminalProgressReport {
    pub size: usize,
    pub state: c_int,
    pub progress: i8,
}

pub type GhosttyTerminalProgressReportFn = unsafe extern "C" fn(
    terminal: GhosttyTerminal,
    userdata: *mut c_void,
    report: *const GhosttyTerminalProgressReport,
);

/// `GHOSTTY_SEMANTIC_PROMPT_*` (event kinds)
pub const GHOSTTY_SEMANTIC_PROMPT_INVALID: c_int = 0;
pub const GHOSTTY_SEMANTIC_PROMPT_PROMPT_START: c_int = 1;
pub const GHOSTTY_SEMANTIC_PROMPT_INPUT_START: c_int = 2;
pub const GHOSTTY_SEMANTIC_PROMPT_OUTPUT_START: c_int = 3;
pub const GHOSTTY_SEMANTIC_PROMPT_COMMAND_END: c_int = 4;

/// `GHOSTTY_SEMANTIC_PROMPT_PROMPT_*` (prompt kinds)
pub const GHOSTTY_SEMANTIC_PROMPT_PROMPT_PRIMARY: c_int = 0;
pub const GHOSTTY_SEMANTIC_PROMPT_PROMPT_RIGHT: c_int = 1;
pub const GHOSTTY_SEMANTIC_PROMPT_PROMPT_CONTINUATION: c_int = 2;
pub const GHOSTTY_SEMANTIC_PROMPT_PROMPT_SECONDARY: c_int = 3;

/// Sized struct; the strings are borrowed for the callback only.
#[repr(C)]
pub struct GhosttyTerminalSemanticPrompt {
    pub size: usize,
    pub kind: c_int,
    pub prompt_kind: c_int,
    pub has_exit_code: bool,
    pub exit_code: i32,
    pub command: GhosttyString,
    pub error: GhosttyString,
}

pub type GhosttyTerminalSemanticPromptFn = unsafe extern "C" fn(
    terminal: GhosttyTerminal,
    userdata: *mut c_void,
    event: *const GhosttyTerminalSemanticPrompt,
);

// ---------------------------------------------------------------------------
// Size reports, device attributes, window resize, DECRQCRA (terminal.h,
// size_report.h, device.h)
// ---------------------------------------------------------------------------

/// `GhosttySizeReportSize` (size_report.h): the terminal geometry the
/// size callback answers XTWINOPS queries and mode-2048 reports with.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct GhosttySizeReportSize {
    pub rows: u16,
    pub columns: u16,
    pub cell_width: u32,
    pub cell_height: u32,
}

/// `GhosttyTerminalSizeFn`: false suppresses the report.
pub type GhosttyTerminalSizeFn = unsafe extern "C" fn(
    terminal: GhosttyTerminal,
    userdata: *mut c_void,
    out_size: *mut GhosttySizeReportSize,
) -> bool;

/// `GhosttyDeviceAttributesPrimary` (device.h): the DA1 answer's Pp and
/// up to 64 feature codes.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct GhosttyDeviceAttributesPrimary {
    pub conformance_level: u16,
    pub features: [u16; 64],
    pub num_features: usize,
}

/// `GhosttyDeviceAttributesSecondary` (device.h): the DA2 answer.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct GhosttyDeviceAttributesSecondary {
    pub device_type: u16,
    pub firmware_version: u16,
    pub rom_cartridge: u16,
}

/// `GhosttyDeviceAttributesTertiary` (device.h): the DA3 answer's unit id.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct GhosttyDeviceAttributesTertiary {
    pub unit_id: u32,
}

/// `GhosttyDeviceAttributes` (device.h): all three DA answers at once; the
/// terminal encodes whichever the query asked for.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct GhosttyDeviceAttributes {
    pub primary: GhosttyDeviceAttributesPrimary,
    pub secondary: GhosttyDeviceAttributesSecondary,
    pub tertiary: GhosttyDeviceAttributesTertiary,
}

/// `GhosttyTerminalDeviceAttributesFn`: false leaves the query unanswered.
pub type GhosttyTerminalDeviceAttributesFn = unsafe extern "C" fn(
    terminal: GhosttyTerminal,
    userdata: *mut c_void,
    out_attrs: *mut GhosttyDeviceAttributes,
) -> bool;

/// `GHOSTTY_TERMINAL_RESIZE_WINDOW_GRID` (the only tag today).
pub const GHOSTTY_TERMINAL_RESIZE_WINDOW_GRID: c_int = 0;

/// `GhosttyTerminalResizeWindowGrid`: a grid resize request, 0 keeping
/// the dimension.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct GhosttyTerminalResizeWindowGrid {
    pub rows: u16,
    pub columns: u16,
}

/// `GhosttyTerminalResizeWindowValue`: the request's value, read by tag.
/// Not `Copy`: a union cannot safely claim it.
#[repr(C)]
pub union GhosttyTerminalResizeWindowValue {
    pub grid: GhosttyTerminalResizeWindowGrid,
    pub padding: [u64; 2],
}

/// `GhosttyTerminalResizeWindow`: a program's window-resize request.
#[repr(C)]
pub struct GhosttyTerminalResizeWindow {
    pub tag: c_int,
    pub value: GhosttyTerminalResizeWindowValue,
}

/// `GhosttyTerminalResizeWindowFn`: the terminal does not resize itself;
/// the embedder decides.
pub type GhosttyTerminalResizeWindowFn = unsafe extern "C" fn(
    terminal: GhosttyTerminal,
    userdata: *mut c_void,
    request: *const GhosttyTerminalResizeWindow,
);

// ---------------------------------------------------------------------------
// Search (search.h)
// ---------------------------------------------------------------------------

pub type GhosttySearch = *mut c_void;

/// `GHOSTTY_SEARCH_STATUS_*`
pub const GHOSTTY_SEARCH_STATUS_RUNNING: c_int = 0;
pub const GHOSTTY_SEARCH_STATUS_FEED_REQUIRED: c_int = 1;
pub const GHOSTTY_SEARCH_STATUS_COMPLETE: c_int = 2;

/// `GHOSTTY_SEARCH_SCROLL_*`
pub const GHOSTTY_SEARCH_SCROLL_IF_NEEDED: c_int = 0;
pub const GHOSTTY_SEARCH_SCROLL_NONE: c_int = 1;

/// `GHOSTTY_SEARCH_DATA_*`
pub const GHOSTTY_SEARCH_DATA_STATUS: c_int = 0;
pub const GHOSTTY_SEARCH_DATA_NEEDLE: c_int = 1;
pub const GHOSTTY_SEARCH_DATA_TOTAL_MATCHES: c_int = 2;
pub const GHOSTTY_SEARCH_DATA_SELECTED_INDEX: c_int = 3;
pub const GHOSTTY_SEARCH_DATA_SELECTED_MATCH: c_int = 4;
pub const GHOSTTY_SEARCH_DATA_MATCHES: c_int = 5;
pub const GHOSTTY_SEARCH_DATA_VIEWPORT_MATCHES: c_int = 6;
pub const GHOSTTY_SEARCH_DATA_SELECT_SCROLL: c_int = 7;

/// `GHOSTTY_SEARCH_OPT_*`
pub const GHOSTTY_SEARCH_OPT_NEEDLE: c_int = 0;
pub const GHOSTTY_SEARCH_OPT_SELECT_NEXT: c_int = 1;
pub const GHOSTTY_SEARCH_OPT_SELECT_PREV: c_int = 2;
pub const GHOSTTY_SEARCH_OPT_SELECT_SCROLL: c_int = 3;

unsafe extern "C" {
    pub fn ghostty_search_new(
        allocator: *const GhosttyAllocator,
        out_search: *mut GhosttySearch,
        terminal: GhosttyTerminal,
    ) -> c_int;
    pub fn ghostty_search_free(search: GhosttySearch);
    pub fn ghostty_search_tick(search: GhosttySearch, out_status: *mut c_int) -> c_int;
    pub fn ghostty_search_feed(search: GhosttySearch) -> c_int;
    pub fn ghostty_search_run(search: GhosttySearch) -> c_int;
    pub fn ghostty_search_set(search: GhosttySearch, option: c_int, value: *const c_void) -> c_int;
    pub fn ghostty_search_get(search: GhosttySearch, data: c_int, value: *mut c_void) -> c_int;
}
