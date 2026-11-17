//! Drawing one viewport with CoreGraphics and CoreText.
//!
//! Each grapheme is shaped alone (CoreText picks the fallback font a
//! character needs) and its glyphs are drawn at its cell's pen, on the
//! primary font's baseline: a fallback font's own advance or ascent never
//! moves another cell. Shapes are cached per grapheme and style, so a frame
//! costs a lookup and a glyph batch per run of one font and color.

use std::{collections::HashMap, ptr::NonNull, rc::Rc};

use objc2_core_foundation::{
    CFAttributedString, CFDictionary, CFRange, CFRetained, CFString, CFType, CGAffineTransform,
    CGPoint, CGRect, CGSize,
};
use objc2_core_graphics::{CGColor, CGContext, CGGlyph, CGPath};
use objc2_core_text::{
    CTFont, CTFontOrientation, CTFontSymbolicTraits, CTLine, CTRun, kCTFontAttributeName,
};
use zu_ghostty::{
    Frame, Rgb,
    sys::{
        GHOSTTY_CELL_WIDE_SPACER_TAIL, GHOSTTY_CELL_WIDE_WIDE,
        GHOSTTY_RENDER_STATE_CURSOR_VISUAL_STYLE_BAR,
        GHOSTTY_RENDER_STATE_CURSOR_VISUAL_STYLE_UNDERLINE, GHOSTTY_SGR_UNDERLINE_NONE,
    },
};

use super::{
    grid::{Metrics, Rect, text_width},
    sprite::{self, Pixels, Sprites},
};

/// A color with its alpha, each channel 0–1.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Rgba {
    pub(crate) r: f64,
    pub(crate) g: f64,
    pub(crate) b: f64,
    pub(crate) a: f64,
}

impl Rgba {
    pub(crate) const fn opaque(r: u8, g: u8, b: u8) -> Self {
        Self {
            r: r as f64 / 255.0,
            g: g as f64 / 255.0,
            b: b as f64 / 255.0,
            a: 1.0,
        }
    }

    /// `#rrggbb` or `#rrggbbaa` (what `token()` gives).
    pub(crate) fn parse(hex: &str) -> Option<Self> {
        let hex = hex.strip_prefix('#')?;
        let byte = |i: usize| u8::from_str_radix(hex.get(i..i + 2)?, 16).ok();
        let mut c = Self::opaque(byte(0)?, byte(2)?, byte(4)?);
        if hex.len() == 8 {
            c.a = byte(6)? as f64 / 255.0;
        } else if hex.len() != 6 {
            return None;
        }
        Some(c)
    }

    pub(crate) fn rgb(self) -> Rgb {
        let ch = |v: f64| (v * 255.0).round().clamp(0.0, 255.0) as u8;
        Rgb::new(ch(self.r), ch(self.g), ch(self.b))
    }

    pub(crate) fn with_alpha(self, a: f64) -> Self {
        Self {
            a: self.a * a,
            ..self
        }
    }
}

impl From<Rgb> for Rgba {
    fn from(c: Rgb) -> Self {
        Self::opaque(c.r, c.g, c.b)
    }
}

/// The theme colors the view draws with.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Palette {
    pub(crate) foreground: Rgba,
    pub(crate) background: Rgba,
    pub(crate) cursor: Rgba,
    pub(crate) selection: Rgba,
    pub(crate) preedit: Rgba,
    pub(crate) link: Rgba,
    pub(crate) mark: Rgba,
    pub(crate) mark_current: Rgba,
    pub(crate) scrollbar: Rgba,
}

impl Default for Palette {
    fn default() -> Self {
        Self {
            foreground: Rgba::opaque(0x1d, 0x1d, 0x1f),
            background: Rgba::opaque(0xff, 0xff, 0xff),
            cursor: Rgba::opaque(0x1d, 0x1d, 0x1f).with_alpha(0.5),
            selection: Rgba::opaque(0x6d, 0x5a, 0xe0).with_alpha(0.25),
            preedit: Rgba::opaque(0xf1, 0xee, 0xfc),
            link: Rgba::opaque(0x3d, 0x63, 0xd1),
            mark: Rgba::opaque(0xb2, 0x6a, 0x00).with_alpha(0.25),
            mark_current: Rgba::opaque(0xb2, 0x6a, 0x00).with_alpha(0.55),
            scrollbar: Rgba::opaque(0x6e, 0x6e, 0x73).with_alpha(0.5),
        }
    }
}

