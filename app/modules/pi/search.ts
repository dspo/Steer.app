import type { SearchHit } from "../../../contracts/module";
import { sessions, type SessionMeta } from "./sessions";
import { openPath } from "./container";

/** The last two path segments, as the sidebar shows a folder. */
function shortPath(path: string): string {
  const parts = (path ?? "").split("/").filter(Boolean);
  return parts.slice(-2).join("/");
}

/** Case-insensitive containment over a session's title, cwd and file path. */
export function sessionMatches(session: SessionMeta, query: string): boolean {
  const term = query.trim().toLowerCase();
  if (!term) return false;
  const faces = [session.name, session.preview, session.cwd, session.path];
  return faces.some((face) => (face ?? "").toLowerCase().includes(term));
}

/**
 * The sidebar's search hits for pi's session index: the one place a session
 * that no container holds is reachable. The shell renders the rows; the
 * module decides what matches and what opening means.
 */
export function searchSessions(query: string): SearchHit[] {
  return sessions()
    .filter((session) => sessionMatches(session, query))
    .slice(0, 50)
    .map((session) => ({
      id: session.id,
      title: session.name || session.preview || session.id,
      subtitle: shortPath(session.cwd),
      meta: String(session.messageCount),
      open: () => void openPath(session.path),
    }));
}
