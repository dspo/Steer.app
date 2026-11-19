//! The Ghostty kernel's version fact: one getter for the About surface.
//!
//! The kernel itself ([`zu_ghostty`]) is vendored at one rev — a tip build
//! with no release version — and the build script bakes that rev in before
//! any download or cache logic runs, so the module's whole job is handing
//! the pin to TSX, the way [`crate::instance`] hands out the instance claim.

use nsh_core::prelude::*;

/// The Ghostty kernel's version facts.
#[module]
pub struct Ghostty;

#[module]
impl Ghostty {
    /// The rev the vendored libghostty-vt was built from (a full git sha).
    /// TSX shortens it for display; the About surface reports it.
    pub fn version() -> String {
        zu_ghostty::pinned_rev().to_owned()
    }
}