const IDENTITY: CGAffineTransform = CGAffineTransform {
    a: 1.0,
    b: 0.0,
    c: 0.0,
    d: 1.0,
    tx: 0.0,
    ty: 0.0,
};

/// The graphemes shaped and kept at once.
const MAX_SHAPES: usize = 8192;

/// Regular, bold, italic, bold italic.
const STYLES: usize = 4;

fn style_of(bold: bool, italic: bool) -> usize {
    bold as usize | (italic as usize) << 1
}

/// The glyphs of one font in a shaped grapheme, offsets from its pen.
struct Piece {
    font: CFRetained<CTFont>,
    glyphs: Vec<CGGlyph>,
    offsets: Vec<CGPoint>,
}

/// A grapheme as CoreText shaped it.
struct Shape {
    pieces: Vec<Piece>,
    width: f64,
}

/// The terminal's faces and the grid their primary face sets.
pub(crate) struct Fonts {
    faces: [CFRetained<CTFont>; STYLES],
    shapes: HashMap<(String, usize), Rc<Shape>>,
    sprites: Sprites,
    advance: f64,
    ascent: f64,
    descent: f64,
}

impl Fonts {
    /// `family` at `size`; the system's monospaced face when no font of
    /// that family is registered.
    pub(crate) fn new(family: &str, size: f64) -> Self {
        let regular =
            named(family, size).unwrap_or_else(|| named("Menlo", size).expect("macOS ships Menlo"));
        let traits = |t: CTFontSymbolicTraits| {
            // SAFETY: a copy of a live font; `None` when no face has it.
            unsafe { regular.copy_with_symbolic_traits(0.0, std::ptr::null(), t, t) }
        };
        let bold = traits(CTFontSymbolicTraits::TraitBold).unwrap_or_else(|| regular.clone());
        // A family without italics slants its upright face.
        let slanted = || slant(&regular, size).unwrap_or_else(|| regular.clone());
        let italic = traits(CTFontSymbolicTraits::TraitItalic).unwrap_or_else(slanted);
        let bold_italic =
            traits(CTFontSymbolicTraits::TraitBold | CTFontSymbolicTraits::TraitItalic)
                .unwrap_or_else(|| bold.clone());
        // SAFETY: metrics of a live font.
        let (ascent, descent) = unsafe { (regular.ascent(), regular.descent()) };
        let advance = digit_advance(&regular).unwrap_or(size * 0.6);
        Self {
            faces: [regular, bold, italic, bold_italic],
            shapes: HashMap::new(),
            sprites: Sprites::default(),
            advance,
            ascent,
            descent,
        }
    }

    /// The family CoreText resolved the regular face to.
    pub(crate) fn family(&self) -> String {
        // SAFETY: a live font's family.
        unsafe { self.faces[0].family_name() }.to_string()
    }

    pub(crate) fn metrics(&self, line_height: f64, scale: f64) -> Metrics {
        Metrics::new(self.advance, self.ascent, self.descent, line_height, scale)
    }

    fn shape(&mut self, text: &str, style: usize) -> Rc<Shape> {
        if let Some(shape) = self.shapes.get(&(text.to_owned(), style)) {
            return shape.clone();
        }
        // Programs that print every codepoint would grow it without bound.
        if self.shapes.len() >= MAX_SHAPES {
            self.shapes.clear();
        }
        let shape = Rc::new(shape(&self.faces[style], text));
        self.shapes.insert((text.to_owned(), style), shape.clone());
        shape
    }
}

