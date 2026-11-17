//! Links in a row of cells: the program's own (OSC 8, found by the
//! emulator) and URLs written as plain text, found here.

/// A URL in a row: its cells, half open, and the address.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Found {
    pub(crate) start: u16,
    pub(crate) end: u16,
    pub(crate) url: String,
}

const SCHEMES: [&str; 5] = ["https://", "http://", "file://", "ftp://", "mailto:"];

/// The URL covering column `col` of a row whose cells are `cells` (each a
/// column and the grapheme it starts; a wide character's tail is absent),
/// if any.
pub(crate) fn url_at(cells: &[(u16, &str)], col: u16) -> Option<Found> {
    urls(cells)
        .into_iter()
        .find(|f| f.start <= col && col < f.end)
}

/// Every URL in a row: a scheme, then characters a URL may hold; closing
/// punctuation that is not part of it (a sentence's period, a bracket that
/// closes around it) is left out.
pub(crate) fn urls(cells: &[(u16, &str)]) -> Vec<Found> {
    let text: String = cells.iter().map(|(_, g)| *g).collect();
    // The column each byte of `text` belongs to, and one past the end.
    let mut columns = Vec::with_capacity(text.len() + 1);
    for (col, g) in cells {
        columns.extend(std::iter::repeat_n(*col, g.len()));
    }
    let end_col = cells
        .last()
        .map_or(0, |(c, g)| c + super::grid::text_width(g).max(1));
    columns.push(end_col);

    let mut out = Vec::new();
    let mut from = 0;
    while from < text.len() {
        let Some((at, scheme)) = SCHEMES
            .iter()
            .filter_map(|s| text[from..].find(s).map(|i| (from + i, *s)))
            .min_by_key(|(i, _)| *i)
        else {
            break;
        };
        let rest = &text[at..];
        let mut len = rest
            .char_indices()
            .find(|(_, c)| !url_char(*c))
            .map_or(rest.len(), |(i, _)| i);
        len = trim_tail(&rest[..len]);
        if len > scheme.len() {
            out.push(Found {
                start: columns[at],
                end: columns[at + len],
                url: rest[..len].to_owned(),
            });
        }
        from = at + len.max(1);
    }
    out
}

fn url_char(c: char) -> bool {
    !c.is_whitespace()
        && !c.is_control()
        && !matches!(c, '<' | '>' | '"' | '`' | '{' | '}' | '|' | '\\' | '^')
        && !matches!(c as u32, 0x2500..=0x259F)
}

/// The length of `url` without punctuation that ends a sentence or closes
/// a bracket opened outside it.
fn trim_tail(url: &str) -> usize {
    let mut end = url.len();
    loop {
        let Some(last) = url[..end].chars().next_back() else {
            return end;
        };
        let unmatched = |open: char, close: char| {
            last == close && url[..end].matches(open).count() < url[..end].matches(close).count()
        };
        if matches!(last, '.' | ',' | ';' | ':' | '!' | '?' | '\'')
            || unmatched('(', ')')
            || unmatched('[', ']')
        {
            end -= last.len_utf8();
        } else {
            return end;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(text: &str) -> Vec<(u16, String)> {
        let mut col = 0;
        let mut out = Vec::new();
        for c in text.chars() {
            out.push((col, c.to_string()));
            col += super::super::grid::text_width(&c.to_string()).max(1);
        }
        out
    }

    fn find(text: &str) -> Vec<(u16, u16, String)> {
        let cells = row(text);
        let cells: Vec<(u16, &str)> = cells.iter().map(|(c, g)| (*c, g.as_str())).collect();
        urls(&cells)
            .into_iter()
            .map(|f| (f.start, f.end, f.url))
            .collect()
    }

    #[test]
    fn a_url_in_text_is_found_with_its_cells() {
        assert_eq!(
            find("see https://example.com/a?b=1 now"),
            vec![(4, 29, "https://example.com/a?b=1".to_owned())]
        );
    }

    #[test]
    fn closing_punctuation_stays_outside() {
        assert_eq!(
            find("(https://x.dev/a)."),
            vec![(1, 16, "https://x.dev/a".to_owned())]
        );
        assert_eq!(
            find("https://en.wikipedia.org/wiki/Rust_(language)"),
            vec![(
                0,
                45,
                "https://en.wikipedia.org/wiki/Rust_(language)".to_owned()
            )]
        );
    }

    #[test]
    fn wide_characters_move_the_columns() {
        // Two CJK characters take four cells before the URL.
        assert_eq!(
            find("中文 http://a.b"),
            vec![(5, 15, "http://a.b".to_owned())]
        );
    }

    #[test]
    fn several_and_none() {
        assert_eq!(find("a http://x.y b file:///tmp/z").len(), 2);
        assert!(find("no links here, just https:// alone").is_empty());
    }

    #[test]
    fn a_column_finds_its_url() {
        let cells = row("go https://x.y now");
        let cells: Vec<(u16, &str)> = cells.iter().map(|(c, g)| (*c, g.as_str())).collect();
        assert_eq!(
            url_at(&cells, 5).map(|f| f.url),
            Some("https://x.y".to_owned())
        );
        assert_eq!(url_at(&cells, 1), None);
        assert_eq!(url_at(&cells, 14), None);
    }
}
