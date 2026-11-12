import { Dialog, DiffView, Editor, Input, type DiffStats, type EditorRef, type EditorSearchResult } from "nsh/base";
import { cleanup, effect, keymap, List, signal, Text, token, untracked, View } from "nsh";
import type { Bounds } from "nsh";
import type { DiffLayout } from "nsh/base";
import { containers } from "../stores/containers";
import {
  closeEditor,
  diffSheetPaths,
  editorDocs,
  editorPathFor,
  editorSheetId,
  editorSheetPath,
  ensureEditor,
  languageFor,
  openDiffSheet,
  openEditorSheet,
  reloadEditor,
  saveEditor,
  setEditorText,
} from "../stores/editors";
import { baseName, canonicalRoot, failure, formatBytes, listDir, readText, relativeTo, type FsFailure } from "../stores/fs";
import { SHEET_FONT } from "../ui/fonts";
import {
  ROOT_KEY,
  compareRowTestId,
  dirToggleTestId,
  fileRowKey,
  fileRowTestId,
  fileRows,
  sortEntries,
  type DirState,
  type FileRow,
} from "../stores/file-tree";
import { visiblePanels } from "../stores/dock";
import {
  clearPendingReveal,
  diagnosticsFor,
  lspCompletion,
  lspDefinition,
  lspHover,
  pendingReveals,
  requestReveal,
  type LspCompletionResult,
} from "../stores/lsp";
import { HoverCard } from "./lsp-ui";
import { K, t } from "../ui/i18n";
import { Glyph, motionStyle, shadowDialog, SheetAction as Action, SheetIconButton as IconButton } from "../ui/ui";

/**
 * The workspace sheets: the file tree, one editor per file, and a two-file
 * diff. The tree lists the active container's cwd lazily (a directory's
 * children load when it opens), opens a file in an editor sheet, and offers
 * "compare" on a file row for the diff sheet.
 *
 * Every read and write goes through `zu/fs` (`fs.ts`); the sheets never
 * touch a file-system capability of their own. States are explicit: loading,
 * empty, error, binary, too large, and the stale conflict that turns an
 * editor read-only until it reloads.
 */

/** A specific failure, in the shell's language. */
function failureText(problem: FsFailure): string {
  switch (problem.code) {
    case "ERR_FS_BINARY":
      return t(K.editor.binary);
    case "ERR_FS_TOO_LARGE":
      return t(K.editor.tooLarge, {
        size: formatBytes(problem.size ?? 0),
        limit: formatBytes(problem.limit ?? 0),
      });
    case "ENOENT":
      return t(K.editor.missing);
    case "ERR_FS_ESCAPE":
      return t(K.editor.escape);
    case "ERR_FS_STALE":
      return t(K.editor.conflict);
    default:
      return t(K.editor.error, { code: problem.code, message: problem.message });
  }
}