fn named(family: &str, size: f64) -> Option<CFRetained<CTFont>> {
    let name = CFString::from_str(family);
    // SAFETY: CoreText's font lookup; a font is always returned.
    let font = unsafe { CTFont::with_name(&name, size, std::ptr::null()) };
    // CoreText answers an unknown name with another family: refuse it.
    // SAFETY: a live font's family.
    let got = unsafe { font.family_name() }.to_string();
    got.eq_ignore_ascii_case(family).then_some(font)
}

fn slant(font: &CTFont, size: f64) -> Option<CFRetained<CTFont>> {
    let skew = CGAffineTransform {
        a: 1.0,
        b: 0.0,
        c: 0.2,
        d: 1.0,
        tx: 0.0,
        ty: 0.0,
    };
    // SAFETY: a live font's name; the matrix outlives the call.
    let name = unsafe { font.post_script_name() };
    Some(unsafe { CTFont::with_name(&name, size, &skew) })
}

fn digit_advance(font: &CTFont) -> Option<f64> {
    let mut ch: u16 = b'0' as u16;
    let mut glyph: CGGlyph = 0;
    // SAFETY: one character, one glyph, both live for the calls.
    unsafe {
        if !font.glyphs_for_characters(NonNull::from(&mut ch), NonNull::from(&mut glyph), 1) {
            return None;
        }
        let mut advance = CGSize::default();
        font.advances_for_glyphs(
            CTFontOrientation::Horizontal,
            NonNull::from(&mut glyph),
            &mut advance,
            1,
        );
        (advance.width > 0.0).then_some(advance.width)
    }
}

fn shape(face: &CTFont, text: &str) -> Shape {
    let string = CFString::from_str(text);
    // SAFETY: CoreText's key and a live font, retained by the dictionary.
    let key = unsafe { kCTFontAttributeName };
    let face_value: &CFType = face.as_ref();
    let attributes = CFDictionary::<CFString, CFType>::from_slices(&[key], &[face_value]);
    // SAFETY: a string and attributes CoreText retains.
    let Some(attributed) =
        (unsafe { CFAttributedString::new(None, Some(&string), Some(attributes.as_opaque())) })
    else {
        return Shape {
            pieces: Vec::new(),
            width: 0.0,
        };
    };
    // SAFETY: a line of a live attributed string.
    let line = unsafe { CTLine::with_attributed_string(&attributed) };
    let width = unsafe {
        line.typographic_bounds(
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };
    // SAFETY: a line's runs are CTRuns.
    let runs = unsafe { line.glyph_runs() };
    let runs = unsafe { runs.cast_unchecked::<CTRun>() };
    let mut pieces = Vec::new();
    for i in 0..runs.len() {
        let Some(run) = runs.get(i) else { continue };
        // SAFETY: reads of a live run into buffers of its glyph count.
        unsafe {
            let count = run.glyph_count().max(0) as usize;
            if count == 0 {
                continue;
            }
            let attrs = run.attributes();
            let attrs = attrs.cast_unchecked::<CFString, CTFont>();
            let Some(font) = attrs.get(key) else { continue };
            let mut glyphs = vec![0 as CGGlyph; count];
            let mut offsets = vec![CGPoint::default(); count];
            let all = CFRange {
                location: 0,
                length: 0,
            };
            run.glyphs(all, NonNull::new_unchecked(glyphs.as_mut_ptr()));
            run.positions(all, NonNull::new_unchecked(offsets.as_mut_ptr()));
            pieces.push(Piece {
                font,
                glyphs,
                offsets,
            });
        }
    }
    Shape { pieces, width }
}

/// What a frame draws besides the cells.
pub(crate) struct Overlay {
    pub(crate) focused: bool,
    /// Whether a blinking cursor is in its shown phase.
    pub(crate) cursor_on: bool,
    /// The selected columns of each viewport row, half open.
    pub(crate) selected: Vec<Option<(u16, u16)>>,
    /// The input method's text, at the cursor.
    pub(crate) preedit: String,
    /// Runs underlined as links (the one under a Cmd-hover): row, columns
    /// half open.
    pub(crate) links: Vec<(u16, u16, u16)>,
    /// Find matches: row, columns half open, and whether it is the current.
    pub(crate) marks: Vec<(u16, u16, u16, bool)>,
    /// The visual bell's strength, 0 when it is not ringing.
    pub(crate) flash: f64,
    pub(crate) scrollbar: Option<Scrollbar>,
}

/// Where the viewport is in the history, as fractions of it, and how
/// visible the bar is.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Scrollbar {
    pub(crate) top: f64,
    pub(crate) size: f64,
    pub(crate) alpha: f64,
    /// Wider while the pointer is over it or drags it.
    pub(crate) wide: bool,
}

