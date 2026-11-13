import type { DockAreaLayout } from "../../core/dock";
import { defaultLayoutForSheets, panelIds } from "../../core/dock";

/**
 * The pi module's sheet-id vocabulary: a pi session is one sheet
 * (`session:{sessionId}`). These helpers used to live in the shell's dock;
 * they belong to the module that owns the kind.
 */

/** A session's sheet id in every container. */
export function sessionSheetId(sessionId: string): string {
  return `session:${sessionId}`;
}

/** The pi session a sheet id names, or null for another kind. */
export function sessionIdOfSheet(id: string): string | null {
  return id.startsWith("session:") ? id.slice("session:".length) : null;
}

/** The pi sessions referenced by a layout. */
export function layoutSessions(layout: DockAreaLayout): string[] {
  const ids = panelIds(layout)
    .map(sessionIdOfSheet)
    .filter((id): id is string => !!id);
  return [...new Set(ids)];
}

/** A canvas for `sessionIds`: one tab group, the first session displayed. */
export function defaultLayoutForSessions(sessionIds: string[]): DockAreaLayout {
  return defaultLayoutForSheets(sessionIds.map(sessionSheetId));
}
