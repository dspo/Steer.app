import { Buffer } from "buffer";
import { signal, untracked } from "nsh";
import { closeSheet, containers, layout, noteSheetOpened, setLayout } from "../../core/containers";
import { appendSheet, visiblePanels } from "../../core/dock";
import { canonicalRoot, failure, readText, sameVersion, statPath, writeText, type FsFailure } from "../../domains/fs";
import { t, K } from "../../ui/i18n";
import { languageFor } from "../../ui/languages";
import { documentChanged, documentClosed, documentSaved, openLspDocument } from "../../domains/lsp";

export { languageFor };

/**
 * The editors' documents and their sheet identity.
 *
 * A document lives here, not in a sheet component: a sheet unmounts when a
 * container switches or a tab is hidden, and an unsaved edit must not
 * disappear with it. The sheet renders this store and writes through it; the
 * id is `editor:{containerId}:{base64url path}`, so a layout stash restores
 * the same sheet and the same file without a second lookup.
 *
 * Saves are the Rust module's: `stat` first, then `write` with the version
 * last read, then a read-back that must equal the text. A file changed by
 * somebody else turns the sheet read-only (`conflict`) until it reloads.
 */

/** `ERR_FS_VERIFY` is this layer's: the save came back but the disk differs. */
const ERR_FS_VERIFY = "ERR_FS_VERIFY";
/** `ERR_FS_ROOT` is also the container's: no cwd to allow. */
export const ERR_FS_ROOT = "ERR_FS_ROOT";

type EditorStatus = "loading" | "ready" | "saving";

/** One open file: its text, the version on disk and what the sheet shows. */
interface EditorDoc {
  sheetId: string;
  containerId: string;
  /** The absolute path the sheet opened (inside the container's cwd). */
  path: string;
  /**
   * The canonical path (`/tmp` on macOS is `/private/tmp`), set by the first
   * successful read. The language server sees canonical paths, so diagnostics
   * and definitions are keyed by this, while the sheet id keeps `path`.
   */
  realPath: string;
  /** The workspace root as `zu/fs` canonicalizes it; "" until the first read. */
  root: string;
  text: string;
  /** The text last read from or written to disk. */
  baseline: string;
  dirty: boolean;
  status: EditorStatus;
  error: FsFailure | null;
  /** The file changed on disk after this sheet read it; saving is disabled. */
  conflict: boolean;
  /** Editing is disabled: a conflict, a binary file, a too-large file. */
  readonly: boolean;
  encoding: string;
  mtimeMs: number;
  size: number;
}

/** Every open document, by sheet id. The editor sheets render this. */
export const editorDocs = signal<Record<string, EditorDoc>>({});

/** Saves in flight, so a second press joins the first instead of racing it. */
const saving = new Set<string>();