impl Scrollbar {
    /// The thumb's box in a view `width` × `height`.
    pub(crate) fn thumb(&self, width: f64, height: f64) -> Rect {
        let w = if self.wide { 9.0 } else { 6.0 };
        let track = height - 4.0;
        let h = (self.size * track).max(24.0).min(track);
        Rect {
            x: width - w - 2.0,
            y: 2.0 + self.top * (track - h) / (1.0 - self.size).max(f64::EPSILON),
            width: w,
            height: h,
        }
    }
}

/// Glyphs of one font and color waiting to be drawn together.
struct Batch {
    font: Option<CFRetained<CTFont>>,
    color: Rgba,
    glyphs: Vec<CGGlyph>,
    positions: Vec<CGPoint>,
}

impl Batch {
    fn push(
        &mut self,
        cg: &CGContext,
        font: &CFRetained<CTFont>,
        color: Rgba,
        glyph: CGGlyph,
        at: CGPoint,
    ) {
        let same = self
            .font
            .as_ref()
            .is_some_and(|f| CFRetained::as_ptr(f) == CFRetained::as_ptr(font))
            && self.color == color;
        if !same {
            self.flush(cg);
            self.font = Some(font.clone());
            self.color = color;
        }
        self.glyphs.push(glyph);
        self.positions.push(at);
    }

    fn flush(&mut self, cg: &CGContext) {
        if let Some(font) = &self.font
            && !self.glyphs.is_empty()
        {
            fill_color(cg, self.color);
            // SAFETY: as many positions as glyphs, both live for the call.
            unsafe {
                font.draw_glyphs(
                    NonNull::new_unchecked(self.glyphs.as_mut_ptr()),
                    NonNull::new_unchecked(self.positions.as_mut_ptr()),
                    self.glyphs.len(),
                    cg,
                );
            }
        }
        self.glyphs.clear();
        self.positions.clear();
    }
}

fn fill_color(cg: &CGContext, c: Rgba) {
    let color = CGColor::new_srgb(c.r, c.g, c.b, c.a);
    CGContext::set_fill_color_with_color(Some(cg), Some(&color));
}

fn fill(cg: &CGContext, rect: Rect, c: Rgba) {
    if c.a <= 0.0 {
        return;
    }
    fill_color(cg, c);
    CGContext::fill_rect(Some(cg), cg_rect(rect));
}

fn cg_rect(r: Rect) -> CGRect {
    CGRect::new(CGPoint::new(r.x, r.y), CGSize::new(r.width, r.height))
}

/// A cell's colors after inversion and the defaults: text, then background
/// (`None` the view's own).
fn cell_colors(cell: &zu_ghostty::Cell, palette: &Palette) -> (Rgba, Option<Rgba>) {
    let fg = cell
        .fg
        .map_or(palette.foreground, |_| cell.fg_resolved.into());
    let bg = cell.bg.map(|_| Rgba::from(cell.bg_resolved));
    let (fg, bg) = if cell.inverse {
        (bg.unwrap_or(palette.background), Some(fg))
    } else {
        (fg, bg)
    };
    (if cell.faint { fg.with_alpha(0.6) } else { fg }, bg)
}

