//! What changes with time alone: the cursor's blink, the visual bell's
//! flash and the scrollbar's fade. The view asks it what to draw now and
//! when to draw again; nothing redraws while nothing moves.

use std::time::{Duration, Instant};

/// Half a blink: how long the cursor stays shown, then hidden.
const BLINK: Duration = Duration::from_millis(530);
/// How long the visual bell takes to fade.
const FLASH: Duration = Duration::from_millis(180);
/// How long the scrollbar stays after the viewport moved.
const BAR: Duration = Duration::from_millis(900);
/// The last part of [`BAR`], over which it fades.
const BAR_FADE: Duration = Duration::from_millis(300);
/// A fade's frame interval.
const FRAME: Duration = Duration::from_millis(16);

#[derive(Debug, Clone, Copy)]
pub(crate) struct Clock {
    blink_from: Instant,
    flash_until: Option<Instant>,
    bar_until: Option<Instant>,
    /// The pointer is over the bar or drags it: it stays, at full strength.
    bar_held: bool,
}

impl Clock {
    pub(crate) fn new(now: Instant) -> Self {
        Self {
            blink_from: now,
            flash_until: None,
            bar_until: None,
            bar_held: false,
        }
    }

    /// The cursor starts a shown phase: typing never meets a hidden cursor.
    pub(crate) fn restart_blink(&mut self, now: Instant) {
        self.blink_from = now;
    }

    pub(crate) fn ring(&mut self, now: Instant) {
        self.flash_until = Some(now + FLASH);
    }

    pub(crate) fn show_bar(&mut self, now: Instant) {
        self.bar_until = Some(now + BAR);
    }

    pub(crate) fn hold_bar(&mut self, held: bool, now: Instant) {
        if self.bar_held && !held {
            self.show_bar(now);
        }
        self.bar_held = held;
    }

    pub(crate) fn bar_held(&self) -> bool {
        self.bar_held
    }

    pub(crate) fn cursor_on(&self, now: Instant) -> bool {
        let phase = now.saturating_duration_since(self.blink_from).as_millis() / BLINK.as_millis();
        phase.is_multiple_of(2)
    }

    /// The bell's strength now, from 1 when it rang to 0.
    pub(crate) fn flash(&self, now: Instant) -> f64 {
        match self.flash_until {
            Some(until) if until > now => {
                until.duration_since(now).as_secs_f64() / FLASH.as_secs_f64()
            }
            _ => 0.0,
        }
    }

    /// The scrollbar's opacity now.
    pub(crate) fn bar(&self, now: Instant) -> f64 {
        if self.bar_held {
            return 1.0;
        }
        match self.bar_until {
            Some(until) if until > now => {
                let left = until.duration_since(now);
                (left.as_secs_f64() / BAR_FADE.as_secs_f64()).min(1.0)
            }
            _ => 0.0,
        }
    }

    /// When the picture changes next with no other cause: a blink's turn
    /// (while `blinking`), a fade's next frame. `None` while nothing moves.
    pub(crate) fn next(&self, now: Instant, blinking: bool) -> Option<Instant> {
        let mut next: Option<Instant> = None;
        let mut at = |t: Instant| next = Some(next.map_or(t, |n| n.min(t)));
        if blinking {
            let since = now.saturating_duration_since(self.blink_from).as_millis();
            let turn = (since / BLINK.as_millis() + 1) * BLINK.as_millis();
            at(self.blink_from + Duration::from_millis(turn as u64));
        }
        if self.flash(now) > 0.0 {
            at(now + FRAME);
        }
        if !self.bar_held
            && let Some(until) = self.bar_until.filter(|u| *u > now)
        {
            let fading = until
                .checked_sub(BAR_FADE)
                .is_some_and(|start| start <= now);
            at(if fading {
                now + FRAME
            } else {
                until - BAR_FADE
            });
        }
        next
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ms(n: u64) -> Duration {
        Duration::from_millis(n)
    }

    #[test]
    fn the_cursor_blinks_in_half_periods_from_its_restart() {
        let t0 = Instant::now();
        let mut c = Clock::new(t0);
        assert!(c.cursor_on(t0));
        assert!(!c.cursor_on(t0 + ms(600)));
        assert!(c.cursor_on(t0 + ms(1100)));
        c.restart_blink(t0 + ms(600));
        assert!(c.cursor_on(t0 + ms(600)));
        assert_eq!(c.next(t0 + ms(600), true), Some(t0 + ms(1130)));
    }

    #[test]
    fn nothing_moves_when_nothing_animates() {
        let t0 = Instant::now();
        let c = Clock::new(t0);
        assert_eq!(c.next(t0, false), None);
        assert_eq!(c.flash(t0), 0.0);
        assert_eq!(c.bar(t0), 0.0);
    }

    #[test]
    fn the_bell_fades_frame_by_frame() {
        let t0 = Instant::now();
        let mut c = Clock::new(t0);
        c.ring(t0);
        assert_eq!(c.flash(t0), 1.0);
        assert!(c.flash(t0 + ms(90)) > 0.4 && c.flash(t0 + ms(90)) < 0.6);
        assert_eq!(c.next(t0 + ms(90), false), Some(t0 + ms(106)));
        assert_eq!(c.flash(t0 + ms(200)), 0.0);
    }

    #[test]
    fn the_scrollbar_waits_then_fades_unless_held() {
        let t0 = Instant::now();
        let mut c = Clock::new(t0);
        c.show_bar(t0);
        assert_eq!(c.bar(t0), 1.0);
        // Steady until its fade starts: one wake-up then, not a frame each.
        assert_eq!(c.next(t0, false), Some(t0 + ms(600)));
        assert!(c.bar(t0 + ms(750)) < 1.0);
        assert_eq!(c.bar(t0 + ms(950)), 0.0);
        c.hold_bar(true, t0 + ms(950));
        assert_eq!(c.bar(t0 + ms(5000)), 1.0);
        assert_eq!(c.next(t0 + ms(5000), false), None);
        c.hold_bar(false, t0 + ms(5000));
        assert_eq!(c.bar(t0 + ms(5000)), 1.0);
    }
}
