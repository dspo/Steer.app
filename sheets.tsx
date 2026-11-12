import { Terminal, type TerminalRef } from "nsh/base";
import { cleanup, effect, Scroll, signal, Text, token, View } from "nsh";
import { sessionTitle, viewFor } from "./stores/sessions";
import { abortRun, loadSubagents, runs, selectedRunId, selectRun, transcript, subagentError } from "./stores/subagents";
import { visiblePanels } from "./stores/dock";
import { ChatView, MessageRow } from "./chat-view";
import { closeSheet, containers } from "./stores/containers";
import {
  attachTerminal,
  bindTerminalRef,
  defaultAction,
  detachTerminal,
  ensureTerminal,
  externalKindLabel,
  restartTerminal,
  setTerminalTitle,
  terminalAction,
  terminalActionLabel,
  terminalInfo,
  terminalSheetContainer,
  terminalTitle,
} from "./stores/terminals";
import { K, t } from "./ui/i18n";
import { HeroSheet } from "./hero";
import { Chip, Dot, Glyph, type GlyphName } from "./ui/ui";
import { DiffBody, EditorBody, FilesBody } from "./files";
import { browserTabTitle } from "./stores/browser";
import { BrowserBody } from "./browser-ui";
import { ChangesBody, HistoryBody } from "./git-ui";
import { ProblemsBody } from "./lsp-ui";
import { diffSheetPaths, editorSheetPath } from "./stores/editors";
import { baseName } from "./stores/fs";
import { SHEET_FONT } from "./ui/fonts";

/** The color tokens the registry tints glyphs with. */
type TintToken = "brand" | "warn" | "up" | "info" | "muted-foreground" | "primary-foreground" | "faint";

/**
 * The sheet registry: what a sheet kind is (its tab title, glyph, the
 * mock body's big line) and what the body renders. The dock canvas holds
 * sheet ids (`kind:instance`); the registry resolves them. Mock only:
 * every body is one line of text plus a counter that survives drags
 * (`renderPanel` renders once per key, so the component keeps its state
 * wherever the sheet moves).
 */

type SheetKind =
  | "home"
  | "session"
  | "terminal"
  | "webview"
  | "editor"
  | "diff"
  | "files"
  | "changes"
  | "history"
  | "problems"
  | "subagents"
  | "tasks"
  | "traces"
  | "stats";

interface SheetSpec {
  /** The tab title's copy key. */
  title: string;
  glyph: GlyphName;
  /** The glyph's tint token. */
  tint: TintToken;
  /** The dim line under the body's big line. */
  note: string;
}

const SPECS: Record<SheetKind, SheetSpec> = {
  home: { title: K.sheet.homeTitle, glyph: "pi", tint: "brand", note: K.sheet.homeNote },
  session: { title: K.sheet.sessionTitle, glyph: "chat", tint: "brand", note: K.sheet.sessionNote },
  terminal: { title: K.sheet.terminalTitle, glyph: "terminal", tint: "muted-foreground", note: K.sheet.terminalNote },
  webview: { title: K.sheet.webviewTitle, glyph: "globe", tint: "info", note: K.sheet.webviewNote },
  editor: { title: K.sheet.editorTitle, glyph: "file", tint: "muted-foreground", note: K.sheet.editorNote },
  diff: { title: K.sheet.diffTitle, glyph: "diff", tint: "muted-foreground", note: K.sheet.diffNote },
  files: { title: K.sheet.filesTitle, glyph: "folder", tint: "muted-foreground", note: K.sheet.filesNote },
  changes: { title: K.sheet.changesTitle, glyph: "diff", tint: "muted-foreground", note: K.sheet.changesNote },
  history: { title: K.sheet.historyTitle, glyph: "commit", tint: "muted-foreground", note: K.sheet.historyNote },
  problems: { title: K.sheet.problemsTitle, glyph: "alert", tint: "warn", note: K.sheet.problemsNote },
  subagents: { title: K.sheet.subagentsTitle, glyph: "branch", tint: "muted-foreground", note: K.sheet.subagentsNote },
  tasks: { title: K.sheet.tasksTitle, glyph: "archive", tint: "muted-foreground", note: K.sheet.tasksNote },
  traces: { title: K.sheet.tracesTitle, glyph: "tree", tint: "muted-foreground", note: K.sheet.tracesNote },
  stats: { title: K.sheet.statsTitle, glyph: "pulse", tint: "muted-foreground", note: K.sheet.statsNote },
};

