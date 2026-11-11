import { LayoutAnimation, signal, untracked } from "nsh";
import type { DockAreaRef } from "nsh/base";
import { request } from "./engine";
import type {
  ContainerKind,
  ContainerListData,
  ContainerRecord,
  SessionData,
} from "./contracts/protocol";
import {
  SCRATCH_SHEET,
  activePanelIds,
  appendSheet,
  defaultLayoutForSessions,
  homeSheetId,
  layoutSessions,
  panelIds,
  pruneLayout,
  removeSheet,
  replaceSheet,
  sessionIdOfSheet,
  sheetCount,
  sessionSheetId,
  visiblePanels,
  type DockAreaLayout,
} from "./dock";
import {
  activeCwd,
  adoptSession,
  focusSession,
  openSession,
  refreshSessions,
  send,
  sessions,
  viewFor,
} from "./sessions";
import { stopLspContainer } from "./lsp";
import {
  closeTerminalsOfContainer,
  focusTerminal,
  reconcileTerminals,
  registerTerminal,
  terminalInfo,
  terminalResource,
  terminalSheetContainer,
  terminalSheetId,
  setProgramExitHandler,
  type TerminalAction,
} from "./terminals";

/**
 * The container store: the sidebar's rows, the active container and its
 * view stash. Switching rows saves the current DockArea layout through the
 * engine, then restores the target's layout, zoom and session transcripts.
 *
 * The canvas is always a sheet tree: a container's stashed layout, or the
 * scratch canvas (`activeContainerId === null`) whose layout lives in memory
 * only. `home:{containerId}` / `home:scratch` are the Hero sheets; there is
 * no page state beside the tree.
 *
 * The engine owns the registry and the layout files; this store is the
 * shell's projection. A sheet id is `session:{sessionId}` and is stable
 * across drags, so `renderPanel` keeps its state while the layout moves.
 */

/** Every container, archived ones included (the sidebar filters). */
export const containers = signal<ContainerRecord[]>([]);
/** The container whose canvas is shown; `null` is the scratch canvas. */
export const activeContainerId = signal<string | null>(null);
/** The active canvas's DockArea layout. */
export const layout = signal<DockAreaLayout>(defaultLayoutForSessions([]));
/** The scratch canvas's layout: in memory only, like the canvas itself. */
const scratchLayout = signal<DockAreaLayout>(defaultScratchLayout());
/** The zoomed panel's id, or null (DockArea keeps zoom outside the layout). */
export const zoomedPanel = signal<string | null>(null);
/** The last container/layout failure, shown in the status line. */
export const containerError = signal<string | null>(null);
/** The registry's first load is done: creating/opening a container can begin.
 * Before it, a create could race the load's empty-state reset. */
export const containersLoaded = signal(false);

type ContainerTransport = (type: string, payload?: Record<string, unknown>, timeoutMs?: number) => Promise<any>;

let dock: DockAreaRef | undefined;
let saveTimer: any = null;
let savedFor: string | null = null;
let transport: ContainerTransport = request;

/**
 * Every canvas intent (a switch, New's scratch, a create) takes a ticket.
 * A slower, older one must not apply over a newer intent: the sidebar is
 * clickable while the startup switch is still in flight, and a late reply
 * would otherwise put back the container the user just left.
 */
let canvasTicket = 0;

function takeCanvasTicket(): number {
  return ++canvasTicket;
}

function ticketCurrent(ticket: number): boolean {
  return ticket === canvasTicket;
}

/** Replaces the engine transport (tests drive the store without a sidecar). */
export function setContainerTransport(next: ContainerTransport | null): void {
  transport = next ?? request;
}

/**
 * How the scratch canvas's sheets move onto a container it mints. The
 * browser store owns its page state and installs this (`browser.ts`);
 * the container store only needs the new sheet ids to build the layout.
 */
let transferScratchSheets: ((containerId: string) => string[]) | null = null;