/** The file tree of one container's cwd. */
export function FilesBody(props: { containerId: string }) {
  const tree = signal<Record<string, DirState>>({});
  const expanded = signal<string[]>([]);
  const selected = signal<string | null>(null);
  const compareOpen = signal(false);
  const pathA = signal("");
  const pathB = signal("");
  const compareError = signal<string | null>(null);
  /** The workspace root as zu/fs canonicalizes it (relative paths need it). */
  const base = signal("");
  const root = () => containers().find((row) => row.id === props.containerId)?.cwd ?? "";
  const shownRoot = () => base() || root();
  // A list read may finish after the sheet closed; its signals are gone then.
  let alive = true;
  cleanup(() => {
    alive = false;
  });

  const load = (key: string, dir: string): void => {
    const workspace = root();
    if (!workspace) return;
    tree.update((previous) => ({
      ...previous,
      [key]: { status: "loading", entries: previous[key]?.entries ?? [], error: null },
    }));
    void canonicalRoot(workspace)
      .then((canonical) => {
        if (!alive) return [];
        base.set(canonical);
        return listDir(canonical, dir);
      })
      .then((entries) => {
        if (!alive) return;
        tree.update((previous) => ({
          ...previous,
          [key]: { status: "ready", entries: sortEntries(entries), error: null },
        }));
      })
      .catch((error: unknown) => {
        if (!alive) return;
        tree.update((previous) => ({
          ...previous,
          [key]: { status: "error", entries: [], error: failure(error) },
        }));
      });
  };

  if (!root()) {
    return (
      <View class="flex-1 items-center justify-center gap-1 bg-card">
        <Text class="text-[12px] text-muted-foreground">{t(K.files.noContainer)}</Text>
        <Text class="text-[11px] font-mono text-faint">{props.containerId}</Text>
      </View>
    );
  }

  load(ROOT_KEY, "");

  const toggle = (path: string): void => {
    const open = expanded().includes(path);
    if (open) {
      expanded.set(expanded().filter((entry) => entry !== path));
      return;
    }
    expanded.set([...expanded(), path]);
    const state = tree()[path];
    if (!state || state.status === "error") load(path, path);
  };

  const openFile = (path: string): void => {
    selected.set(path);
    openEditorSheet(props.containerId, path);
  };

  const openCompare = (path?: string): void => {
    pathA.set(path ?? selected() ?? shownRoot());
    pathB.set("");
    compareError.set(null);
    compareOpen.set(true);
  };

  const confirmCompare = (): void => {
    const first = pathA().trim();
    const second = pathB().trim();
    if (!first || !second) {
      compareError.set(t(K.files.compareHint));
      return;
    }
    openDiffSheet(props.containerId, first, second);
    compareOpen.set(false);
  };

  const refresh = (): void => {
    tree.set({});
    expanded.set([]);
    load(ROOT_KEY, "");
  };

  const rows = () => fileRows(tree(), expanded());
  const rootError = () => tree()[ROOT_KEY]?.error ?? null;
  const rootEntries = () => tree()[ROOT_KEY]?.entries.length ?? 0;

  return (
    <View class="flex-1 bg-card">
      <View class="flex-row items-center gap-2 border-b border-line px-3 py-2">
        <Glyph name="folder" size={13} tint={token("muted-foreground")} />
        <View style={{ flex: 1 }}>
          <Text testID="files-root" class="text-[12px] font-semibold text-foreground" style={{ numberOfLines: 1 }}>
            {baseName(shownRoot()) || t(K.files.title)}
          </Text>
          <Text class="text-[10px] font-mono text-faint" style={{ numberOfLines: 1 }}>
            {shownRoot()}
          </Text>
        </View>
        <Text class="text-[10.5px] tabular-nums text-faint">
          {t(K.files.entries, { count: rootEntries() })}
        </Text>
        <IconButton
          testID="files-refresh"
          label={t(K.files.refresh)}
          glyph="pulse"
          onPress={refresh}
        />
      </View>

      <If when={!!rootError()}>
        <View class="flex-row items-center gap-2 border-b border-line bg-inset px-3 py-1.5">
          <Glyph name="alert" size={11} tint={token("destructive")} />
          <Text testID="files-error" class="text-[11px] text-muted-foreground" style={{ flex: 1 }}>
            {t(K.files.error, { message: rootError()?.message ?? "" })}
          </Text>
        </View>
      </If>

      <List
        testID="file-list"
        each={rows()}
        keyExtractor={fileRowKey}
        style={{ flex: 1 }}
        contentClass="py-1"
      >
        {(row) => {
          const value: FileRow = row();
          if (value.kind === "loading") {
            return (
              <View class="flex-row items-center gap-2" style={{ height: 24, paddingLeft: 20 + value.depth * 14 }}>
                <Text class="text-[11px] text-faint">{t(K.files.loading)}</Text>
              </View>
            );
          }
          if (value.kind === "empty") {
            return (
              <View style={{ paddingLeft: 20 + value.depth * 14, paddingVertical: 4 }}>
                <Text class="text-[11px] text-faint">{t(K.files.empty)}</Text>
              </View>
            );
          }
          if (value.kind === "error") {
            return (
              <View class="flex-row items-center gap-1.5" style={{ paddingLeft: 20 + value.depth * 14, paddingVertical: 4 }}>
                <Glyph name="alert" size={10} tint={token("destructive")} />
                <Text class="text-[10.5px] text-muted-foreground" style={{ numberOfLines: 1 }}>
                  {failureText(value.error)}
                </Text>
              </View>
            );
          }
          const entry = value.entry;
          const isDir = entry.kind === "dir";
          const isOpen = isDir && expanded().includes(entry.path);
          const isSelected = selected() === entry.path;
          return (
            <View
              class="flex-row items-center"
              style={{ paddingLeft: 8 + value.depth * 14, paddingRight: 8, height: 26 }}
            >
              <View
                role="button"
                testID={
                  isDir
                    ? dirToggleTestId(relativeTo(shownRoot(), entry.path))
                    : fileRowTestId(relativeTo(shownRoot(), entry.path))
                }
                accessibilityLabel={entry.name}
                class={`h-[26px] flex-row items-center gap-1.5 rounded-lg px-1.5 ${
                  isSelected ? "bg-accent" : "hover:bg-hover"
                } active:opacity-70 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1`}
                style={{ flex: 1, ...motionStyle("fast") }}
                onPress={() => (isDir ? toggle(entry.path) : openFile(entry.path))}
              >
                {isDir ? (
                  <Glyph name={isOpen ? "caret-down" : "caret-right"} size={9} tint={token("faint")} />
                ) : (
                  <View style={{ width: 9 }} />
                )}
                <Glyph
                  name={isDir ? "folder" : "file"}
                  size={11.5}
                  tint={token(isDir ? "muted-foreground" : "faint")}
                />
                <Text
                  class={`text-[12px] ${isSelected ? "text-foreground" : "text-muted-foreground"}`}
                  style={{ flex: 1, numberOfLines: 1 }}
                >
                  {entry.name}
                </Text>
                <If when={!isDir}>
                  <Text class="text-[10px] tabular-nums text-faint">{formatBytes(entry.size)}</Text>
                </If>
              </View>
              <If when={!isDir}>
                <IconButton
                  testID={compareRowTestId(relativeTo(shownRoot(), entry.path))}
                  label={t(K.files.compare)}
                  glyph="diff"
                  tint="faint"
                  onPress={() => openCompare(entry.path)}
                />
              </If>
            </View>
          );
        }}
      </List>

      <View class="flex-row items-center gap-2 border-t border-line bg-inset px-3 py-1.5">
        <Glyph name="file" size={11} tint={token("faint")} />
        <Text
          testID="files-selected"
          class="text-[11px] text-muted-foreground"
          style={{ flex: 1, numberOfLines: 1 }}
        >
          {selected() ? relativeTo(shownRoot(), selected()!) : t(K.files.select)}
        </Text>
        <Action testID="files-compare" label={t(K.files.compare)} onPress={() => openCompare()} />
      </View>

      <Dialog
        testID="diff-dialog"
        open={compareOpen()}
        animation="fade"
        class="m-auto w-[480px] gap-3 rounded-xl border border-border bg-card p-5"
        style={{ boxShadow: shadowDialog() }}
        backdropClass="bg-scrim"
        onCancel={() => compareOpen.set(false)}
      >
        <Text class="text-[15px] font-semibold text-foreground">{t(K.files.dialogTitle)}</Text>
        <Text class="text-[11.5px] text-muted-foreground">{t(K.files.compareHint)}</Text>
        <Text class="text-[12px] text-muted-foreground">{t(K.files.pathA)}</Text>
        <Input
          testID="diff-path-a"
          value={pathA()}
          onChange={({ value }) => pathA.set(value)}
          placeholder={t(K.files.pathPlaceholder)}
          style={{
            height: 34,
            paddingHorizontal: 10,
            fontSize: 12,
            color: token("foreground"),
            placeholderColor: token("faint"),
            caretColor: token("primary"),
            borderWidth: 1,
            borderColor: token("border"),
            borderRadius: 8,
            backgroundColor: token("background"),
          }}
        />
        <Text class="text-[12px] text-muted-foreground">{t(K.files.pathB)}</Text>
        <Input
          testID="diff-path-b"
          value={pathB()}
          onChange={({ value }) => pathB.set(value)}
          placeholder={t(K.files.pathPlaceholder)}
          style={{
            height: 34,
            paddingHorizontal: 10,
            fontSize: 12,
            color: token("foreground"),
            placeholderColor: token("faint"),
            caretColor: token("primary"),
            borderWidth: 1,
            borderColor: token("border"),
            borderRadius: 8,
            backgroundColor: token("background"),
          }}
        />
        <If when={!!compareError()}>
          <Text testID="diff-error" class="text-[11px] text-destructive">
            {compareError() ?? ""}
          </Text>
        </If>
        <View class="flex-row justify-end gap-2">
          <Action
            testID="diff-cancel"
            label={t(K.dialog.cancel)}
            onPress={() => compareOpen.set(false)}
          />
          <Action
            testID="diff-open"
            label={t(K.files.openDiff)}
            primary
            onPress={confirmCompare}
          />
        </View>
      </Dialog>
    </View>
  );
}

