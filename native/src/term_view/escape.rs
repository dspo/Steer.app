//! Paths dropped on the terminal, written as a shell reads them.

/// `path` with a backslash before every character a POSIX shell would
/// treat specially, as Terminal.app writes a dropped file.
pub(crate) fn shell_escape(path: &str) -> String {
    let mut out = String::with_capacity(path.len());
    for c in path.chars() {
        let plain = c.is_alphanumeric()
            || matches!(c, '/' | '.' | '_' | '-' | '+' | ':' | '@' | '%' | ',' | '=');
        if !plain {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

/// Several dropped paths: escaped, separated by spaces, with a trailing
/// space so the next word starts apart.
pub(crate) fn dropped(paths: &[String]) -> String {
    let mut out = paths
        .iter()
        .map(|p| shell_escape(p))
        .collect::<Vec<_>>()
        .join(" ");
    if !out.is_empty() {
        out.push(' ');
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn specials_are_escaped_and_plain_names_kept() {
        assert_eq!(shell_escape("/tmp/a b/c'd"), r"/tmp/a\ b/c\'d");
        assert_eq!(shell_escape("/Users/me/中文.txt"), "/Users/me/中文.txt");
        assert_eq!(shell_escape("$(rm -rf ~)"), r"\$\(rm\ -rf\ \~\)");
    }

    #[test]
    fn paths_are_joined_with_a_trailing_space() {
        assert_eq!(dropped(&["/a b".to_owned(), "/c".to_owned()]), r"/a\ b /c ");
        assert_eq!(dropped(&[]), "");
    }
}
