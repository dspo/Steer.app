import { signal } from "nsh";
import { TitleCapture } from "../../domains/acp";

/**
 * The program title a session's tools set (issue #73): the harness's Bash
 * tap feeds a session-scoped channel, and this store is the tab's voice.
 *
 * Decisions D3/D4: keyed by session id, it survives sheets closing and
 * harness restarts, and is cleared only when the session is deleted. The
 * projection reads it through the session kind's `tabTitle` — never the
 * container name.
 */
const programTitles = signal<Record<string, string>>({});

/// The open handles, by session id. The Rust value is just the key (the
/// channel lives in the native registry), so replacing one is harmless.
const handles = new Map<string, ReturnType<typeof TitleCapture.open>>();

/** The store write: trimmed, whitespace-only treated as no title (D3). */
function commit(sessionId: string, title: string): void {
  programTitles.set({ ...programTitles(), [sessionId]: title });
}

/**
 * D5's coalescing: a TUI can retitle per chunk, and each store write is a
 * tab repaint. Titles are decorative — batch to the latest within the
 * flush window; the final value is never lost (a pending title always
 * flushes).
 */
const FLUSH_MS = 120;
/// The latest title per session since the last flush: a window merges
/// **per session**, so two sessions retitling in the same window both
/// land (only a session's own intermediate titles collapse).
const pending = new Map<string, string>();
let flushScheduled = false;

/** The store write (issue #73). Trimmed; whitespace-only clears (D3). */
export function setProgramTitle(sessionId: string, title: string): void {
  const cleaned = title.trim();
  if (!cleaned) {
    // A clear is rare and must be synchronous: the tab falls back to the
    // session name right away.
    commit(sessionId, "");
    return;
  }
  pending.set(sessionId, cleaned);
  if (flushScheduled) return;
  flushScheduled = true;
  setTimeout(() => {
    flushScheduled = false;
    flushPendingTitle();
  }, FLUSH_MS);
}

/** Applies the pending coalesced writes now (the tests' determinism seam). */
export function flushPendingTitle(): void {
  if (pending.size === 0) return;
  const entries = [...pending];
  pending.clear();
  for (const [sessionId, title] of entries) commit(sessionId, title);
}

/** The program title for a session, or an empty string before one lands. */
export function programTitle(sessionId: string): string {
  return programTitles()[sessionId] ?? "";
}

/**
 * Opens (or reattaches) the session's title channel. Idempotent and safe
 * to call before the harness spawns — the channel outlives both. A failed
 * open means tools write nowhere; the session still starts.
 */
export function openTitleChannel(sessionId: string): void {
  try {
    const handle = TitleCapture.open(sessionId, (title: string) => {
      setProgramTitle(sessionId, title);
    });
    handles.set(sessionId, handle);
  } catch {
    // No channel: the title tap writes nowhere (the native side's own
    // graceful path); the session is otherwise unaffected.
  }
}

/**
 * Drops the session's channel and its title: the scan that finds a
 * session's file gone is the delete signal (D4) — see `refreshSessions`'s
 * prune.
 */
export function closeTitleChannel(sessionId: string): void {
  const next = { ...programTitles() };
  delete next[sessionId];
  programTitles.set(next);
  handles.get(sessionId)?.close();
  handles.delete(sessionId);
}

/**
 * D4's prune: drops store entries and channels for ids that are neither in
 * the session list nor have a live view (a deleted session's file leaves
 * the scan; a starting session is protected by its view). Called from
 * `refreshSessions`.
 */
export function pruneTitles(liveIds: string[]): void {
  const live = new Set(liveIds);
  for (const sessionId of Object.keys(programTitles())) {
    if (!live.has(sessionId)) closeTitleChannel(sessionId);
  }
}
