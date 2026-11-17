//! Mouse and focus reports for programs that ask for them.

use std::ffi::{c_char, c_int, c_void};

use crate::{Terminal, check, sys};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MouseAction {
    Press,
    Release,
    Motion,
}

/// Wheel "buttons" are reported as presses; the horizontal wheel and the
/// back/forward side buttons only reach SGR-style formats intact.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum MouseButton {
    Left,
    Middle,
    Right,
    WheelUp,
    WheelDown,
    WheelLeft,
    WheelRight,
    Back,
    Forward,
}

impl MouseButton {
    fn raw(self) -> c_int {
        match self {
            Self::Left => sys::GHOSTTY_MOUSE_BUTTON_LEFT,
            Self::Middle => sys::GHOSTTY_MOUSE_BUTTON_MIDDLE,
            Self::Right => sys::GHOSTTY_MOUSE_BUTTON_RIGHT,
            Self::WheelUp => sys::GHOSTTY_MOUSE_BUTTON_FOUR,
            Self::WheelDown => sys::GHOSTTY_MOUSE_BUTTON_FIVE,
            Self::WheelLeft => sys::GHOSTTY_MOUSE_BUTTON_SIX,
            Self::WheelRight => sys::GHOSTTY_MOUSE_BUTTON_SEVEN,
            Self::Back => sys::GHOSTTY_MOUSE_BUTTON_EIGHT,
            Self::Forward => sys::GHOSTTY_MOUSE_BUTTON_NINE,
        }
    }

    fn is_wheel(self) -> bool {
        matches!(
            self,
            Self::WheelUp | Self::WheelDown | Self::WheelLeft | Self::WheelRight
        )
    }
}

/// The surface in pixels: positions passed to [`MouseEncoder::encode`] are
/// relative to its top-left, padding included.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct MouseGeometry {
    pub screen_width: u32,
    pub screen_height: u32,
    pub cell_width: u32,
    pub cell_height: u32,
    pub padding_top: u32,
    pub padding_bottom: u32,
    pub padding_left: u32,
    pub padding_right: u32,
}

/// Encodes pointer events the way the program's tracking mode and format
/// ask (X10/normal/button/any-event; X10, UTF-8, SGR, urxvt, SGR-pixels).
/// It reports nothing while tracking is off, and suppresses motion within
/// the same cell.
pub struct MouseEncoder {
    enc: sys::GhosttyMouseEncoder,
    event: sys::GhosttyMouseEvent,
    /// Real buttons currently down; button-event mode only reports motion
    /// while one is.
    held: Vec<MouseButton>,
}

impl MouseEncoder {
    pub fn new() -> Result<Self, c_int> {
        let mut enc: sys::GhosttyMouseEncoder = std::ptr::null_mut();
        // SAFETY: a valid out-pointer; NULL selects the default allocator.
        check(unsafe { sys::ghostty_mouse_encoder_new(std::ptr::null(), &mut enc) })?;
        let mut event: sys::GhosttyMouseEvent = std::ptr::null_mut();
        // SAFETY: as above.
        let rc = unsafe { sys::ghostty_mouse_event_new(std::ptr::null(), &mut event) };
        if let Err(rc) = check(rc) {
            // SAFETY: the encoder is live and never used again.
            unsafe { sys::ghostty_mouse_encoder_free(enc) };
            return Err(rc);
        }
        let this = Self {
            enc,
            event,
            held: Vec::new(),
        };
        let track = true;
        // SAFETY: the option takes a `bool*`.
        unsafe { this.setopt(sys::GHOSTTY_MOUSE_ENCODER_OPT_TRACK_LAST_CELL, &track) };
        Ok(this)
    }

    /// # Safety
    /// `T` must be the value type `option` documents.
    unsafe fn setopt<T>(&self, option: c_int, value: &T) {
        // SAFETY: the encoder is live; the value type is the caller's
        // contract.
        unsafe {
            sys::ghostty_mouse_encoder_setopt(self.enc, option, value as *const T as *const c_void)
        }
    }

    /// Pull the tracking mode and format from the terminal. Call before
    /// encoding: programs switch them at runtime.
    pub fn sync_from_terminal(&mut self, term: &Terminal) {
        // SAFETY: both handles are live.
        unsafe { sys::ghostty_mouse_encoder_setopt_from_terminal(self.enc, term.term) }
    }

    pub fn set_geometry(&mut self, geometry: MouseGeometry) {
        let size = sys::GhosttyMouseEncoderSize {
            size: std::mem::size_of::<sys::GhosttyMouseEncoderSize>(),
            screen_width: geometry.screen_width,
            screen_height: geometry.screen_height,
            cell_width: geometry.cell_width.max(1),
            cell_height: geometry.cell_height.max(1),
            padding_top: geometry.padding_top,
            padding_bottom: geometry.padding_bottom,
            padding_right: geometry.padding_right,
            padding_left: geometry.padding_left,
        };
        // SAFETY: the option takes a `GhosttyMouseEncoderSize*`.
        unsafe { self.setopt(sys::GHOSTTY_MOUSE_ENCODER_OPT_SIZE, &size) };
    }

