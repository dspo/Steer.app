//! Find-in-terminal over the screen and scrollback.

use std::ffi::{c_int, c_void};

#[cfg(doc)]
use crate::Terminal;
use crate::{check, sys};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SearchStatus {
    /// More work is queued; step again (next frame is fine).
    Running,
    /// Caught up with the terminal as of this step. Later output needs
    /// another step to be seen.
    Complete,
}

/// A match as inclusive (col, row) cells. Rows count from the top of the
/// scrollback ([`Search::matches`]) or of the viewport
/// ([`Search::viewport_matches`]).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Match {
    pub start: (u16, usize),
    pub end: (u16, usize),
}

/// The terminal's search: owned by its [`Terminal`] (see
/// [`Terminal::search`]), so it is only ever used, and freed, under the
/// terminal's lock. Matching is byte-exact except ASCII letters, which
/// match either case.
pub struct Search {
    search: sys::GhosttySearch,
    term: sys::GhosttyTerminal,
}

impl Search {
    pub(crate) fn new(term: sys::GhosttyTerminal) -> Result<Self, c_int> {
        let mut search: sys::GhosttySearch = std::ptr::null_mut();
        // SAFETY: a live terminal and a valid out-pointer.
        check(unsafe { sys::ghostty_search_new(std::ptr::null(), &mut search, term) })?;
        Ok(Self { search, term })
    }

    /// Look for `needle`; empty returns to idle. An unchanged needle keeps
    /// the results.
    pub fn set_needle(&mut self, needle: &str) -> Result<(), c_int> {
        let s = sys::GhosttyString {
            ptr: needle.as_ptr(),
            len: needle.len(),
        };
        // SAFETY: the option takes a `GhosttyString*`, copied.
        check(unsafe {
            sys::ghostty_search_set(
                self.search,
                sys::GHOSTTY_SEARCH_OPT_NEEDLE,
                &s as *const _ as *const c_void,
            )
        })
    }

    /// One bounded slice of work: read the terminal's changes, then search
    /// what was read. Call while the find bar is open, each frame or after
    /// output.
    pub fn step(&mut self) -> Result<SearchStatus, c_int> {
        // SAFETY: the search and its terminal are live (both owned by the
        // `Terminal` borrowed to reach `self`).
        check(unsafe { sys::ghostty_search_feed(self.search) })?;
        loop {
            let mut status = sys::GHOSTTY_SEARCH_STATUS_COMPLETE;
            // SAFETY: as above; `status` is a valid out-pointer.
            check(unsafe { sys::ghostty_search_tick(self.search, &mut status) })?;
            match status {
                sys::GHOSTTY_SEARCH_STATUS_RUNNING => continue,
                sys::GHOSTTY_SEARCH_STATUS_FEED_REQUIRED => return Ok(SearchStatus::Running),
                _ => return Ok(SearchStatus::Complete),
            }
        }
    }

    /// Search until caught up with the terminal (blocking).
    pub fn run(&mut self) -> Result<(), c_int> {
        // SAFETY: the search and its terminal are live.
        check(unsafe { sys::ghostty_search_run(self.search) })
    }

    /// # Safety
    /// `T` must be the output type `data` documents.
    unsafe fn get<T>(&self, data: c_int, out: &mut T) -> c_int {
        // SAFETY: the search is live; the output type is the caller's
        // contract.
        unsafe { sys::ghostty_search_get(self.search, data, out as *mut T as *mut c_void) }
    }

    pub fn total(&self) -> usize {
        let mut total = 0usize;
        // SAFETY: the data kind writes a `size_t`.
        unsafe { self.get(sys::GHOSTTY_SEARCH_DATA_TOTAL_MATCHES, &mut total) };
        total
    }

    /// The selected match's index, 0 the newest (bottom-most): a find bar
    /// shows `index + 1` of [`Self::total`].
    pub fn selected_index(&self) -> Option<usize> {
        let mut index = 0usize;
        // SAFETY: the data kind writes a `size_t`.
        let rc = unsafe { self.get(sys::GHOSTTY_SEARCH_DATA_SELECTED_INDEX, &mut index) };
        (rc == sys::GHOSTTY_SUCCESS).then_some(index)
    }

    /// Select the next older match (wrapping) and scroll it into view if it
    /// is off screen. False when nothing matches.
    pub fn select_next(&mut self) -> bool {
        self.select(sys::GHOSTTY_SEARCH_OPT_SELECT_NEXT)
    }

    /// Select the next newer match (wrapping), scrolling as needed.
    pub fn select_prev(&mut self) -> bool {
        self.select(sys::GHOSTTY_SEARCH_OPT_SELECT_PREV)
    }

    fn select(&mut self, option: c_int) -> bool {
        // SAFETY: the select options take NULL.
        let rc = unsafe { sys::ghostty_search_set(self.search, option, std::ptr::null()) };
        rc == sys::GHOSTTY_SUCCESS
    }

    /// The selected match in screen rows. [`Terminal::select_found`] makes
    /// it the active selection.
    pub fn selected(&self) -> Option<Match> {
        self.locate(&self.selected_raw()?, sys::GHOSTTY_POINT_TAG_SCREEN)
    }

