//! `zu.terminal`: the terminal sheet's own AppKit view, registered as a
//! native component.
//!
//! The view owns everything a terminal's correctness depends on and nsh's
//! elements cannot promise: every glyph is drawn at its cell's pen on one
//! baseline (`grid`), whichever font CoreText falls back to; the view is the
//! input method's client itself (`NSTextInputClient`), so the composition
//! and the candidate window's anchor are the terminal's cursor, not a hidden
//! field's. libghostty-vt is the emulation; TSX only carries bytes between
//! the view and the PTY (`write` command in, `data` event out).

mod clock;
mod escape;
mod grid;
mod ime;
mod keys;
mod links;
mod render;
mod sprite;
mod theme;
mod view;

/// The name TSX declares the component by (`domains/terminal.ts`).
pub(crate) const NAME: &str = "zu.terminal";

pub(crate) fn register(components: &nsh_platform_macos::Components) {
    use std::rc::Rc;

    use nsh_platform_macos::{ComponentContext, NativeComponent};

    components.register(
        NAME,
        Rc::new(|context: ComponentContext| -> Box<dyn NativeComponent> {
            Box::new(view::Component::new(context))
        }),
    );
}
