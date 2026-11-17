//! Characters drawn as geometry instead of font glyphs: box drawing, block
//! elements, braille, Powerline separators and sextants.
//!
//! A font's box glyphs are designed for its own line height; in a taller row
//! they stop short of the cell's edges. A sprite fills the cell it is given,
//! so borders join across cells whatever the row height. Every edge and line
//! is on the device pixel grid: the cell's box is snapped to it, each line is
//! a whole number of pixels thick, and a line of odd width is centered on a
//! half pixel.

use std::{collections::HashMap, rc::Rc};

use objc2_core_foundation::{CGPoint, CGRect, CGSize};
use objc2_core_graphics::{CGColor, CGContext, CGLineCap};

use super::{grid::Rect, render::Rgba};

/// One primitive of a sprite, in cell-local points (origin at the cell's top
/// left, y down). Every primitive lies within the cell.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Shape {
    /// An axis-aligned box filled with `alpha` of the color.
    Rect {
        x: f64,
        y: f64,
        w: f64,
        h: f64,
        alpha: f64,
    },
    /// A region under the nonzero rule: subpaths of one orientation that
    /// overlap fill once.
    Fill(Vec<Seg>),
    /// A path stroked `width` thick with butt ends.
    Stroke { path: Vec<Seg>, width: f64 },
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum Seg {
    Move(f64, f64),
    Line(f64, f64),
    /// Two control points, then the end point.
    Cubic(Point, Point, Point),
    Close,
}

/// (x, y) in cell-local points.
type Point = (f64, f64);

/// The control distance of a cubic quarter circle, per unit of radius.
const KAPPA: f64 = 0.552_284_749_830_793_6;

/// Whether `c` is drawn as a sprite.
pub(crate) fn covers(c: char) -> bool {
    matches!(
        c as u32,
        0x2500..=0x259F | 0x2800..=0x28FF | 0xE0B0..=0xE0BF | 0x1FB00..=0x1FB3B
    )
}

/// The thickness of a light line in points for cells `cell_width` wide: an
/// eighth of the cell, at least one device pixel, a whole number of them.
pub(crate) fn light(cell_width: f64, scale: f64) -> f64 {
    let scale = if scale > 0.0 { scale } else { 1.0 };
    (cell_width * scale / 8.0).round().max(1.0) / scale
}

/// The shapes of `c` in a box `width` × `height` points whose origin sits on
/// a device pixel of `scale`; light lines `light` points thick, heavy ones
/// twice that. `None` when `c` is not a sprite.
pub(crate) fn sprite(
    c: char,
    width: f64,
    height: f64,
    light: f64,
    scale: f64,
) -> Option<Vec<Shape>> {
    if !covers(c) || width <= 0.0 || height <= 0.0 {
        return None;
    }
    let scale = if scale > 0.0 { scale } else { 1.0 };
    let mut cv = Canvas {
        w: width,
        h: height,
        scale,
        t: light.max(1.0 / scale),
        out: Vec::new(),
    };
    let cp = c as u32;
    match cp {
        0x2500..=0x257F => cv.box_drawing(cp - 0x2500),
        0x2580..=0x259F => cv.block(cp),
        0x2800..=0x28FF => cv.braille((cp - 0x2800) as u8),
        0xE0B0..=0xE0BF => cv.powerline(cp),
        0x1FB00..=0x1FB3B => cv.sextant(cp - 0x1FB00),
        _ => return None,
    }
    Some(cv.out)
}

/// Sprites already built, per character and box.
#[derive(Default)]
pub(crate) struct Sprites(HashMap<(char, [u64; 4]), Rc<[Shape]>>);

impl Sprites {
    pub(crate) fn get(
        &mut self,
        c: char,
        width: f64,
        height: f64,
        light: f64,
        scale: f64,
    ) -> Option<Rc<[Shape]>> {
        if !covers(c) {
            return None;
        }
        let key = (c, [width, height, light, scale].map(|v| v.to_bits()));
        if let Some(shapes) = self.0.get(&key) {
            return Some(shapes.clone());
        }
        let shapes: Rc<[Shape]> = sprite(c, width, height, light, scale)?.into();
        self.0.insert(key, shapes.clone());
        Some(shapes)
    }
}

/// A context's device pixel grid.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Pixels {
    sx: f64,
    tx: f64,
    sy: f64,
    ty: f64,
}

impl Pixels {
    /// The grid of `cg` in its current user space.
    pub(crate) fn of(cg: &CGContext) -> Self {
        let t = CGContext::user_space_to_device_space_transform(Some(cg));
        let nonzero = |v: f64| if v == 0.0 { 1.0 } else { v };
        Self {
            sx: nonzero(t.a),
            tx: t.tx,
            sy: nonzero(t.d),
            ty: t.ty,
        }
    }

    pub(crate) fn scale(&self) -> f64 {
        self.sx.abs()
    }

    /// `r` with each edge moved to the nearest device pixel: boxes that
    /// share an edge still share it, and every box is whole pixels.
    pub(crate) fn snap(&self, r: Rect) -> Rect {
        let x = |v: f64| ((v * self.sx + self.tx).round() - self.tx) / self.sx;
        let y = |v: f64| ((v * self.sy + self.ty).round() - self.ty) / self.sy;
        let (x0, x1) = (x(r.x), x(r.x + r.width));
        let (y0, y1) = (y(r.y), y(r.y + r.height));
        Rect {
            x: x0.min(x1),
            y: y0.min(y1),
            width: (x1 - x0).abs(),
            height: (y1 - y0).abs(),
        }
    }
}

