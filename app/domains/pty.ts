import { Clipboard, signal } from "nsh";
import { TerminalSession, type TerminalSessionEvent } from "zu/native";
import { t, K } from "../ui/i18n";
import { baseName } from "./fs";

/**
 * A container's terminals.
 *
 * A terminal is a **resource**: a sheet `terminal:{containerId}:{n}`, whose
 * session belongs to the store rather than to the sheet component. The native
 * `TerminalSession` owns the program and its emulator: the PTY's output goes
 * straight into the emulator, never through TSX, and the screen, scrollback
 * and modes live as long as the session. Switching containers hides a sheet
 * without ending its program; a sheet that mounts again names the session to
 * its view (`session` of `zu.terminal`) and the view draws what is there.
 *
 * A container can hold several: a Pi container's Hero opens a shell and the
 * agent TUIs side by side, and every one of them is that container's — not a
 * new sidebar row. The action is remembered per sheet; after a restart (a
 * program never survives one) a restored sheet falls back to its container's
 * kind: an external container restarts its CLI, a Pi container its shell.
 */

/** A terminal as the store and tests read it: the session's text, the view's keyboard. */
export interface TerminalRef {
  focus: () => void;
  text: () => Promise<string>;
  viewportText: () => Promise<string>;
  scrollBy: (lines: number) => void;
  scrollToBottom: () => void;
  selectAll: () => void;
  selectedText: () => Promise<string>;
  /** The font family the view draws with, as the platform resolved it. */
  font: () => Promise<string>;
}

/** What the mounted view adds to its session: the keyboard and its face. */
export interface TerminalViewRef {
  focus: () => void;
  font: () => Promise<string>;
}

/** A program's OSC 9;4 progress: `null` when it reported none or removed it. */
export interface TerminalProgress {
  state: "set" | "error" | "indeterminate" | "pause";
  percent: number | null;
}

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
  /** What the view names the session by; `null` before it started. */
  session: number | null;
  progress: TerminalProgress | null;
}

