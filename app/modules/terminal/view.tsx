import type { NativeComponentRef } from "nsh";
import { surfaceView, TerminalSurface, type TerminalSnapshot } from "../../domains/terminal";
import { Clipboard, cleanup, effect, signal, Text, token, View } from "nsh";
import { Input } from "nsh/base";
import {
  bindTerminalView,
  endTerminalFind,
  findInTerminal,
  setNotificationHandler,
  stepTerminalFind,
  type TerminalFindState,
  closeTerminalsOfContainer,
  defaultAction,
  pasteIntoTerminal,
  ensureTerminal,
  reconcileTerminalsByIds,
  registerTerminal,
  restartTerminal,
  setProgramExitHandler,
  terminalAction,
  terminalActionLabel,
  terminalInfo,
  terminalSheetContainer,
  terminalSheetId,
  terminalTitle,
  type TerminalAction,
  type TerminalViewRef,
} from "../../domains/pty";
import {
  closeSheet,
  containerOfSheet,
  containers,
  createContainerRecord,
  layout,
  noteSheetOpened,
  openSheet,
  projectCwd,
  setLayout,
} from "../../core/containers";
import { appendSheet, panelIds, replaceSheet, visiblePanels } from "../../core/dock";
import { scratchCwd } from "../../core/workspace";
import { K, t } from "../../ui/i18n";
import { Dot, Glyph, SheetIconButton } from "../../ui/ui";
import { notifySettled } from "../../core/notifications";
import { dispatchIntent } from "../../core/registry";
import { SHEET_MONO } from "../../ui/fonts";
import type { LaunchContext, SheetModule } from "../../../contracts/module";

/**
 * The terminal sheet (`terminal:{containerId}:{n}`): one terminal resource of
 * a container, drawn by the native `zu.terminal` view from the store's
 * `TerminalSession`. Output and keys go between the session and the view in
 * Rust; the sheet names the session, its face and colors, and carries what
 * leaves the terminal: the clipboard, links (into the container's browser
 * sheet) and the find bar.
 * A container holds several: a shell beside an agent's TUI is two sheets of
 * one container, not two sidebar rows.
 *
 * The session outlives the sheet: switching containers unmounts the view,
 * and the next mount draws the screen, scrollback and modes the program left.
 */