/** Splits a sheet id (`kind:instance`) into its kind and instance. */
function sheetParts(id: string): { kind: SheetKind; instance: string } {
  const at = id.indexOf(":");
  const kind = (at < 0 ? id : id.slice(0, at)) as SheetKind;
  return { kind, instance: at < 0 ? "" : id.slice(at + 1) };
}

/** A sheet's tab title, by id. */
export function sheetTitle(id: string): string {
  const { kind, instance } = sheetParts(id);
  // Every Hero tab reads the same: the start page, not a place.
  if (kind === "home") return t(K.sheet.homeTitle);
  if (kind === "session") {
    return instance ? sessionTitle(instance) : t(K.sheet.sessionTitle);
  }
  if (kind === "subagents") return t(K.subagents.title);
  if (kind === "terminal") {
    if (!instance) return t(K.sheet.terminalTitle);
    const live = terminalTitle(id);
    if (live) return live;
    const container = containers().find((row) => row.id === terminalSheetContainer(id));
    return container ? externalKindLabel(container.kind) : t(K.sheet.terminalTitle);
  }
  if (kind === "webview") return browserTabTitle(id);
  if (kind === "editor") {
    const target = editorSheetPath(id);
    return target ? baseName(target.path) : id;
  }
  if (kind === "diff") {
    const pair = diffSheetPaths(id);
    return pair ? `${baseName(pair.oldPath)} ↔ ${baseName(pair.newPath)}` : id;
  }
  if (kind === "problems") {
    const container = containers().find((row) => row.id === instance);
    const folder = container ? baseName(container.cwd) : "";
    return folder ? `${t(K.sheet.problemsTitle)} · ${folder}` : t(K.sheet.problemsTitle);
  }
  if (kind === "files" || kind === "changes" || kind === "history") {
    const container = containers().find((row) => row.id === instance);
    const folder = container ? baseName(container.cwd) : "";
    const title = t(SPECS[kind].title);
    return folder ? `${title} · ${folder}` : title;
  }
  const spec = SPECS[kind];
  return spec ? (instance ? `${t(spec.title)} · ${instance}` : t(spec.title)) : id;
}

/** A sheet's tab glyph, by id. */
export function sheetGlyph(id: string): GlyphName {
  const { kind } = sheetParts(id);
  return SPECS[kind]?.glyph ?? "file";
}

/** The kinds the canvas toolbar offers. */
/**
 * A sheet's mock body: the registry's big line, the id dimmed, and a
 * counter whose presses survive the sheet moving between panels —
 * `renderPanel` is keyed by id, so the component never remounts on a
 * move. A real sheet renders its domain store here instead.
 */
export function SheetBody(props: { id: string }) {
  const taps = signal(0);
  const { kind, instance } = sheetParts(props.id);
  const spec = SPECS[kind];
  if (kind === "home") return <HeroSheet id={props.id} />;
  if (kind === "session") return <SessionBody id={instance || "pending"} sheetId={props.id} />;
  if (kind === "subagents") return <SubagentsBody containerId={instance} />;
  if (kind === "terminal") return <TerminalBody id={props.id} />;
  if (kind === "webview") return <BrowserBody id={props.id} />;
  if (kind === "files") return <FilesBody containerId={instance} />;
  if (kind === "changes") return <ChangesBody containerId={instance} />;
  if (kind === "history") return <HistoryBody containerId={instance} />;
  if (kind === "problems") return <ProblemsBody containerId={instance} />;
  if (kind === "editor") return <EditorBody sheetId={props.id} />;
  if (kind === "diff") return <DiffBody sheetId={props.id} />;
  return (
    <View
      class="flex-1 items-center justify-center gap-3 bg-card"
      role="button"
      accessibilityLabel={`Sheet ${props.id}`}
      onPress={() => taps.set(taps() + 1)}
    >
      <View
        class="items-center justify-center rounded-2xl"
        style={{ width: 52, height: 52, backgroundColor: token("muted") }}
      >
        <Glyph name={spec.glyph} size={24} tint={token(spec.tint)} />
      </View>
      <Text class="text-base font-semibold text-foreground">{t(spec.title)}</Text>
      <Text class="text-xs text-muted-foreground">{t(spec.note)}</Text>
      <Text class="text-[11px] font-mono text-faint">{props.id}</Text>
      <Text class="text-[11px] tabular-nums text-faint">{t(K.sheet.taps, { count: taps() })}</Text>
    </View>
  );
}