    /// Forget the held buttons and the last reported cell (focus lost,
    /// tracking switched).
    pub fn reset(&mut self) {
        self.held.clear();
        // SAFETY: the encoder is live.
        unsafe { sys::ghostty_mouse_encoder_reset(self.enc) };
    }

    /// The bytes to send the program for one pointer event; empty when the
    /// mode does not report it. `mods` is a `GHOSTTY_MODS_*` mask. Motion
    /// without a button reports the last button still held, if any.
    pub fn encode(
        &mut self,
        action: MouseAction,
        button: Option<MouseButton>,
        mods: u16,
        x: f32,
        y: f32,
    ) -> Vec<u8> {
        if let Some(b) = button.filter(|b| !b.is_wheel()) {
            match action {
                MouseAction::Press if !self.held.contains(&b) => self.held.push(b),
                MouseAction::Release => self.held.retain(|&h| h != b),
                _ => {}
            }
        }
        let button = match (action, button) {
            (MouseAction::Motion, None) => self.held.last().copied(),
            _ => button,
        };
        let any_pressed = !self.held.is_empty();
        let raw_action = match action {
            MouseAction::Press => sys::GHOSTTY_MOUSE_ACTION_PRESS,
            MouseAction::Release => sys::GHOSTTY_MOUSE_ACTION_RELEASE,
            MouseAction::Motion => sys::GHOSTTY_MOUSE_ACTION_MOTION,
        };
        let mut buf = [0 as c_char; 64];
        let mut written = 0usize;
        // SAFETY: live handles; the option takes a `bool*`; the output
        // buffer holds `buf.len()` bytes.
        let rc = unsafe {
            self.setopt(
                sys::GHOSTTY_MOUSE_ENCODER_OPT_ANY_BUTTON_PRESSED,
                &any_pressed,
            );
            sys::ghostty_mouse_event_set_action(self.event, raw_action);
            match button {
                Some(b) => sys::ghostty_mouse_event_set_button(self.event, b.raw()),
                None => sys::ghostty_mouse_event_clear_button(self.event),
            }
            sys::ghostty_mouse_event_set_mods(self.event, mods);
            sys::ghostty_mouse_event_set_position(self.event, sys::GhosttyMousePosition { x, y });
            sys::ghostty_mouse_encoder_encode(
                self.enc,
                self.event,
                buf.as_mut_ptr(),
                buf.len(),
                &mut written,
            )
        };
        if rc != sys::GHOSTTY_SUCCESS {
            return Vec::new();
        }
        buf[..written].iter().map(|&b| b as u8).collect()
    }
}

impl Drop for MouseEncoder {
    fn drop(&mut self) {
        // SAFETY: the handles are live and never used again.
        unsafe {
            sys::ghostty_mouse_event_free(self.event);
            sys::ghostty_mouse_encoder_free(self.enc);
        }
    }
}