/** Installs (or clears) the scratch-canvas sheet transfer. */
export function setScratchSheetTransfer(next: ((containerId: string) => string[]) | null): void {
  transferScratchSheets = next;
}

/**
 * Live containers, newest activity first. The order is explicit and stable:
 * `updatedAt` descending (the engine's stamp for the last activity), then
 * `createdAt` descending for a tie, then the id ascending so two containers
 * never swap places between renders.
 */
export function containersByRecency(rows: ContainerRecord[] = containers()): ContainerRecord[] {
  return rows
    .filter((container) => !container.archived)
    .slice()
    .sort(
      (a, b) =>
        b.updatedAt - a.updatedAt ||
        b.createdAt - a.createdAt ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
}

/** The rows the sidebar shows, newest activity first. */
export function liveContainers(): ContainerRecord[] {
  return containersByRecency();
}

/**
 * Each container's sheets in creation order (S2). The container's title is
 * the earliest-created surviving sheet's, so closing the first tab promotes
 * the second instead of leaving a name with nothing behind it. The order is
 * UI state: on a restart it is rebuilt from the restored layout's tree order.
 */
export const sheetOrder = signal<Record<string, string[]>>({});

/**
 * Notes a sheet as newly opened on the canvas. Creation order cannot be read
 * off a layout edit — the dock helpers build the next tree from the current
 * one — so whoever opens a sheet says so.
 */
export function noteSheetOpened(id: string): void {
  const containerId = activeContainerId();
  if (!containerId) return;
  const current = sheetOrder()[containerId] ?? [];
  if (current.includes(id)) return;
  sheetOrder.set({ ...sheetOrder(), [containerId]: [...current, id] });
}

/** Drops sheets that left the layout; an open sheet keeps its place. */
function pruneSheetOrder(containerId: string, next: DockAreaLayout): void {
  const current = sheetOrder()[containerId];
  if (!current) return;
  const alive = new Set(panelIds(next));
  const order = current.filter((id) => alive.has(id));
  if (order.length !== current.length) sheetOrder.set({ ...sheetOrder(), [containerId]: order });
}

/** Seeds a container's order from its layout when nothing is recorded yet. */
function seedSheetOrder(containerId: string, layout: DockAreaLayout): void {
  if (sheetOrder()[containerId]) return;
  sheetOrder.set({ ...sheetOrder(), [containerId]: panelIds(layout) });
}

/** The canvas of a new or not-yet-stashed container: its own terminal for an
 * external one, one sheet per session otherwise. */
export function defaultLayoutForContainer(container: ContainerRecord): DockAreaLayout {
  if (container.kind !== "Pi") {
    return { center: { type: "tabs", panels: [terminalSheetId(container.id, 1)], activeIndex: 0 } };
  }
  return defaultLayoutForSessions(container.sessions.map((session) => session.sessionId));
}

/** The scratch canvas before anything happens on it: its Hero sheet. */
function defaultScratchLayout(): DockAreaLayout {
  return { center: { type: "tabs", panels: [SCRATCH_SHEET], activeIndex: 0 } };
}

/** The Hero sheet added to (or activated in) a scratch layout. */
function withScratchHero(current: DockAreaLayout): DockAreaLayout {
  return appendSheet(current, SCRATCH_SHEET);
}

/** Remembers the scratch canvas as it is before the canvas leaves it. */
function stashScratch(): void {
  if (activeContainerId() === null) scratchLayout.set(layout());
}

/** Shows the scratch canvas as it was left (an emptied one stays empty). */
function showScratch(): void {
  activeContainerId.set(null);
  savedFor = null;
  layout.set(scratchLayout());
  zoomedPanel.set(null);
  syncVisible();
}

/**
 * "New": shows the scratch canvas with its Hero sheet, opening the Hero
 * again if it was closed. An unsubmitted scratch (its browser sheets, later)
 * is what the canvas comes back to.
 */
export async function openScratch(): Promise<void> {
  const ticket = takeCanvasTicket();
  if (activeContainerId() !== null) await flushLayout();
  if (!ticketCurrent(ticket)) return;
  const base = activeContainerId() === null ? layout() : scratchLayout();
  scratchLayout.set(withScratchHero(base));
  showScratch();
  containerError.set(null);
}

/** Whether the active container can hold a pi session. */
function isPiContainer(id: string | null): boolean {
  if (!id) return false;
  return containers().find((container) => container.id === id)?.kind === "Pi";
}

/** Gives the store the DockArea it restores zoom through. */
export function bindDock(ref: DockAreaRef | undefined): void {
  dock = ref;
  const wanted = untracked(zoomedPanel);
  if (dock && wanted) void applyZoom(wanted);
}

/** Loads the registry and shows its active container (startup). */
export async function loadContainers(): Promise<void> {
  containersLoaded.set(false);
  try {
    const data = (await transport("container.list", {}, 10000)) as ContainerListData;
    containers.set(data.containers ?? []);
    const id = data.activeContainerId ?? liveContainers()[0]?.id ?? null;
    // The canvas comes first: switching needs the registry and the layout
    // file only, while `session.list` scans every session on disk and would
    // otherwise leave an empty canvas (or the scratch Hero) on startup.
    if (id) {
      await switchContainer(id, true);
    } else {
      // Nothing to show: the scratch canvas (its Hero sheet) is the start.
      scratchLayout.set(withScratchHero(scratchLayout()));
      showScratch();
    }
    await refreshSessions();
  } catch (failure) {
    containerError.set(String(failure));
  } finally {
    containersLoaded.set(true);
  }
}

/** Adds or replaces a container's row in the sidebar's projection. */
function upsertContainer(container: ContainerRecord): void {
  const rows = containers();
  containers.set(
    rows.some((row) => row.id === container.id)
      ? rows.map((row) => (row.id === container.id ? container : row))
      : [...rows, container],
  );
}

/**
 * Puts `container` on the canvas with `next` as its layout. Every way a
 * container reaches the canvas — a switch, a create, a created external —
 * goes through here, so they cannot drift (the A1/B3 class of mismatch).
 */
function activateCanvas(container: ContainerRecord, next: DockAreaLayout, zoom: string | null): void {
  upsertContainer(container);
  activeContainerId.set(container.id);
  savedFor = container.id;
  layout.set(next);
  // A container seen for the first time after a restart has no recorded
  // order; its restored tree order is the best account of it.
  seedSheetOrder(container.id, next);
  zoomedPanel.set(zoom);
  syncVisible();
}

/**
 * Makes `id` active. `force` reloads even when it is already shown (a
 * reconnect or a fresh registry load). Callers that are already part of a
 * later intent (an archive's follow-up switch) pass their own ticket.
 */
export function switchContainer(id: string, force = false): Promise<void> {
  if (!force && activeContainerId() === id && savedFor === id) return Promise.resolve();
  return switchNow(id, takeCanvasTicket());
}

async function switchNow(id: string, ticket: number): Promise<void> {
  await flushLayout();
  if (!ticketCurrent(ticket)) return;
  stashScratch();
  try {
    const data = await transport("container.show", { containerId: id }, 10000);
    const container = data?.container as ContainerRecord;
    if (!container) throw new Error("container not found");
    const stashed = await transport("layout.get", { containerId: container.id }, 10000);
    // A newer intent (a click, New) arrived while this one was in flight:
    // its canvas stands, and this reply's canvas change is dropped.
    if (!ticketCurrent(ticket)) return;
    const sessionIds = container.sessions.map((session) => session.sessionId);
    const restored = isLayout(stashed?.layout)
      ? pruneLayout(stashed.layout as DockAreaLayout, sessionIds)
      : defaultLayoutForContainer(container);
    activateCanvas(container, restored, typeof stashed?.zoom === "string" ? stashed.zoom : null);
    await hydrateVisible(container);
    if (!ticketCurrent(ticket)) return;
    await applyZoom(untracked(zoomedPanel));
    containerError.set(null);
  } catch (failure) {
    containerError.set(String(failure));
  }
}

/** Creates a pi container in `cwd` (the active one's cwd when omitted). */
export async function createContainer(cwd?: string, projectId?: string | null): Promise<string | null> {
  const ticket = takeCanvasTicket();
  const fromScratch = activeContainerId() === null;
  await flushLayout();
  if (!ticketCurrent(ticket)) return null;
  stashScratch();
  try {
    const payload: Record<string, unknown> = {};
    const target = cwd ?? activeCwd() ?? undefined;
    if (target) payload.cwd = target;
    if (projectId !== undefined) payload.projectId = projectId;
    const data = await transport("container.create", payload, 120000);
    const container = data?.container as ContainerRecord;
    const session = data?.session as SessionData | undefined;
    if (!container) throw new Error("container create returned nothing");
    if (session) adoptSession(session);
    // The scratch canvas's browser pages belong to the container it mints:
    // move them before the canvas switches, and leave the scratch one fresh.
    const moved = fromScratch ? (transferScratchSheets?.(container.id) ?? []) : [];
    if (fromScratch) scratchLayout.set(defaultScratchLayout());
    if (!ticketCurrent(ticket)) {
      // A newer intent owns the canvas; the container still exists.
      upsertContainer(container);
      return session ? session.id : null;
    }
    const sessionIds = container.sessions.map((row) => row.sessionId);
    let next = defaultLayoutForSessions(sessionIds);
    for (const sheetId of moved) next = appendSheet(next, sheetId);
    activateCanvas(container, next, null);
    await flushLayout();
    if (session) {
      focusSession(session.id);
      return session.id;
    }
    return null;
  } catch (failure) {
    containerError.set(String(failure));
    return null;
  }
}

/**
 * Creates an external container (`Terminal`/`Claude`/`Codex`/`Copilot`) and
 * shows its terminal sheet. No pi session, no composer: the container is the
 * PTY, which `TerminalBody` opens when it mounts.
 */
export async function createExternalContainer(
  kind: Exclude<ContainerKind, "Pi">,
  projectId: string | null = null,
): Promise<string | null> {
  const ticket = takeCanvasTicket();
  const fromScratch = activeContainerId() === null;
  await flushLayout();
  if (!ticketCurrent(ticket)) return null;
  stashScratch();
  try {
    const payload: Record<string, unknown> = { kind, projectId };
    // Chats: start where the active container works (an external one has a
    // cwd too), else the last pi session's directory.
    const current = containers().find((row) => row.id === activeContainerId());
    const target = projectId === null ? current?.cwd ?? activeCwd() ?? undefined : undefined;
    if (target) payload.cwd = target;
    const data = await transport("container.create", payload, 30000);
    const container = data?.container as ContainerRecord | undefined;
    if (!container) throw new Error("container create returned nothing");
    // The scratch canvas's browser pages move with the container it mints.
    const moved = fromScratch ? (transferScratchSheets?.(container.id) ?? []) : [];
    if (fromScratch) scratchLayout.set(defaultScratchLayout());
    if (!ticketCurrent(ticket)) {
      // A newer intent owns the canvas; the container still exists.
      upsertContainer(container);
      return container.id;
    }
    let next = defaultLayoutForContainer(container);
    for (const sheetId of moved) next = appendSheet(next, sheetId);
    activateCanvas(container, next, null);
    await flushLayout();
    containerError.set(null);
    return container.id;
  } catch (failure) {
    containerError.set(String(failure));
    return null;
  }
}

/** Archives a container: it leaves the sidebar and its sessions are torn down. */
export async function archiveContainer(id: string): Promise<void> {
  const ticket = takeCanvasTicket();
  try {
    const data = (await transport("container.archive", { containerId: id }, 30000)) as ContainerListData;
    // The registry first, then the processes: a terminal sheet still mounted
    // for one frame must see its container archived and not restart a PTY.
    // The removed row plays its exit before the sidebar drops it.
    // The sidebar's rows animate the removal natively: the leaving row
    // fades and the rows below slide up with it (DESIGN §3.8).
    LayoutAnimation.configureNext(LayoutAnimation.create(180));
    containers.set(data.containers ?? []);
    // An external container is its process: archiving kills its PTY before
    // the canvas switches away. A Pi container's terminals (the Hero's shell
    // and TUIs) go with it too — the container is their only home.
    closeTerminalsOfContainer(id);
    // Language servers belong to the workspace too; archiving ends them and
    // clears their diagnostics, so a dead container leaves no process behind.
    stopLspContainer(id);
    if (activeContainerId() === id) {
      savedFor = null;
      const next = data.activeContainerId;
      // The follow-up switch is part of this archive's intent: it keeps the
      // archive's ticket, so a click made while the archive was in flight
      // still owns the canvas.
      if (next) await switchNow(next, ticket);
      else if (ticketCurrent(ticket)) {
        // The last container left: the scratch canvas is where the shell
        // goes, as it does at a first launch with no registry rows.
        scratchLayout.set(withScratchHero(scratchLayout()));
        showScratch();
      }
    }
    containerError.set(null);
  } catch (failure) {
    containerError.set(String(failure));
  }
}

/** Brings an archived container back (data plane; there is no v1 UI entry). */
export async function unarchiveContainer(id: string): Promise<void> {
  try {
    const data = (await transport("container.unarchive", { containerId: id }, 30000)) as ContainerListData;
    containers.set(data.containers ?? []);
  } catch (failure) {
    containerError.set(String(failure));
  }
}

/**
 * Opens a pi session file in the workspace: switches to the container that
 * already holds it, else attaches it to the active container (creating one
 * when the canvas is empty) and appends its sheet.
 */
export async function openPath(path: string): Promise<void> {
  const owner = containers().find((container) =>
    container.sessions.some((session) => session.path === path),
  );
  if (owner) {
    await switchContainer(owner.id);
    const session = owner.sessions.find((row) => row.path === path);
    if (session) {
      const id = sessionSheetId(session.sessionId);
      if (!layoutSessions(layout()).includes(session.sessionId)) {
        noteSheetOpened(id);
        setLayout(appendSheet(layout(), id));
        await flushLayout();
      }
      focusSession(session.sessionId);
      await hydrateSession(session.sessionId, owner);
    }
    return;
  }
  let target = activeContainerId();
  if (!isPiContainer(target)) {
    // A pi session cannot live in an external (terminal/TUI) container.
    const meta = sessions().find((row) => row.path === path);
    await createContainer(meta?.cwd || activeCwd() || undefined);
    target = activeContainerId();
    if (!isPiContainer(target)) return;
  }
  try {
    const data = await transport("container.attachSession", { containerId: target, path }, 120000);
    const container = data?.container as ContainerRecord;
    const session = data?.session as SessionData | undefined;
    if (container) containers.set(containers().map((row) => (row.id === container.id ? container : row)));
    if (session) {
      adoptSession(session);
      const id = sessionSheetId(session.id);
      noteSheetOpened(id);
      setLayout(appendSheet(layout(), id));
      await flushLayout();
      focusSession(session.id);
    }
  } catch (failure) {
    containerError.set(String(failure));
  }
}

/** The DockArea layout changed: keep the tree, the visible set and the stash. */
export function setLayout(next: DockAreaLayout): void {
  const containerId = activeContainerId();
  if (containerId) pruneSheetOrder(containerId, next);
  layout.set(next);
  // The scratch canvas has no layout file; its tree lives in memory.
  if (activeContainerId() === null) scratchLayout.set(next);
  syncVisible();
  // Closing a terminal tab closes its PTY; switching containers does not go
  // through here, so a hidden container's shell keeps running.
  reconcileTerminals(next);
  scheduleSave();
  // Q69: the last sheet gone leaves no place to work — including the Hero's
  // own ×, which is why the last tab is closable at all. The archive moves
  // the canvas to the next container (or scratch) itself.
  if (containerId && sheetCount(next) === 0) void archiveContainer(containerId);
}

/** The zoom changed: remember it beside the layout (it is not in the tree). */
/** Opens an auxiliary sheet (`subagents:{containerId}`, ...) in the canvas. */
export function openAuxSheet(kind: "subagents" | "stats" | "tasks" | "traces"): void {
  const container = activeContainerId();
  if (!isPiContainer(container)) return;
  const id = `${kind}:${container}`;
  noteSheetOpened(id);
  setLayout(appendSheet(layout(), id));
}

/**
 * Opens the active canvas's Hero sheet (`home:{containerId}` /
 * `home:scratch`) in the group holding `prefer`, or as a new tab. A Hero is
 * one sheet per canvas: asking again activates the one already open.
 */
export function openHomeSheet(prefer?: string | null): void {
  const id = homeSheetId(activeContainerId());
  noteSheetOpened(id);
  const next = appendSheet(layout(), id, prefer ?? undefined);
  setLayout(next);
}

/**
 * Shows a container's captain session (the Hero's "Pi" action and its
 * composer): the sheet replaces the Hero when `fromSheet` is it, else it
 * opens beside `prefer`; its transcript loads.
 */
export async function showContainerSession(containerId: string, fromSheet?: string): Promise<void> {
  const container = containers().find((row) => row.id === containerId);
  const captain = container?.sessions[0];
  if (!container || !captain) return;
  if (activeContainerId() !== container.id) await switchContainer(container.id);
  const sheetId = sessionSheetId(captain.sessionId);
  noteSheetOpened(sheetId);
  setLayout(
    fromSheet ? replaceSheet(layout(), fromSheet, sheetId) : appendSheet(layout(), sheetId),
  );
  await hydrateSession(captain.sessionId, container);
}

/**
 * Sends a Hero's first message in a container: the container's captain
 * session sheet comes forward, its transcript opens, then the prompt goes.
 */
export async function startInContainer(
  containerId: string,
  text: string,
  heroSheetId?: string,
): Promise<boolean> {
  const prompt = text.trim();
  const container = containers().find((row) => row.id === containerId);
  const captain = container?.sessions[0];
  if (!prompt || !container || !captain) return false;
  await showContainerSession(containerId, heroSheetId);
  await send(prompt, captain.sessionId);
  return true;
}

// A TUI agent's process ending takes its sheet with it.
setProgramExitHandler((sheetId) => closeSheet(sheetId));

/** Closes one sheet: its panel leaves the layout (a sheet's own state decides
 * what else to drop). */
export function closeSheet(id: string): void {
  if (!panelIds(layout()).includes(id)) return;
  if (zoomedPanel() === id) zoomedPanel.set(null);
  setLayout(removeSheet(layout(), id));
}

/** Opens (or shows) a container's file tree sheet; any container with a cwd. */
export function openFilesSheet(containerId: string | null = activeContainerId()): void {
  if (!containerId) return;
  const id = `files:${containerId}`;
  noteSheetOpened(id);
  setLayout(appendSheet(layout(), id));
}

/** The next free terminal resource number in a container. */
function nextTerminalIndex(containerId: string): number {
  let max = 0;
  for (const id of [...panelIds(layout()), ...Object.keys(terminalInfo())]) {
    const resource = terminalResource(id);
    if (resource && resource.containerId === containerId) max = Math.max(max, resource.index);
  }
  return max + 1;
}

/**
 * Opens a terminal resource in a container: a plain shell, an agent's TUI or
 * the native `pi` TUI. The container is the terminal's home — a Pi container
 * holding a shell beside a TUI is one sidebar row with several tabs — and a
 * Hero's action replaces the Hero sheet with it (`fromSheet`).
 */
export function openTerminalSheet(
  containerId: string,
  action: TerminalAction,
  fromSheet?: string,
): string | null {
  const container = containers().find((row) => row.id === containerId);
  if (!container || activeContainerId() !== containerId) return null;
  const sheetId = terminalSheetId(containerId, nextTerminalIndex(containerId));
  registerTerminal(sheetId, action);
  noteSheetOpened(sheetId);
  setLayout(fromSheet ? replaceSheet(layout(), fromSheet, sheetId) : appendSheet(layout(), sheetId));
  return sheetId;
}

export function setZoom(panel: string | null): void {
  zoomedPanel.set(panel);
  syncVisible();
  scheduleSave();
}

/** A panel became the displayed tab: focus and hydrate its session. */
export function onPanelActive(panel: string, active: boolean): void {
  if (!active) return;
  if (terminalSheetContainer(panel)) {
    focusTerminal(panel);
    return;
  }
  const sessionId = sessionIdOfSheet(panel);
  if (!sessionId) return;
  focusSession(sessionId);
  void hydrateSession(sessionId);
}

/** Writes the active container's layout now (switch, create, app close).
 * The scratch canvas has no layout file: nothing to write. */
export async function flushLayout(): Promise<void> {
  clearTimeout(saveTimer);
  saveTimer = null;
  const id = activeContainerId();
  if (!id) return;
  try {
    await transport("layout.put", { containerId: id, layout: layout(), zoom: zoomedPanel() }, 10000);
  } catch (failure) {
    containerError.set(String(failure));
  }
}

function scheduleSave(): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void flushLayout();
  }, 400);
}

