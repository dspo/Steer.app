import { Terminal, type TerminalRef } from "nsh/base";
import { cleanup, effect, Text, token, View } from "nsh";
import {
  attachTerminal,
  bindTerminalRef,
  closeTerminalsOfContainer,
  defaultAction,
  detachTerminal,
  ensureTerminal,
  reconcileTerminalsByIds,
  registerTerminal,
  restartTerminal,
  setProgramExitHandler,
  setTerminalTitle,
  terminalAction,
  terminalActionLabel,
  terminalInfo,
  terminalSheetContainer,
  terminalSheetId,
  terminalTitle,
  type TerminalAction,
} from "../../domains/pty";
import {
  activeCwd,
  closeSheet,
  containerOfSheet,
  containers,
  createContainerRecord,
  fallbackCwd,
  layout,
  noteSheetOpened,
  openSheet,
  projectCwd,
  setLayout,
} from "../../core/containers";
import { appendSheet, panelIds, replaceSheet, visiblePanels } from "../../core/dock";
import { K, t } from "../../ui/i18n";
import { Dot, Glyph } from "../../ui/ui";
import { SHEET_FONT } from "../../ui/fonts";
import type { SheetModule } from "../../../contracts/module";

/**
 * The terminal sheet (`terminal:{containerId}:{n}`): one terminal resource of
 * a container, drawn by `nsh/base`'s `Terminal` (its `VtEmulator`). Bytes go
 * straight from `zu/pty` to the emulator; the sheet never sees a protocol.
 * A container holds several: a shell beside an agent's TUI is two sheets of
 * one container, not two sidebar rows.
 *
 * The `Terminal` stays mounted while its tab is hidden: the emulator must keep
 * the alternate screen and scrollback a TUI set. Switching containers unmounts
 * the sheet; the PTY survives in the domain, whose replay buffer rebuilds the
 * screen on mount.
 */
export function TerminalBody(props: { id: string }) {
  const containerId = () => terminalSheetContainer(props.id) ?? "";
  const container = () => containers().find((row) => row.id === containerId());
  const info = () => terminalInfo()[props.id];
  const visible = () => visiblePanels().includes(props.id);
  const action = () => terminalAction(props.id) ?? defaultAction();
  // The handle exists before the emulator binds (it replays the buffer), and
  // a sheet still mounted for the frame after its container was archived
  // must not restart a PTY the archive just ended.
  const handle = container() && !container()!.archived ? ensureTerminal(props.id, container()!) : undefined;
  let term: TerminalRef | undefined;

  // A TUI agent's process is the sheet: when it exits, its tab goes with it.
  effect(() => {
    const current = info();
    if (current && !current.running && current.exitCode !== null) closeSheet(props.id);
  });

  // The sheet going away detaches the Terminal without killing the shell: the
  // store decides, through archive and metadata reconciliation, when it dies.
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

/** Opens a terminal resource in a container, replacing `fromSheet` when given. */
export function openTerminalSheet(containerId: string, action: TerminalAction, fromSheet?: string): string | null {
  const container = containers().find((row) => row.id === containerId);
  if (!container) return null;
  const sheetId = terminalSheetId(containerId, nextTerminalIndex(containerId));
  registerTerminal(sheetId, action);
  openSheet(sheetId, fromSheet);
  return sheetId;
}

/** Mints an external container whose single sheet is its terminal. */
export async function createExternalContainer(
  action: TerminalAction = "shell",
  projectId: string | null = null,
): Promise<string | null> {
  const target = projectCwd(projectId) || activeCwd() || fallbackCwd();
  if (!target) return null;
  const now = Date.now();
  const containerId = `external:${action.toLowerCase()}:${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const sheetId = terminalSheetId(containerId, 1);
  registerTerminal(sheetId, action);
  const container = await createContainerRecord({
    id: containerId,
    cwd: target,
    projectId,
    sheets: [sheetId],
  });
  return container?.id ?? null;
}

/** The terminal kind's registration. */
export const terminalModule: SheetModule = {
  id: "terminal",
  capabilities: ["pty"],
  initialize: () => setProgramExitHandler((sheetId) => closeSheet(sheetId)),
  onLayoutChanged: (ids) => reconcileTerminalsByIds(ids),
  onContainerArchive: (containerId) => closeTerminalsOfContainer(containerId),
  intents: {
    "terminal.open": (payload) => {
      const { containerId = null, action = "shell", fromSheet } = (payload ?? {}) as {
        containerId?: string | null;
        action?: TerminalAction;
        fromSheet?: string;
      };
      if (!containerId) return null;
      return openTerminalSheet(containerId, action, fromSheet) ?? null;
    },
    "terminal.createExternal": async (payload) => {
      const { action = "shell", projectId = null } = (payload ?? {}) as {
        action?: TerminalAction;
        projectId?: string | null;
      };
      const containerId = await createExternalContainer(action, projectId);
      return containerId ? terminalSheetId(containerId, 1) : null;
    },
  },
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
        return folder ? `${label} · ${folder}` : label;
      },
      body: ({ id }) => <TerminalBody id={id} />,
      parse: (id) => (id.startsWith("terminal:") ? id.slice("terminal:".length) : null),
      restore: (id) => containerOfSheet(id) !== null,
    },
  ],
};
