import type { FsFailure } from "./fs";
import type { FileEntry } from "./fs";
import { encodePath } from "./editors";

/**
 * The file tree's data and its rows. The tree is a map of directory path to
 * its listing, so expanding a directory loads only that directory; the
 * visible rows are flattened from the expanded set, which is what the
 * virtualized `List` renders. Pure functions here, so the ordering and the
 * flattening are testable without a screen.
 */

/** One loaded directory: its entries, or why they could not be read. */
export interface DirState {
  status: "loading" | "ready" | "error";
  entries: FileEntry[];
  error: FsFailure | null;
}

/** A row of the flattened tree. */
export type FileRow =
  | { kind: "entry"; entry: FileEntry; depth: number }
  | { kind: "loading"; path: string; depth: number }
  | { kind: "empty"; path: string; depth: number }
  | { kind: "error"; path: string; depth: number; error: FsFailure };

/** The root's key in `DirState`; a directory's key is its absolute path. */
export const ROOT_KEY = "";

/** Directories first, then names case-insensitively (the Rust module sorts,
 * this keeps the invariant if a listing is built elsewhere). */
export function sortEntries(entries: FileEntry[]): FileEntry[] {
  return entries.slice().sort((a, b) => {
    const dirs = Number(b.kind === "dir") - Number(a.kind === "dir");
    if (dirs !== 0) return dirs;
    const left = a.name.toLowerCase();
    const right = b.name.toLowerCase();
    return left < right ? -1 : left > right ? 1 : a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
}

/** The directory key for an entry (its own path when it is a directory). */
export function dirKey(entry: FileEntry): string {
  return entry.path;
}

/**
 * The rows the tree shows: every entry of every expanded directory, in
 * order, with a loading/empty/error row under a directory that is not ready.
 * `expanded` holds directory paths (not the root key, which is always open).
 */
export function fileRows(tree: Record<string, DirState>, expanded: string[]): FileRow[] {
  const open = new Set(expanded);
  const rows: FileRow[] = [];
  const walk = (key: string, depth: number): void => {
    const state = tree[key];
    if (!state) {
      rows.push({ kind: "loading", path: key, depth });
      return;
    }
    if (state.status === "loading") {
      rows.push({ kind: "loading", path: key, depth });
      return;
    }
    if (state.status === "error") {
      rows.push({
        kind: "error",
        path: key,
        depth,
        error: state.error ?? { code: "ERR_FS_UNKNOWN", message: "the directory could not be read" },
      });
      return;
    }
    if (state.entries.length === 0) {
      rows.push({ kind: "empty", path: key, depth });
      return;
    }
    for (const entry of state.entries) {
      rows.push({ kind: "entry", entry, depth });
      if (entry.kind === "dir" && open.has(entry.path)) walk(entry.path, depth + 1);
    }
  };
  walk(ROOT_KEY, 0);
  return rows;
}

/** The test id of one file/directory row (the absolute path, encoded). */
export function fileRowTestId(path: string): string {
  return `file-row-${encodePath(path)}`;
}

/** The test id of the "compare this file" action on a file row. */
export function compareRowTestId(path: string): string {
  return `compare-${encodePath(path)}`;
}

/** The test id of the tree's caret for a directory. */
export function dirToggleTestId(path: string): string {
  return `dir-toggle-${encodePath(path)}`;
}

/** The rows' key extractor for the virtualized list: stable per path/kind. */
export function fileRowKey(row: FileRow): string {
  switch (row.kind) {
    case "entry":
      return `${row.entry.kind}:${row.entry.path}`;
    case "loading":
      return `loading:${row.path}`;
    case "empty":
      return `empty:${row.path}`;
    case "error":
      return `error:${row.path}`;
  }
}

/** Whether `path` is the root or inside it (a leaf check for compare paths). */
export function within(root: string, path: string): boolean {
  const base = root.endsWith("/") ? root : `${root}/`;
  return path === root || path.startsWith(base);
}
