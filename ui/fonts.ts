/**
 * Lilex, the sheet content's face (§2.3-16, DESIGN §3.4): the crate ships
 * both weights (`src/lib.rs`, `assets/fonts/`), and the engine registers
 * them before the first render under the family their name tables carry —
 * the shell's own chrome (sidebar, titlebar, tabs) keeps the system face;
 * only sheet content names this family. The Rust side's `lilex_ships_under_one_family`
 * guards the literal against the files.
 */
export const SHEET_FONT = "Lilex";
