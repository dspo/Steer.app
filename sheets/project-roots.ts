/**
 * A project's roots while the dialog edits them. The rules are pure and
 * testable: paths come from the Finder picker, so they are absolute and have
 * no free-form text field; exactly one root is primary, and the first root
 * chosen becomes primary.
 */

export interface RootDraft {
  path: string;
  primary: boolean;
}

/**
 * A picked folder as the dialog stores it: trimmed, absolute, and without a
 * trailing slash (except the file system root). `null` rejects anything the
 * picker should never return.
 */
export function normalizeRootPath(raw: string): string | null {
  const path = raw.trim();
  if (!path || path.includes("\0") || path.includes("\n") || path.includes("\r")) return null;
  if (!path.startsWith("/")) return null;
  const trimmed = path.length > 1 ? path.replace(/\/+$/, "") : path;
  return trimmed || "/";
}

/** Adds a picked root; the first one becomes primary and duplicates are ignored. */
export function addProjectRoot(roots: RootDraft[], raw: string): RootDraft[] {
  const path = normalizeRootPath(raw);
  if (!path) return roots;
  if (roots.some((root) => root.path === path)) return roots;
  if (roots.length === 0) return [{ path, primary: true }];
  return [...roots, { path, primary: false }];
}

/** Removes a root; when it was primary, the first remaining root becomes primary. */
export function removeProjectRoot(roots: RootDraft[], path: string): RootDraft[] {
  const next = roots.filter((root) => root.path !== path);
  if (next.length === 0) return next;
  if (next.some((root) => root.primary)) return next;
  return next.map((root, index) => ({ ...root, primary: index === 0 }));
}

/** Makes one root primary; every other root stops being primary. */
export function setPrimaryProjectRoot(roots: RootDraft[], path: string): RootDraft[] {
  if (!roots.some((root) => root.path === path)) return roots;
  return roots.map((root) => ({ ...root, primary: root.path === path }));
}

/** The dialog's submit payload: roots as the engine expects them. */
export function rootPayload(roots: RootDraft[]): Array<{ path: string; primary: boolean }> {
  return roots.map((root) => ({ path: root.path, primary: root.primary }));
}