/// Fills `shapes` in `color` with the cell's top left at `origin`, in the
/// view's flipped points. Consecutive rectangles of one alpha fill as one
/// path, so where they overlap the color is not applied twice.
pub(crate) fn paint(cg: &CGContext, shapes: &[Shape], origin: (f64, f64), color: Rgba) {
    let (ox, oy) = origin;
    let cg = Some(cg);
    let srgb = |alpha: f64| CGColor::new_srgb(color.r, color.g, color.b, color.a * alpha);
    let trace = |path: &[Seg]| {
        CGContext::begin_path(cg);
        for seg in path {
            match *seg {
                Seg::Move(x, y) => CGContext::move_to_point(cg, ox + x, oy + y),
                Seg::Line(x, y) => CGContext::add_line_to_point(cg, ox + x, oy + y),
                Seg::Cubic((ax, ay), (bx, by), (x, y)) => CGContext::add_curve_to_point(
                    cg,
                    ox + ax,
                    oy + ay,
                    ox + bx,
                    oy + by,
                    ox + x,
                    oy + y,
                ),
                Seg::Close => CGContext::close_path(cg),
            }
        }
    };
    let flush = |open: &mut Option<f64>| {
        if let Some(alpha) = open.take() {
            CGContext::set_fill_color_with_color(cg, Some(&srgb(alpha)));
            CGContext::fill_path(cg);
        }
    };
    let mut open: Option<f64> = None;
    for shape in shapes {
        match shape {
            Shape::Rect { x, y, w, h, alpha } => {
                if open != Some(*alpha) {
                    flush(&mut open);
                    CGContext::begin_path(cg);
                    open = Some(*alpha);
                }
                CGContext::add_rect(
                    cg,
                    CGRect::new(CGPoint::new(ox + x, oy + y), CGSize::new(*w, *h)),
                );
            }
            Shape::Fill(path) => {
                flush(&mut open);
                trace(path);
                CGContext::set_fill_color_with_color(cg, Some(&srgb(1.0)));
                CGContext::fill_path(cg);
            }
            Shape::Stroke { path, width } => {
                flush(&mut open);
                trace(path);
                CGContext::set_stroke_color_with_color(cg, Some(&srgb(1.0)));
                CGContext::set_line_width(cg, *width);
                CGContext::set_line_cap(cg, CGLineCap::Butt);
                CGContext::stroke_path(cg);
            }
        }
    }
    flush(&mut open);
}

/// A line's weight on one arm of a box-drawing character.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum W {
    O,
    L,
    H,
    D,
}

use W::{D, H, L, O};

/// The arms of U+2500–U+257F, `[up, right, down, left]`; dashes, arcs and
/// diagonals are drawn by their own code and have none here.
#[rustfmt::skip]
const ARMS: [[W; 4]; 0x80] = [
    [O,L,O,L], [O,H,O,H], [L,O,L,O], [H,O,H,O], // ─ ━ │ ┃
    [O,O,O,O], [O,O,O,O], [O,O,O,O], [O,O,O,O], // ┄ ┅ ┆ ┇
    [O,O,O,O], [O,O,O,O], [O,O,O,O], [O,O,O,O], // ┈ ┉ ┊ ┋
    [O,L,L,O], [O,H,L,O], [O,L,H,O], [O,H,H,O], // ┌ ┍ ┎ ┏
    [O,O,L,L], [O,O,L,H], [O,O,H,L], [O,O,H,H], // ┐ ┑ ┒ ┓
    [L,L,O,O], [L,H,O,O], [H,L,O,O], [H,H,O,O], // └ ┕ ┖ ┗
    [L,O,O,L], [L,O,O,H], [H,O,O,L], [H,O,O,H], // ┘ ┙ ┚ ┛
    [L,L,L,O], [L,H,L,O], [H,L,L,O], [L,L,H,O], // ├ ┝ ┞ ┟
    [H,L,H,O], [H,H,L,O], [L,H,H,O], [H,H,H,O], // ┠ ┡ ┢ ┣
    [L,O,L,L], [L,O,L,H], [H,O,L,L], [L,O,H,L], // ┤ ┥ ┦ ┧
    [H,O,H,L], [H,O,L,H], [L,O,H,H], [H,O,H,H], // ┨ ┩ ┪ ┫
    [O,L,L,L], [O,L,L,H], [O,H,L,L], [O,H,L,H], // ┬ ┭ ┮ ┯
    [O,L,H,L], [O,L,H,H], [O,H,H,L], [O,H,H,H], // ┰ ┱ ┲ ┳
    [L,L,O,L], [L,L,O,H], [L,H,O,L], [L,H,O,H], // ┴ ┵ ┶ ┷
    [H,L,O,L], [H,L,O,H], [H,H,O,L], [H,H,O,H], // ┸ ┹ ┺ ┻
    [L,L,L,L], [L,L,L,H], [L,H,L,L], [L,H,L,H], // ┼ ┽ ┾ ┿
    [H,L,L,L], [L,L,H,L], [H,L,H,L], [H,L,L,H], // ╀ ╁ ╂ ╃
    [H,H,L,L], [L,L,H,H], [L,H,H,L], [H,H,L,H], // ╄ ╅ ╆ ╇
    [L,H,H,H], [H,L,H,H], [H,H,H,L], [H,H,H,H], // ╈ ╉ ╊ ╋
    [O,O,O,O], [O,O,O,O], [O,O,O,O], [O,O,O,O], // ╌ ╍ ╎ ╏
    [O,D,O,D], [D,O,D,O], [O,D,L,O], [O,L,D,O], // ═ ║ ╒ ╓
    [O,D,D,O], [O,O,L,D], [O,O,D,L], [O,O,D,D], // ╔ ╕ ╖ ╗
    [L,D,O,O], [D,L,O,O], [D,D,O,O], [L,O,O,D], // ╘ ╙ ╚ ╛
    [D,O,O,L], [D,O,O,D], [L,D,L,O], [D,L,D,O], // ╜ ╝ ╞ ╟
    [D,D,D,O], [L,O,L,D], [D,O,D,L], [D,O,D,D], // ╠ ╡ ╢ ╣
    [O,D,L,D], [O,L,D,L], [O,D,D,D], [L,D,O,D], // ╤ ╥ ╦ ╧
    [D,L,O,L], [D,D,O,D], [L,D,L,D], [D,L,D,L], // ╨ ╩ ╪ ╫
    [D,D,D,D], [O,O,O,O], [O,O,O,O], [O,O,O,O], // ╬ ╭ ╮ ╯
    [O,O,O,O], [O,O,O,O], [O,O,O,O], [O,O,O,O], // ╰ ╱ ╲ ╳
    [O,O,O,L], [L,O,O,O], [O,L,O,O], [O,O,L,O], // ╴ ╵ ╶ ╷
    [O,O,O,H], [H,O,O,O], [O,H,O,O], [O,O,H,O], // ╸ ╹ ╺ ╻
    [O,H,O,L], [L,O,H,O], [O,L,O,H], [H,O,L,O], // ╼ ╽ ╾ ╿
];

