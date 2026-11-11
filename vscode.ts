import { openUrl } from "nsh";
import type { ContainerRecord } from "./contracts/protocol";
import { activeContainerId, liveContainers } from "./containers";
import { containerProject, projects } from "./projects";

/**
 * The "open in VS Code" action's data side: the target, the URL and the
 * platform open. It stays outside `shell.tsx` so the target rules are
 * testable without a window.
 */

/** The active container, if the canvas shows one. */
function activeContainer(): ContainerRecord | null {
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