/// Draws `frame` into `cg`, a context flipped to the view's top-left
/// origin, over a view of `size` (width, height) points.
pub(crate) fn draw(
    cg: &CGContext,
    size: (f64, f64),
    fonts: &mut Fonts,
    metrics: Metrics,
    palette: &Palette,
    frame: &Frame,
    overlay: &Overlay,
) {
    let height = size.1;
    // Every box sits on device pixels, so neighbors share edges exactly.
    let pixels = Pixels::of(cg);
    let cell_box = |x: u16, y: u16, span: u16| pixels.snap(metrics.cell(x, y, span));
    // A blinking cursor in its hidden phase is drawn as no cursor; an
    // unfocused one never blinks (it is the hollow box).
    let cursor = frame
        .cursor
        .as_ref()
        .filter(|c| c.visible && c.x < frame.cols && c.y < frame.rows)
        .filter(|c| !(overlay.focused && c.blinking && !overlay.cursor_on));
    let block = cursor.is_some_and(|c| {
        overlay.focused
            && overlay.preedit.is_empty()
            && c.style != GHOSTTY_RENDER_STATE_CURSOR_VISUAL_STYLE_BAR
            && c.style != GHOSTTY_RENDER_STATE_CURSOR_VISUAL_STYLE_UNDERLINE
    });

    for (y, row) in frame.cells.iter().enumerate() {
        let y = y as u16;
        for (x, cell) in row.iter().enumerate() {
            let x = x as u16;
            let span = if cell.wide == GHOSTTY_CELL_WIDE_WIDE {
                2
            } else {
                1
            };
            if let (_, Some(bg)) = cell_colors(cell, palette) {
                fill(cg, cell_box(x, y, span), bg);
            }
        }
        for &(row, start, end, current) in &overlay.marks {
            if row == y && end > start {
                let color = if current {
                    palette.mark_current
                } else {
                    palette.mark
                };
                fill(cg, cell_box(start, y, end - start), color);
            }
        }
        if let Some(Some((start, end))) = overlay.selected.get(y as usize)
            && end > start
        {
            fill(cg, cell_box(*start, y, end - start), palette.selection);
        }
    }
    if let Some(c) = cursor
        && block
    {
        let span = if c.wide_tail { 2 } else { 1 };
        fill(cg, cell_box(c.x, c.y, span), palette.cursor);
    }

    // Sprites draw outside the glyphs' transform, in the view's flipped
    // points, each in its cell's box snapped to device pixels.
    let light = sprite::light(metrics.cell_width, pixels.scale());
    let mut sprites: Vec<(Rect, Rc<[sprite::Shape]>, Rgba)> = Vec::new();

    // Glyphs in CoreGraphics' own orientation, where text space is user
    // space: a pen at the view's (x, y) is (x, height - y).
    CGContext::save_g_state(Some(cg));
    CGContext::translate_ctm(Some(cg), 0.0, height);
    CGContext::scale_ctm(Some(cg), 1.0, -1.0);
    CGContext::set_text_matrix(Some(cg), IDENTITY);
    let mut batch = Batch {
        font: None,
        color: palette.foreground,
        glyphs: Vec::new(),
        positions: Vec::new(),
    };
    let mut decorations: Vec<(Rect, Rgba)> = Vec::new();
    for (y, row) in frame.cells.iter().enumerate() {
        let y = y as u16;
        for (x, cell) in row.iter().enumerate() {
            let x = x as u16;
            if cell.wide == GHOSTTY_CELL_WIDE_SPACER_TAIL || cell.invisible {
                continue;
            }
            let (mut fg, _) = cell_colors(cell, palette);
            let under_cursor = block && cursor.is_some_and(|c| c.x == x && c.y == y);
            if under_cursor {
                fg = palette.background;
            }
            let span = if cell.wide == GHOSTTY_CELL_WIDE_WIDE {
                2
            } else {
                1
            };
            if cell.underline != GHOSTTY_SGR_UNDERLINE_NONE {
                decorations.push((underline(metrics, x, y, span), fg));
            }
            if cell.strikethrough {
                decorations.push((strike(metrics, x, y, span), fg));
            }
            let mut chars = cell.text.chars();
            if let (Some(c), None) = (chars.next(), chars.next())
                && sprite::covers(c)
            {
                let at = pixels.snap(metrics.cell(x, y, span));
                let scale = pixels.scale();
                if let Some(shapes) = fonts.sprites.get(c, at.width, at.height, light, scale) {
                    sprites.push((at, shapes, fg));
                    continue;
                }
            }
            if cell.text.is_empty() || cell.text == " " {
                continue;
            }
            glyphs(
                cg,
                &mut batch,
                fonts,
                metrics,
                height,
                &cell.text,
                style_of(cell.bold, cell.italic),
                x,
                y,
                span,
                fg,
            );
        }
    }
    batch.flush(cg);
    CGContext::restore_g_state(Some(cg));

    for (at, shapes, color) in sprites {
        sprite::paint(cg, &shapes, (at.x, at.y), color);
    }
    for &(row, start, end) in &overlay.links {
        if end > start {
            decorations.push((underline(metrics, start, row, end - start), palette.link));
        }
    }
    for (rect, color) in decorations {
        fill(cg, pixels.snap(rect), color);
    }
    if let Some(c) = cursor
        && overlay.preedit.is_empty()
    {
        let span = if c.wide_tail { 2 } else { 1 };
        let cell = cell_box(c.x, c.y, span);
        match c.style {
            _ if !overlay.focused => {
                CGContext::set_line_width(Some(cg), 1.0);
                let color = palette.cursor;
                let stroke = CGColor::new_srgb(color.r, color.g, color.b, color.a);
                CGContext::set_stroke_color_with_color(Some(cg), Some(&stroke));
                CGContext::stroke_rect(
                    Some(cg),
                    cg_rect(Rect {
                        x: cell.x + 0.5,
                        y: cell.y + 0.5,
                        width: cell.width - 1.0,
                        height: cell.height - 1.0,
                    }),
                );
            }
            GHOSTTY_RENDER_STATE_CURSOR_VISUAL_STYLE_BAR => {
                fill(cg, Rect { width: 2.0, ..cell }, palette.cursor);
            }
            GHOSTTY_RENDER_STATE_CURSOR_VISUAL_STYLE_UNDERLINE => {
                fill(
                    cg,
                    Rect {
                        y: cell.y + cell.height - 2.0,
                        height: 2.0,
                        ..cell
                    },
                    palette.cursor,
                );
            }
            _ => {}
        }
    }
    if let Some(c) = cursor.or(frame.cursor.as_ref())
        && !overlay.preedit.is_empty()
    {
        preedit(
            cg,
            fonts,
            metrics,
            palette,
            height,
            &overlay.preedit,
            c.x,
            c.y,
        );
    }
    if let Some(bar) = overlay.scrollbar {
        scrollbar(cg, bar, size.0, size.1, palette);
    }
    if overlay.flash > 0.0 {
        let all = Rect {
            x: 0.0,
            y: 0.0,
            width: size.0,
            height,
        };
        fill(cg, all, palette.foreground.with_alpha(0.12 * overlay.flash));
    }
}