/// Where a line of each weight lies across one axis of the cell: its two
/// edges. A double line's two strokes are light, flanking the light line's
/// place, so its gap is one light thickness.
#[derive(Debug, Clone, Copy)]
struct Bands {
    light: (f64, f64),
    heavy: (f64, f64),
    double: (f64, f64),
}

struct Canvas {
    w: f64,
    h: f64,
    scale: f64,
    /// A light line's thickness.
    t: f64,
    out: Vec<Shape>,
}

impl Canvas {
    fn round(&self, v: f64) -> f64 {
        (v * self.scale).round() / self.scale
    }

    fn floor(&self, v: f64) -> f64 {
        (v * self.scale + 1e-6).floor() / self.scale
    }

    fn rect(&mut self, x0: f64, y0: f64, x1: f64, y1: f64) {
        self.alpha_rect(x0, y0, x1, y1, 1.0);
    }

    fn alpha_rect(&mut self, x0: f64, y0: f64, x1: f64, y1: f64, alpha: f64) {
        let (x0, y0, x1, y1) = (x0.max(0.0), y0.max(0.0), x1.min(self.w), y1.min(self.h));
        if x1 > x0 && y1 > y0 {
            self.out.push(Shape::Rect {
                x: x0,
                y: y0,
                w: x1 - x0,
                h: y1 - y0,
                alpha,
            });
        }
    }

    /// A pixel-snapped fraction of the cell: its edges exactly at 0 and 1.
    fn at(&self, f: f64, extent: f64) -> f64 {
        if f <= 0.0 {
            0.0
        } else if f >= 1.0 {
            extent
        } else {
            self.round(f * extent)
        }
    }

    /// The edges of a line `thick` across an axis `extent` long, centered
    /// with its start on a pixel.
    fn centered(&self, extent: f64, thick: f64) -> (f64, f64) {
        let start = self.floor((extent - thick) / 2.0).max(0.0);
        (start, start + thick)
    }

    fn bands(&self, extent: f64) -> Bands {
        let light = self.centered(extent, self.t);
        Bands {
            light,
            heavy: self.centered(extent, 2.0 * self.t),
            double: ((light.0 - self.t).max(0.0), light.1 + self.t),
        }
    }

    fn box_drawing(&mut self, i: u32) {
        match i {
            0x04..=0x0B => {
                let k = i - 0x04;
                self.dashes(3 + k / 4, k & 1 != 0, k & 2 != 0);
            }
            0x4C..=0x4F => {
                let k = i - 0x4C;
                self.dashes(2, k & 1 != 0, k & 2 != 0);
            }
            0x6D => self.arc(1.0, 1.0),
            0x6E => self.arc(-1.0, 1.0),
            0x6F => self.arc(-1.0, -1.0),
            0x70 => self.arc(1.0, -1.0),
            0x71 => self.diagonals(&[((self.w, 0.0), (0.0, self.h))]),
            0x72 => self.diagonals(&[((0.0, 0.0), (self.w, self.h))]),
            0x73 => self.diagonals(&[
                ((self.w, 0.0), (0.0, self.h)),
                ((0.0, 0.0), (self.w, self.h)),
            ]),
            _ => self.lines(ARMS[i as usize]),
        }
    }