export function TerminalBody(props: { id: string }) {
  const containerId = () => terminalSheetContainer(props.id) ?? "";
  const container = () => containers().find((row) => row.id === containerId());
  const info = () => terminalInfo()[props.id];
  const visible = () => visiblePanels().includes(props.id);
  const action = () => terminalAction(props.id) ?? defaultAction();
  // A sheet still mounted for the frame after its container was archived
  // must not restart a program the archive just ended.
  if (container() && !container()!.archived) ensureTerminal(props.id, container()!);
  let view: TerminalViewRef | undefined;
  let answer: ((s: TerminalSnapshot) => void) | undefined;
  // The find bar: open while `finding`, the needle and where it stands.
  const finding = signal(false);
  const needle = signal("");
  const found = signal<TerminalFindState>({ total: 0, index: null });
  const find = (text: string) => {
    needle.set(text);
    found.set(findInTerminal(props.id, text));
  };
  const step = (by: number) => {
    if (!finding()) finding.set(true);
    if (needle()) found.set(stepTerminalFind(props.id, by));
  };
  const closeFind = () => {
    finding.set(false);
    endTerminalFind(props.id);
    found.set({ total: 0, index: null });
    view?.focus();
  };

  // Becoming the displayed tab hands the sheet the keyboard: a terminal the
  // user is looking at is where typing should go.
  effect(() => {
    if (visible() && view) view.focus();
  });

  // A TUI agent's process is the sheet: when it exits, its tab goes with it.
  effect(() => {
    const current = info();
    if (current && !current.running && current.exitCode !== null) closeSheet(props.id);
  });

  // The sheet going away unbinds its view without ending the program: the
  // store decides, through archive and metadata reconciliation, when it dies.
  cleanup(() => bindTerminalView(props.id, undefined));

  const bind = (node: NativeComponentRef | undefined) => {
    const surface = node ? surfaceView(node) : undefined;
    view = surface?.view;
    answer = surface?.answer;
    bindTerminalView(props.id, view);
    if (view && visible()) view.focus();
  };

  const restart = () => {
    const row = container();
    if (row) restartTerminal(props.id, row);
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
  const progress = () => info()?.progress ?? null;
  return (
    <View class="flex-1 bg-background">
      <If when={progress()}>
        <View testID="terminal-progress" class="h-[2px] bg-track" accessibilityLabel={t(K.terminal.progress, { percent: progress()?.percent ?? 0 })}>
          <View
            style={{
              height: 2,
              width: progress()?.state === "indeterminate" ? "100%" : `${progress()?.percent ?? 0}%`,
              backgroundColor: progress()?.state === "error" ? token("destructive") : token("primary"),
              opacity: progress()?.state === "pause" || progress()?.state === "indeterminate" ? 0.5 : 1,
            }}
          />
        </View>
      </If>
      <If when={finding()}>
        <View testID="terminal-find" class="flex-row items-center gap-1.5 border-b border-line bg-inset px-2 py-1">
          <Glyph name="search" size={11} tint={token("muted-foreground")} />
          <Input
            testID="terminal-find-input"
            accessibilityLabel={t(K.terminal.findPlaceholder)}
            placeholder={t(K.terminal.findPlaceholder)}
            autoFocus
            value={needle()}
            onChange={({ value }) => find(value)}
            onSubmit={() => step(1)}
            style={{
              flex: 1,
              height: 24,
              paddingHorizontal: 6,
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
          <Text testID="terminal-find-count" class="min-w-[56px] text-right text-[11px] text-muted-foreground">
            {!needle()
              ? ""
              : found().total === 0
                ? t(K.terminal.findNone)
                : t(K.terminal.findCount, { index: (found().index ?? 0) + 1, total: found().total })}
          </Text>
          <SheetIconButton testID="terminal-find-prev" label={t(K.terminal.findPrev)} glyph="caret-down" disabled={found().total === 0} onPress={() => step(-1)} />
          <SheetIconButton testID="terminal-find-next" label={t(K.terminal.findNext)} glyph="caret-right" disabled={found().total === 0} onPress={() => step(1)} />
          <SheetIconButton testID="terminal-find-close" label={t(K.terminal.findClose)} glyph="close" onPress={closeFind} />
        </View>
      </If>
      <View class="flex-1 bg-background px-2 py-1.5">
        <TerminalSurface
          ref={bind}
          testID="terminal-view"
          accessibilityLabel={terminalActionLabel(action())}
          class="flex-1"
          session={info()?.session ?? null}
          fontFamily={SHEET_MONO}
          fontSize={13}
          lineHeight={18}
          colors={{
            foreground: token("foreground"),
            background: token("background"),
            cursor: withAlpha(token("foreground"), 0x80),
            selection: token("brand-tint"),
            preedit: token("accent"),
            link: token("info"),
            mark: withAlpha(token("warn"), 0x40),
            markCurrent: withAlpha(token("warn"), 0x90),
            scrollbar: token("scrollbar-thumb"),
          }}
          cursorStyle="block"
          cursorBlink
          optionAsMeta={false}
          menu={{
            copy: t(K.terminal.copy),
            paste: t(K.terminal.paste),
            selectAll: t(K.terminal.selectAll),
            find: t(K.terminal.find),
            clear: t(K.terminal.clear),
          }}
          onSnapshot={(snapshot) => answer?.(snapshot)}
          onOpen={({ url }) => {
            // Links open beside the terminal, in the container's own browser
            // sheet: web pages stay inside Zu (Q61), never another app.
            dispatchIntent("browser.open", { containerId: containerId(), url }, { containerId: containerId() });
          }}
          onFind={() => finding.set(true)}
          onFindStep={({ step: by }) => step(by)}
          onCopy={({ text }) => void Clipboard.writeText(text)}
          onPaste={() => {
            void Clipboard.readText().then((text) => {
              if (text) pasteIntoTerminal(props.id, text);
            });
          }}
        />
      </View>
      <If when={!running()}>
        <View class="flex-row items-center gap-2 border-t border-line bg-inset px-3 py-1.5">
          <Dot tint={token("faint")} size={6} />
          <Text class="flex-1 text-[11px] text-muted-foreground" style={{ numberOfLines: 1 }}>
            {t(K.terminal.exited, { code: info()?.exitCode ?? info()?.exitSignal ?? "—" })}
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

/** `#rrggbbaa` (what `token()` gives) with its alpha replaced. */
function withAlpha(color: string, alpha: number): string {
  return `${color.slice(0, 7)}${alpha.toString(16).padStart(2, "0")}`;
}

/** The next free terminal resource number in a container. */
function nextTerminalIndex(containerId: string): number {
  let max = 0;
  for (const id of [...panelIds(layout()), ...Object.keys(terminalInfo())]) {
    const resource = id.startsWith("terminal:") ? id : null;
    if (!resource) continue;
    const parsed = resource.slice("terminal:".length);
    const at = parsed.lastIndexOf(":");
    const index = at >= 0 ? Number(parsed.slice(at + 1)) : 1;
    const owner = at >= 0 ? parsed.slice(0, at) : parsed;
    if (owner === containerId && Number.isFinite(index)) max = Math.max(max, index);
  }
  return max + 1;
}

/** Opens a terminal resource in a container (a new sheet beside the start page). */
export function openTerminalSheet(containerId: string, action: TerminalAction): string | null {
  const container = containers().find((row) => row.id === containerId);
  if (!container) return null;
  const sheetId = terminalSheetId(containerId, nextTerminalIndex(containerId));
  registerTerminal(sheetId, action);
  openSheet(sheetId);
  return sheetId;
}

/** Mints an external container whose single sheet is its terminal. Outside
 * a project the container's workspace is its own `scratch/<id>` folder, made
 * after the id is known; a project context pins the root. */
export async function createExternalContainer(
  action: TerminalAction = "shell",
  projectId: string | null = null,
  cwd: string | null = null,
): Promise<string> {
  const now = Date.now();
  const containerId = `external:${action.toLowerCase()}:${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  // No project root and no workspace is the start page's error line, never a
  // silent fallback into the home folder.
  const target = cwd || projectCwd(projectId) || (await scratchCwd(containerId));
  if (!target) throw new Error("cannot create the workspace for this terminal");
  const sheetId = terminalSheetId(containerId, 1);
  registerTerminal(sheetId, action);
  const container = await createContainerRecord({
    id: containerId,
    cwd: target,
    projectId,
    sheets: [sheetId],
  });
  if (!container) throw new Error("cannot create the terminal's container");
  return container.id;
}

/** A start-page tile's instantiate: in a container the terminal is a
 * resource of that container (the start page's tab becomes the terminal's);
 * outside one it mints the external container the process lives in. */
async function instantiateTerminal(action: TerminalAction, context: LaunchContext): Promise<void> {
  if (context.containerId) {
    openTerminalSheet(context.containerId, action);
    return;
  }
  await createExternalContainer(action, context.projectId, context.cwd);
}

/** The terminal kind's registration. */
export const terminalModule: SheetModule = {
  id: "terminal",
  capabilities: ["pty"],
  initialize: () => {
    setProgramExitHandler((sheetId) => closeSheet(sheetId));
    setNotificationHandler((sheetId, title, body) => void notifySettled({ sheetId, title, body }));
  },
  onLayoutChanged: (ids) => reconcileTerminalsByIds(ids),
  onContainerArchive: (containerId) => closeTerminalsOfContainer(containerId),
  intents: {
    "terminal.open": (payload) => {
      const { containerId = null, action = "shell" } = (payload ?? {}) as {
        containerId?: string | null;
        action?: TerminalAction;
      };
      if (!containerId) return null;
      return openTerminalSheet(containerId, action) ?? null;
    },
    "terminal.createExternal": async (payload) => {
      const { action = "shell", projectId = null, cwd = null } = (payload ?? {}) as {
        action?: TerminalAction;
        projectId?: string | null;
        cwd?: string | null;
      };
      const containerId = await createExternalContainer(action, projectId, cwd);
      return terminalSheetId(containerId, 1);
    },
  },
  launchers: [
    {
      id: "terminal",
      label: () => t(K.external.terminal),
      glyph: "terminal",
      group: "tool",
      order: 10,
      instantiate: (context) => instantiateTerminal("shell", context),
    },
    {
      id: "claude",
      label: () => t(K.external.claude),
      brand: "claude",
      group: "agent",
      order: 10,
      instantiate: (context) => instantiateTerminal("Claude", context),
    },
    {
      id: "codex",
      label: () => t(K.external.codex),
      brand: "codex",
      group: "agent",
      order: 20,
      instantiate: (context) => instantiateTerminal("Codex", context),
    },
    {
      id: "copilot",
      label: () => t(K.external.copilot),
      brand: "copilot",
      group: "agent",
      order: 30,
      instantiate: (context) => instantiateTerminal("Copilot", context),
    },
  ],
  kinds: [
    {
      kind: "terminal",
      glyph: "terminal",
      tint: "muted-foreground",
      title: (id) => {
        const live = terminalTitle(id);
        if (live) return live;
        const container = containers().find((row) => row.id === terminalSheetContainer(id));
        const label = terminalActionLabel(terminalAction(id) ?? "shell");
        const folder = container?.cwd.split("/").filter(Boolean).pop();
        // A scratch workspace's folder is the container's own id: it names
        // nothing a reader can use, so the kind's label stands alone.
        return folder && folder !== container?.id ? `${label} · ${folder}` : label;
      },
      body: ({ id }) => <TerminalBody id={id} />,
      parse: (id) => (id.startsWith("terminal:") ? id.slice("terminal:".length) : null),
      restore: (id) => containerOfSheet(id) !== null,
    },
  ],
};