/** Recomputes which sheets are visible (the throttle's input). */
export function syncVisible(): void {
  visiblePanels.set(activePanelIds(layout(), zoomedPanel()));
}

function isLayout(value: unknown): boolean {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as any).center === "object"
  );
}

async function hydrateVisible(container: ContainerRecord): Promise<void> {
  const shown = visiblePanels()
    .map(sessionIdOfSheet)
    .filter((id): id is string => !!id);
  for (const sessionId of shown) await hydrateSession(sessionId, container);
  const first = shown[0];
  if (first) focusSession(first);
}

/** Opens (or focuses) one session of a container by its file path. */
export async function hydrateSession(sessionId: string, owner?: ContainerRecord): Promise<void> {
  const container = owner ?? containers().find((row) => row.id === activeContainerId());
  const session = container?.sessions.find((row) => row.sessionId === sessionId);
  if (!session) return;
  if (!session.path) {
    focusSession(sessionId);
    return;
  }
  const view = viewFor(sessionId);
  if (view?.loaded) {
    focusSession(sessionId);
    return;
  }
  await openSession(session.path);
  focusSession(sessionId);
}

/**
 * Puts the saved zoom back through the DockArea ref: leave any current zoom,
 * then zoom the group that holds `panel` (a passed group id would change
 * across a re-layout, a panel id does not).
 */
export async function applyZoom(panel: string | null): Promise<void> {
  if (!dock) return;
  const current = await dock.zoomedGroup();
  if (current !== null) dock.toggleZoom(current);
  if (!panel) return;
  // Let the controlled layout reach the area before asking where the panel is.
  await new Promise<void>((resolve) => setTimeout(resolve, 16));
  const group = await dock.groupOf(panel);
  if (group !== null) {
    dock.toggleZoom(group);
  } else {
    // The stashed panel was pruned from the layout (its session left the
    // container): a zoom with no panel would hide every sheet.
    zoomedPanel.set(null);
    syncVisible();
  }
}

/** The number of live containers (sidebar badge). */
export function containerCount(): number {
  return liveContainers().length;
}
