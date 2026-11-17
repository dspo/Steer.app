import {
  activeContainerId,
  activeCwd,
  containers,
  createContainerRecord,
  fallbackCwd,
  layout,
  noteSheetOpened,
  openSheet,
  projectCwd,
  setLayout,
  sheetOrder,
  switchContainer,
} from "../../core/containers";
import type { ContainerRecord } from "../../core/types";
import { appendSheet, panelIds, replaceSheet, visiblePanels } from "../../core/dock";
import { applySessionConfig, createSession, focusSession, openSession, refreshSessions, send, sessions, setSessionLoading, viewFor } from "./sessions";
import { defaultLayoutForSessions, layoutSessions, sessionIdOfSheet, sessionSheetId } from "./sheets";

/**
 * The pi module's container operations (docs/sheet-module-ARCHITECTURE.md §8):
 * creating a conversation, showing its captain, opening a session file, and
 * hydrating a visible transcript. The core container store knows none of this;
 * it only mints rows and switches canvases.
 */

/** The pi session ids a container holds, in creation order. */
export function sessionIdsOfContainer(containerId: string): string[] {
  const ids = (sheetOrder()[containerId] ?? []).map(sessionIdOfSheet).filter((id): id is string => !!id);
  if (ids.length) return ids;
  if (containerId === activeContainerId()) return layoutSessions(layout());
  return [];
}

/** The module's own container → session projection (the doc's replacement
 * for the old record field). It survives a closed tab: the captain is the
 * conversation, not the tab. */
const sessionsByContainer = new Map<string, string[]>();

/** Remembers the sessions a container is known to hold (from its sheets). */
export function rememberContainerSessions(containerId: string): string[] {
  const known = sessionsByContainer.get(containerId) ?? [];
  const fromOrder = sessionIdsOfContainer(containerId);
  const fromLayout = containerId === activeContainerId() ? layoutSessions(layout()) : [];
  const merged = [...new Set([...known, ...fromOrder, ...fromLayout])];
  if (merged.length) sessionsByContainer.set(containerId, merged);
  return merged;
}

/** The sessions the module believes a container holds. */
export function knownSessionIds(containerId: string): string[] {
  return sessionsByContainer.get(containerId) ?? [];
}

/** Whether a container holds at least one pi session sheet. */
export function hostsPi(containerId: string | null): boolean {
  return !!containerId && sessionIdsOfContainer(containerId).length > 0;
}

/**
 * Creates a pi container in `cwd` and shows it. The container id carries the
 * session id (`pi:{sessionId}`) as before, but the record itself is generic;
 * the session is this module's.
 */
export async function createContainer(
  cwd?: string,
  projectId?: string | null,
  prefs: { model?: string | null; effort?: string | null } = {},
): Promise<string | null> {
  try {
    const target = cwd || projectCwd(projectId) || activeCwd() || fallbackCwd();
    if (!target) throw new Error("no folder to start the conversation in");
    const sessionId = await createSession(target);
    await applySessionConfig(sessionId, prefs);
    const view = viewFor(sessionId);
    const container = await createContainerRecord({
      id: `pi:${sessionId}`,
      cwd: target,
      ...(projectId !== undefined ? { projectId } : {}),
      sheets: [sessionSheetId(sessionId)],
    });
    if (!container) return sessionId;
    sessionsByContainer.set(container.id, [...new Set([...(sessionsByContainer.get(container.id) ?? []), sessionId])]);
    focusSession(sessionId);
    void view;
    return sessionId;
  } catch (failure) {
    throw failure;
  }
}

/** Creates (or reuses) the captain session of a container and returns its id. */
async function ensureCaptain(container: ContainerRecord): Promise<string | null> {
  const existing = [...knownSessionIds(container.id), ...rememberContainerSessions(container.id)];
  if (existing[0]) return existing[0];
  const sessionId = await createSession(container.cwd);
  sessionsByContainer.set(container.id, [...knownSessionIds(container.id), sessionId]);
  openSheet(sessionSheetId(sessionId));
  return sessionId;
}

/**
 * Shows a container's captain session: its sheet replaces the Hero when
 * `fromSheet` is it, else it opens beside `prefer`; its transcript loads.
 */
export async function showContainerSession(containerId: string, fromSheet?: string): Promise<void> {
  const container = containers().find((row) => row.id === containerId);
  if (!container) return;
  if (activeContainerId() !== container.id) await switchContainer(container.id);
  const sessionId = await ensureCaptain(container);
  if (!sessionId) return;
  const sheetId = sessionSheetId(sessionId);
  noteSheetOpened(sheetId);
  setLayout(fromSheet ? replaceSheet(layout(), fromSheet, sheetId) : appendSheet(layout(), sheetId));
  await hydrateSession(sessionId);
}

