import { TitleBridge } from "../../domains/manox";
import { createTitleStore } from "../../core/title-store";

/**
 * The manox thread's title wiring (issue #73): the kernel's bash output tap
 * feeds a thread-scoped bridge (`TitleBridge`), and the shared title store
 * is the dock tab's voice. See docs/title-capture.md for the decisions.
 *
 * The key is the **thread id**: one AHP thread is one program, and every
 * chat sheet of the thread shows its title in the tab.
 */

/// The open handles, by thread id. The Rust value is just the key (the
/// bridge lives in the native registry), so replacing one is harmless.
const handles = new Map<string, ReturnType<typeof TitleBridge.open>>();

const store = createTitleStore({
  open: (threadId, onTitle) => {
    const handle = TitleBridge.open(threadId, onTitle);
    handles.set(threadId, handle);
  },
  close: (threadId) => {
    handles.get(threadId)?.close();
    handles.delete(threadId);
  },
});

/** The program title for a thread, or an empty string before one lands. */
export const programTitle = store.programTitle;

/**
 * Opens (or reattaches) the thread's bridge. Idempotent and safe to call
 * any time — a thread restored later reattaches on its chat's mount.
 */
export const openTitleBridge = store.openChannel;

/** Drops the thread's bridge and its title: only a thread's deletion. */
export const closeTitleBridge = store.closeChannel;

/**
 * The thread's title tty (C1's explicit redirect target); null before the
 * bridge is opened. The manox module passes it to `createSession` as
 * `toolEnv.ZU_TTY` so tools can `printf … > "$ZU_TTY"` (issue #73 C1).
 */
export function titleTtyPath(threadId: string): string | null {
  try {
    return TitleBridge.ttyPath(threadId);
  } catch {
    return null;
  }
}

/** D4's prune: drops bridges and titles for threads that left the catalog. */
export const pruneTitles = store.pruneTitles;


/** The store write (issue #73): trimmed; whitespace-only clears (D3). */
export const setProgramTitle = store.setProgramTitle;

/** Applies the pending coalesced writes now (tests' determinism seam). */
export const flushPendingTitle = store.flushPendingTitle;
