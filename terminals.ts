import { signal } from "nsh";
import { Pty, type PtyExit } from "zu/native";
import type { ContainerKind, ContainerRecord } from "./contracts/protocol";
import { t, K } from "./i18n";
import { panelIds } from "./dock";
import type { DockAreaLayout } from "./dock";

/**
 * The external containers' terminals.
 *
 * A PTY belongs to an external container, not to a sheet component: switching
 * containers hides a sheet without ending the shell, and `ensureTerminal`
 * keeps one handle per container for the app's lifetime. The component only
 * attaches a sink to it. The native `Pty` owns the process; the handle owns the
 * replay buffer that lets a remounted Terminal rebuild the screen (including
 * the alternate screen a TUI set) after a container switch.
 *
 * Output never goes through the engine wire: `onData` posts from the PTY's
 * reader task straight into this store.
 */

/** The most output kept for a remount; a long session keeps the tail. */
const MAX_REPLAY = 512 * 1024;
/** A closed external container's PTY is killed; archived ones never reopen. */
const AGENT_COMMANDS: Partial<Record<ContainerKind, string>> = {
  Claude: "claude",
  Codex: "codex",
  Copilot: "copilot",
};

export interface TerminalInfo {
  title: string;
  running: boolean;
  exitCode: number | null;
  exitSignal: string | null;
  error: string | null;
}

export interface TerminalHandle {
  containerId: string;
  pty?: Pty;
  /** Output since the last attach (a remount replays it). */
  buffer: string;
  truncated: boolean;
  sink?: (data: string) => void;
  info: TerminalInfo;
}

/** What the shell shows about a container's terminal (a mirror, not the PTY). */
export const terminalInfo = signal<Record<string, TerminalInfo>>({});

const handles = new Map<string, TerminalHandle>();

/**
 * What to do when a program ends on its own. The container store owns the
 * layout, and it imports this module (not the other way), so it installs the
 * handler: a TUI agent's exit closes its sheet instead of leaving a tab that
 * only offers to restart what the user never asked to keep.
 */
let onProgramExit: ((sheetId: string) => void) | null = null;

/** Installs (or clears) the handler a program's own exit calls. */
export function setProgramExitHandler(handler: ((sheetId: string) => void) | null): void {
  onProgramExit = handler;
}
const refs = new Map<string, { focus: () => void; text: () => Promise<string> }>();

/** The sheet id of an external container's terminal. */
export function terminalSheetId(containerId: string): string {
  return `terminal:${containerId}`;
}

/** The external container a terminal sheet names. */
export function containerOfTerminalSheet(id: string): string | null {
  return id.startsWith("terminal:") ? id.slice("terminal:".length) : null;
}

function publish(handle: TerminalHandle): void {
  terminalInfo.set({ ...terminalInfo(), [handle.containerId]: { ...handle.info } });
}

function seedTitle(container: ContainerRecord): string {
  const label = t(K.external[container.kind === "Pi" ? "terminal" : kindKey(container.kind)]);
  const folder = container.cwd.split("/").filter(Boolean).slice(-1)[0];
  return folder ? `${label} · ${folder}` : label;
}

function kindKey(kind: ContainerKind): keyof typeof K.external {
  switch (kind) {
    case "Claude":
      return "claude";
    case "Codex":
      return "codex";
    case "Copilot":
      return "copilot";
    default:
      return "terminal";
  }
}

/** The external kind's label in the shell's language. */
export function externalKindLabel(kind: ContainerKind): string {
  return kind === "Pi" ? t(K.external.terminal) : t(K.external[kindKey(kind)]);
}

function append(handle: TerminalHandle, data: string): void {
  const next = handle.buffer + data;
  if (next.length > MAX_REPLAY) {
    // Keep whole lines so the replay does not begin inside an escape
    // sequence's arguments; a partially lost sequence is the price of a cap.
    const cut = next.length - MAX_REPLAY;
    const line = next.indexOf("\n", cut);
    handle.buffer = next.slice(line >= 0 ? line + 1 : cut);
    handle.truncated = true;
  } else {
    handle.buffer = next;
  }
  handle.sink?.(data);
}

/**
 * The container's PTY, started on first use. A failed start stays in
 * `terminalInfo` as an error; `restartTerminal` tries again.
 */
