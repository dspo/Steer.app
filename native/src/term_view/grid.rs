//! The cell grid's geometry, in the view's points with the origin at the
//! top left: every glyph, background, cursor and the IME's anchor sit on
//! it, so nothing the text engine measures can move them.

/// One font's cell: the advance of its digits, the row height and the
/// baseline inside a row.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Metrics {
    pub(crate) cell_width: f64,
    pub(crate) line_height: f64,
    /// From a row's top to the baseline of every glyph drawn in it,
    /// whichever font (primary or fallback) the glyph comes from.
    pub(crate) baseline: f64,
}

impl Metrics {
    /// The cell of a font with `advance`, `ascent` and `descent` in rows
    /// at least `line_height` tall (the font's own height when taller),
    /// the glyphs centered vertically. `scale` is the backing scale: the
    /// baseline sits on a device pixel so text keeps its crispness.
    pub(crate) fn new(
        advance: f64,
        ascent: f64,
        descent: f64,
        line_height: f64,
        scale: f64,
    ) -> Self {
        let scale = if scale > 0.0 { scale } else { 1.0 };
        let natural = ascent + descent;
        let line_height = line_height.max(natural).max(1.0);
        let baseline = ((line_height - natural) / 2.0 + ascent) * scale;
        Self {
            cell_width: advance.max(1.0),
            line_height,
            baseline: baseline.round() / scale,
        }
    }

    /// How many cells fit in `width` × `height`, each at least one.
    pub(crate) fn grid(&self, width: f64, height: f64) -> (u16, u16) {
        let fit =
            |extent: f64, cell: f64| (extent / cell).floor().clamp(1.0, u16::MAX as f64) as u16;
        (fit(width, self.cell_width), fit(height, self.line_height))
    }

    /// The box of `span` cells from (`col`, `row`).
    pub(crate) fn cell(&self, col: u16, row: u16, span: u16) -> Rect {
        Rect {
            x: col as f64 * self.cell_width,
            y: row as f64 * self.line_height,
            width: span.max(1) as f64 * self.cell_width,
            height: self.line_height,
        }
    }

    /// Where a glyph of cell (`col`, `row`) starts: its pen position.
    pub(crate) fn pen(&self, col: u16, row: u16) -> (f64, f64) {
        (
            col as f64 * self.cell_width,
            row as f64 * self.line_height + self.baseline,
        )
    }
}

/// A rectangle in the view's top-left-origin points.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Rect {
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) width: f64,
    pub(crate) height: f64,
}

/// How many cells `text` takes: a wide character two, a combining mark none.
pub(crate) fn text_width(text: &str) -> u16 {
    use unicode_width::UnicodeWidthChar;
    text.chars().map(|c| c.width().unwrap_or(0) as u16).sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mono() -> Metrics {
        // A mono face at 13pt: 7.8 advance, 12.35 ascent, 3.25 descent.
        Metrics::new(7.8, 12.35, 3.25, 18.0, 2.0)
    }

    #[test]
    fn the_baseline_is_shared_and_pixel_aligned() {
        let m = mono();
        assert_eq!(m.line_height, 18.0);
        // Centered: (18 - 15.6) / 2 + 12.35 = 13.55 → 13.5 at 2x.
        assert_eq!(m.baseline, 13.5);
        assert_eq!(m.pen(0, 2).1, 36.0 + 13.5);
    }

    #[test]
    fn a_font_taller_than_the_row_grows_it() {
        let m = Metrics::new(8.0, 16.0, 6.0, 18.0, 1.0);
        assert_eq!(m.line_height, 22.0);
        assert_eq!(m.baseline, 16.0);
    }

    #[test]
    fn columns_never_drift_from_the_grid() {
        let m = mono();
        // Column 80's pen is exactly 80 advances: no accumulated error from
        // what a glyph of another font measured.
        assert_eq!(m.pen(80, 0).0, 80.0 * 7.8);
        assert_eq!(
            m.cell(10, 1, 2),
            Rect {
                x: 78.0,
                y: 18.0,
                width: 15.6,
                height: 18.0
            }
        );
    }

    #[test]
    fn the_grid_fits_whole_cells() {
        let m = mono();
        assert_eq!(m.grid(800.0, 400.0), (102, 22));
        assert_eq!(m.grid(1.0, 1.0), (1, 1));
    }

    #[test]
    fn wide_text_takes_two_cells() {
        assert_eq!(text_width("ab"), 2);
        assert_eq!(text_width("中文"), 4);
        assert_eq!(text_width("e\u{301}"), 1);
    }
}