/// The scrollbar's thumb over a view `width` × `height`, rounded.
fn scrollbar(cg: &CGContext, bar: Scrollbar, width: f64, height: f64, palette: &Palette) {
    if bar.alpha <= 0.0 || bar.size >= 1.0 {
        return;
    }
    let thumb = bar.thumb(width, height);
    let radius = thumb.width / 2.0;
    // SAFETY: a path of a valid rectangle, no transform.
    let path =
        unsafe { CGPath::with_rounded_rect(cg_rect(thumb), radius, radius, std::ptr::null()) };
    let c = palette.scrollbar.with_alpha(bar.alpha);
    fill_color(cg, c);
    CGContext::begin_path(Some(cg));
    CGContext::add_path(Some(cg), Some(&path));
    CGContext::fill_path(Some(cg));
}

/// Queues the glyphs of grapheme `text` at cell (`x`, `y`): its pen on the
/// grid, a narrower fallback glyph centered in its `span` cells.
#[allow(clippy::too_many_arguments)]
fn glyphs(
    cg: &CGContext,
    batch: &mut Batch,
    fonts: &mut Fonts,
    metrics: Metrics,
    height: f64,
    text: &str,
    style: usize,
    x: u16,
    y: u16,
    span: u16,
    color: Rgba,
) {
    let shape = fonts.shape(text, style);
    let (mut pen_x, pen_y) = metrics.pen(x, y);
    let room = span as f64 * metrics.cell_width;
    if span > 1 && shape.width < room {
        pen_x += (room - shape.width) / 2.0;
    }
    for piece in &shape.pieces {
        for (glyph, offset) in piece.glyphs.iter().zip(&piece.offsets) {
            let at = CGPoint::new(pen_x + offset.x, height - pen_y + offset.y);
            batch.push(cg, &piece.font, color, *glyph, at);
        }
    }
}

