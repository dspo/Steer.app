import { TextView } from "nsh/base";
import { effect, Overlay, Scroll, token, View, Text, type Bounds } from "nsh";
import { appendSheet } from "../stores/dock";
import { activeContainerId, containers, layout, noteSheetOpened, setLayout } from "../stores/containers";
import { editorSheetId, editorPathFor, openEditorSheet } from "../stores/editors";
import { relativeTo } from "../stores/fs";
import { K, t } from "../ui/i18n";
import {
  ensureContainerLsp,
  lspContainerState,
  lspServerList,
  problemCounts,
  problemsFor,
  requestReveal,
  restartLsp,
  type LspServerInfo,
  type ProblemRow,
} from "../stores/lsp";
import {
  Dot,
  Glyph,
  motionStyle,
  shadowRaised,
  SheetAction as Action,
  SheetIconButton as IconButton,
} from "../ui/ui";

/**
 * The LSP surfaces: the hover card over an editor and the Problems sheet.
 *
 * Both draw only what `lsp.ts` holds (server state, published diagnostics);
 * neither talks to a language server itself. The hover card is the
 * `Editor.onHover` answer shown in an `Overlay` anchored to the word's
 * `pageBounds`, with a `TextView` for Markdown and signature code, as the
 * M11 design asks.
 */

/** The hover card over the hovered word: Markdown in a `TextView`, anchored. */
export function HoverCard(props: {
  markdown: string;
  anchor: Bounds;
  onClose: () => void;
}) {
  return (
    <Overlay
      anchor={props.anchor}
      placement="bottom"
      align="start"
      offset={6}
      margin={8}
      onPressOutside={props.onClose}
      onCancel={props.onClose}
    >
      <View
        testID="editor-hover"
        accessibilityLabel={t(K.editor.hover)}
        class="rounded-xl border border-line bg-popover"
        style={{
          width: 430,
          maxHeight: 300,
          overflow: "hidden",
          boxShadow: shadowRaised(),
        }}
      >
        <Scroll style={{ maxHeight: 300 }} contentStyle={{ paddingHorizontal: 12, paddingVertical: 10 }}>
          <TextView
            markdown={props.markdown}
            selectable
            codeBlockScrollbar={false}
            styles={{
              root: { gap: 6, fontSize: 12, lineHeight: 18, color: token("foreground") },
              code: { color: token("code") },
              codeBlockCode: { color: token("code") },
              link: { color: token("brand") },
            }}
            classes={{ codeBlock: "bg-inset rounded-lg" }}
          />
        </Scroll>
      </View>
    </Overlay>
  );
}

/** Opens (or shows) a container's Problems sheet. */
export function openProblemsSheet(containerId: string | null = activeContainerId()): void {
  if (!containerId) return;
  setLayout(appendSheet(layout(), `problems:${containerId}`));
  noteSheetOpened(`problems:${containerId}`);
}

/** The test id of a Problems row (paths contain characters selectors split on). */
function problemRowTestId(row: ProblemRow): string {
  return `problems-row-${row.id.replace(/[^A-Za-z0-9]+/g, "-")}`;
}

function severityTint(row: ProblemRow): string {
  if (row.severity === "error") return token("destructive");
  if (row.severity === "warning") return token("warn");
  if (row.severity === "info") return token("info");
  return token("muted-foreground");
}

function severityLabel(row: ProblemRow): string {
  if (row.severity === "error") return t(K.lsp.severityError);
  if (row.severity === "warning") return t(K.lsp.severityWarning);
  if (row.severity === "info") return t(K.lsp.severityInfo);
  return t(K.lsp.severityHint);
}

function serverStateLabel(server: LspServerInfo): string {
  switch (server.state) {
    case "starting":
      return t(K.lsp.stateStarting);
    case "ready":
      return server.progress ? server.progress : t(K.lsp.stateReady);
    case "error":
      return t(K.lsp.stateError);
    default:
      return t(K.lsp.stateStopped);
  }
}

