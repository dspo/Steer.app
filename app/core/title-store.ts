import { signal } from "nsh";

/**
 * The program-title store shared by the conversation modules (issue #73):
 * a module's harness feeds a session-scoped channel with raw Bash output,
 * and this store is the dock tab's voice.
 *
 * Decisions D3/D4: keyed by session id, it survives sheets closing and
 * harness restarts, and is cleared only when the session is deleted. The
 * projection reads it through the kind's `tabTitle` — never the container
 * name. D5: writes are trimmed (whitespace-only clears, synchronously) and
 * coalesced per session to the latest within a short window — the final
 * value is never lost.
 */

/** How long retitles batch before landing; decorative, so latency is fine. */
const FLUSH_MS = 120;

export interface TitleStoreHooks {
  /**
   * (Re)attaches the channel's observer; the native open is idempotent and
   * must survive harness restarts. A failed open means titles write
   * nowhere — the session is otherwise unaffected.
   */
  open(sessionId: string, onTitle: (title: string) => void): void;
  /** Drops the channel: only a session's deletion calls this. */
  close(sessionId: string): void;
}

export interface TitleStore {
  /** The program title for a session, or an empty string before one lands. */
  programTitle(sessionId: string): string;
  /** The store write (issue #73). Trimmed; whitespace-only clears (D3). */
  setProgramTitle(sessionId: string, title: string): void;
  /** Applies the pending coalesced writes now (tests' determinism seam). */
  flushPendingTitle(): void;
  /** Opens (or reattaches) the session's channel; idempotent. */
  openChannel(sessionId: string): void;
  /** Drops the channel and the title: only a session's deletion. */
  closeChannel(sessionId: string): void;
  /**
   * D4's prune: drops store entries and channels for ids that are neither
   * in the session list nor have a live view. The caller composes the live
   * set (scan rows + live views); `refreshSessions` is the wiring.
   */
  pruneTitles(liveIds: string[]): void;
}

/** Creates a store; each conversation module keeps its own instance. */
export function createTitleStore(hooks: TitleStoreHooks): TitleStore {
  const titles = signal<Record<string, string>>({});

  /// The latest title per session since the last flush: a window merges
  /// **per session**, so two sessions retitling in the same window both
  /// land (only a session's own intermediate titles collapse).
  const pending = new Map<string, string>();
  let flushScheduled = false;

  function commit(sessionId: string, title: string): void {
    titles.set({ ...titles(), [sessionId]: title });
  }

  const store: TitleStore = {
    programTitle(sessionId) {
      return titles()[sessionId] ?? "";
    },

    setProgramTitle(sessionId, title) {
      const cleaned = title.trim();
      if (!cleaned) {
        // A clear is rare and must be synchronous: the tab falls back to
        // the session name right away.
        commit(sessionId, "");
        return;
      }
      pending.set(sessionId, cleaned);
      if (flushScheduled) return;
      flushScheduled = true;
      setTimeout(() => {
        flushScheduled = false;
        for (const [sessionId, title] of [...pending]) commit(sessionId, title);
        pending.clear();
      }, FLUSH_MS);
    },

    flushPendingTitle() {
      if (pending.size === 0) return;
      const entries = [...pending];
      pending.clear();
      for (const [sessionId, title] of entries) commit(sessionId, title);
    },

    openChannel(sessionId) {
      // The observer lands in the store through the coalesced write.
      try {
        hooks.open(sessionId, (title) => store.setProgramTitle(sessionId, title));
      } catch {
        // No channel: the title tap writes nowhere; the session is
        // otherwise unaffected.
      }
    },

    closeChannel(sessionId) {
      hooks.close(sessionId);
    },

    pruneTitles(liveIds) {
      const live = new Set(liveIds);
      for (const sessionId of Object.keys(titles())) {
        if (!live.has(sessionId)) {
          titles.set(
            Object.fromEntries(Object.entries(titles()).filter(([id]) => id !== sessionId)),
          );
          hooks.close(sessionId);
        }
      }
    },
  };

  return store;
}
