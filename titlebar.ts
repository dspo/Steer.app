import { openUrl } from "nsh";
import type { ContainerRecord } from "./contracts/protocol";
import { activeContainerId, liveContainers, switchContainer } from "./containers";
import { containerTitle } from "./titles";
import { containerProject, projects } from "./projects";
import { focusSession, sessions, type SessionMeta } from "./sessions";

/**
 * The titlebar's data side: the session picker's candidates, the "open in
 * VS Code" target, and the VS Code URL. The views live in `shell.tsx`; these
 * functions stay outside the JSX so the ordering/filtering rules are
 * testable without a window.
 */

/** The picker never lists more than this many containers. */
export const PICKER_LIMIT = 10;

/** The project a container belongs to, or null for Chats. */
export function containerProjectName(container: ContainerRecord): string | null {
  const id = containerProject(container);
  if (!id) return null;
  return projects().find((project) => project.id === id)?.name ?? null;
}

/** Case-insensitive containment over a container's title, cwd and project. */
export function containerMatches(container: ContainerRecord, query: string): boolean {
  const term = query.trim().toLowerCase();
  if (!term) return true;
  const faces = [containerTitle(container), container.cwd, containerProjectName(container) ?? ""];
  return faces.some((face) => face.toLowerCase().includes(term));
}

/** Case-insensitive containment over a session's title, cwd and file path. */
export function sessionMatches(session: SessionMeta, query: string): boolean {
  const term = query.trim().toLowerCase();
  if (!term) return false;
  const faces = [session.name, session.preview, session.cwd, session.path];
  return faces.some((face) => (face ?? "").toLowerCase().includes(term));
}

/**
 * The picker's rows: non-archived containers matching `query`, newest
 * activity first, capped at [`PICKER_LIMIT`] **after** filtering (a matching
 * older container is never crowded out by newer non-matching ones). The
 * engine's `container.show` stamps `updatedAt`; `liveContainers` carries the
 * explicit tie-breaks.
 */
export function pickerCandidates(query = ""): ContainerRecord[] {
  return liveContainers()
    .filter((container) => containerMatches(container, query))
    .slice(0, PICKER_LIMIT);
}

/** The picker's session rows: recent openable sessions matching `query`. */
export function pickerSessions(query = ""): SessionMeta[] {
  const term = query.trim().toLowerCase();
  return sessions()
    .filter((session) => {
      if (!term) return true;
      const faces = [session.name, session.preview, session.cwd, session.path];
      return faces.some((face) => (face ?? "").toLowerCase().includes(term));
    })
    .slice(0, PICKER_LIMIT);
}

/** The active container, if the canvas shows one. */
export function activeContainer(): ContainerRecord | null {
  const id = activeContainerId();
  if (!id) return null;
  return liveContainers().find((container) => container.id === id) ?? null;
}

/**
 * `code $project.main_path`: the active project's primary root, else the
 * active container's cwd. A project's primary root is the one the engine
 * snapshots into new containers; a root set without a primary (defensive)
 * falls back to its first root.
 */
export function vscodeTarget(): string | null {
  const container = activeContainer();
  if (!container) return null;
  const projectId = containerProject(container);
  const project = projectId ? projects().find((row) => row.id === projectId) : null;
  const primary = project?.roots.find((root) => root.primary) ?? project?.roots[0];
  const path = primary?.path ?? container.cwd;
  return path ? path : null;
}

/** `vscode://file/{absolute path}`, each path segment URL-encoded. */
export function vscodeUrl(path: string): string {
  const absolute = path.startsWith("/") ? path : `/${path}`;
  // `windowId=_blank` opens a new window: without it VS Code reuses (and so
  // replaces) the window the user already has.
  return `vscode://file${absolute.split("/").map(encodeURIComponent).join("/")}?windowId=_blank`;
}

/** What opening the editor did, for the status bar's one-line report. */
export type OpenEditorResult =
  | { kind: "opened"; path: string; url: string }
  | { kind: "no-folder" }
  | { kind: "failed"; path: string; url: string; error: string };

/**
 * Opens the active target in VS Code through the platform's URL handler.
 * The capability (`nsh.json` `capabilities.openUrl.schemes`) grants the
 * `vscode` scheme; when no app handles it `openUrl` resolves `opened:false`
 * and the caller says so instead of pretending the editor came up.
 */
export async function openActiveInVSCode(): Promise<OpenEditorResult> {
  const path = vscodeTarget();
  if (!path) return { kind: "no-folder" };
  const url = vscodeUrl(path);
  try {
    const result = await openUrl(url);
    if (!result?.opened) {
      return { kind: "failed", path, url, error: "no application handles vscode:// links" };
    }
    return { kind: "opened", path, url };
  } catch (failure) {
    return { kind: "failed", path, url, error: String(failure) };
  }
}

/** Switches to a container from the picker and focuses its first session. */
export async function pickContainer(id: string): Promise<void> {
  const target = liveContainers().find((container) => container.id === id);
  await switchContainer(id, true);
  // A failed switch keeps the old canvas: focusing the target's session then
  // would leave the selection and the canvas pointing at different containers.
  if (activeContainerId() !== id) return;
  const first = target?.sessions[0]?.sessionId;
  if (first) focusSession(first);
}