/// The focus report (`CSI I` / `CSI O`) to send when
/// [`Terminal::focus_reporting`] is on.
pub fn focus_encode(gained: bool) -> Vec<u8> {
    let event = if gained {
        sys::GHOSTTY_FOCUS_GAINED
    } else {
        sys::GHOSTTY_FOCUS_LOST
    };
    let mut buf = [0 as c_char; 8];
    let mut written = 0usize;
    // SAFETY: the buffer holds `buf.len()` bytes.
    let rc = unsafe { sys::ghostty_focus_encode(event, buf.as_mut_ptr(), buf.len(), &mut written) };
    if rc != sys::GHOSTTY_SUCCESS {
        return Vec::new();
    }
    buf[..written].iter().map(|&b| b as u8).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sys::GHOSTTY_MODS_SHIFT;

    fn encoder(term: &Terminal) -> MouseEncoder {
        let mut enc = MouseEncoder::new().unwrap();
        enc.set_geometry(MouseGeometry {
            screen_width: 800,
            screen_height: 600,
            cell_width: 10,
            cell_height: 20,
            ..MouseGeometry::default()
        });
        enc.sync_from_terminal(term);
        enc
    }

    use MouseAction::*;
    use MouseButton::*;

    #[test]
    fn nothing_is_reported_without_tracking() {
        let term = Terminal::new(80, 30).unwrap();
        let mut enc = encoder(&term);
        assert!(enc.encode(Press, Some(Left), 0, 55.0, 45.0).is_empty());
        assert!(enc.encode(Motion, None, 0, 75.0, 45.0).is_empty());
        assert!(enc.encode(Press, Some(WheelUp), 0, 55.0, 45.0).is_empty());
    }

    #[test]
    fn sgr_press_release_and_wheel() {
        let term = Terminal::new(80, 30).unwrap();
        term.write(b"\x1b[?1000h\x1b[?1006h");
        let mut enc = encoder(&term);
        assert_eq!(
            enc.encode(Press, Some(Left), 0, 55.0, 45.0),
            b"\x1b[<0;6;3M"
        );
        assert_eq!(
            enc.encode(Release, Some(Left), 0, 55.0, 45.0),
            b"\x1b[<0;6;3m"
        );
        assert_eq!(
            enc.encode(Press, Some(Right), GHOSTTY_MODS_SHIFT, 5.0, 5.0),
            b"\x1b[<6;1;1M"
        );
        assert_eq!(
            enc.encode(Press, Some(WheelUp), 0, 5.0, 5.0),
            b"\x1b[<64;1;1M"
        );
        assert_eq!(
            enc.encode(Press, Some(WheelDown), 0, 5.0, 5.0),
            b"\x1b[<65;1;1M"
        );
        assert_eq!(
            enc.encode(Press, Some(WheelLeft), 0, 5.0, 5.0),
            b"\x1b[<66;1;1M"
        );
        assert_eq!(
            enc.encode(Press, Some(WheelRight), 0, 5.0, 5.0),
            b"\x1b[<67;1;1M"
        );
        assert_eq!(
            enc.encode(Press, Some(Back), 0, 5.0, 5.0),
            b"\x1b[<128;1;1M"
        );
    }

    #[test]
    fn motion_follows_the_tracking_mode() {
        let term = Terminal::new(80, 30).unwrap();
        term.write(b"\x1b[?1000h\x1b[?1006h");
        let mut enc = encoder(&term);
        assert!(
            enc.encode(Motion, None, 0, 75.0, 45.0).is_empty(),
            "1000: no motion"
        );
        enc.encode(Press, Some(Left), 0, 55.0, 45.0);
        assert!(enc.encode(Motion, Some(Left), 0, 75.0, 45.0).is_empty());
        enc.encode(Release, Some(Left), 0, 75.0, 45.0);

        term.write(b"\x1b[?1002h");
        enc.sync_from_terminal(&term);
        assert!(
            enc.encode(Motion, None, 0, 95.0, 45.0).is_empty(),
            "1002: drags only"
        );
        enc.encode(Press, Some(Left), 0, 95.0, 45.0);
        assert_eq!(
            enc.encode(Motion, Some(Left), 0, 115.0, 45.0),
            b"\x1b[<32;12;3M"
        );
        enc.encode(Release, Some(Left), 0, 115.0, 45.0);

        term.write(b"\x1b[?1003h");
        enc.sync_from_terminal(&term);
        assert_eq!(enc.encode(Motion, None, 0, 135.0, 45.0), b"\x1b[<35;14;3M");
        assert!(
            enc.encode(Motion, None, 0, 137.0, 47.0).is_empty(),
            "the same cell is reported once"
        );
        assert_eq!(enc.encode(Motion, None, 0, 135.0, 65.0), b"\x1b[<35;14;4M");
    }

    #[test]
    fn legacy_formats_and_x10() {
        let term = Terminal::new(80, 30).unwrap();
        term.write(b"\x1b[?1000h");
        let mut enc = encoder(&term);
        assert_eq!(enc.encode(Press, Some(Left), 0, 55.0, 45.0), b"\x1b[M &#");
        assert_eq!(enc.encode(Release, Some(Left), 0, 55.0, 45.0), b"\x1b[M#&#");

        term.write(b"\x1b[?1015h");
        enc.sync_from_terminal(&term);
        assert_eq!(
            enc.encode(Press, Some(Left), 0, 55.0, 45.0),
            b"\x1b[32;6;3M"
        );

        term.write(b"\x1b[?1015l\x1b[?1016h");
        enc.sync_from_terminal(&term);
        assert_eq!(
            enc.encode(Press, Some(Left), 0, 55.0, 45.0),
            b"\x1b[<0;55;45M"
        );

        term.write(b"\x1b[?1016l\x1b[?1000l\x1b[?9h");
        enc.sync_from_terminal(&term);
        assert_eq!(
            enc.encode(Press, Some(Left), GHOSTTY_MODS_SHIFT, 55.0, 45.0),
            b"\x1b[M &#"
        );
        assert!(
            enc.encode(Release, Some(Left), 0, 55.0, 45.0).is_empty(),
            "X10: presses only"
        );
    }

    #[test]
    fn focus_reports() {
        assert_eq!(focus_encode(true), b"\x1b[I");
        assert_eq!(focus_encode(false), b"\x1b[O");
    }
}
