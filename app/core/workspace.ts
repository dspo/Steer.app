import { ensureWorkspace, removeWorkspace } from "../domains/state";

/**
 * The start page's fallback workspaces (docs/DESIGN §4.1), apart from the
 * state directory: an agent working in one of these must not be able to
 * delete `registry.json`.
 *
 * - `__chat__/`: one stable folder every conversation without a project
 *   starts in; it does not move when a session is deleted.
 * - `scratch/<containerId>/`: a tool container minted outside a project gets
 *   its own folder, removed with the container. Never the system `/tmp`: the
 *   container records its cwd, and a cleaned `/tmp` would fail to reopen.
 *
 * The workspace parent is `~/.steer` (see `zu/state`).
 */

/** The folder every project-less conversation shares. */
export const CHATS_FOLDER = "__chat__";

/** The `__chat__/` folder, created on use; null when the workspace cannot be
 * made. */
export function chatsCwd(): Promise<string | null> {
  return ensureWorkspace(CHATS_FOLDER);
}

/** A container's scratch folder, created on use; null when the workspace
 * cannot be made. */
export function scratchCwd(containerId: string): Promise<string | null> {
  return ensureWorkspace(`scratch/${containerId}`);
}

/** Removes a container's scratch folder with the container (archive). A
 * project container has none, and that is not an error. */
export function dropScratch(containerId: string): void {
  void removeWorkspace(`scratch/${containerId}`);
}
