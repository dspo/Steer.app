import { signal } from "nsh";
import { Pty } from "zu/native";
import type { ContainerKind, ContainerRecord } from "./contracts/protocol";
import { t, K } from "./i18n";
import { panelIds } from "./dock";
import type { DockAreaLayout } from "./dock";

/**
 * A container's terminals.
 *
 * A terminal is a **resource**: a sheet `terminal:{containerId}:{n}`, whose
 * PTY belongs to the store rather than to the sheet component. Switching
 * containers hides a sheet without ending the shell; `ensureTerminal` keeps
 * one handle per resource for the app's lifetime, and the component only
 * attaches a sink to it. The native `Pty` owns the process; the handle owns
 * the replay buffer that lets a remounted Terminal rebuild the screen
 * (including the alternate screen a TUI set) after a container switch.
 *
 * A container can hold several: a Pi container's Hero opens a shell and the
 * agent TUIs side by side, and every one of them is that container's — not a
 * new sidebar row. The action is remembered per sheet; after a restart (a
 * PTY never survives one) a restored sheet falls back to its container's
 * kind: an external container restarts its CLI, a Pi container its shell.
 *
 * Output never goes through the engine wire: `onData` posts from the PTY's
 * reader task straight into this store.
 */

/** The most output kept for a remount; a long session keeps the tail. */
const MAX_REPLAY = 512 * 1024;

/** What a terminal runs: a plain shell or an agent's native TUI. */
export type TerminalAction = "shell" | "Pi" | "Claude" | "Codex" | "Copilot";

const ACTION_COMMANDS: Record<TerminalAction, string | null> = {
  shell: null,
  Pi: "pi",
  Claude: "claude",
  Codex: "codex",
  Copilot: "copilot",
};

interface TerminalInfo {
  title: string;
  running: boolean;
  exitCode: number | null;
  exitSignal: string | null;
  error: string | null;
}

interface TerminalHandle {
  sheetId: string;
  containerId: string;
  action: TerminalAction;
  pty?: Pty;
  /** Output since the last attach (a remount replays it). */
  buffer: string;
  truncated: boolean;
  sink?: (data: string) => void;
  info: TerminalInfo;
}

/** What the shell shows about a terminal resource (a mirror, not the PTY). */
export const terminalInfo = signal<Record<string, TerminalInfo>>({});

const handles = new Map<string, TerminalHandle>();
/** The action each open sheet runs; a restored sheet has no entry. */
const actions = new Map<string, TerminalAction>();

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

/** One terminal resource of a container: `terminal:{containerId}:{n}`. */
export function terminalSheetId(containerId: string, index: number): string {
  return `terminal:${containerId}:${index}`;
}

/**
 * The container and index a terminal sheet names. A sheet written before
 * terminals were resources (`terminal:{containerId}`) is resource 1.
 */
export function terminalResource(sheetId: string): { containerId: string; index: number } | null {
  if (!sheetId.startsWith("terminal:")) return null;
  const rest = sheetId.slice("terminal:".length);
  const at = rest.lastIndexOf(":");
  const tail = at >= 0 ? rest.slice(at + 1) : "";
  if (at >= 0 && /^\d+$/.test(tail)) return { containerId: rest.slice(0, at), index: Number(tail) };
  return { containerId: rest, index: 1 };
}

/** The container a terminal sheet belongs to, or `null` for another kind. */
export function terminalSheetContainer(sheetId: string): string | null {
  return terminalResource(sheetId)?.containerId ?? null;
}

/** The action a terminal sheet runs, if the shell opened it this run. */
export function terminalAction(sheetId: string): TerminalAction | undefined {
  return actions.get(sheetId);
}

/** Records what a sheet runs (the Hero's action, before the sheet mounts). */
export function registerTerminal(sheetId: string, action: TerminalAction): void {
  actions.set(sheetId, action);
}

/** The action a container kind's own terminal runs by default. */
export function defaultAction(kind: ContainerKind): TerminalAction {
  if (kind === "Pi" || kind === "Terminal") return "shell";
  return kind;
}

/** The action's label in the shell's language. */
export function terminalActionLabel(action: TerminalAction): string {
  switch (action) {
    case "Pi":
      return t(K.external.pi);
    case "Claude":
      return t(K.external.claude);
    case "Codex":
      return t(K.external.codex);
    case "Copilot":
      return t(K.external.copilot);
    default:
      return t(K.external.terminal);
  }
}

function publish(handle: TerminalHandle): void {
  terminalInfo.set({ ...terminalInfo(), [handle.sheetId]: { ...handle.info } });
}

function seedTitle(container: ContainerRecord, action: TerminalAction): string {
  const label = terminalActionLabel(action);
  const folder = container.cwd.split("/").filter(Boolean).slice(-1)[0];
  return folder ? `${label} · ${folder}` : label;
}