    /// Straight arms meeting at the center. Each arm runs from its edge to
    /// where the crossing line's near or far side lies, so a junction is
    /// square, a heavy line passes over a light one, and a double line's
    /// inner strokes stop at the gap of a double line crossing them.
    fn lines(&mut self, [up, right, down, left]: [W; 4]) {
        let hz = self.bands(self.h);
        let vt = self.bands(self.w);
        let (w, h) = (self.w, self.h);

        // Where an arm meets the lines crossing it (`a`, `b`), given the
        // weights of itself and the arm opposite. It covers a heavy or an
        // uneven crossing to its far side, and runs to the far side when it
        // continues straight on; an arm whose opposite has another weight
        // stops at the near side of an even crossing, which runs through.
        // `low` is whether the arm comes from the top or left edge.
        let reach = |a: W, b: W, own: W, opposite: W, bands: Bands, low: bool| {
            let far = |(lo, hi): (f64, f64)| if low { hi } else { lo };
            let near = |(lo, hi): (f64, f64)| if low { lo } else { hi };
            if a == H || b == H {
                far(bands.heavy)
            } else if a != b || own == opposite {
                if a == D || b == D {
                    far(bands.double)
                } else {
                    far(bands.light)
                }
            } else if a == O {
                far(bands.light)
            } else {
                near(bands.light)
            }
        };
        let up_end = reach(left, right, up, down, hz, true);
        let down_start = reach(left, right, down, up, hz, false);
        let left_end = reach(up, down, left, right, vt, true);
        let right_start = reach(up, down, right, left, vt, false);

        match up {
            O => {}
            L => self.rect(vt.light.0, 0.0, vt.light.1, up_end),
            H => self.rect(vt.heavy.0, 0.0, vt.heavy.1, up_end),
            D => {
                let l = if left == D { hz.light.0 } else { up_end };
                let r = if right == D { hz.light.0 } else { up_end };
                self.rect(vt.double.0, 0.0, vt.light.0, l);
                self.rect(vt.light.1, 0.0, vt.double.1, r);
            }
        }
        match down {
            O => {}
            L => self.rect(vt.light.0, down_start, vt.light.1, h),
            H => self.rect(vt.heavy.0, down_start, vt.heavy.1, h),
            D => {
                let l = if left == D { hz.light.1 } else { down_start };
                let r = if right == D { hz.light.1 } else { down_start };
                self.rect(vt.double.0, l, vt.light.0, h);
                self.rect(vt.light.1, r, vt.double.1, h);
            }
        }
        match left {
            O => {}
            L => self.rect(0.0, hz.light.0, left_end, hz.light.1),
            H => self.rect(0.0, hz.heavy.0, left_end, hz.heavy.1),
            D => {
                let t = if up == D { vt.light.0 } else { left_end };
                let b = if down == D { vt.light.0 } else { left_end };
                self.rect(0.0, hz.double.0, t, hz.light.0);
                self.rect(0.0, hz.light.1, b, hz.double.1);
            }
        }
        match right {
            O => {}
            L => self.rect(right_start, hz.light.0, w, hz.light.1),
            H => self.rect(right_start, hz.heavy.0, w, hz.heavy.1),
            D => {
                let t = if up == D { vt.light.1 } else { right_start };
                let b = if down == D { vt.light.1 } else { right_start };
                self.rect(t, hz.double.0, w, hz.light.0);
                self.rect(b, hz.light.1, w, hz.double.1);
            }
        }
        self.join_lines();
    }

    /// Rectangles that continue one another become one: a straight line
    /// through the cell is a single rectangle.
    fn join_lines(&mut self) {
        let mut i = 0;
        while i < self.out.len() {
            let mut joined = false;
            let mut j = i + 1;
            while j < self.out.len() {
                if let Some(both) = join(&self.out[i], &self.out[j]) {
                    self.out[i] = both;
                    self.out.remove(j);
                    joined = true;
                } else {
                    j += 1;
                }
            }
            if !joined {
                i += 1;
            }
        }
    }

    /// `n` dashes along the cell, each centered in its `1/n` with half the
    /// gap on either side, so dashes keep one rhythm across cells.
    fn dashes(&mut self, n: u32, heavy: bool, vertical: bool) {
        let (along, across) = if vertical {
            (self.h, self.w)
        } else {
            (self.w, self.h)
        };
        let band = self.bands(across);
        let (lo, hi) = if heavy { band.heavy } else { band.light };
        let seg = along / n as f64;
        let gap = self.round(seg / 3.0).max(1.0 / self.scale);
        for i in 0..n {
            let start = self.round(i as f64 * seg + gap / 2.0);
            let end = self.round((i + 1) as f64 * seg - gap / 2.0);
            if vertical {
                self.rect(lo, start, hi, end);
            } else {
                self.rect(start, lo, end, hi);
            }
        }
    }

    /// A rounded corner toward `dx` (1 right, -1 left) and `dy` (1 down,
    /// -1 up): one stroke on the light lines' centerlines, straight from
    /// both edges into a quarter circle.
    fn arc(&mut self, dx: f64, dy: f64) {
        let (x0, x1) = self.bands(self.w).light;
        let (y0, y1) = self.bands(self.h).light;
        let (cx, cy) = ((x0 + x1) / 2.0, (y0 + y1) / 2.0);
        let r = cx.min(self.w - cx).min(cy).min(self.h - cy).max(0.0);
        let x_end = if dx > 0.0 { self.w } else { 0.0 };
        let y_end = if dy > 0.0 { self.h } else { 0.0 };
        let k = r * (1.0 - KAPPA);
        self.out.push(Shape::Stroke {
            path: vec![
                Seg::Move(cx, y_end),
                Seg::Line(cx, cy + dy * r),
                Seg::Cubic((cx, cy + dy * k), (cx + dx * k, cy), (cx + dx * r, cy)),
                Seg::Line(x_end, cy),
            ],
            width: self.t,
        });
    }

    /// Light lines between the given points, clipped to the cell and filled
    /// as one region.
    fn diagonals(&mut self, lines: &[(Point, Point)]) {
        let mut path = Vec::new();
        for &(a, b) in lines {
            polygon(&mut path, &self.band(a, b, self.t));
        }
        self.out.push(Shape::Fill(path));
    }