export function ensureTerminal(container: ContainerRecord): TerminalHandle {
  const existing = handles.get(container.id);
  if (existing) return existing;
  const handle: TerminalHandle = {
    containerId: container.id,
    buffer: "",
    truncated: false,
    info: { title: seedTitle(container), running: false, exitCode: null, exitSignal: null, error: null },
  };
  handles.set(container.id, handle);
  try {
    const pty = Pty.open(
      {
        command: AGENT_COMMANDS[container.kind] ?? null,
        cwd: container.cwd,
        cols: 80,
        rows: 24,
      },
      (data) => append(handle, data),
      (exit) => {
        const running = handle.info.running;
        handle.info = {
          ...handle.info,
          running: false,
          exitCode: exit.code ?? null,
          exitSignal: exit.signal ?? null,
        };
        publish(handle);
        // Only a program that was running and ended by itself: closing the
        // sheet first sets `running` false, so a user's close is not echoed.
        if (running && container.kind !== "Pi") {
          onProgramExit?.(terminalSheetId(container.id));
        }
      },
    );
    handle.pty = pty;
    // Keep the seeded `Kind · folder` title until the program sets an OSC
    // title: a plain shell reports its executable ("/bin/zsh"), which reads
    // as a broken container name in the sidebar and tab.
    handle.info = { ...handle.info, running: true };
    publish(handle);
  } catch (failure) {
    handle.info = { ...handle.info, running: false, error: String(failure) };
    publish(handle);
  }
  return handle;
}

/**
 * Gives the Terminal component the output it missed: the replay buffer, then
 * live chunks. `reset` says the buffer starts after dropped output, so the
 * emulator must clear before taking it.
 */
export function attachTerminal(
  containerId: string,
  sink: (data: string) => void,
): { buffer: string; reset: boolean } {
  const handle = handles.get(containerId);
  if (!handle) return { buffer: "", reset: false };
  handle.sink = sink;
  const replay = handle.buffer;
  const reset = handle.truncated;
  handle.buffer = "";
  handle.truncated = false;
  return { buffer: replay, reset };
}

/** Stops sending output to a Terminal that is going away; the PTY stays. */
export function detachTerminal(containerId: string): void {
  const handle = handles.get(containerId);
  if (handle) handle.sink = undefined;
  refs.delete(containerId);
}

/** Registers the mounted Terminal so activating its tab can focus it. */
export function bindTerminalRef(
  containerId: string,
  ref: { focus: () => void; text: () => Promise<string> } | undefined,
): void {
  if (ref) refs.set(containerId, ref);
  else refs.delete(containerId);
}

/** Focuses the terminal of a container whose tab became active. */
export function focusTerminal(containerId: string): void {
  refs.get(containerId)?.focus();
}

/** The mounted Terminal of a container (tests read its screen). */
export function terminalRef(containerId: string): { focus: () => void; text: () => Promise<string> } | undefined {
  return refs.get(containerId);
}

/** The PTY's last reported cell size, `null` before it exists. */
export function terminalSize(containerId: string): [number, number] | null {
  const pty = handles.get(containerId)?.pty;
  if (!pty) return null;
  const [cols, rows] = pty.size;
  return [cols, rows];
}

/** The program's title, as the emulator last heard it (OSC 0/2). */
export function setTerminalTitle(containerId: string, title: string): void {
  const handle = handles.get(containerId);
  if (!handle || !title.trim() || handle.info.title === title) return;
  handle.info = { ...handle.info, title };
  publish(handle);
}

/** Kills the PTY and forgets the handle (archive, or the tab closed). */
export function closeTerminal(containerId: string): void {
  const handle = handles.get(containerId);
  if (!handle) return;
  handles.delete(containerId);
  refs.delete(containerId);
  handle.sink = undefined;
  try {
    handle.pty?.close();
    handle.pty?.dispose();
  } catch {
    // A PTY that already ended has nothing to close.
  }
  const next = { ...terminalInfo() };
  delete next[containerId];
  terminalInfo.set(next);
}

/** Stops the program and starts a fresh one (the exited state's action). */
export function restartTerminal(container: ContainerRecord): TerminalHandle {
  closeTerminal(container.id);
  return ensureTerminal(container);
}

/**
 * Keeps the store honest after a layout edit: a terminal sheet the user closed
 * takes its PTY with it. Container switches do not call this (they replace the
 * layout wholesale and must keep the hidden container's PTY alive).
 */
export function reconcileTerminals(layout: DockAreaLayout): void {
  const open = new Set(panelIds(layout));
  for (const containerId of [...handles.keys()]) {
    if (!open.has(terminalSheetId(containerId))) closeTerminal(containerId);
  }
}

/** The tab title for a terminal sheet, once its container exists. */
export function terminalTitle(containerId: string): string | null {
  return terminalInfo()[containerId]?.title ?? null;
}
