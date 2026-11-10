import { signal, untracked } from "nsh";
import type { DockAreaRef } from "nsh/base";
import { request } from "./engine";
import type {
  ContainerKind,
  ContainerListData,
  ContainerRecord,
  SessionData,
} from "./contracts/protocol";
import {
  activePanelIds,
  appendSheet,
  defaultLayoutForSessions,
  layoutSessions,
  panelIds,
  pruneLayout,
  removeSheet,
  sessionIdOfSheet,
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
  sessions,
  sessionTitle,
  viewFor,
} from "./sessions";
import { stopLspContainer } from "./lsp";
import {
  closeTerminal,
  containerOfTerminalSheet,
  externalKindLabel,
  focusTerminal,
  reconcileTerminals,
  terminalSheetId,
  terminalTitle,
} from "./terminals";

/**
 * The container store: the sidebar's rows, the active container and its
 * view stash. Switching rows saves the current DockArea layout through the
 * engine, then restores the target's layout, zoom and session transcripts.
 *
 * The engine owns the registry and the layout files; this store is the
 * shell's projection. A sheet id is `session:{sessionId}` and is stable
 * across drags, so `renderPanel` keeps its state while the layout moves.
 */

/** Every container, archived ones included (the sidebar filters). */
export const containers = signal<ContainerRecord[]>([]);
/** The container whose canvas is shown, or null for an empty canvas. */
export const activeContainerId = signal<string | null>(null);
/** The active container's DockArea layout. */
export const layout = signal<DockAreaLayout>(defaultLayoutForSessions([]));
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

/** Replaces the engine transport (tests drive the store without a sidecar). */
export function setContainerTransport(next: ContainerTransport | null): void {
  transport = next ?? request;
}

/** The rows the sidebar shows, newest activity first. */
export function liveContainers(): ContainerRecord[] {
  return containers()
    .filter((container) => !container.archived)
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** A container's label: its captain's session title, an external TUI's
 * terminal title, else the kind and cwd. */
export function containerTitle(container: ContainerRecord): string {
  const captain = container.sessions[0];
  if (captain) return sessionTitle(captain.sessionId);
  if (container.kind !== "Pi") {
    const title = terminalTitle(container.id);
    if (title) return title;
    return externalKindLabel(container.kind);
  }
  return container.cwd.split("/").filter(Boolean).slice(-2).join("/") || container.id;
}

/** The canvas of a new or not-yet-stashed container: a terminal for an
 * external one, one sheet per session otherwise. */
export function defaultLayoutForContainer(container: ContainerRecord): DockAreaLayout {
  if (container.kind !== "Pi") {
    return { center: { type: "tabs", panels: [terminalSheetId(container.id)], activeIndex: 0 } };
  }
  return defaultLayoutForSessions(container.sessions.map((session) => session.sessionId));
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
    await refreshSessions();
    if (id) {
      await switchContainer(id, true);
    } else {
      activeContainerId.set(null);
      savedFor = null;
      layout.set(defaultLayoutForSessions([]));
      zoomedPanel.set(null);
      visiblePanels.set([]);
    }
  } catch (failure) {
    containerError.set(String(failure));
  } finally {
    containersLoaded.set(true);
  }
}

/**
 * Makes `id` active. `force` reloads even when it is already shown (a
 * reconnect or a fresh registry load).
 */
export async function switchContainer(id: string, force = false): Promise<void> {
  if (!force && activeContainerId() === id && savedFor === id) return;
  await flushLayout();
  try {
    const data = await transport("container.show", { containerId: id }, 10000);
    const container = data?.container as ContainerRecord;
    if (!container) throw new Error("container not found");
    containers.set(containers().map((row) => (row.id === container.id ? container : row)));
    activeContainerId.set(container.id);
    savedFor = container.id;
    const stashed = await transport("layout.get", { containerId: container.id }, 10000);
    const sessionIds = container.sessions.map((session) => session.sessionId);
    const restored = isLayout(stashed?.layout)
      ? pruneLayout(stashed.layout as DockAreaLayout, sessionIds)
      : defaultLayoutForContainer(container);
    layout.set(restored);
    zoomedPanel.set(typeof stashed?.zoom === "string" ? stashed.zoom : null);
    syncVisible();
    await hydrateVisible(container);
    await applyZoom(untracked(zoomedPanel));
    containerError.set(null);
  } catch (failure) {
    containerError.set(String(failure));
  }
}