/** Sends a Hero's first message in a container's captain session. */
export async function startInContainer(containerId: string, text: string, heroSheetId?: string): Promise<boolean> {
  const prompt = text.trim();
  if (!prompt) return false;
  const container = containers().find((row) => row.id === containerId);
  if (!container) return false;
  await showContainerSession(containerId, heroSheetId);
  const sessionId = sessionIdsOfContainer(containerId)[0];
  if (!sessionId) return false;
  await send(prompt, sessionId);
  return true;
}

/** From a fresh canvas: a pi container plus the first message. */
export async function startFromScratch(
  text: string,
  target: {
    cwd?: string;
    projectId?: string | null;
    model?: string | null;
    effort?: string | null;
  } = {},
): Promise<boolean> {
  const prompt = text.trim();
  if (!prompt) return false;
  const sessionId = await createContainer(target.cwd, target.projectId, {
    model: target.model,
    effort: target.effort,
  });
  if (!sessionId) return false;
  await send(prompt, sessionId);
  return true;
}

/**
 * Opens a pi session file in the workspace: switches to the container that
 * already holds it, else attaches it to the active container (creating one
 * when the canvas is empty) and appends its sheet.
 */
export async function openPath(path: string): Promise<void> {
  const meta = sessions().find((row) => row.path === path);
  const sessionId = meta?.id ?? sessionIdOfPath(path) ?? path;
  const owner = containers().find((container) =>
    sessionIdsOfContainer(container.id).includes(sessionId),
  );
  if (owner) {
    await switchContainer(owner.id);
    const sheetId = sessionSheetId(sessionId);
    if (!panelIds(layout()).includes(sheetId)) openSheet(sheetId);
    focusSession(sessionId);
    await hydrateSession(sessionId);
    return;
  }
  const active = activeContainerId();
  if (!active) {
    const view = await openSession(path);
    if (!view) return;
    const container = await createContainerRecord({
      id: `pi:${view.id}`,
      cwd: meta?.cwd ?? view.cwd ?? activeCwd() ?? fallbackCwd() ?? "/",
      sheets: [sessionSheetId(view.id)],
    });
    if (container) focusSession(view.id);
    return;
  }
  const view = await openSession(path);
  if (!view) return;
  sessionsByContainer.set(active, [...new Set([...knownSessionIds(active), view.id])]);
  openSheet(sessionSheetId(view.id));
  focusSession(view.id);
}

/** The pi session id in a session file's name, when the path is one. */
function sessionIdOfPath(path: string): string | null {
  const base = path.split("/").pop() ?? "";
  const match = /_(.+)\.jsonl$/.exec(base);
  return match ? (match[1] ?? null) : null;
}

/** Opens the subagent roster of a container that holds a pi session. */
export function openAuxSheet(kind: "subagents"): void {
  const containerId = activeContainerId();
  if (!hostsPi(containerId)) return;
  openSheet(`${kind}:${containerId}`);
}

/** A reopened session's history must not pin the loading page forever: after
 * this long the gate self-clears and the empty-session Hero returns (the
 * manox history-loading gate's 10 s). */
const HISTORY_TIMEOUT = 10_000;
const loadingTimers = new Map<string, ReturnType<typeof setTimeout>>();

function beginLoading(id: string): void {
  setSessionLoading(id, true);
  const previous = loadingTimers.get(id);
  if (previous) clearTimeout(previous);
  loadingTimers.set(
    id,
    setTimeout(() => {
      loadingTimers.delete(id);
      setSessionLoading(id, false);
    }, HISTORY_TIMEOUT),
  );
}

function endLoading(id: string): void {
  const timer = loadingTimers.get(id);
  if (timer) clearTimeout(timer);
  loadingTimers.delete(id);
  setSessionLoading(id, false);
}

/** Opens (or focuses) one session's transcript. */
export async function hydrateSession(sessionId: string): Promise<void> {
  const view = viewFor(sessionId);
  focusSession(sessionId);
  if (view?.loaded) {
    endLoading(sessionId);
    return;
  }
  // The restored sheet is visible but its file may not be in the sidebar's
  // scan yet: draw the loading page now, and let the scan's retry open it.
  // The 10 s gate turns a session that never resolves back into the Hero.
  beginLoading(sessionId);
  const path = view?.path || sessions().find((row) => row.id === sessionId)?.path;
  if (!path) return;
  try {
    await openSession(path);
  } finally {
    endLoading(sessionId);
  }
}

/** Hydrates every visible pi sheet of the active canvas. */
export function hydrateVisible(): void {
  const ids = visiblePanels()
    .map(sessionIdOfSheet)
    .filter((id): id is string => !!id);
  for (const id of ids) void hydrateSession(id);
}

/** A container's initial pi layout: one sheet per session. */
export function piLayout(containerId: string) {
  return defaultLayoutForSessions(sessionIdsOfContainer(containerId));
}