/**
 * A real terminal: one terminal resource of a container, drawn by
 * `nsh/base`'s `Terminal` (its `VtEmulator`). Bytes go straight from
 * `zu/native` to the emulator; the sheet never sees the engine wire. A
 * container holds several (`terminal:{containerId}:{n}`): a shell beside an
 * agent's TUI is two sheets of one container, not two sidebar rows.
 *
 * The `Terminal` stays mounted while its tab is hidden: the emulator must
 * keep the alternate screen and scrollback a TUI set, and the base
 * component's virtual list only paints the displayed tab. Switching
 * containers unmounts the sheet; the PTY survives in `terminals.ts`, and the
 * replay buffer rebuilds the screen when the sheet mounts again. There is no
 * supported "keep the emulator, skip its paint" hook to add beyond that, so
 * the emulator is never paused; hiding a tab costs no PTY work.
 */
export function TerminalBody(props: { id: string }) {
  const containerId = () => terminalSheetContainer(props.id) ?? "";
  const container = () => containers().find((row) => row.id === containerId());
  const info = () => terminalInfo()[props.id];
  const visible = () => visiblePanels().includes(props.id);
  const action = () => terminalAction(props.id) ?? defaultAction(container()!.kind);
  // The handle exists before the emulator binds (it replays the buffer), and
  // a sheet still mounted for the frame after its container was archived
  // must not restart a PTY the archive just ended.
  const handle =
    container() && !container()!.archived ? ensureTerminal(props.id, container()!) : undefined;
  let term: TerminalRef | undefined;

  // A TUI agent's process is the sheet: when it exits, its tab goes with it.
  // (A plain shell's exit follows the same rule; the container stays so its
  // history is not silently archived.)
  effect(() => {
    const current = info();
    if (current && !current.running && current.exitCode !== null) {
      closeSheet(props.id);
    }
  });

  // The sheet going away (a closed tab, a project switch that drops the
  // container) detaches the Terminal without killing the shell: the store
  // decides, through archive and metadata reconciliation, when it dies.
  cleanup(() => detachTerminal(props.id));

  const bind = (ref: TerminalRef | undefined) => {
    term = ref;
    bindTerminalRef(props.id, ref);
    if (!ref) return;
    const replay = attachTerminal(props.id, (data) => {
      try {
        ref.write(data);
      } catch {
        // The emulator is gone while the callback still holds a stale ref.
      }
    });
    if (replay.reset) ref.reset();
    if (replay.buffer) ref.write(replay.buffer);
    if (visible()) ref.focus();
  };

  const restart = () => {
    const row = container();
    if (!row) return;
    restartTerminal(props.id, row);
    if (!term) return;
    // Reattach the existing emulator to the new PTY: reset first, then the
    // store's live sink replaces the old one.
    term.reset();
    const replay = attachTerminal(props.id, (data) => {
      try {
        term?.write(data);
      } catch {
        // Stale ref: the next mount replays the buffer.
      }
    });
    if (replay.reset) term.reset();
    if (replay.buffer) term.write(replay.buffer);
  };

  if (!container()) {
    return (
      <View class="flex-1 items-center justify-center gap-1 bg-card">
        <Text class="text-[12px] text-muted-foreground">{t(K.external.terminal)}</Text>
        <Text class="text-[11px] font-mono text-faint">{props.id}</Text>
      </View>
    );
  }

  const failure = info()?.error;
  if (failure) {
    return (
      <View class="flex-1 items-center justify-center gap-3 bg-card" accessibilityLabel={t(K.terminal.failed, { error: failure })}>
        <Glyph name="alert" size={20} tint={token("destructive")} />
        <Text class="max-w-[420px] text-center text-[12px] text-muted-foreground">
          {t(K.terminal.failed, { error: failure })}
        </Text>
        <View
          role="button"
          testID="terminal-restart"
          accessibilityLabel={t(K.terminal.restart)}
          class="rounded-lg border border-line px-2.5 py-1.5 hover:bg-hover active:opacity-70 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
          onPress={restart}
        >
          <Text class="text-[12px] font-medium text-foreground">{t(K.terminal.restart)}</Text>
        </View>
      </View>
    );
  }

  const running = () => info()?.running ?? true;
  return (
    <View class="flex-1 bg-background">
      <Terminal
        ref={bind}
        testID="terminal-view"
        scrollback={5000}
        fontFamily={SHEET_FONT}
        fontSize={13}
        lineHeight={18}
        accessibilityLabel={terminalActionLabel(action())}
        cursorClass="bg-foreground/50"
        class="flex-1 bg-background px-2 py-1.5"
        onData={({ data }) => {
          try {
            handle?.pty?.write(data);
          } catch {
            // A closed PTY rejects input; the status line says why.
          }
        }}
        onResize={({ cols, rows }) => {
          if (!visible() || cols < 1 || rows < 1) return;
          try {
            handle?.pty?.resize(cols, rows);
          } catch {
            // The program ended between the layout and the resize.
          }
        }}
        onTitleChange={({ title }) => setTerminalTitle(props.id, title)}
      />
      <If when={!running()}>
        <View class="flex-row items-center gap-2 border-t border-line bg-inset px-3 py-1.5">
          <Dot tint={token("faint")} size={6} />
          <Text class="flex-1 text-[11px] text-muted-foreground" style={{ numberOfLines: 1 }}>
            {t(K.terminal.exited, {
              code: info()?.exitCode ?? info()?.exitSignal ?? "—",
            })}
          </Text>
          <View
            role="button"
            testID="terminal-restart"
            accessibilityLabel={t(K.terminal.restart)}
            class="rounded-md border border-line px-2 py-1 hover:bg-hover active:opacity-70 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
            onPress={restart}
          >
            <Text class="text-[11px] font-medium text-foreground">{t(K.terminal.restart)}</Text>
          </View>
        </View>
      </If>
    </View>
  );
}