/** The base64url form of a path (no `=`, `+` or `/`); it may contain `:`? No. */
export function encodePath(path: string): string {
  return Buffer.from(path, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** The path `encodePath` encoded, `null` when the text is not valid. */
function decodePath(encoded: string): string | null {
  try {
    const padded = encoded.replace(/-/g, "+").replace(/_/g, "/");
    return Buffer.from(padded, "base64").toString("utf8");
  } catch {
    return null;
  }
}

/** A file's editor sheet: stable across layout stash and restore. */
export function editorSheetId(containerId: string, path: string): string {
  return `editor:${containerId}:${encodePath(path)}`;
}

/** The container and path an editor sheet names, `null` for another sheet. */
export function editorSheetPath(id: string): { containerId: string; path: string } | null {
  if (!id.startsWith("editor:")) return null;
  const rest = id.slice("editor:".length);
  const at = rest.lastIndexOf(":");
  if (at <= 0) return null;
  const path = decodePath(rest.slice(at + 1));
  return path === null ? null : { containerId: rest.slice(0, at), path };
}

/** A two-file diff's sheet. `~` separates the two base64url paths. */
export function diffSheetId(containerId: string, oldPath: string, newPath: string): string {
  return `diff:${containerId}:${encodePath(oldPath)}~${encodePath(newPath)}`;
}

/** The two files a diff sheet names, `null` for another sheet. */
export function diffSheetPaths(
  id: string,
): { containerId: string; oldPath: string; newPath: string } | null {
  if (!id.startsWith("diff:")) return null;
  const rest = id.slice("diff:".length);
  const at = rest.lastIndexOf(":");
  if (at <= 0) return null;
  const parts = rest.slice(at + 1).split("~");
  if (parts.length !== 2) return null;
  const oldPath = decodePath(parts[0]);
  const newPath = decodePath(parts[1]);
  return oldPath === null || newPath === null
    ? null
    : { containerId: rest.slice(0, at), oldPath, newPath };
}

/** The active container's cwd, or a coded failure when it has none. */
function rootOf(containerId: string): { root: string } | { error: FsFailure } {
  const container = containers().find((row) => row.id === containerId);
  if (!container || !container.cwd) {
    return {
      error: {
        code: ERR_FS_ROOT,
        message: `the container has no workspace root: ${containerId}`,
      },
    };
  }
  return { root: container.cwd };
}

function patch(id: string, changes: Partial<EditorDoc>): void {
  const current = editorDocs()[id];
  if (!current) return;
  editorDocs.set({ ...editorDocs(), [id]: { ...current, ...changes } });
}

/** Loads (or reloads) one document from disk. */
async function load(doc: EditorDoc): Promise<void> {
  const owner = rootOf(doc.containerId);
  if ("error" in owner) {
    patch(doc.sheetId, { status: "ready", readonly: true, conflict: false, error: owner.error });
    return;
  }
  try {
    const base = await canonicalRoot(owner.root);
    patch(doc.sheetId, { root: base });
    const real = await statPath(base, doc.path);
    const file = await readText(base, doc.path);
    const realPath = real.kind === "file" ? real.path : doc.path;
    patch(doc.sheetId, {
      realPath,
      text: file.text,
      baseline: file.text,
      dirty: false,
      status: "ready",
      error: null,
      conflict: false,
      readonly: false,
      encoding: file.encoding,
      mtimeMs: file.mtimeMs,
      size: file.size,
    });
    // A supported file opening is the only trigger besides Problems: the
    // server starts now, with the same text the sheet read.
    openLspDocument(doc.containerId, base, realPath, file.text, languageFor(doc.path));
  } catch (error) {
    const problem = failure(error);
    // Binary and too-large files are states, not transient failures: keep the
    // sheet open, read-only, and say which one it is.
    patch(doc.sheetId, {
      text: "",
      baseline: "",
      realPath: "",
      dirty: false,
      status: "ready",
      readonly: true,
      conflict: false,
      error: problem,
    });
  }
}

/**
 * Ensures `path` has a document and starts its first read. Opening the same
 * file twice returns the same sheet (and keeps unsaved edits).
 */
export function ensureEditor(containerId: string, path: string): string {
  const id = editorSheetId(containerId, path);
  const existing = editorDocs()[id];
  if (existing) return id;
  const doc: EditorDoc = {
    sheetId: id,
    containerId,
    path,
    root: "",
    realPath: "",
    text: "",
    baseline: "",
    dirty: false,
    status: "loading",
    error: null,
    conflict: false,
    readonly: false,
    encoding: "utf-8",
    mtimeMs: 0,
    size: 0,
  };
  editorDocs.set({ ...editorDocs(), [id]: doc });
  void load(doc);
  return id;
}

/** The user edited the text: the document becomes dirty (or clean again). */
export function setEditorText(id: string, text: string): void {
  const doc = editorDocs()[id];
  if (!doc || doc.readonly) return;
  patch(id, { text, dirty: text !== doc.baseline });
  // The language server gets the full text on a pause in typing; the store
  // owns this call so a hidden sheet stays synchronized too.
  documentChanged(doc.containerId, doc.realPath || doc.path, text);
}

/** Reads the file again, dropping the unsaved edit and clearing a conflict. */
export function reloadEditor(id: string): void {
  const doc = editorDocs()[id];
  if (!doc) return;
  patch(id, { status: "loading", error: null, conflict: false, readonly: false });
  void load(editorDocs()[id]);
}

/**
 * Saves through `zu/fs`: `stat` before the write, the write with the version
 * last read, then a read-back that must equal what was written. A changed
 * file becomes a `conflict` and stays read-only until `reloadEditor`.
 */
export async function saveEditor(id: string): Promise<void> {
  const doc = editorDocs()[id];
  if (!doc || doc.status !== "ready" || doc.readonly || saving.has(id)) return;
  const owner = rootOf(doc.containerId);
  if ("error" in owner) {
    patch(id, { error: owner.error, readonly: true });
    return;
  }
  saving.add(id);
  patch(id, { status: "saving", error: null });
  const text = doc.text;
  const base = doc.root || (await canonicalRoot(owner.root));
  try {
    // The required pre-save check: the version the editor holds must still
    // be the one on disk, even before the write's own check.
    const before = await statPath(base, doc.path);
    if (!sameVersion(before, doc)) {
      patch(id, {
        status: "ready",
        conflict: true,
        readonly: true,
        error: {
          code: "ERR_FS_STALE",
          message: t(K.editor.conflictDetail),
          mtimeMs: before.mtimeMs,
          size: before.size,
        },
      });
      return;
    }
    await writeText(
      base,
      doc.path,
      text,
      { mtimeMs: doc.mtimeMs, size: doc.size },
      doc.encoding,
    );
    // Verify the disk, not the promise: the sheet is done only when a fresh
    // read returns exactly what was typed.
    const after = await readText(base, doc.path);
    if (after.text !== text) {
      patch(id, {
        status: "ready",
        readonly: true,
        error: {
          code: ERR_FS_VERIFY,
          message: t(K.editor.verifyFailed),
          size: after.size,
          mtimeMs: after.mtimeMs,
        },
      });
      return;
    }
    patch(id, {
      status: "ready",
      baseline: after.text,
      dirty: false,
      conflict: false,
      readonly: false,
      error: null,
      encoding: after.encoding,
      mtimeMs: after.mtimeMs,
      size: after.size,
    });
    documentSaved(doc.containerId, doc.realPath || doc.path, after.text);
  } catch (error) {
    const problem = failure(error);
    // `ERR_FS_STALE` from the write itself is the same read-only conflict.
    const stale = problem.code === "ERR_FS_STALE";
    patch(id, {
      status: "ready",
      readonly: true,
      conflict: stale,
      error: problem,
      mtimeMs: typeof problem.mtimeMs === "number" ? problem.mtimeMs : doc.mtimeMs,
      size: typeof problem.size === "number" ? problem.size : doc.size,
    });
  } finally {
    saving.delete(id);
  }
}

/** The path a sheet already uses for `path` (a canonical alias, else itself). */
export function editorPathFor(containerId: string, path: string): string {
  for (const doc of Object.values(editorDocs())) {
    if (doc.containerId === containerId && (doc.realPath || doc.path) === path) return doc.path;
  }
  return path;
}

/** Forgets a document (its sheet closed). Unsaved text goes with it. */
function dropEditor(id: string): void {
  const current = editorDocs();
  const doc = current[id];
  if (!doc) return;
  documentClosed(doc.containerId, doc.realPath || doc.path);
  const next = { ...current };
  delete next[id];
  editorDocs.set(next);
}

/** Saves the editor sheets that are on screen now (the app's Mod+S). */
export function saveActiveEditor(): void {
  for (const id of visiblePanels()) {
    if (id.startsWith("editor:")) void saveEditor(id);
  }
}

/** Opens (or shows) a file's editor sheet beside the file tree. */
export function openEditorSheet(containerId: string, path: string): void {
  ensureEditor(containerId, path);
  const id = editorSheetId(containerId, path);
  if (!visiblePanels().includes(id)) {
    setLayout(appendSheet(layout(), id, `files:${containerId}`));
    noteSheetOpened(id);
  }
}

/** Opens a two-file diff sheet beside the file tree. */
export function openDiffSheet(containerId: string, oldPath: string, newPath: string): void {
  const id = diffSheetId(containerId, oldPath, newPath);
  setLayout(appendSheet(layout(), id, `files:${containerId}`));
  noteSheetOpened(id);
}

/** Closes an editor sheet and drops its document. */
export function closeEditor(id: string): void {
  closeSheet(id);
  dropEditor(id);
}