/** The external kind's label in the shell's language. */
export function externalKindLabel(kind: ContainerKind): string {
  return terminalActionLabel(defaultAction(kind));
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
 * A terminal resource's PTY, started on first use. A failed start stays in
 * `terminalInfo` as an error; `restartTerminal` tries again.
 */
export function ensureTerminal(sheetId: string, container: ContainerRecord): TerminalHandle {
  const existing = handles.get(sheetId);
  if (existing) return existing;
  const action = actions.get(sheetId) ?? defaultAction(container.kind);
  const handle: TerminalHandle = {
    sheetId,
    containerId: container.id,
    action,
    buffer: "",
    truncated: false,
    info: { title: seedTitle(container, action), running: false, exitCode: null, exitSignal: null, error: null },
  };
  handles.set(sheetId, handle);
  try {
    const pty = Pty.open(
      {
        command: ACTION_COMMANDS[action],
        cwd: container.cwd,
        cols: 80,
        rows: 24,
      },
      // A closed sheet's PTY still reports its death; that is not news the
      // shell should see, and republishing it would put the entry back.
      (data) => {
        if (handles.get(sheetId) !== handle) return;
        append(handle, data);
      },
      (exit) => {
        if (handles.get(sheetId) !== handle) return;
        const running = handle.info.running;
        handle.info = {
          ...handle.info,
          running: false,
          exitCode: exit.code ?? null,
          exitSignal: exit.signal ?? null,
        };
        publish(handle);
        // A program that was running and ended by itself: closing the sheet
        // first sets `running` false, so a user's close is not echoed. A
        // shell in a Pi container is a place to work and stays (with its
        // restart action); every other exit takes the sheet with it.
        const stays = action === "shell" && container.kind === "Pi";
        if (running && !stays) onProgramExit?.(sheetId);
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
export function attachTerminal(sheetId: string, sink: (data: string) => void): { buffer: string; reset: boolean } {
  const handle = handles.get(sheetId);
  if (!handle) return { buffer: "", reset: false };
  handle.sink = sink;
  const replay = handle.buffer;
  const reset = handle.truncated;
  handle.buffer = "";
  handle.truncated = false;
  return { buffer: replay, reset };
}

/** Stops sending output to a Terminal that is going away; the PTY stays. */
export function detachTerminal(sheetId: string): void {
  const handle = handles.get(sheetId);
  if (handle) handle.sink = undefined;
  refs.delete(sheetId);
}

/** Registers the mounted Terminal so activating its tab can focus it. */
export function bindTerminalRef(
  sheetId: string,
  ref: { focus: () => void; text: () => Promise<string> } | undefined,
): void {
  if (ref) refs.set(sheetId, ref);
  else refs.delete(sheetId);
}

/** Focuses the terminal of a sheet whose tab became active. */
export function focusTerminal(sheetId: string): void {
  refs.get(sheetId)?.focus();
}

/** The mounted Terminal of a sheet (tests read its screen). */
export function terminalRef(sheetId: string): { focus: () => void; text: () => Promise<string> } | undefined {
  return refs.get(sheetId);
}

/** The PTY's last reported cell size, `null` before it exists. */
export function terminalSize(sheetId: string): [number, number] | null {
  const pty = handles.get(sheetId)?.pty;
  if (!pty) return null;
  const [cols, rows] = pty.size;
  return [cols, rows];
}

/** The program's title, as the emulator last heard it (OSC 0/2). */
export function setTerminalTitle(sheetId: string, title: string): void {
  const handle = handles.get(sheetId);
  if (!handle || !title.trim() || handle.info.title === title) return;
  handle.info = { ...handle.info, title };
  publish(handle);
}

/** Kills a terminal's PTY and forgets the handle (archive, or the tab closed). */
export function closeTerminal(sheetId: string): void {
  const handle = handles.get(sheetId);
  actions.delete(sheetId);
  if (!handle) return;
  handles.delete(sheetId);
  refs.delete(sheetId);
  handle.sink = undefined;
  try {
    handle.pty?.close();
    handle.pty?.dispose();
  } catch {
    // A PTY that already ended has nothing to close.
  }
  const next = { ...terminalInfo() };
  delete next[sheetId];
  terminalInfo.set(next);
}

/** Kills every terminal a container holds (archive takes them all). */
export function closeTerminalsOfContainer(containerId: string): void {
  for (const [sheetId, handle] of [...handles]) {
    if (handle.containerId === containerId) closeTerminal(sheetId);
  }
}

/** Stops the program and starts a fresh one (the exited state's action). */
export function restartTerminal(sheetId: string, container: ContainerRecord): TerminalHandle {
  closeTerminal(sheetId);
  return ensureTerminal(sheetId, container);
}

/**
 * Keeps the store honest after a layout edit: a terminal sheet the user closed
 * takes its PTY with it. Container switches do not call this (they replace the
 * layout wholesale and must keep the hidden container's PTYs alive).
 */
export function reconcileTerminals(layout: DockAreaLayout): void {
  const open = new Set(panelIds(layout));
  for (const sheetId of [...handles.keys()]) {
    if (!open.has(sheetId)) closeTerminal(sheetId);
  }
}

/** The tab title for a terminal sheet, once its PTY has a title. */
export function terminalTitle(sheetId: string): string | null {
  return terminalInfo()[sheetId]?.title ?? null;
}