/** A subagent's status in the shell's language. */
function statusLabel(status: string): string {
  switch (status) {
    case "running":
      return t(K.subagents.running);
    case "settled":
      return t(K.subagents.settled);
    case "failed":
      return t(K.subagents.failed);
    case "aborted":
      return t(K.subagents.aborted);
    default:
      return t(K.subagents.interrupted);
  }
}

/** The roster: live and settled runs, with a read-only transcript. */
function SubagentsBody(props: { containerId: string }) {
  void loadSubagents(props.containerId);
  const selected = () => runs().find((run) => run.runId === selectedRunId());
  return (
    <View class="flex-1 flex-row bg-card">
      <View class="border-r border-line" style={{ width: 300 }}>
        {/* The tab already names the sheet; the header only counts runs. */}
        <View class="flex-row items-center gap-2 border-b border-line px-3 py-2">
          <Glyph name="branch" size={13} tint={token("muted-foreground")} />
          <Text class="flex-1 text-[11px] text-muted-foreground">{t(K.subagents.count, { count: runs().length })}</Text>
          <Chip label={String(runs().length)} />
        </View>
        <Scroll style={{ flex: 1 }} contentStyle={{ paddingVertical: 4 }}>
          <If
            when={runs().length === 0}
            else={
              <Each of={runs()} key={(run) => run.runId}>
                {(run) => {
                  const value = run();
                  const active = value.runId === selectedRunId();
                  return (
                    <View
                      role="button"
                      testID={`subagent-run-${value.runId}`}
                      accessibilityLabel={`Subagent ${value.agent} ${value.runId}`}
                      class={active ? "bg-accent" : "hover:bg-hover"}
                      style={{ paddingHorizontal: 12, paddingVertical: 7, gap: 2 }}
                      onPress={() => void selectRun(value.runId)}
                    >
                      <View class="flex-row items-center gap-1.5">
                        <Dot tint={token(value.status === "running" ? "info" : value.status === "settled" ? "up" : "destructive")} size={6} />
                        <Text class="text-[12px] font-medium text-foreground" style={{ flex: 1, numberOfLines: 1 }}>
                          {value.agent}
                        </Text>
                        <Text class="text-[10px] text-faint">{statusLabel(value.status)}</Text>
                      </View>
                      <Text class="text-[10.5px] text-muted-foreground" style={{ numberOfLines: 1 }}>
                        {value.task}
                      </Text>
                      <Text class="text-[10px] font-mono text-faint">{value.runId}</Text>
                    </View>
                  );
                }}
              </Each>
            }
          >
            <Text class="px-3 py-4 text-[11.5px] text-muted-foreground">{t(K.subagents.empty)}</Text>
          </If>
        </Scroll>
      </View>
      <View class="flex-1">
        <If
          when={!!selected()}
          else={
            <View class="flex-1 items-center justify-center gap-1">
              <Text class="text-[12px] text-muted-foreground">{t(K.subagents.transcript)}</Text>
            </View>
          }
        >
          <View class="flex-row items-center gap-2 border-b border-line px-3 py-2">
            <View style={{ flex: 1 }}>
              <Text class="text-[12px] font-semibold text-foreground">{`${selected()?.agent ?? ""} · ${selectedRunId() ?? ""}`}</Text>
              <Text class="text-[10.5px] text-muted-foreground" style={{ numberOfLines: 1 }}>
                {selected()?.task ?? ""}
              </Text>
            </View>
            <If when={selected()?.status === "running"}>
              <View
                role="button"
                testID="subagent-abort"
                accessibilityLabel={t(K.subagents.abort)}
                class="rounded-md border border-line px-2 py-1 hover:bg-hover"
                onPress={() => selectedRunId() && void abortRun(selectedRunId()!)}
              >
                <Text class="text-[11px] text-destructive">{t(K.subagents.abort)}</Text>
              </View>
            </If>
          </View>
          <Scroll style={{ flex: 1 }} contentStyle={{ paddingHorizontal: 16, paddingVertical: 10, gap: 8 }}>
            <Each of={transcript()} key="index">
              {(message) => (
                <MessageRow message={message} streaming={() => false} />
              )}
            </Each>
          </Scroll>
        </If>
      </View>
    </View>
  );
}

/**
 * The conversation sheet. A sheet that is not the displayed tab of its group
 * (or is behind a zoom) draws only a compact placeholder: its view keeps
 * updating in the store, but the Markdown tree and the composer are not
 * mounted until it is visible again. The visible surface is `ChatView`:
 * Steer's hero while empty, the transcript and footer composer after.
 */
export function SessionBody(props: { id: string; sheetId: string }) {
  const view = () => viewFor(props.id);
  const visible = () => visiblePanels().includes(props.sheetId);
  return (
    <View class="flex-1 bg-background">
      <If when={!visible()}>
        <View class="flex-1 items-center justify-center gap-2 bg-background">
          <Glyph name="chat" size={20} tint={token("faint")} />
          <Text class="text-[12px] font-medium text-muted-foreground">{sessionTitle(props.id)}</Text>
          <Text class="text-[11px] text-faint">{t(K.session.hidden, { count: view()?.messages.length ?? 0 })}</Text>
        </View>
      </If>
      <If when={visible()}>
        <ChatView id={props.id} />
      </If>
    </View>
  );
}
