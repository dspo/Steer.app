import { TitleCapture } from "../../domains/acp";
import { createTitleStore } from "../../core/title-store";

/**
 * The pi session's title wiring (issue #73): the harness's Bash tap feeds
 * a session-scoped channel (`TitleCapture`), and the shared title store is
 * the dock tab's voice. See docs/title-capture.md for the decisions.
 */

/// The open handles, by session id. The Rust value is just the key (the
/// channel lives in the native registry), so replacing one is harmless.
const handles = new Map<string, ReturnType<typeof TitleCapture.open>>();

const store = createTitleStore({
  open: (sessionId, onTitle) => {
    const handle = TitleCapture.open(sessionId, onTitle);
    handles.set(sessionId, handle);
  },
  close: (sessionId) => {
    handles.get(sessionId)?.close();
    handles.delete(sessionId);
  },
});

/** The program title for a session, or an empty string before one lands. */
export const programTitle = store.programTitle;

/** The store write (issue #73): trimmed; whitespace-only clears (D3). */
export const setProgramTitle = store.setProgramTitle;

/** Applies the pending coalesced writes now (tests' determinism seam). */
export const flushPendingTitle = store.flushPendingTitle;

/**
 * Opens (or reattaches) the session's channel. Idempotent and safe to call
 * before the harness spawns — the channel outlives both.
 */
export const openTitleChannel = store.openChannel;

/** Drops the session's channel and its title: only a session's deletion. */
export const closeTitleChannel = store.closeChannel;

/** D4's prune: the scan that loses a session's file is the delete signal. */
export const pruneTitles = store.pruneTitles;