    /// A line `thick` wide from `a` to `b`, extended past both so the
    /// cell's edges, not its ends, cut it.
    fn band(&self, a: Point, b: Point, thick: f64) -> Vec<Point> {
        let (dx, dy) = (b.0 - a.0, b.1 - a.1);
        let len = dx.hypot(dy);
        if len == 0.0 {
            return Vec::new();
        }
        let (ux, uy) = (dx / len, dy / len);
        let (nx, ny) = (-uy * thick / 2.0, ux * thick / 2.0);
        let a = (a.0 - ux * thick, a.1 - uy * thick);
        let b = (b.0 + ux * thick, b.1 + uy * thick);
        let quad = vec![
            (a.0 + nx, a.1 + ny),
            (b.0 + nx, b.1 + ny),
            (b.0 - nx, b.1 - ny),
            (a.0 - nx, a.1 - ny),
        ];
        clip(quad, self.w, self.h)
    }

    fn block(&mut self, cp: u32) {
        let (w, h) = (self.w, self.h);
        let mut frac = |x0: f64, y0: f64, x1: f64, y1: f64, alpha: f64| {
            let r = (
                self.at(x0, w),
                self.at(y0, h),
                self.at(x1, w),
                self.at(y1, h),
            );
            self.alpha_rect(r.0, r.1, r.2, r.3, alpha);
        };
        match cp {
            0x2580 => frac(0.0, 0.0, 1.0, 0.5, 1.0),
            0x2581..=0x2588 => {
                let n = (cp - 0x2580) as f64;
                frac(0.0, 1.0 - n / 8.0, 1.0, 1.0, 1.0);
            }
            0x2589..=0x258F => {
                let n = (0x2590 - cp) as f64;
                frac(0.0, 0.0, n / 8.0, 1.0, 1.0);
            }
            0x2590 => frac(0.5, 0.0, 1.0, 1.0, 1.0),
            0x2591..=0x2593 => frac(0.0, 0.0, 1.0, 1.0, (cp - 0x2590) as f64 / 4.0),
            0x2594 => frac(0.0, 0.0, 1.0, 1.0 / 8.0, 1.0),
            0x2595 => frac(7.0 / 8.0, 0.0, 1.0, 1.0, 1.0),
            _ => {
                // Upper left, upper right, lower left, lower right.
                const QUADRANTS: [u8; 10] = [4, 8, 1, 13, 9, 7, 11, 2, 6, 14];
                let bits = QUADRANTS[(cp - 0x2596) as usize];
                for (bit, (x, y)) in [(0.0, 0.0), (0.5, 0.0), (0.0, 0.5), (0.5, 0.5)]
                    .into_iter()
                    .enumerate()
                {
                    if bits & 1 << bit != 0 {
                        frac(x, y, x + 0.5, y + 0.5, 1.0);
                    }
                }
            }
        }
    }

    /// The 2 × 3 mosaics in the order Unicode lists them: every pattern but
    /// empty, full and the two half blocks (▌ ▐), which have their own
    /// characters.
    fn sextant(&mut self, i: u32) {
        let mut bits = i + 1;
        if bits >= 0b010101 {
            bits += 1;
        }
        if bits >= 0b101010 {
            bits += 1;
        }
        let xs = [0.0, self.at(0.5, self.w), self.w];
        let ys = [
            0.0,
            self.at(1.0 / 3.0, self.h),
            self.at(2.0 / 3.0, self.h),
            self.h,
        ];
        for cell in 0..6 {
            if bits & 1 << cell != 0 {
                let (col, row) = (cell % 2, cell / 2);
                self.rect(xs[col], ys[row], xs[col + 1], ys[row + 1]);
            }
        }
    }

    /// Eight dots in two columns of four, each centered in its part of a
    /// 2 × 4 grid over the cell, so dots keep one spacing across cells.
    fn braille(&mut self, bits: u8) {
        let size = self
            .round((self.w / 4.0).min(self.h / 8.0))
            .max(1.0 / self.scale);
        // Dots 1–8 by bit, as (column, row).
        const DOTS: [(u8, u8); 8] = [
            (0, 0),
            (0, 1),
            (0, 2),
            (1, 0),
            (1, 1),
            (1, 2),
            (0, 3),
            (1, 3),
        ];
        for (bit, (col, row)) in DOTS.into_iter().enumerate() {
            if bits & 1 << bit != 0 {
                let cx = self.w * (2 * col + 1) as f64 / 4.0;
                let cy = self.h * (2 * row + 1) as f64 / 8.0;
                let x = self.round(cx - size / 2.0);
                let y = self.round(cy - size / 2.0);
                self.rect(x, y, x + size, y + size);
            }
        }
    }