function serverTint(server: LspServerInfo): string {
  if (server.state === "error") return token("destructive");
  if (server.state === "ready") return server.progress ? token("info") : token("up");
  if (server.state === "starting") return token("warn");
  return token("muted-foreground");
}

/**
 * One container's diagnostics, from every open editor, ordered by severity,
 * file and line. A row opens the file (through `editors.ts`, so the same
 * sheet is reused) and asks it to reveal the range. The header reports the
 * real servers (`rust-analyzer`/`typescript-language-server`/`gopls`), their
 * indexing progress and how to restart them; the empty, loading, no-server
 * and server-error states each say what is happening instead of showing a
 * blank list.
 */
export function ProblemsBody(props: { containerId: string }) {
  const container = () => containers().find((row) => row.id === props.containerId);
  const root = () => container()?.cwd ?? "";
  const rows = () => problemsFor(props.containerId);
  const counts = () => problemCounts(props.containerId);
  const servers = () => lspServerList(props.containerId);
  const state = () => lspContainerState(props.containerId);
  const indexing = () => servers().find((server) => server.progress !== null)?.progress ?? null;
  const errorServer = () => servers().find((server) => server.state === "error") ?? null;

  // Problems is the second place a server may start (the first is a
  // supported file opening): project markers decide, never a file scan.
  effect(() => {
    const cwd = root();
    if (cwd) void ensureContainerLsp(props.containerId, cwd);
  });

  const open = (row: ProblemRow): void => {
    const path = editorPathFor(props.containerId, row.path);
    openEditorSheet(props.containerId, path);
    requestReveal(editorSheetId(props.containerId, path), row.range);
  };

  const restartAll = (): void => {
    for (const server of servers()) restartLsp(props.containerId, server.family);
  };

  return (
    <View class="flex-1 bg-card">
      <View class="flex-row items-center gap-2 border-b border-line px-3 py-1.5">
        <Glyph name="alert" size={12} tint={token("muted-foreground")} />
        <View style={{ flex: 1 }}>
          <Text testID="problems-title" class="text-[12px] font-semibold text-foreground" style={{ numberOfLines: 1 }}>
            {t(K.lsp.title)}
          </Text>
          <Text class="text-[10px] font-mono text-faint" style={{ numberOfLines: 1 }}>
            {root() || props.containerId}
          </Text>
        </View>
        <Text
          testID="problems-counts"
          class="text-[10.5px] tabular-nums text-muted-foreground"
        >
          {t(K.lsp.counts, { errors: counts().errors, warnings: counts().warnings })}
        </Text>
        <Action
          testID="problems-restart-all"
          label={t(K.lsp.restartAll)}
          disabled={servers().length === 0}
          onPress={restartAll}
        />
      </View>

      <If when={servers().length > 0}>
        <View class="border-b border-line bg-inset px-3 py-1.5" style={{ gap: 4 }}>
          <Each of={servers()} key={(server) => server.key}>
            {(server) => {
              const value = server();
              return (
                <View testID={`problems-server-${value.family}`} class="flex-row items-center gap-2">
                  <Dot tint={serverTint(value)} size={6} />
                  <Text class="text-[10.5px] font-medium text-foreground" style={{ numberOfLines: 1 }}>
                    {`${value.command} · ${value.family}`}
                  </Text>
                  <Text class="text-[10px] text-muted-foreground" style={{ flex: 1, numberOfLines: 1 }}>
                    {serverStateLabel(value)}
                  </Text>
                  <If when={value.error !== null}>
                    <Text
                      testID={`problems-server-error-${value.family}`}
                      class="text-[10px] text-muted-foreground"
                      style={{ maxWidth: 320, numberOfLines: 2 }}
                    >
                      {value.error ?? ""}
                    </Text>
                  </If>
                  <IconButton
                    testID={`problems-restart-${value.family}`}
                    label={t(K.lsp.restart)}
                    glyph="reload"
                    onPress={() => restartLsp(props.containerId, value.family)}
                  />
                </View>
              );
            }}
          </Each>
          <If when={indexing() !== null}>
            <Text testID="problems-indexing" class="text-[10px] text-faint" style={{ numberOfLines: 1 }}>
              {t(K.lsp.indexing, { server: indexing() ?? "" })}
            </Text>
          </If>
        </View>
      </If>

      <If when={state() === "starting"}>
        <View testID="problems-loading" class="items-center justify-center gap-1 px-4 py-10">
          <Text class="text-[12px] font-medium text-foreground">{t(K.lsp.loading)}</Text>
          <Text class="text-center text-[11px] text-faint">{t(K.lsp.loadingHint)}</Text>
        </View>
      </If>

      <If when={state() !== "starting"}>
        <If when={errorServer() !== null}>
          <View class="flex-row items-center gap-2 border-b border-line bg-inset px-3 py-1.5">
            <Glyph name="alert" size={11} tint={token("destructive")} />
            <Text testID="problems-server-error" class="text-[11px] text-muted-foreground" style={{ flex: 1 }}>
              {t(K.lsp.error, { message: errorServer()?.error ?? "" })}
            </Text>
            <Action
              testID="problems-server-retry"
              label={t(K.lsp.restart)}
              onPress={() => {
                const server = errorServer();
                if (server) restartLsp(props.containerId, server.family);
              }}
            />
          </View>
        </If>

        <Scroll style={{ flex: 1 }} contentStyle={{ paddingVertical: 2 }}>
          <If when={rows().length === 0}>
            <View testID="problems-empty" class="items-center gap-1 px-4 py-10">
              <Glyph name="check" size={18} tint={token("up")} />
              <Text class="text-[12px] font-medium text-foreground">{t(K.lsp.empty)}</Text>
              <Text class="text-center text-[11px] text-faint">
                {servers().length === 0 ? t(K.lsp.noServer) : t(K.lsp.emptyHint)}
              </Text>
            </View>
          </If>
          <Each of={rows()} key={(row) => row.id}>
            {(row) => {
              const value = row();
              return (
                <View
                  role="button"
                  testID={problemRowTestId(value)}
                  accessibilityLabel={`${severityLabel(value)}: ${value.message}`}
                  class="flex-row items-start gap-2 px-3 py-1.5 hover:bg-hover active:bg-accent focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[-1px]"
                  style={{ ...motionStyle("fast") }}
                  onPress={() => open(value)}
                >
                  <View style={{ marginTop: 2 }}>
                    <Dot tint={severityTint(value)} size={6} />
                  </View>
                  <View style={{ flex: 1, gap: 1 }}>
                    <Text class="text-[11.5px] text-foreground" style={{ numberOfLines: 3 }}>
                      {value.message}
                    </Text>
                    <Text class="text-[10px] font-mono text-faint" style={{ numberOfLines: 1 }}>
                      {`${relativeTo(root(), value.path)}:${value.line + 1}:${value.column + 1}`}
                    </Text>
                  </View>
                  <Text class="text-[10px] text-muted-foreground" style={{ numberOfLines: 1 }}>
                    {[value.source, value.code].filter(Boolean).join(" · ")}
                  </Text>
                </View>
              );
            }}
          </Each>
        </Scroll>
      </If>

      <View class="flex-row items-center gap-3 border-t border-line bg-inset px-3 py-1">
        <Text testID="problems-files" class="text-[10px] text-faint">
          {t(K.lsp.files, {
            count: new Set(rows().map((row) => row.path)).size,
          })}
        </Text>
        <View style={{ flex: 1 }} />
        <Text class="text-[10px] text-faint">{t(K.lsp.hint)}</Text>
      </View>
    </View>
  );
}