    /// A fresh snapshot of the selected match.
    pub(crate) fn selected_raw(&self) -> Option<sys::GhosttySelection> {
        let mut selection = sys::GhosttySelection::default();
        // SAFETY: the data kind writes a `GhosttySelection`.
        let rc = unsafe { self.get(sys::GHOSTTY_SEARCH_DATA_SELECTED_MATCH, &mut selection) };
        (rc == sys::GHOSTTY_SUCCESS).then_some(selection)
    }

    /// Every match on the active screen in screen rows, newest first.
    pub fn matches(&self) -> Vec<Match> {
        self.collect(
            sys::GHOSTTY_SEARCH_DATA_MATCHES,
            sys::GHOSTTY_POINT_TAG_SCREEN,
        )
    }

    /// The matches on screen, in viewport rows, for highlighting.
    pub fn viewport_matches(&self) -> Vec<Match> {
        self.collect(
            sys::GHOSTTY_SEARCH_DATA_VIEWPORT_MATCHES,
            sys::GHOSTTY_POINT_TAG_VIEWPORT,
        )
    }

    fn collect(&self, data: c_int, tag: c_int) -> Vec<Match> {
        let mut buffer = sys::GhosttySelectionBuffer {
            ptr: std::ptr::null_mut(),
            cap: 0,
            len: 0,
        };
        // SAFETY: the data kind fills a `GhosttySelectionBuffer`; an empty
        // one only queries the capacity.
        let rc = unsafe { self.get(data, &mut buffer) };
        if rc != sys::GHOSTTY_OUT_OF_SPACE || buffer.len == 0 {
            return Vec::new();
        }
        let mut storage = vec![sys::GhosttySelection::default(); buffer.len];
        buffer = sys::GhosttySelectionBuffer {
            ptr: storage.as_mut_ptr(),
            cap: storage.len(),
            len: 0,
        };
        // SAFETY: as above; `storage` holds `cap` entries.
        if unsafe { self.get(data, &mut buffer) } != sys::GHOSTTY_SUCCESS {
            return Vec::new();
        }
        storage.truncate(buffer.len);
        storage
            .iter()
            .filter_map(|selection| self.locate(selection, tag))
            .collect()
    }

    /// A match's endpoints in `tag`'s space; `None` when either falls
    /// outside it (a viewport match on an off-screen row of its page).
    fn locate(&self, selection: &sys::GhosttySelection, tag: c_int) -> Option<Match> {
        let point = |r: &sys::GhosttyGridRef| {
            let mut out = sys::GhosttyPointCoordinate::default();
            // SAFETY: a fresh snapshot ref from this terminal.
            let rc =
                unsafe { sys::ghostty_terminal_point_from_grid_ref(self.term, r, tag, &mut out) };
            (rc == sys::GHOSTTY_SUCCESS).then_some((out.x, out.y as usize))
        };
        let (start, end) = (point(&selection.start)?, point(&selection.end)?);
        if tag == sys::GHOSTTY_POINT_TAG_VIEWPORT && end.1 >= self.viewport_rows() {
            return None;
        }
        Some(Match { start, end })
    }

    fn viewport_rows(&self) -> usize {
        let mut rows: u16 = 0;
        // SAFETY: the data kind writes a `uint16_t`.
        unsafe {
            sys::ghostty_terminal_get(
                self.term,
                sys::GHOSTTY_TERMINAL_DATA_ROWS,
                &mut rows as *mut u16 as *mut c_void,
            )
        };
        rows as usize
    }
}

impl Drop for Search {
    fn drop(&mut self) {
        // SAFETY: the search is live and never used again; its terminal is
        // alive and borrowed by whoever drops it.
        unsafe { sys::ghostty_search_free(self.search) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Terminal;

    #[test]
    fn finds_a_needle_in_scrollback_and_scrolls_to_it() {
        let mut term = Terminal::new(30, 4).unwrap();
        term.set_scrollback_lines(1000);
        term.write(b"an ERROR early on\r\n");
        for i in 0..40 {
            term.write(format!("noise {i}\r\n").as_bytes());
        }
        term.write(b"late error here\r\n");
        let bottom = term.scrollbar().offset;

        let search = term.search().unwrap();
        search.set_needle("error").unwrap();
        while search.step().unwrap() == SearchStatus::Running {}
        assert_eq!(search.total(), 2);
        let all = search.matches();
        assert_eq!(
            all,
            [
                Match {
                    start: (5, 41),
                    end: (9, 41)
                },
                Match {
                    start: (3, 0),
                    end: (7, 0)
                },
            ],
            "newest first, case-insensitive"
        );
        assert_eq!(search.selected_index(), None);

        assert!(search.select_next());
        assert_eq!(search.selected_index(), Some(0));
        assert!(search.select_next());
        assert_eq!(search.selected_index(), Some(1));
        assert_eq!(search.selected(), Some(all[1]));
        assert_eq!(
            search.viewport_matches(),
            [Match {
                start: (3, 0),
                end: (7, 0)
            }],
            "scrolled to the top: the old match is on screen"
        );
        assert!(term.select_found());
        assert_ne!(term.scrollbar().offset, bottom);
        assert_eq!(term.selected_text().as_deref(), Some("ERROR"));

        term.write(b"one more error\r\n");
        let search = term.search().unwrap();
        while search.step().unwrap() == SearchStatus::Running {}
        assert_eq!(search.total(), 3, "new output is picked up");

        search.set_needle("").unwrap();
        search.run().unwrap();
        assert_eq!(search.total(), 0);
        assert!(!search.select_next());
        term.end_search();
    }
}
