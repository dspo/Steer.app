import type { ContainerRecord } from "./contracts/protocol";
import { sessionIdOfSheet } from "./dock";
import { sheetOrder } from "./containers";
import { sessionHasName, sessionTitle } from "./sessions";
import { sheetTitle } from "./sheets";
import { baseName } from "./fs";
import { externalKindLabel, terminalSheetId, terminalTitle } from "./terminals";

/**
 * A container's title (S2): the **earliest-created surviving sheet's** title.
 * Closing the first tab promotes the second instead of leaving a name with
 * nothing behind it, and a sheet that renames itself renames the container.
 *
 * Each kind names itself through `sheetTitle`: a session its name (which
 * `appendSessionInfo` can change), a terminal its OSC title, a browser page
 * its page title; every other kind is fixed. The Hero is exempt — every
 * container's start page would read the same — so a container holding only
 * its Hero, or one this run never showed, falls back to what it *is*: its
 * captain's session name, a terminal's title, or its kind and folder.
 *
 * This lives outside `containers.ts` because it needs the sheet registry,
 * which imports the container store; the store stays below it in the graph.
 */
export function containerTitle(container: ContainerRecord): string {
  for (const id of sheetOrder()[container.id] ?? []) {
    if (id.startsWith("home:")) continue;
    const named = namedSheetTitle(id);
    if (named) return named;
  }
  return fallbackTitle(container);
}

/** The sheet's title, or null while it has nothing to say yet. */
function namedSheetTitle(id: string): string | null {
  const sessionId = sessionIdOfSheet(id);
  if (sessionId) {
    // A fresh session has no name: its id prefix would leave two containers
    // reading the same, so it waits for one (the next sheet speaks instead).
    if (!sessionHasName(sessionId)) return null;
    return sessionTitle(sessionId);
  }
  const title = sheetTitle(id);
  return title.trim() ? title : null;
}

/** What a container is called when no sheet of its own names it. */
function fallbackTitle(container: ContainerRecord): string {
  const folder = baseName(container.cwd);
  // A container is a place to work, so its own name wins over its captain's:
  // a fresh session has no name, and two unnamed containers would read as the
  // same id prefix — pressing the other one looked like nothing happened.
  const captain = container.sessions[0];
  if (captain && sessionHasName(captain.sessionId)) return sessionTitle(captain.sessionId);
  if (container.kind !== "Pi") {
    // An external container is born with terminal resource 1 (its default
    // layout), so its OSC title is the best name on record.
    const title = terminalTitle(terminalSheetId(container.id, 1));
    if (title) return title;
    return externalKindLabel(container.kind);
  }
  return folder || container.id.slice(0, 8);
}