/** Creates a pi container in `cwd` (the active one's cwd when omitted). */
export async function createContainer(cwd?: string, projectId?: string | null): Promise<string | null> {
  await flushLayout();
  try {
    const payload: Record<string, unknown> = {};
    const target = cwd ?? activeCwd() ?? undefined;
    if (target) payload.cwd = target;
    if (projectId !== undefined) payload.projectId = projectId;
    const data = await transport("container.create", payload, 120000);
    const container = data?.container as ContainerRecord;
    const session = data?.session as SessionData | undefined;
    if (!container) throw new Error("container create returned nothing");
    containers.set([...containers(), container]);
    activeContainerId.set(container.id);
    savedFor = container.id;
    if (session) adoptSession(session);
    const sessionIds = container.sessions.map((row) => row.sessionId);
    layout.set(defaultLayoutForSessions(sessionIds));
    zoomedPanel.set(null);
    syncVisible();
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
  await flushLayout();
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
    containers.set([...containers(), container]);
    activeContainerId.set(container.id);
    savedFor = container.id;
    layout.set(defaultLayoutForContainer(container));
    zoomedPanel.set(null);
    syncVisible();
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
  try {
    const data = (await transport("container.archive", { containerId: id }, 30000)) as ContainerListData;
    // An external container is its process: archiving kills the PTY before
    // the canvas switches away (the handle is not tied to the sheet).
    closeTerminal(id);
    // Language servers belong to the workspace too; archiving ends them and
    // clears their diagnostics, so a dead container leaves no process behind.
    stopLspContainer(id);
    containers.set(data.containers ?? []);
    if (activeContainerId() === id) {
      savedFor = null;
      const next = data.activeContainerId;
      if (next) await switchContainer(next, true);
      else {
        activeContainerId.set(null);
        layout.set(defaultLayoutForSessions([]));
        zoomedPanel.set(null);
        visiblePanels.set([]);
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
        layout.set(appendSheet(layout(), id));
        syncVisible();
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
      layout.set(appendSheet(layout(), id));
      syncVisible();
      await flushLayout();
      focusSession(session.id);
    }
  } catch (failure) {
    containerError.set(String(failure));
  }
}

/** The DockArea layout changed: keep the tree, the visible set and the stash. */
export function setLayout(next: DockAreaLayout): void {
  layout.set(next);
  syncVisible();
  // Closing a terminal tab closes its PTY; switching containers does not go
  // through here, so a hidden container's shell keeps running.
  reconcileTerminals(next);
  scheduleSave();
}

/** The zoom changed: remember it beside the layout (it is not in the tree). */
/** Opens an auxiliary sheet (`subagents:{containerId}`, ...) in the canvas. */
export function openAuxSheet(kind: "subagents" | "stats" | "tasks" | "traces"): void {
  const container = activeContainerId();
  if (!isPiContainer(container)) return;
  const id = `${kind}:${container}`;
  layout.set(appendSheet(layout(), id));
  syncVisible();
  scheduleSave();
}

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
  layout.set(appendSheet(layout(), id));
  syncVisible();
  scheduleSave();
}

export function setZoom(panel: string | null): void {
  zoomedPanel.set(panel);
  syncVisible();
  scheduleSave();
}

/** A panel became the displayed tab: focus and hydrate its session. */
export function onPanelActive(panel: string, active: boolean): void {
  if (!active) return;
  const terminalId = containerOfTerminalSheet(panel);
  if (terminalId) {
    focusTerminal(terminalId);
    return;
  }
  const sessionId = sessionIdOfSheet(panel);
  if (!sessionId) return;
  focusSession(sessionId);
  void hydrateSession(sessionId);
}

/** Writes the active container's layout now (switch, create, app close). */
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