/** One file's editor: the document store, a find/replace bar, and the save
 * round-trip (`stat`, `write` with the version read, read-back). */
export function EditorBody(props: { sheetId: string }) {
  const parsed = editorSheetPath(props.sheetId);
  if (!parsed) {
    return (
      <View class="flex-1 items-center justify-center gap-1 bg-card">
        <Text class="text-[12px] text-muted-foreground">{t(K.editor.missing)}</Text>
        <Text class="text-[10.5px] font-mono text-faint">{props.sheetId}</Text>
      </View>
    );
  }
  const { containerId, path } = parsed;
  // A layout restored after a restart has the sheet but no document yet.
  // Untracked: this runs once, not on every edit of every document.
  effect(() => {
    if (!untracked(() => editorDocs())[props.sheetId]) ensureEditor(containerId, path);
  });
  const doc = () => editorDocs()[props.sheetId];
  const container = () => containers().find((row) => row.id === containerId);
  const root = () => container()?.cwd ?? "";
  const findOpen = signal(false);
  const query = signal("");
  const replacement = signal("");
  const searchResult = signal<EditorSearchResult | null>(null);
  const focused = signal(false);
  const hoverCard = signal<{ markdown: string; anchor: Bounds } | null>(null);
  let editor: EditorRef | undefined;
  let hoverSeq = 0;
  let definitionSeq = 0;
  let completionSeq = 0;

  // A definition or a Problems row asked this sheet to reveal a position; do
  // it once the document is ready (a newly opened sheet loads asynchronously).
  effect(() => {
    const target = pendingReveals()[props.sheetId];
    if (!target || !editor || doc()?.status !== "ready") return;
    editor.revealPosition(target.range.start, true);
    // A navigation (definition, a Problems row) should leave the caret's
    // editor taking the keyboard, as every editor does when it opens a target.
    editor.focus();
    clearPendingReveal(props.sheetId, target.nonce);
  });

  // Ctrl+Space is the editors' usual "show completions"; only the focused,
  // visible sheet answers, so split editors do not fight over the list.
  keymap.bind("ctrl+space", () => {
    if (focused() && isVisible(props.sheetId)) editor?.showCompletions();
  });

  const close = (): void => closeEditor(props.sheetId);
  const save = (): void => void saveEditor(props.sheetId);
  const reload = (): void => {
    reloadEditor(props.sheetId);
    searchResult.set(null);
  };
  const search = () =>
    findOpen() && query().trim().length > 0 ? { query: query(), caseSensitive: false } : null;
  const matches = () => {
    const result = searchResult();
    if (!result) return t(K.editor.noMatches);
    if (result.error) return result.error;
    return t(K.editor.matches, { count: result.count });
  };

  const realPath = (): string => doc()?.realPath || path;

  const askHover = (event: any): void => {
    if (!doc()?.realPath) return;
    const seq = ++hoverSeq;
    void lspHover(containerId, realPath(), event.position, doc()?.text ?? "")
      .then((result) => {
        if (seq !== hoverSeq) return;
        const parts: string[] = [];
        if (result?.markdown.trim()) parts.push(result.markdown);
        for (const diagnostic of event.diagnostics ?? []) {
          parts.push(`**${diagnostic.severity ?? "error"}** · ${diagnostic.message}`);
        }
        if (parts.length === 0) {
          hoverCard.set(null);
          return;
        }
        hoverCard.set({ markdown: parts.join("\n\n---\n\n"), anchor: event.pageBounds });
      })
      .catch(() => {
        if (seq === hoverSeq) hoverCard.set(null);
      });
  };

  const askDefinition = (event: any): void => {
    const seq = ++definitionSeq;
    void lspDefinition(containerId, realPath(), event.position, doc()?.text ?? "")
      .then((target) => {
        if (seq !== definitionSeq) return;
        if (event.trigger === "hover") {
          // The underline is over the word under the pointer in *this*
          // document; the target's range may be in another file.
          if (target) editor?.presentDefinitionLink(event.id, event.range);
          else editor?.hideDefinitionLink();
          return;
        }
        if (!target) return;
        const targetPath = editorPathFor(containerId, target.path);
        const targetSheet = editorSheetId(containerId, targetPath);
        if (targetSheet === props.sheetId) {
          editor?.revealPosition(target.target.start, true);
          return;
        }
        openEditorSheet(containerId, targetPath);
        requestReveal(targetSheet, target.target);
      })
      .catch(() => {});
  };

  const askCompletion = (event: any): void => {
    const seq = ++completionSeq;
    void lspCompletion(
      containerId,
      realPath(),
      event.position,
      doc()?.text ?? "",
      event.trigger,
      event.character ?? null,
    )
      .then((result: LspCompletionResult) => {
        // The editor drops a stale id itself; this also drops an older
        // answer that arrived after a newer question.
        if (seq !== completionSeq) return;
        editor?.presentCompletions(event.id, result.items, result.incomplete);
      })
      .catch(() => {
        if (seq === completionSeq) editor?.presentCompletions(event.id, []);
      });
  };

  return (
    <View class="flex-1 bg-card">
      <View class="flex-row items-center gap-2 border-b border-line px-3 py-1.5">
        <Glyph name="file" size={12} tint={token("muted-foreground")} />
        <View style={{ flex: 1 }}>
          <View class="flex-row items-center gap-1.5">
            <Text testID="editor-name" class="text-[12px] font-semibold text-foreground" style={{ numberOfLines: 1 }}>
              {baseName(path)}
            </Text>
            <If when={doc()?.dirty ?? false}>
              <View
                testID="editor-dirty-dot"
                accessibilityLabel={t(K.editor.modified)}
                style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: token("primary") }}
              />
            </If>
          </View>
          <Text class="text-[10px] font-mono text-faint" style={{ numberOfLines: 1 }}>
            {doc()?.root ? relativeTo(doc()!.root, path) : path}
          </Text>
        </View>
        <Action testID="editor-find" label={t(K.editor.find)} onPress={() => findOpen.set(!findOpen())} />
        <Action
          testID="editor-save"
          label={doc()?.status === "saving" ? t(K.editor.saving) : t(K.editor.save)}
          primary
          disabled={!doc()?.dirty || (doc()?.readonly ?? true) || doc()?.status === "saving"}
          onPress={save}
        />
        <Action testID="editor-reload" label={t(K.editor.reload)} onPress={reload} />
        <IconButton testID="editor-close" label={t(K.editor.close)} glyph="close" onPress={close} />
      </View>

      <If when={doc()?.status === "loading"}>
        <View testID="editor-loading" class="flex-1 items-center justify-center gap-1">
          <Text class="text-[12px] text-muted-foreground">{t(K.editor.loading)}</Text>
        </View>
      </If>

      <If when={doc()?.status !== "loading"}>
        <If when={!!doc()?.error}>
          <View class="flex-row items-center gap-2 border-b border-line bg-inset px-3 py-1.5">
            <Glyph
              name="alert"
              size={11}
              tint={token(doc()?.conflict ? "warn" : "destructive")}
            />
            <Text
              testID={doc()?.conflict ? "editor-conflict" : "editor-error"}
              class="text-[11px] text-muted-foreground"
              style={{ flex: 1 }}
            >
              {doc()?.error ? failureText(doc()!.error!) : ""}
            </Text>
            <If when={doc()?.readonly ?? false}>
              <Text testID="editor-readonly" class="text-[10px] font-medium text-warn">
                {t(K.editor.readOnly)}
              </Text>
            </If>
            <If when={doc()?.conflict ?? false}>
              <Action testID="editor-conflict-reload" label={t(K.editor.reload)} onPress={reload} />
            </If>
          </View>
        </If>

        <If when={findOpen()}>
          <View class="flex-row items-center gap-1.5 border-b border-line bg-inset px-3 py-1.5">
            <Input
              testID="editor-find-query"
              value={query()}
              onChange={({ value }) => query.set(value)}
              placeholder={t(K.editor.findPlaceholder)}
              style={searchInputStyle}
            />
            <Text testID="editor-find-count" class="text-[10.5px] tabular-nums text-faint" style={{ width: 86 }}>
              {matches()}
            </Text>
            <IconButton
              testID="editor-find-previous"
              label={t(K.editor.previous)}
              glyph="chevron-left"
              onPress={() => editor?.run("findPrevious")}
            />
            <IconButton
              testID="editor-find-next"
              label={t(K.editor.next)}
              glyph="chevron-right"
              onPress={() => editor?.run("findNext")}
            />
            <Input
              testID="editor-find-replace"
              value={replacement()}
              onChange={({ value }) => replacement.set(value)}
              placeholder={t(K.editor.replacePlaceholder)}
              style={searchInputStyle}
            />
            <Action
              testID="editor-replace"
              label={t(K.editor.replace)}
              onPress={() => editor?.replace(replacement())}
            />
            <Action
              testID="editor-replace-all"
              label={t(K.editor.replaceAll)}
              onPress={() => void editor?.replaceAll(replacement())}
            />
          </View>
        </If>

        <Editor
          ref={(next) => {
            editor = next;
          }}
          testID="editor-view"
          class="flex-1"
          value={doc()?.text ?? ""}
          language={languageFor(path)}
          readOnly={doc()?.readonly ?? true}
          autoFocus={doc()?.readonly === false && isVisible(props.sheetId)}
          folding
          softWrap={false}
          lineNumbers
          indentGuides
          activeLine
          fontFamily={SHEET_FONT}
          fontSize={13}
          lineHeight={20}
          accessibilityLabel={baseName(path)}
          search={search()}
          completion
          completionTriggerCharacters={[".", ":"]}
          diagnostics={doc()?.realPath ? diagnosticsFor(containerId, doc()!.realPath!) : []}
          onSearchChange={({ result }) => searchResult.set(result)}
          onChange={({ value }) => setEditorText(props.sheetId, value)}
          onFocus={() => focused.set(true)}
          onBlur={() => focused.set(false)}
          onHover={askHover}
          onHoverEnd={() => {
            hoverSeq += 1;
            hoverCard.set(null);
          }}
          onDefinitionRequest={askDefinition}
          onCompletionRequest={askCompletion}
        />

        <View class="flex-row items-center gap-3 border-t border-line bg-inset px-3 py-1">
          <Text testID="editor-language" class="text-[10px] text-faint">
            {t(K.editor.language, { language: languageFor(path) })}
          </Text>
          <Text class="text-[10px] text-faint">
            {t(K.editor.lines, { count: (doc()?.text ?? "").split("\n").length })}
          </Text>
          <Text class="text-[10px] text-faint">{formatBytes(doc()?.size ?? 0)}</Text>
          <Text class="text-[10px] text-faint">{doc()?.encoding ?? "utf-8"}</Text>
          <Text testID="editor-diagnostics" class="text-[10px] text-faint">
            {t(K.editor.diagnostics, {
              count: doc()?.realPath ? diagnosticsFor(containerId, doc()!.realPath!).length : 0,
            })}
          </Text>
          <View style={{ flex: 1 }} />
          <Text
            testID="editor-state"
            class="text-[10px] text-faint"
          >
            {doc()?.status === "saving"
              ? t(K.editor.saving)
              : doc()?.dirty
                ? t(K.editor.modified)
                : t(K.editor.saved)}
          </Text>
        </View>
      </If>

      <If when={hoverCard() !== null}>
        <HoverCard
          markdown={hoverCard()!.markdown}
          anchor={hoverCard()!.anchor}
          onClose={() => {
            hoverSeq += 1;
            hoverCard.set(null);
          }}
        />
      </If>
    </View>
  );
}