    fn powerline(&mut self, cp: u32) {
        let (w, h) = (self.w, self.h);
        // The right-pointing shapes; each left-pointing one is its mirror.
        let left = matches!(cp, 0xE0B2 | 0xE0B3 | 0xE0B6 | 0xE0B7);
        let mx = |x: f64| if left { w - x } else { x };
        let m = |(x, y): Point| (mx(x), y);
        let mut path = Vec::new();
        match cp {
            0xE0B0 | 0xE0B2 => {
                polygon(&mut path, &[(0.0, 0.0), (w, h / 2.0), (0.0, h)].map(m));
                self.out.push(Shape::Fill(path));
            }
            0xE0B1 | 0xE0B3 => {
                let tip = m((w, h / 2.0));
                for from in [m((0.0, 0.0)), m((0.0, h))] {
                    polygon(&mut path, &self.band(from, tip, self.t));
                }
                self.out.push(Shape::Fill(path));
            }
            0xE0B4 | 0xE0B6 => {
                let (rx, ry, cy) = (w, h / 2.0, h / 2.0);
                path.push(Seg::Move(mx(0.0), 0.0));
                path.extend(half_ellipse(rx, ry, cy, mx));
                path.push(Seg::Close);
                self.out.push(Shape::Fill(path));
            }
            0xE0B5 | 0xE0B7 => {
                let half = self.t / 2.0;
                let (rx, ry, cy) = (w - half, h / 2.0 - half, h / 2.0);
                path.push(Seg::Move(mx(0.0), cy - ry));
                path.extend(half_ellipse(rx, ry, cy, mx));
                self.out.push(Shape::Stroke {
                    path,
                    width: self.t,
                });
            }
            0xE0B8 => self.triangle([(0.0, 0.0), (w, h), (0.0, h)]),
            0xE0BA => self.triangle([(w, 0.0), (w, h), (0.0, h)]),
            0xE0BC => self.triangle([(0.0, 0.0), (w, 0.0), (0.0, h)]),
            0xE0BE => self.triangle([(0.0, 0.0), (w, 0.0), (w, h)]),
            0xE0B9 | 0xE0BF => self.diagonals(&[((0.0, 0.0), (w, h))]),
            _ => self.diagonals(&[((w, 0.0), (0.0, h))]),
        }
    }

    fn triangle(&mut self, points: [Point; 3]) {
        let mut path = Vec::new();
        polygon(&mut path, &points);
        self.out.push(Shape::Fill(path));
    }
}

/// The two quarter arcs of an ellipse centered on the cell's flat edge at
/// height `cy`, from its top to its bottom, `mx` mirroring x.
fn half_ellipse(rx: f64, ry: f64, cy: f64, mx: impl Fn(f64) -> f64) -> [Seg; 2] {
    let (kx, ky) = (rx * KAPPA, ry * KAPPA);
    [
        Seg::Cubic((mx(kx), cy - ry), (mx(rx), cy - ky), (mx(rx), cy)),
        Seg::Cubic((mx(rx), cy + ky), (mx(kx), cy + ry), (mx(0.0), cy + ry)),
    ]
}

/// Appends `points` as a closed subpath, wound one way whatever their
/// order, so subpaths that overlap fill once under the nonzero rule.
fn polygon(path: &mut Vec<Seg>, points: &[Point]) {
    if points.len() < 3 {
        return;
    }
    let area: f64 = points
        .iter()
        .zip(points.iter().cycle().skip(1))
        .map(|(a, b)| a.0 * b.1 - b.0 * a.1)
        .sum();
    let ordered: Vec<Point> = if area < 0.0 {
        points.iter().rev().copied().collect()
    } else {
        points.to_vec()
    };
    path.push(Seg::Move(ordered[0].0, ordered[0].1));
    path.extend(ordered[1..].iter().map(|&(x, y)| Seg::Line(x, y)));
    path.push(Seg::Close);
}

/// `poly` cut to the box 0..`w` × 0..`h`; a point on a cut lies exactly on
/// the box's edge.
fn clip(mut poly: Vec<Point>, w: f64, h: f64) -> Vec<Point> {
    // (vertical edge, its position, whether inside is past it)
    for (vertical, bound, past) in [
        (true, 0.0, true),
        (true, w, false),
        (false, 0.0, true),
        (false, h, false),
    ] {
        let inside = |p: Point| {
            let d = if vertical { p.0 } else { p.1 } - bound;
            if past { d } else { -d }
        };
        let mut out = Vec::with_capacity(poly.len() + 2);
        for (i, &a) in poly.iter().enumerate() {
            let b = poly[(i + 1) % poly.len()];
            let (da, db) = (inside(a), inside(b));
            if da >= 0.0 {
                out.push(a);
            }
            if (da >= 0.0) != (db >= 0.0) {
                let s = da / (da - db);
                out.push(if vertical {
                    (bound, a.1 + (b.1 - a.1) * s)
                } else {
                    (a.0 + (b.0 - a.0) * s, bound)
                });
            }
        }
        poly = out;
        if poly.is_empty() {
            break;
        }
    }
    poly
}

