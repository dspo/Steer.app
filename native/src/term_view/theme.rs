//! The 16 ANSI colors for the appearance the sheet shows: programs pick
//! them by number and expect them readable on the background, so a light
//! background gets dark "white" and "yellow", a dark one bright ones. The
//! cube and grays of the 256-color palette are the standard ones.

use zu_ghostty::{Rgb, default_palette};

use super::render::Rgba;

const LIGHT: [u32; 16] = [
    0x24292f, 0xcf222e, 0x116329, 0x4d2d00, 0x0969da, 0x8250df, 0x1b7c83, 0x6e7781, 0x57606a,
    0xa40e26, 0x1a7f37, 0x633c01, 0x218bff, 0xa475f9, 0x3192aa, 0x8c959f,
];

const DARK: [u32; 16] = [
    0x484f58, 0xff7b72, 0x3fb950, 0xd29922, 0x58a6ff, 0xbc8cff, 0x39c5cf, 0xb1bac4, 0x6e7681,
    0xffa198, 0x56d364, 0xe3b341, 0x79c0ff, 0xd2a8ff, 0x56d4dd, 0xffffff,
];

/// Whether `background` reads as dark (its relative luminance under half).
pub(crate) fn is_dark(background: Rgba) -> bool {
    let linear = |c: f64| {
        if c <= 0.04045 {
            c / 12.92
        } else {
            ((c + 0.055) / 1.055).powf(2.4)
        }
    };
    let l = 0.2126 * linear(background.r)
        + 0.7152 * linear(background.g)
        + 0.0722 * linear(background.b);
    l < 0.5
}

/// The 256-color palette over `background`.
pub(crate) fn palette(background: Rgba) -> [Rgb; 256] {
    let mut out = default_palette();
    let ansi = if is_dark(background) { &DARK } else { &LIGHT };
    for (slot, hex) in out.iter_mut().zip(ansi) {
        *slot = Rgb::new((hex >> 16) as u8, (hex >> 8) as u8, *hex as u8);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_appearance_follows_the_background() {
        assert!(!is_dark(Rgba::opaque(0xff, 0xff, 0xff)));
        assert!(is_dark(Rgba::opaque(0x1c, 0x1c, 0x1e)));
    }

    #[test]
    fn ansi_colors_change_and_the_cube_stays() {
        let light = palette(Rgba::opaque(0xff, 0xff, 0xff));
        let dark = palette(Rgba::opaque(0, 0, 0));
        // "White" is gray on white, bright on black.
        assert_eq!(light[7], Rgb::new(0x6e, 0x77, 0x81));
        assert_eq!(dark[15], Rgb::new(0xff, 0xff, 0xff));
        assert_eq!(light[16..], default_palette()[16..]);
        assert_eq!(light[196], dark[196]);
    }
}
