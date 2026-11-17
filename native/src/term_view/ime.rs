//! What a key press becomes once the input method has seen it, and where
//! its candidate window opens: the decisions of the view's
//! `NSTextInputClient`, apart from AppKit.

use super::grid::text_width;

/// What reaches the program after a key went through the input method.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Outcome {
    /// Text the input method committed, as it is: the key itself was the
    /// input method's (it picked a candidate, ended or cancelled a
    /// composition) and is not encoded.
    Commit(Vec<String>),
    /// The key, with each text it typed (a letter, `å` on Option): the
    /// program gets libghostty's encoding of it.
    Typed(Vec<String>),
    /// The key typed nothing (Return, an arrow, Backspace): its own sequence.
    Key,
}

/// The outcome of a key press: the composition before it (`was`), after it
/// (`is`), and what `insertText:` handed over meanwhile.
///
/// A key of a composition is the input method's even when the composition
/// ends with it: Backspace deleting its last letter, Escape cancelling it
/// must not also reach the shell.
pub(crate) fn outcome(was: bool, is: bool, typed: Vec<String>) -> Outcome {
    match (was || is, typed.is_empty()) {
        (true, _) => Commit(typed),
        (false, true) => Key,
        (false, false) => Typed(typed),
    }
}

use Outcome::{Commit, Key, Typed};

/// The cell the candidate window opens at for the composed text from
/// `utf16` (an `NSRange` location, in UTF-16 units): the composition starts
/// at the terminal's `cursor` and takes the cells its text takes.
pub(crate) fn anchor(cursor: (u16, u16), marked: &str, utf16: usize) -> (u16, u16) {
    let mut units = 0;
    let before: String = marked
        .chars()
        .take_while(|c| {
            units += c.len_utf16();
            units <= utf16
        })
        .collect();
    (cursor.0.saturating_add(text_width(&before)), cursor.1)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|t| t.to_string()).collect()
    }

    #[test]
    fn plain_typing_is_encoded() {
        assert_eq!(outcome(false, false, s(&["a"])), Typed(s(&["a"])));
        assert_eq!(outcome(false, false, vec![]), Key);
    }

    #[test]
    fn a_composition_owns_its_keys() {
        // `n` starts pinyin: nothing for the shell yet.
        assert_eq!(outcome(false, true, vec![]), Commit(vec![]));
        // Backspace on the last letter, Escape: the composition ends, the
        // key is not the shell's.
        assert_eq!(outcome(true, false, vec![]), Commit(vec![]));
        // Space or a digit picks a candidate.
        assert_eq!(outcome(true, false, s(&["你好"])), Commit(s(&["你好"])));
        // Rime commits the raw letters on Return.
        assert_eq!(outcome(true, false, s(&["nihao"])), Commit(s(&["nihao"])));
    }

    #[test]
    fn every_composition_starts_at_the_cursor() {
        // The second, third... composition: nothing remembered from the
        // last one moves the anchor off the cursor.
        assert_eq!(anchor((7, 3), "ni", 0), (7, 3));
        assert_eq!(anchor((12, 3), "hao", 0), (12, 3));
    }

    #[test]
    fn a_range_inside_the_composition_moves_by_cells() {
        // Locations count UTF-16 units; a CJK character is two cells.
        assert_eq!(anchor((4, 0), "你好", 1), (6, 0));
        assert_eq!(anchor((4, 0), "你好", 2), (8, 0));
        // An emoji is two UTF-16 units and two cells.
        assert_eq!(anchor((0, 0), "🙂a", 2), (2, 0));
        assert_eq!(anchor((0, 0), "🙂a", 1), (0, 0));
        // Past the end clamps to the composition's end.
        assert_eq!(anchor((0, 0), "ab", 9), (2, 0));
    }
}