/** Whether `panel` is the displayed tab of its group (a snapshot for autofocus). */
function isVisible(panel: string): boolean {
  return visiblePanels().includes(panel);
}

const searchInputStyle = {
  height: 28,
  width: 170,
  paddingHorizontal: 8,
  fontSize: 11.5,
  color: token("foreground"),
  placeholderColor: token("faint"),
  caretColor: token("primary"),
  borderWidth: 1,
  borderColor: token("border"),
  borderRadius: 8,
  backgroundColor: token("background"),
};

/** The two-file diff: real `DiffView` over both files' text. */
export function DiffBody(props: { sheetId: string }) {
  const parsed = diffSheetPaths(props.sheetId);
  if (!parsed) {
    return (
      <View class="flex-1 items-center justify-center gap-1 bg-card">
        <Text class="text-[12px] text-muted-foreground">{t(K.diff.error, { code: "ERR_FS_PATH", message: props.sheetId })}</Text>
      </View>
    );
  }
  const { containerId, oldPath, newPath } = parsed;
  const container = () => containers().find((row) => row.id === containerId);
  const root = () => container()?.cwd ?? "";
  const base = signal("");
  const state = signal<
    | { status: "loading" }
    | { status: "ready"; oldText: string; newText: string; encoding: string }
    | { status: "error"; error: FsFailure }
  >({ status: "loading" });
  const layout = signal<DiffLayout>("split");
  const stats = signal<DiffStats | null>(null);
  const retry = signal(0);
  let alive = true;
  cleanup(() => {
    alive = false;
  });

  effect(() => {
    retry();
    state.set({ status: "loading" });
    stats.set(null);
    const workspace = root();
    if (!workspace) {
      state.set({ status: "error", error: { code: "ERR_FS_ROOT", message: "no workspace root" } });
      return;
    }
    void canonicalRoot(workspace)
      .then((canonical) => {
        if (!alive) return null;
        base.set(canonical);
        return Promise.all([readText(canonical, oldPath), readText(canonical, newPath)]);
      })
      .then((files) => {
        if (!alive || !files) return;
        const [oldFile, newFile] = files;
        state.set({
          status: "ready",
          oldText: oldFile.text,
          newText: newFile.text,
          encoding: oldFile.encoding,
        });
      })
      .catch((error: unknown) => {
        if (!alive) return;
        state.set({ status: "error", error: failure(error) });
      });
  });

  const body = () => state();
  return (
    <View class="flex-1 bg-card">
      <View class="flex-row items-center gap-2 border-b border-line px-3 py-1.5">
        <Glyph name="diff" size={12} tint={token("muted-foreground")} />
        <View style={{ flex: 1 }}>
          <Text class="text-[11.5px] font-medium text-foreground" style={{ numberOfLines: 1 }}>
            {`${t(K.diff.old)} · ${relativeTo(base() || root(), oldPath)}`}
          </Text>
          <Text class="text-[11.5px] font-medium text-foreground" style={{ numberOfLines: 1 }}>
            {`${t(K.diff.new)} · ${relativeTo(base() || root(), newPath)}`}
          </Text>
        </View>
        <Text testID="diff-stats" class="text-[10.5px] tabular-nums text-muted-foreground">
          {stats()
            ? t(K.diff.stats, {
                added: stats()!.added,
                deleted: stats()!.deleted,
                hunks: stats()!.hunks,
              })
            : ""}
        </Text>
        <Action
          testID="diff-split"
          label={t(K.diff.split)}
          primary={layout() === "split"}
          onPress={() => layout.set("split")}
        />
        <Action
          testID="diff-unified"
          label={t(K.diff.unified)}
          primary={layout() === "unified"}
          onPress={() => layout.set("unified")}
        />
        <IconButton testID="diff-reload" label={t(K.editor.reload)} glyph="pulse" onPress={() => retry.set(retry() + 1)} />
      </View>

      <If when={body().status === "loading"}>
        <View testID="diff-loading" class="flex-1 items-center justify-center">
          <Text class="text-[12px] text-muted-foreground">{t(K.diff.loading)}</Text>
        </View>
      </If>
      <If when={body().status === "error"}>
        <View testID="diff-error-state" class="flex-1 items-center justify-center gap-1 px-6">
          <Glyph name="alert" size={18} tint={token("destructive")} />
          <Text class="text-center text-[12px] text-muted-foreground">
            {failureText((body() as { error: FsFailure }).error)}
          </Text>
        </View>
      </If>
      <If when={body().status === "ready"}>
        <DiffView
          testID="diff-view"
          class="flex-1"
          oldValue={(body() as { oldText: string }).oldText}
          newValue={(body() as { newText: string }).newText}
          language={languageFor(oldPath)}
          layout={layout()}
          inline="word"
          contextLines={3}
          lineNumbers
          background
          softWrap={false}
          fontFamily={SHEET_FONT}
          fontSize={13}
          lineHeight={20}
          onStatsChange={({ stats: next }) => stats.set(next)}
        />
        <View class="flex-row items-center gap-2 border-t border-line bg-inset px-3 py-1">
          <Text class="text-[10px] text-faint">{baseName(oldPath)}</Text>
          <Text class="text-[10px] text-faint">{baseName(newPath)}</Text>
          <View style={{ flex: 1 }} />
          <If when={(stats()?.hunks ?? 0) === 0}>
            <Text testID="diff-same" class="text-[10px] text-faint">
              {t(K.diff.same)}
            </Text>
          </If>
        </View>
      </If>
    </View>
  );
}
