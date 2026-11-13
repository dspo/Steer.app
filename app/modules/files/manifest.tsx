import { DiffBody, EditorBody, FilesBody } from "./view";
import { diffSheetPaths, editorDocs, editorPathFor, editorSheetId, editorSheetPath, openEditorSheet, reloadEditor, saveActiveEditor } from "./editors";
import { requestReveal } from "../../domains/lsp";
import { baseName } from "../../domains/fs";
import { activeContainerId, containers, openSheet } from "../../core/containers";
import { K, t } from "../../ui/i18n";
import type { SheetModule } from "../../../contracts/module";

/** `· folder` suffix the workspace sheets share. */
function folderTitle(containerId: string | null, title: string): string {
  const container = containers().find((row) => row.id === containerId);
  const folder = container ? baseName(container.cwd) : "";
  return folder ? `${title} · ${folder}` : title;
}

/** Opens (or shows) a container's file tree sheet. */
export function openFilesSheet(containerId: string | null = activeContainerId()): void {
  if (!containerId) return;
  openSheet(`files:${containerId}`);
}

/**
 * The workspace module: the file tree, the editor and the two-file diff.
 * All three read the `fs` domain; the module owns their sheet state
 * (`editors.ts`) and the bodies.
 */
export const filesModule: SheetModule = {
  id: "files",
  capabilities: ["fs"],
  titlebar: [
    {
      id: "open-files",
      label: () => t(K.files.title),
      glyph: "folder",
      testID: "open-files",
      order: 10,
      enabled: () => activeContainerId() !== null,
      onPress: () => openFilesSheet(),
    },
  ],
  intents: {
    "files.open": (payload) => {
      const { containerId = activeContainerId() } = (payload ?? {}) as { containerId?: string | null };
      openFilesSheet(containerId);
      return containerId ? `files:${containerId}` : null;
    },
    "editor.open": (payload) => {
      const { containerId = null, path } = (payload ?? {}) as { containerId?: string | null; path?: string };
      if (!containerId || !path) return null;
      openEditorSheet(containerId, path);
      return editorSheetId(containerId, path);
    },
    "editor.reveal": (payload) => {
      const { containerId = null, path, range } = (payload ?? {}) as {
        containerId?: string | null;
        path?: string;
        range?: unknown;
      };
      if (!containerId || !path) return null;
      const real = editorPathFor(containerId, path);
      openEditorSheet(containerId, real);
      const id = editorSheetId(containerId, real);
      if (range) requestReveal(id, range as never);
      return id;
    },
    "editor.saveActive": () => {
      saveActiveEditor();
      return null;
    },
    "editor.reload": (payload) => {
      const { containerId = null, cleanOnly = true } = (payload ?? {}) as {
        containerId?: string | null;
        cleanOnly?: boolean;
      };
      for (const doc of Object.values(editorDocs())) {
        if (containerId && doc.containerId !== containerId) continue;
        if (cleanOnly && doc.dirty) continue;
        reloadEditor(doc.sheetId);
      }
      return null;
    },
  },
  kinds: [
    {
      kind: "files",
      glyph: "folder",
      tint: "muted-foreground",
      title: (id) => folderTitle(id.slice("files:".length), t(K.sheet.filesTitle)),
      body: ({ containerId }) => <FilesBody containerId={containerId ?? ""} />,
      parse: (id) => (id.startsWith("files:") ? id.slice("files:".length) : null),
    },
    {
      kind: "editor",
      glyph: "file",
      tint: "muted-foreground",
      title: (id) => {
        const target = editorSheetPath(id);
        return target ? baseName(target.path) : id;
      },
      body: ({ id }) => <EditorBody sheetId={id} />,
      parse: (id) => (id.startsWith("editor:") ? id.slice("editor:".length) : null),
    },
    {
      kind: "diff",
      glyph: "diff",
      tint: "muted-foreground",
      title: (id) => {
        const pair = diffSheetPaths(id);
        return pair ? `${baseName(pair.oldPath)} ↔ ${baseName(pair.newPath)}` : id;
      },
      body: ({ id }) => <DiffBody sheetId={id} />,
      parse: (id) => (id.startsWith("diff:") ? id.slice("diff:".length) : null),
    },
  ],
};