fn underline(metrics: Metrics, x: u16, y: u16, span: u16) -> Rect {
    let cell = metrics.cell(x, y, span);
    Rect {
        y: cell.y + metrics.baseline + 1.5,
        height: 1.0,
        ..cell
    }
}

fn strike(metrics: Metrics, x: u16, y: u16, span: u16) -> Rect {
    let cell = metrics.cell(x, y, span);
    Rect {
        y: cell.y + metrics.baseline * 0.62,
        height: 1.0,
        ..cell
    }
}

/// The input method's composition at the cursor, over the cells it will
/// take: its own background, the theme's text, underlined.
#[allow(clippy::too_many_arguments)]
fn preedit(
    cg: &CGContext,
    fonts: &mut Fonts,
    metrics: Metrics,
    palette: &Palette,
    height: f64,
    text: &str,
    x: u16,
    y: u16,
) {
    use unicode_segmentation::UnicodeSegmentation;

    let cols = text_width(text).max(1);
    let area = metrics.cell(x, y, cols);
    fill(cg, area, palette.preedit);
    CGContext::save_g_state(Some(cg));
    CGContext::translate_ctm(Some(cg), 0.0, height);
    CGContext::scale_ctm(Some(cg), 1.0, -1.0);
    CGContext::set_text_matrix(Some(cg), IDENTITY);
    let mut batch = Batch {
        font: None,
        color: palette.foreground,
        glyphs: Vec::new(),
        positions: Vec::new(),
    };
    let mut col = x;
    for g in text.graphemes(true) {
        let span = text_width(g).max(1);
        glyphs(
            cg,
            &mut batch,
            fonts,
            metrics,
            height,
            g,
            0,
            col,
            y,
            span,
            palette.foreground,
        );
        col = col.saturating_add(span);
    }
    batch.flush(cg);
    CGContext::restore_g_state(Some(cg));
    fill(cg, underline(metrics, x, y, cols), palette.foreground);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_colors_parse() {
        assert_eq!(
            Rgba::parse("#ff000080").map(|c| (c.r, c.a)),
            Some((1.0, 128.0 / 255.0))
        );
        assert_eq!(Rgba::parse("#00ff00").map(|c| (c.g, c.a)), Some((1.0, 1.0)));
        assert_eq!(Rgba::parse("red"), None);
        assert_eq!(Rgba::parse("#fff"), None);
    }

    #[test]
    fn fallback_glyphs_keep_the_primary_baseline() {
        let mut fonts = Fonts::new("Menlo", 13.0);
        let m = fonts.metrics(18.0, 2.0);
        // A CJK character comes from a fallback face; its pieces still sit
        // on y = 0 relative to the pen (the shared baseline).
        let shape = fonts.shape("中", 0);
        assert!(!shape.pieces.is_empty());
        for piece in &shape.pieces {
            assert!(
                piece.offsets.iter().all(|o| o.y == 0.0),
                "{:?}",
                piece.offsets.len()
            );
        }
        assert!(m.cell_width > 7.0 && m.cell_width < 9.0, "{}", m.cell_width);
    }
}
