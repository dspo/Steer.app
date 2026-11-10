import { Fs, type FsEntry, type FsExpected, type FsFile, type FsStat, type FsWriteResult } from "zu/native";

/**
 * The workspace file system as the UI uses it: `zu/fs` in Rust owns the path
 * policy, the size caps, the atomic save and the stale check. This module is
 * the typed face of it — the editor and the file tree never touch a native
 * `fs` capability, and every call names the allowed root (the active
 * container's cwd).
 *
 * Failures keep the native error's `code` (`ERR_FS_ESCAPE`, `ERR_FS_BINARY`,
 * `ERR_FS_TOO_LARGE`, `ERR_FS_STALE`, `ENOENT`, ...), so the sheets show a
 * specific empty/error state instead of one generic message.
 */

export type FileEntry = FsEntry;
export type FileStat = FsStat;
export type FileContents = FsFile;
export type FileVersion = FsExpected;
export type WriteResult = FsWriteResult;

/** A failure from `zu/fs`, with its code and any details the module set. */
export interface FsFailure {
  code: string;
  message: string;
  size?: number;
  limit?: number;
  mtimeMs?: number;
}

/** The failure of `error`, keeping `zu/fs`'s code when there is one. */
export function failure(error: unknown): FsFailure {
  const value = error as
    | { code?: unknown; message?: unknown; size?: unknown; limit?: unknown; mtimeMs?: unknown }
    | null
    | undefined;
  const code = typeof value?.code === "string" ? value.code : "ERR_FS_UNKNOWN";
  const message = typeof value?.message === "string" ? value.message : String(error);
  const out: FsFailure = { code, message };
  if (typeof value?.size === "number") out.size = value.size;
  if (typeof value?.limit === "number") out.limit = value.limit;
  if (typeof value?.mtimeMs === "number") out.mtimeMs = value.mtimeMs;
  return out;
}

/** A workspace root as the module canonicalizes it (`/tmp/x` on macOS is
 * `/private/tmp/x`), cached per root so every sheet agrees on the base that
 * makes a path relative. */
const canonicalRoots = new Map<string, string>();

/** The canonical form of `root`; the root itself when it cannot be stat'ed. */
export async function canonicalRoot(root: string): Promise<string> {
  const hit = canonicalRoots.get(root);
  if (hit) return hit;
  try {
    const stat = await statPath(root, ".");
    if (stat.kind === "dir") {
      canonicalRoots.set(root, stat.path);
      return stat.path;
    }
  } catch {
    // Fall back to the root as given; the caller's own call reports why.
  }
  return root;
}

/** Lists `dir` (relative to `root`) with directories first; lazy children. */
export async function listDir(root: string, dir: string): Promise<FileEntry[]> {
  return Fs.list(root, dir || ".");
}

/** Creates a directory inside `root` (its parent must exist), returning it. */
export async function makeDir(root: string, path: string): Promise<FileStat> {
  return Fs.mkdir(root, path);
}

/** One path's kind, size, mtime and read-only bit. */
export async function statPath(root: string, path: string): Promise<FileStat> {
  return Fs.stat(root, path);
}

/** Reads a UTF-8 text file; binary and over-limit files reject with a code. */
export async function readText(root: string, path: string): Promise<FileContents> {
  return Fs.read(root, path);
}

/** Writes atomically, keeping the mode and BOM; `expected` rejects a stale save. */
export async function writeText(
  root: string,
  path: string,
  text: string,
  expected: FileVersion | null,
  encoding: string | null,
): Promise<WriteResult> {
  return Fs.write(root, path, text, expected, encoding);
}

/** Whether `stat` is still the version `read` returned. */
export function sameVersion(stat: FileStat, version: { mtimeMs: number; size: number }): boolean {
  return Math.abs(stat.mtimeMs - version.mtimeMs) < 0.5 && Math.abs(stat.size - version.size) < 0.5;
}

/** A byte count for the file tree and the editor's status line. */
export function formatBytes(size: number): string {
  if (size < 1024) return `${Math.round(size)} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/** The relative path a sheet shows, from the workspace root. */
export function relativeTo(root: string, path: string): string {
  if (path === root) return ".";
  if (path.startsWith(root.endsWith("/") ? root : `${root}/`)) {
    return path.slice(Math.min(path.length, root.length + (root.endsWith("/") ? 0 : 1)));
  }
  return path;
}

/** `main.rs`, for a tab or a row. */
export function baseName(path: string): string {
  const clean = path.replace(/\/+$/, "");
  const at = clean.lastIndexOf("/");
  return at < 0 ? clean : clean.slice(at + 1);
}
