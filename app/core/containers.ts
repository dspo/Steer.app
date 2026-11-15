import { LayoutAnimation, signal, untracked } from "nsh";
import type { DockAreaRef } from "nsh/base";
import { readState, writeState, layoutName } from "../domains/state";
import { State as NativeState } from "../domains/state";
import type { ContainerLayoutData, ContainerListData, ContainerRecord } from "./types";
import {
  SCRATCH_SHEET,
  activePanelIds,
  appendSheet,
  defaultLayoutForSheets,
  homeSheetId,
  panelIds,
  pruneLayout,
  removeSheet,
  replaceSheet,
  sheetCount,
  visiblePanels,
  type DockAreaLayout,
} from "./dock";
import { notifyContainerArchived, notifyContainerShown, notifyLayoutChanged, notifySheetActivated, restoreSheetIds } from "./registry";

/**
 * The container store: the sidebar's rows, the active container and its view
 * stash (docs/sheet-module-ARCHITECTURE.md §3). A container is an
 * organizational unit — `{ id, cwd, projectId, sheetOrder }` — and carries no
 * harness identity: which sheets it holds (and therefore which module talks to
 * which process) is entirely in the layout and the registry.
 *
 * Since the v2 writer inversion the UI owns the registry: rows, the active
 * container and layout files are written here through `zu/state`. Creating a
 * conversation, opening a session file, minting a terminal and hydrating a
 * transcript are **module** operations; they call the generic primitives here
 * (`createContainerRecord`, `openHomeSheet`, `setLayout`, ...).
 */

/** Every container, archived ones included (the sidebar filters). */
export const containers = signal<ContainerRecord[]>([]);
/** The container whose canvas is shown; `null` is the scratch canvas. */
export const activeContainerId = signal<string | null>(null);
/** The active canvas's DockArea layout. */
export const layout = signal<DockAreaLayout>(defaultLayoutForSheets([]));
/**
 * The canvases put aside, by container id. Their sheets stay mounted
 * (`canvas/sheet-host.tsx`): a browser keeps its page, a terminal its screen.
 */
export const heldLayouts = signal<Record<string, DockAreaLayout>>({});
/** The scratch canvas's layout: in memory only, like the canvas itself. */
const scratchLayout = signal<DockAreaLayout>(defaultScratchLayout());
/** The zoomed panel's id, or null (DockArea keeps zoom outside the layout). */
export const zoomedPanel = signal<string | null>(null);
/** The last container/layout failure, shown in the status line. */
export const containerError = signal<string | null>(null);
/** The registry's first load is done: creating/opening a container can begin. */
export const containersLoaded = signal(false);

type ContainerTransport = (type: string, payload?: Record<string, unknown>, timeoutMs?: number) => Promise<any>;

let dock: DockAreaRef | undefined;
let saveTimer: any = null;
let savedFor: string | null = null;
/** Test seam: a fixture may drive container/layout I/O instead of `zu/state`.
 * The packaged app never sets it. */
let transport: ContainerTransport | null = null;

/** Every canvas intent takes a ticket; a late reply must not win. */
let canvasTicket = 0;

function takeCanvasTicket(): number {
  return ++canvasTicket;
}

function ticketCurrent(ticket: number): boolean {
  return ticket === canvasTicket;
}

/** Replaces the fixture transport (null = zu/state). */
export function setContainerTransport(next: ContainerTransport | null): void {
  transport = next;
}

/** How the scratch canvas's sheets move onto a container it mints (a module
 * that owns scratch pages installs this; core only needs the new ids). */
let transferScratchSheets: ((containerId: string) => string[]) | null = null;

/** Installs (or clears) the scratch-canvas sheet transfer. */
export function setScratchSheetTransfer(next: ((containerId: string) => string[]) | null): void {
  transferScratchSheets = next;
}

