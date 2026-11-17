/**
 * Geist / Geist Mono, the sheet content's faces (DESIGN §3.4, issue #20
 * §4.7): the crate ships four sans weights (300/400/500/600) and three mono
 * weights (300/400/500) (`native/src/lib.rs`, `native/assets/fonts/`), and the engine registers
 * them before the first render under the family their name tables carry —
 * the shell's own chrome (sidebar, titlebar, tabs) keeps the system face;
 * only sheet content names these families. Body copy reads Geist 300; the code
 * faces (editor, terminal, Diff, tool I/O, inline code) read Geist Mono. The
 * Rust side's `font_tests` guard the literals against the files.
 */
export const SHEET_FONT = "Geist";
export const SHEET_MONO = "Geist Mono";