/// `a` and `b` as one rectangle when one continues the other along a line.
fn join(a: &Shape, b: &Shape) -> Option<Shape> {
    let (
        &Shape::Rect { x, y, w, h, alpha },
        &Shape::Rect {
            x: bx,
            y: by,
            w: bw,
            h: bh,
            alpha: ba,
        },
    ) = (a, b)
    else {
        return None;
    };
    if alpha != ba {
        return None;
    }
    if y == by && h == bh && x <= bx + bw && bx <= x + w {
        let x0 = x.min(bx);
        let w = (x + w).max(bx + bw) - x0;
        return Some(Shape::Rect {
            x: x0,
            y,
            w,
            h,
            alpha,
        });
    }
    if x == bx && w == bw && y <= by + bh && by <= y + h {
        let y0 = y.min(by);
        let h = (y + h).max(by + bh) - y0;
        return Some(Shape::Rect {
            x,
            y: y0,
            w,
            h,
            alpha,
        });
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A cell snapped to the pixel grid: 8 × 18 points at 2x, lines 2 px.
    const W: f64 = 8.0;
    const HT: f64 = 18.0;
    const S: f64 = 2.0;

    fn draw(c: char) -> Vec<Shape> {
        sprite(c, W, HT, light(W, S), S).expect("a sprite")
    }

    fn rects(shapes: &[Shape]) -> Vec<(f64, f64, f64, f64)> {
        shapes
            .iter()
            .filter_map(|s| match *s {
                Shape::Rect { x, y, w, h, .. } => Some((x, y, w, h)),
                _ => None,
            })
            .collect()
    }

    fn covered(shapes: &[Shape], px: f64, py: f64) -> bool {
        rects(shapes)
            .iter()
            .any(|&(x, y, w, h)| px > x && px < x + w && py > y && py < y + h)
    }

    fn on_pixels(v: f64) -> bool {
        (v * S - (v * S).round()).abs() < 1e-9
    }

    #[test]
    fn thickness_is_whole_device_pixels() {
        assert_eq!(light(7.8, 1.0), 1.0);
        assert_eq!(light(7.8, 2.0), 1.0);
        assert_eq!(light(16.0, 2.0), 2.0);
        assert_eq!(light(12.0, 1.0), 2.0);
        assert_eq!(light(3.0, 1.0), 1.0);
        assert_eq!(light(3.0, 2.0), 0.5);
    }

    #[test]
    fn a_light_horizontal_spans_the_cell_on_the_snapped_center() {
        let r = rects(&draw('─'));
        // 36 px tall, 2 px thick: rows 17–18 of the cell's pixels.
        assert_eq!(r, vec![(0.0, 8.5, W, 1.0)]);
        // One device pixel at 1x sits on a half-point center.
        let r = rects(&sprite('─', W, HT, light(W, 1.0), 1.0).unwrap());
        assert_eq!(r, vec![(0.0, 8.0, W, 1.0)]);
    }

    #[test]
    fn a_light_vertical_spans_the_row() {
        assert_eq!(rects(&draw('│')), vec![(3.5, 0.0, 1.0, HT)]);
    }

    #[test]
    fn heavy_is_twice_light() {
        assert_eq!(rects(&draw('━')), vec![(0.0, 8.0, W, 2.0)]);
    }

    #[test]
    fn a_cross_reaches_all_four_edges() {
        let s = draw('┼');
        let (cx, cy) = (4.0, 9.0);
        for (x, y) in [
            (cx, 0.01),
            (cx, HT - 0.01),
            (0.01, cy),
            (W - 0.01, cy),
            (cx, cy),
        ] {
            assert!(covered(&s, x, y), "{x},{y}");
        }
    }

    #[test]
    fn a_double_cross_leaves_its_gaps_open() {
        let s = draw('╬');
        // The center and the gaps of both double lines stay clear.
        for (x, y) in [(4.0, 9.0), (4.0, 1.0), (4.0, 17.0), (1.0, 9.0), (7.0, 9.0)] {
            assert!(!covered(&s, x, y), "{x},{y}");
        }
        // The outer strokes still reach every edge.
        for (x, y) in [(3.0, 0.01), (5.0, 0.01), (0.01, 8.0), (W - 0.01, 10.0)] {
            assert!(covered(&s, x, y), "{x},{y}");
        }
    }

    #[test]
    fn junctions_meet_square() {
        // ┍: the light down arm starts at the heavy right arm's top edge.
        let r = rects(&draw('┍'));
        assert!(r.contains(&(3.5, 8.0, 1.0, 10.0)), "{r:?}");
        assert!(r.contains(&(3.5, 8.0, 4.5, 2.0)), "{r:?}");
        // ╔: outer and inner corners both close.
        let s = draw('╔');
        assert!(covered(&s, 2.75, 7.75) && covered(&s, 4.75, 9.75));
        assert!(!covered(&s, 3.75, 8.75));
    }

    #[test]
    fn mixed_junctions_keep_the_through_line() {
        // ╪: the light vertical crosses both strokes of the double
        // horizontal, whose gap stays open beside it.
        let s = draw('╪');
        assert!(covered(&s, 4.0, 9.0) && covered(&s, 1.0, 8.0) && covered(&s, 1.0, 10.0));
        assert!(!covered(&s, 1.0, 9.0));
        // ╀: the light horizontal runs through; the heavy up arm stops on it.
        let s = draw('╀');
        assert!(covered(&s, 0.01, 9.0) && covered(&s, W - 0.01, 9.0));
        assert!(covered(&s, 3.25, 8.25) && !covered(&s, 3.25, 9.75));
    }

    #[test]
    fn every_line_lies_on_pixels_and_inside_the_cell() {
        for cp in 0x2500..=0x259F {
            let c = char::from_u32(cp).unwrap();
            for (x, y, w, h) in rects(&draw(c)) {
                assert!(x >= 0.0 && y >= 0.0 && x + w <= W && y + h <= HT, "{c}");
                assert!(
                    on_pixels(x) && on_pixels(y) && on_pixels(w) && on_pixels(h),
                    "{c}"
                );
            }
        }
    }

    #[test]
    fn a_rounded_corner_follows_the_lines_centers() {
        let shapes = draw('╭');
        let [Shape::Stroke { path, width }] = shapes.as_slice() else {
            panic!("{shapes:?}");
        };
        assert_eq!(*width, 1.0);
        assert_eq!(path.first(), Some(&Seg::Move(4.0, HT)));
        assert_eq!(path.last(), Some(&Seg::Line(W, 9.0)));
    }

    #[test]
    fn dashes_keep_their_count() {
        assert_eq!(rects(&draw('┄')).len(), 3);
        assert_eq!(rects(&draw('┋')).len(), 4);
        assert_eq!(rects(&draw('╎')).len(), 2);
    }

    #[test]
    fn diagonals_stay_inside_the_cell() {
        for c in ['╱', '╲', '╳', '\u{E0B9}', '\u{E0BB}'] {
            for shape in draw(c) {
                let Shape::Fill(path) = shape else {
                    panic!("{c}")
                };
                for seg in path {
                    if let Seg::Move(x, y) | Seg::Line(x, y) = seg {
                        assert!((0.0..=W).contains(&x) && (0.0..=HT).contains(&y), "{c}");
                    }
                }
            }
        }
    }

    #[test]
    fn a_full_block_is_the_cell() {
        assert_eq!(rects(&draw('█')), vec![(0.0, 0.0, W, HT)]);
        // The far edges stay exact on a cell that is not whole pixels.
        let r = rects(&sprite('█', 7.8, HT, 1.0, S).unwrap());
        assert_eq!(r, vec![(0.0, 0.0, 7.8, HT)]);
    }

    #[test]
    fn halves_partition_the_cell() {
        let height = 17.5;
        let top = rects(&sprite('▀', W, height, 1.0, S).unwrap())[0];
        let bottom = rects(&sprite('▄', W, height, 1.0, S).unwrap())[0];
        assert_eq!(top.1, 0.0);
        assert_eq!(top.1 + top.3, bottom.1);
        assert_eq!(bottom.1 + bottom.3, height);
        assert!(on_pixels(bottom.1));
        // Every eighth snaps to the same edges its complement does.
        for n in 1..8 {
            let lower = rects(&draw(char::from_u32(0x2580 + n).unwrap()))[0];
            let left = rects(&draw(char::from_u32(0x2590 - n).unwrap()))[0];
            assert!(on_pixels(lower.1) && on_pixels(left.2), "{n}");
        }
    }

    #[test]
    fn shades_are_translucent_full_cells() {
        for (c, alpha) in [('░', 0.25), ('▒', 0.5), ('▓', 0.75)] {
            assert_eq!(
                draw(c),
                vec![Shape::Rect {
                    x: 0.0,
                    y: 0.0,
                    w: W,
                    h: HT,
                    alpha
                }]
            );
        }
    }

    #[test]
    fn quadrants_cover_their_quarters() {
        let s = draw('▚');
        assert!(covered(&s, 1.0, 1.0) && covered(&s, 7.0, 17.0));
        assert!(!covered(&s, 7.0, 1.0) && !covered(&s, 1.0, 17.0));
    }

    #[test]
    fn braille_draws_its_dots() {
        assert!(draw('\u{2800}').is_empty());
        assert_eq!(rects(&draw('\u{28FF}')).len(), 8);
        let one = rects(&draw('\u{2801}'));
        assert_eq!(one.len(), 1);
        let (x, y, w, h) = one[0];
        assert!(x + w <= W / 2.0 && y + h <= HT / 4.0, "{one:?}");
        // Dot 8 is the bottom right.
        let (x, y, ..) = rects(&draw('\u{2880}'))[0];
        assert!(x >= W / 2.0 && y >= HT * 3.0 / 4.0);
    }

    #[test]
    fn powerline_triangles_span_the_cell() {
        let path = |c: char| match draw(c).as_slice() {
            [Shape::Fill(path)] => path.clone(),
            other => panic!("{other:?}"),
        };
        let points = |path: Vec<Seg>| -> Vec<(f64, f64)> {
            path.into_iter()
                .filter_map(|s| match s {
                    Seg::Move(x, y) | Seg::Line(x, y) => Some((x, y)),
                    _ => None,
                })
                .collect()
        };
        let mut right = points(path('\u{E0B0}'));
        right.sort_by(|a, b| a.partial_cmp(b).unwrap());
        assert_eq!(right, vec![(0.0, 0.0), (0.0, HT), (W, HT / 2.0)]);
        let mut left = points(path('\u{E0B2}'));
        left.sort_by(|a, b| a.partial_cmp(b).unwrap());
        assert_eq!(left, vec![(0.0, HT / 2.0), (W, 0.0), (W, HT)]);
    }

    #[test]
    fn a_sextant_fills_its_sixth() {
        assert_eq!(rects(&draw('\u{1FB00}')), vec![(0.0, 0.0, 4.0, 6.0)]);
        // The last one is every sixth but the upper left.
        assert_eq!(rects(&draw('\u{1FB3B}')).len(), 5);
        // 1FB13 is sixths 3 and 5, before the skipped left half block.
        assert_eq!(
            rects(&draw('\u{1FB13}')),
            vec![(0.0, 6.0, 4.0, 6.0), (0.0, 12.0, 4.0, 6.0)]
        );
    }

    #[test]
    fn other_characters_are_text() {
        for c in ['a', ' ', '中', '\u{25A0}', '\u{E0C0}', '\u{1FB3C}'] {
            assert_eq!(sprite(c, W, HT, 1.0, S), None, "{c}");
        }
    }

    #[test]
    fn snapping_keeps_shared_edges() {
        let px = Pixels {
            sx: 2.0,
            tx: 1.0,
            sy: -2.0,
            ty: 400.0,
        };
        let a = px.snap(Rect {
            x: 7.8,
            y: 18.0,
            width: 7.8,
            height: 18.0,
        });
        let b = px.snap(Rect {
            x: 15.6,
            y: 18.0,
            width: 7.8,
            height: 18.0,
        });
        assert_eq!(a.x + a.width, b.x);
        assert_eq!(
            ((a.x * 2.0 + 1.0).fract(), (a.width * 2.0).fract()),
            (0.0, 0.0)
        );
        assert_eq!((a.y, a.height), (18.0, 18.0));
    }
}