/** Live containers, newest activity first (stable tie-breaks). */
export function liveContainers(): ContainerRecord[] {
  return containers()
    .filter((container) => !container.archived)
    .slice()
    .sort(
      (a, b) =>
        b.updatedAt - a.updatedAt ||
        b.createdAt - a.createdAt ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
}

/** Each container's sheets in creation order (the container title's input). */
export const sheetOrder = signal<Record<string, string[]>>({});

/** Notes a sheet as newly opened on the active canvas. */
export function noteSheetOpened(id: string): void {
  const containerId = activeContainerId();
  if (!containerId) return;
  const current = sheetOrder()[containerId] ?? [];
  if (current.includes(id)) return;
  sheetOrder.set({ ...sheetOrder(), [containerId]: [...current, id] });
  void saveRegistry();
}

/** Drops sheets that left the layout; an open sheet keeps its place. */
function pruneSheetOrder(containerId: string, next: DockAreaLayout): void {
  const current = sheetOrder()[containerId];
  if (!current) return;
  const alive = new Set(panelIds(next));
  const order = current.filter((id) => alive.has(id));
  if (order.length !== current.length) {
    sheetOrder.set({ ...sheetOrder(), [containerId]: order });
    void saveRegistry();
  }
}

/** Seeds a container's order from its layout when nothing is recorded yet. */
function seedSheetOrder(containerId: string, current: DockAreaLayout): void {
  if (sheetOrder()[containerId]) return;
  sheetOrder.set({ ...sheetOrder(), [containerId]: panelIds(current) });
  void saveRegistry();
}

/** Seeds the title order from the rows' persisted `sheetOrder`. */
function adoptSheetOrder(rows: ContainerRecord[]): void {
  const next = { ...sheetOrder() };
  for (const row of rows) {
    if (!next[row.id]?.length && row.sheetOrder?.length) next[row.id] = row.sheetOrder;
  }
  sheetOrder.set(next);
}

/** The scratch canvas before anything happens on it: its Hero sheet. */
function defaultScratchLayout(): DockAreaLayout {
  return defaultLayoutForSheets([SCRATCH_SHEET]);
}

function withScratchHero(current: DockAreaLayout): DockAreaLayout {
  return appendSheet(current, SCRATCH_SHEET);
}

function stashScratch(): void {
  if (activeContainerId() === null) scratchLayout.set(layout());
}

function showScratch(): void {
  activeContainerId.set(null);
  savedFor = null;
  layout.set(scratchLayout());
  zoomedPanel.set(null);
  syncVisible();
}

/** "New": the scratch canvas with its Hero sheet. */
export async function openScratch(): Promise<void> {
  const ticket = takeCanvasTicket();
  if (activeContainerId() !== null) await flushLayout();
  if (!ticketCurrent(ticket)) return;
  const base = activeContainerId() === null ? layout() : scratchLayout();
  scratchLayout.set(withScratchHero(base));
  showScratch();
  containerError.set(null);
}

/** The container a sheet belongs to, from the creation-order record. */
export function containerOfSheet(id: string): string | null {
  for (const [containerId, ids] of Object.entries(sheetOrder())) {
    if (ids.includes(id)) return containerId;
  }
  const active = activeContainerId();
  return active && panelIds(layout()).includes(id) ? active : null;
}

/**
 * Displays a sheet the canvas already holds — the tab strip's own activation
 * (`DockAreaRef.selectPanel`), which reports the new layout back. The content
 * carousel calls it when its index moves, so a swipe and a tab press land in
 * the same place.
 */
export function showSheet(id: string): void {
  dock?.selectPanel(id);
}

/** Gives the store the DockArea it restores zoom through. */
export function bindDock(ref: DockAreaRef | undefined): void {
  dock = ref;
  const wanted = untracked(zoomedPanel);
  if (dock && wanted) void applyZoom(wanted);
}

// --- the registry fold (zu/state) -------------------------------------------

interface RegistryFile {
  containers?: ContainerRecord[];
  activeContainerId?: string | null;
}

async function saveRegistry(): Promise<void> {
  if (transport) return;
  try {
    await writeState("registry.json", {
      containers: containers().map((row) => ({ ...row, sheetOrder: sheetOrder()[row.id] ?? row.sheetOrder ?? [] })),
      activeContainerId: activeContainerId(),
    });
  } catch (failure) {
    containerError.set(String(failure));
  }
}

/** Adds or replaces a container's row, then persists the registry. */
function upsertContainer(container: ContainerRecord): void {
  const rows = containers();
  containers.set(
    rows.some((row) => row.id === container.id)
      ? rows.map((row) => (row.id === container.id ? container : row))
      : [...rows, container],
  );
  void saveRegistry();
}

/** Puts `container` on the canvas with `next` as its layout. */
function activateCanvas(container: ContainerRecord, next: DockAreaLayout, zoom: string | null): void {
  stashHeld();
  upsertContainer(container);
  activeContainerId.set(container.id);
  savedFor = container.id;
  layout.set(next);
  seedSheetOrder(container.id, next);
  zoomedPanel.set(zoom);
  syncVisible();
  void saveRegistry();
  notifyContainerShown(container.id);
}

/** Drops the put-aside canvases of containers that are gone: a parked web
 * page must not keep running for a container nobody can open. */
function pruneHeld(): void {
  const live = new Set(liveContainers().map((row) => row.id));
  const held = heldLayouts();
  const kept: Record<string, DockAreaLayout> = {};
  let changed = false;
  for (const [id, layout] of Object.entries(held)) {
    if (live.has(id)) kept[id] = layout;
    else changed = true;
  }
  if (changed) heldLayouts.set(kept);
}

/** Puts the canvas being replaced aside, so its sheets stay mounted. */
function stashHeld(): void {
  const current = activeContainerId();
  if (!current) return; // the scratch canvas keeps its own (`scratchLayout`)
  heldLayouts.set({ ...heldLayouts(), [current]: layout() });
}

/** Loads the registry and shows its active container (startup). */
export async function loadContainers(): Promise<void> {
  containersLoaded.set(false);
  try {
    if (transport) {
      const data = (await transport("container.list", {}, 10000)) as ContainerListData;
      containers.set(data.containers ?? []);
      adoptSheetOrder(data.containers ?? []);
      const id = data.activeContainerId ?? liveContainers()[0]?.id ?? null;
      if (id) await switchContainer(id, true);
      else {
        scratchLayout.set(withScratchHero(scratchLayout()));
        showScratch();
      }
    } else {
      const file = await readState<RegistryFile>("registry.json");
      const rows = (file?.containers ?? []).filter((row) => !!row && typeof row.id === "string");
      containers.set(rows);
      adoptSheetOrder(rows);
      const id = file?.activeContainerId ?? liveContainers()[0]?.id ?? null;
      if (id && rows.some((row) => row.id === id && !row.archived)) await switchContainer(id, true);
      else if (liveContainers()[0]) await switchContainer(liveContainers()[0]!.id, true);
      else {
        scratchLayout.set(withScratchHero(scratchLayout()));
        showScratch();
      }
    }
  } catch (failure) {
    containerError.set(String(failure));
  } finally {
    containersLoaded.set(true);
  }
}

/** Makes `id` active. `force` reloads an already-shown container. */
export function switchContainer(id: string, force = false): Promise<void> {
  if (!force && activeContainerId() === id && savedFor === id) return Promise.resolve();
  return switchNow(id, takeCanvasTicket());
}

async function switchNow(id: string, ticket: number): Promise<void> {
  await flushLayout();
  if (!ticketCurrent(ticket)) return;
  stashScratch();
  try {
    const container = containers().find((row) => row.id === id && !row.archived);
    if (!container) throw new Error("container not found");
    const stashed = await readLayout(container.id);
    if (!ticketCurrent(ticket)) return;
    let restored: DockAreaLayout;
    if (stashed && isLayout(stashed.layout)) {
      const ids = panelIds(stashed.layout as DockAreaLayout);
      const kept = await restoreSheetIds(ids);
      restored = pruneLayout(stashed.layout as DockAreaLayout, new Set(kept));
      if (panelIds(restored).length === 0) restored = defaultCanvasFor(container);
    } else {
      restored = defaultCanvasFor(container);
    }
    activateCanvas({ ...container }, restored, typeof stashed?.zoom === "string" ? stashed.zoom : null);
    await applyZoom(untracked(zoomedPanel));
    containerError.set(null);
  } catch (failure) {
    containerError.set(String(failure));
  }
}

/** The canvas for a container with no stashed layout: its recorded sheets,
 * else its Hero. */
function defaultCanvasFor(container: ContainerRecord): DockAreaLayout {
  const known = sheetOrder()[container.id] ?? [];
  return known.length > 0 ? defaultLayoutForSheets(known) : defaultLayoutForSheets([homeSheetId(container.id)]);
}

/**
 * Mints a container and shows it. The **caller owns its identity and its
 * sheets**: a conversation module passes its session sheet, a terminal module
 * its terminal resource; nothing here knows a harness.
 */
export interface CreateContainerOptions {
  /** The full id (`pi:{sessionId}`, `external:{kind}:{uuid}`). */
  id: string;
  cwd: string;
  projectId?: string | null;
  /** The sheets the new container starts with (in creation order). */
  sheets: string[];
}

export function createContainerRecord(options: CreateContainerOptions): Promise<ContainerRecord | null> {
  return createNow(options, takeCanvasTicket());
}

async function createNow(options: CreateContainerOptions, ticket: number): Promise<ContainerRecord | null> {
  const fromScratch = activeContainerId() === null;
  await flushLayout();
  if (!ticketCurrent(ticket)) return null;
  stashScratch();
  try {
    const now = Date.now();
    const container: ContainerRecord = {
      id: options.id,
      cwd: options.cwd,
      archived: false,
      createdAt: now,
      updatedAt: now,
      ...(options.projectId !== undefined ? { projectId: options.projectId } : {}),
    };
    const moved = fromScratch ? (transferScratchSheets?.(container.id) ?? []) : [];
    if (fromScratch) scratchLayout.set(defaultScratchLayout());
    upsertContainer(container);
    noteMembership(container.id, options.projectId ?? null);
    if (!ticketCurrent(ticket)) return container;
    const sheets = [...options.sheets, ...moved];
    activateCanvas(container, defaultLayoutForSheets(sheets.length ? sheets : [homeSheetId(container.id)]), null);
    await flushLayout();
    return container;
  } catch (failure) {
    containerError.set(String(failure));
    return null;
  }
}

/** The last-resort folder: the home folder, not the app's launch directory. */
function homeFallback(): string | undefined {
  const home = NativeState.homeDir();
  return home === null || home === undefined ? undefined : home;
}

/** A place to start when the caller names none. */
export function fallbackCwd(): string | undefined {
  return activeCwd() || homeFallback();
}

/** The active workspace cwd, when a container is shown. */
export function activeCwd(): string | undefined {
  return containers().find((row) => row.id === activeContainerId())?.cwd;
}

/** The membership writer, installed by the projects store (its signal). */
let membershipWriter: ((containerId: string, projectId: string | null) => void) | null = null;

export function setMembershipWriter(next: ((containerId: string, projectId: string | null) => void) | null): void {
  membershipWriter = next;
}

/** The project-cwd resolver, installed by the projects store. */
let projectCwdResolver: ((projectId: string) => string | null) | null = null;

export function setProjectCwdResolver(next: ((projectId: string) => string | null) | null): void {
  projectCwdResolver = next;
}

export function projectCwd(projectId: string | null | undefined): string | undefined {
  if (!projectId) return undefined;
  return projectCwdResolver?.(projectId) ?? undefined;
}

function noteMembership(containerId: string, projectId: string | null): void {
  membershipWriter?.(containerId, projectId);
}

/** Archives a container: it leaves the sidebar, its modules tear down their
 * resources, and the canvas moves on. */
export async function archiveContainer(id: string): Promise<void> {
  const ticket = takeCanvasTicket();
  if (transport) {
    try {
      const data = (await transport("container.archive", { containerId: id }, 30000)) as ContainerListData;
      LayoutAnimation.configureNext(LayoutAnimation.create(180));
      containers.set(data.containers ?? []);
      pruneHeld();
      notifyContainerArchived(id);
      if (activeContainerId() === id) {
        savedFor = null;
        const next = data.activeContainerId;
        if (next) await switchNow(next, ticket);
        else if (ticketCurrent(ticket)) {
          scratchLayout.set(withScratchHero(scratchLayout()));
          showScratch();
        }
      }
      containerError.set(null);
    } catch (failure) {
      containerError.set(String(failure));
    }
    return;
  }
  try {
    LayoutAnimation.configureNext(LayoutAnimation.create(180));
    containers.set(
      containers().map((row) => (row.id === id ? { ...row, archived: true, updatedAt: Date.now() } : row)),
    );
    void saveRegistry();
    pruneHeld();
    notifyContainerArchived(id);
    if (activeContainerId() === id) {
      savedFor = null;
      const next = liveContainers()[0]?.id ?? null;
      if (next) await switchNow(next, ticket);
      else if (ticketCurrent(ticket)) {
        scratchLayout.set(withScratchHero(scratchLayout()));
        showScratch();
      }
    }
    containerError.set(null);
  } catch (failure) {
    containerError.set(String(failure));
  }
}

/** Brings an archived container back (data plane; no v1 UI entry). */
export async function unarchiveContainer(id: string): Promise<void> {
  if (transport) {
    try {
      const data = (await transport("container.unarchive", { containerId: id }, 30000)) as ContainerListData;
      containers.set(data.containers ?? []);
    } catch (failure) {
      containerError.set(String(failure));
    }
    return;
  }
  containers.set(containers().map((row) => (row.id === id ? { ...row, archived: false } : row)));
  void saveRegistry();
}

/** The DockArea layout changed: keep the tree, the visible set and the stash. */
export function setLayout(next: DockAreaLayout): void {
  const containerId = activeContainerId();
  if (containerId) pruneSheetOrder(containerId, next);
  layout.set(next);
  if (activeContainerId() === null) scratchLayout.set(next);
  syncVisible();
  notifyLayoutChanged(panelIds(next));
  scheduleSave();
  // Q69: the last sheet gone leaves no place to work — including the Hero's
  // own ×, which is why the last tab is closable at all.
  if (containerId && sheetCount(next) === 0) void archiveContainer(containerId);
}

/** Opens (or activates) the active canvas's Hero sheet. */
export function openHomeSheet(prefer?: string | null): void {
  const id = homeSheetId(activeContainerId());
  noteSheetOpened(id);
  setLayout(appendSheet(layout(), id, prefer ?? undefined));
}

/** Closes one sheet: its panel leaves the layout. */
export function closeSheet(id: string): void {
  if (!panelIds(layout()).includes(id)) return;
  if (zoomedPanel() === id) zoomedPanel.set(null);
  setLayout(removeSheet(layout(), id));
}

/** Opens (or focuses) a sheet on the active canvas, replacing `from` if given. */
export function openSheet(id: string, from?: string): void {
  noteSheetOpened(id);
  setLayout(from ? replaceSheet(layout(), from, id) : appendSheet(layout(), id));
}

export function setZoom(panel: string | null): void {
  zoomedPanel.set(panel);
  syncVisible();
  scheduleSave();
}

/** A panel became the displayed tab: the owning module focuses/hydrates it. */
export function onPanelActive(panel: string, active: boolean): void {
  if (!active) return;
  notifySheetActivated(panel);
}

/** Writes the active container's layout now. */
export async function flushLayout(): Promise<void> {
  clearTimeout(saveTimer);
  saveTimer = null;
  const id = activeContainerId();
  if (!id) return;
  try {
    if (transport) {
      await transport("layout.put", { containerId: id, layout: layout(), zoom: zoomedPanel() }, 10000);
    } else {
      await writeState(layoutName(id), {
        containerId: id,
        layout: layout(),
        zoom: zoomedPanel(),
        updatedAt: Date.now(),
      });
    }
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
  return !!value && typeof value === "object" && !Array.isArray(value) && typeof (value as any).center === "object";
}

async function readLayout(containerId: string): Promise<ContainerLayoutData | null> {
  if (transport) {
    return (await transport("layout.get", { containerId }, 10000)) as ContainerLayoutData | null;
  }
  return readState<ContainerLayoutData>(layoutName(containerId));
}

/**
 * Puts the saved zoom back through the DockArea ref: leave any current zoom,
 * then zoom the group that holds `panel`.
 */
export async function applyZoom(panel: string | null): Promise<void> {
  if (!dock) return;
  const current = await dock.zoomedGroup();
  if (current !== null) dock.toggleZoom(current);
  if (!panel) return;
  await new Promise<void>((resolve) => setTimeout(resolve, 16));
  const group = await dock.groupOf(panel);
  if (group !== null) {
    dock.toggleZoom(group);
  } else {
    zoomedPanel.set(null);
    syncVisible();
  }
}