interface TerminalHandle {
  sheetId: string;
  containerId: string;
  action: TerminalAction;
  session?: TerminalSession;
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

/**
 * What a program's desktop notification (OSC 9 / 777) becomes: the shell owns
 * the window and permission policy, so the terminal module installs it.
 */
let onNotify: ((sheetId: string, title: string, body: string) => void) | null = null;

/** Installs (or clears) the handler a program's notification calls. */
export function setNotificationHandler(handler: ((sheetId: string, title: string, body: string) => void) | null): void {
  onNotify = handler;
}

/** Installs (or clears) the handler a program's own exit calls. */
export function setProgramExitHandler(handler: ((sheetId: string) => void) | null): void {
  onProgramExit = handler;
}
const views = new Map<string, TerminalViewRef>();

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

/** The fallback action of a restored sheet: a plain shell. */
export function defaultAction(): TerminalAction {
  return "shell";
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

function seedTitle(container: { id: string; cwd: string }, action: TerminalAction): string {
  const label = terminalActionLabel(action);
  const folder = baseName(container.cwd);
  return folder ? `${label} · ${folder}` : label;
}

/** What a session's program did besides drawing. */
function heard(handle: TerminalHandle, event: TerminalSessionEvent): void {
  switch (event.kind) {
    case "title":
      if (event.text) setTerminalTitle(handle.sheetId, event.text);
      return;
    case "clipboard":
      void Clipboard.writeText(event.text ?? "");
      return;
    case "notify":
      onNotify?.(handle.sheetId, event.title || handle.info.title, event.text ?? "");
      return;
    case "progress": {
      const state = event.text;
      const progress: TerminalProgress | null =
        state === "set" || state === "error" || state === "indeterminate" || state === "pause"
          ? { state, percent: event.percent ?? null }
          : null;
      handle.info = { ...handle.info, progress };
      publish(handle);
      return;
    }
    case "exit": {
      const running = handle.info.running;
      handle.info = {
        ...handle.info,
        running: false,
        exitCode: event.code ?? null,
        exitSignal: event.signal ?? null,
      };
      publish(handle);
      // A program that was running and ended by itself: closing the sheet
      // first sets `running` false, so a user's close is not echoed. A plain
      // shell is a place to work and stays (with its restart action); every
      // other exit takes the sheet with it.
      if (running && handle.action !== "shell") onProgramExit?.(handle.sheetId);
      return;
    }
  }
}

/**
 * A terminal resource's session, started on first use. A failed start stays
 * in `terminalInfo` as an error; `restartTerminal` tries again.
 */
export function ensureTerminal(sheetId: string, container: { id: string; cwd: string }): TerminalHandle {
  const existing = handles.get(sheetId);
  if (existing) return existing;
  const action = actions.get(sheetId) ?? defaultAction();
  const handle: TerminalHandle = {
    sheetId,
    containerId: container.id,
    action,
    info: {
      title: seedTitle(container, action),
      running: false,
      exitCode: null,
      exitSignal: null,
      error: null,
      session: null,
      progress: null,
    },
  };
  handles.set(sheetId, handle);
  try {
    const session = TerminalSession.open(
      { command: ACTION_COMMANDS[action], cwd: container.cwd, cols: 80, rows: 24 },
      // A closed sheet's session still reports its death; that is not news
      // the shell should see, and republishing it would put the entry back.
      (event) => {
        if (handles.get(sheetId) === handle) heard(handle, event);
      },
    );
    handle.session = session;
    // Keep the seeded `Kind · folder` title until the program sets an OSC
    // title: a plain shell reports its executable ("/bin/zsh"), which reads
    // as a broken container name in the sidebar and tab.
    handle.info = { ...handle.info, running: true, session: session.id };
    publish(handle);
  } catch (failure) {
    handle.info = { ...handle.info, running: false, error: String(failure) };
    publish(handle);
  }
  return handle;
}

/** Registers (or clears) the mounted view of a sheet. */
export function bindTerminalView(sheetId: string, view: TerminalViewRef | undefined): void {
  if (view) views.set(sheetId, view);
  else views.delete(sheetId);
}

/** Focuses the terminal of a sheet whose tab became active. */
export function focusTerminal(sheetId: string): void {
  views.get(sheetId)?.focus();
}

/** Where a sheet's find stands. */
export interface TerminalFindState {
  total: number;
  index: number | null;
}

/** Finds `needle` in a sheet's terminal (an empty one ends the find). */
export function findInTerminal(sheetId: string, needle: string): TerminalFindState {
  const session = handles.get(sheetId)?.session;
  if (!session) return { total: 0, index: null };
  const found = session.find(needle);
  return { total: found.total, index: found.index ?? null };
}

/** The next older (1) or newer (-1) match of a sheet's find. */
export function stepTerminalFind(sheetId: string, step: number): TerminalFindState {
  const session = handles.get(sheetId)?.session;
  if (!session) return { total: 0, index: null };
  const found = session.findStep(step);
  return { total: found.total, index: found.index ?? null };
}

/** Ends a sheet's find; the selection stays on its last match. */
export function endTerminalFind(sheetId: string): void {
  handles.get(sheetId)?.session?.endFind();
}

/** Pastes `text` into a sheet's program: bracketed when it asked for it. */
export function pasteIntoTerminal(sheetId: string, text: string): void {
  handles.get(sheetId)?.session?.paste(text);
}

/** A sheet's terminal: its session, and its view while one is mounted. */
export function terminalRef(sheetId: string): TerminalRef | undefined {
  const session = handles.get(sheetId)?.session;
  if (!session) return undefined;
  const view = () => views.get(sheetId);
  return {
    focus: () => view()?.focus(),
    text: async () => session.text(),
    viewportText: async () => session.viewportText(),
    scrollBy: (lines) => session.scrollBy(lines),
    scrollToBottom: () => session.scrollToBottom(),
    selectAll: () => session.selectAll(),
    selectedText: async () => session.selectedText(),
    font: () => view()?.font() ?? Promise.resolve(""),
  };
}

/** The grid's size, `null` before the session exists. */
export function terminalSize(sheetId: string): [number, number] | null {
  const session = handles.get(sheetId)?.session;
  if (!session) return null;
  const [cols, rows] = session.size;
  return [cols, rows];
}

/** The program's title, as the emulator last heard it (OSC 0/2). */
export function setTerminalTitle(sheetId: string, title: string): void {
  const handle = handles.get(sheetId);
  if (!handle || !title.trim() || handle.info.title === title) return;
  handle.info = { ...handle.info, title };
  publish(handle);
}

/** Kills a terminal's program and forgets the handle (archive, or the tab closed). */
export function closeTerminal(sheetId: string): void {
  const handle = handles.get(sheetId);
  actions.delete(sheetId);
  if (!handle) return;
  handles.delete(sheetId);
  views.delete(sheetId);
  try {
    handle.session?.close();
    handle.session?.dispose();
  } catch {
    // A session that already ended has nothing to close.
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
export function restartTerminal(sheetId: string, container: { id: string; cwd: string }): TerminalHandle {
  closeTerminal(sheetId);
  return ensureTerminal(sheetId, container);
}

/**
 * Keeps the store honest after a layout edit: a terminal sheet the user closed
 * takes its PTY with it. Container switches do not call this (they replace the
 * layout wholesale and must keep the hidden container's PTYs alive).
 */
/** The same reconciliation when the caller has the open ids, not a layout. */
export function reconcileTerminalsByIds(openSheetIds: string[]): void {
  const open = new Set(openSheetIds);
  for (const sheetId of [...handles.keys()]) {
    if (!open.has(sheetId)) closeTerminal(sheetId);
  }
}

/** The tab title for a terminal sheet, once its PTY has a title. */
export function terminalTitle(sheetId: string): string | null {
  return terminalInfo()[sheetId]?.title ?? null;
}
