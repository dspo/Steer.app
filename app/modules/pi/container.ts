import {
  activeContainerId,
  activeCwd,
  containers,
  containerOfSheet,
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
import { appendSheet, panelIds, visiblePanels } from "../../core/dock";
import {
  acpOwnsSessions,
  beginNewSession,
  clearReleasedView,
  createSession,
  ensureLiveSession,
  focusSession,
  mintSessionId,
  openSession,
  PI_SESSION_ID,
  refreshSessions,
  sessions,
  setSessionLoading,
  startNewSession,
  viewFor,
} from "./sessions";
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
 *
 * Issue #56 (ACP mode): the id is minted before anything exists, so the
 * container, the sheet and the page are built from it at once and the press
 * lands on the starting face immediately; the harness bind runs in the
 * background. The legacy transport (fixtures) keeps the old shape: create
 * first, then the row — it mints its own id.
 */
export async function createContainer(cwd?: string, projectId?: string | null): Promise<string | null> {
  // The start page resolves a folder (a project root or `__chat__/`); a
  // missing one is its error line, never a silent fallback into home.
  const target = cwd || projectCwd(projectId);
  if (!target) throw new Error("no folder to start the conversation in");
  if (!acpOwnsSessions()) {
    const sessionId = await createSession(target);
    const container = await createContainerRecord({
      id: `pi:${sessionId}`,
      cwd: target,
      ...(projectId !== undefined ? { projectId } : {}),
      sheets: [sessionSheetId(sessionId)],
    });
    if (!container) return sessionId;
    sessionsByContainer.set(container.id, [...new Set([...(sessionsByContainer.get(container.id) ?? []), sessionId])]);
    focusSession(sessionId);
    return sessionId;
  }
  const sessionId = mintSessionId();
  beginNewSession(sessionId, target);
  const container = await createContainerRecord({
    id: `pi:${sessionId}`,
    cwd: target,
    ...(projectId !== undefined ? { projectId } : {}),
    sheets: [sessionSheetId(sessionId)],
  });
  if (container) {
    sessionsByContainer.set(container.id, [...new Set([...(sessionsByContainer.get(container.id) ?? []), sessionId])]);
    focusSession(sessionId);
  }
  void startNewSession(sessionId, target);
  return sessionId;
}

/**
 * Mints a new conversation inside an existing container (`session:{id}` added
 * to its layout, beside the start page). The container's cwd is the start
 * context; no container is created. ACP mode runs the bind behind the
 * visible starting sheet, like `createContainer` (issue #56).
 */
export async function newSessionInContainer(containerId: string): Promise<string | null> {
  const container = containers().find((row) => row.id === containerId);
  if (!container) return null;
  if (activeContainerId() !== container.id) await switchContainer(container.id);
  if (!acpOwnsSessions()) {
    const sessionId = await createSession(container.cwd);
    sessionsByContainer.set(container.id, [...new Set([...knownSessionIds(container.id), sessionId])]);
    const sheetId = sessionSheetId(sessionId);
    noteSheetOpened(sheetId);
    setLayout(appendSheet(layout(), sheetId));
    focusSession(sessionId);
    return sessionId;
  }
  const sessionId = mintSessionId();
  beginNewSession(sessionId, container.cwd);
  sessionsByContainer.set(container.id, [...new Set([...knownSessionIds(container.id), sessionId])]);
  const sheetId = sessionSheetId(sessionId);
  noteSheetOpened(sheetId);
  setLayout(appendSheet(layout(), sheetId));
  focusSession(sessionId);
  void startNewSession(sessionId, container.cwd);
  return sessionId;
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
 * this long the gate self-clears and the conversation page returns (the
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

/** A restored sheet with neither view nor scan row is an empty session: pi
 * casts the file on the first message, so a session released before its
 * first prompt leaves nothing to open (issue #56 follow-up). The scan runs
 * once more first — the boot's first pass may simply not have landed yet;
 * a still-missing file for a UUID-shaped id is rebuilt in place with the
 * same id, so the composer is live instead of dead. The harness refuses a
 * taken id, so a real file can never be shadowed by an empty rebuild. */
async function rebuildEmptySession(sessionId: string): Promise<void> {
  await refreshSessions();
  const row = sessions().find((entry) => entry.id === sessionId);
  if (row) {
    try {
      await openSession(row.path);
    } finally {
      endLoading(sessionId);
    }
    return;
  }
  const current = viewFor(sessionId);
  // A starting face already owns this page (its retry is explicit); leave
  // it be rather than reset a visible failure behind the user's back.
  if (current?.startingPhase) {
    endLoading(sessionId);
    return;
  }
  endLoading(sessionId);
  if (!PI_SESSION_ID.test(sessionId)) return;
  const containerId = containerOfSheet(sessionSheetId(sessionId));
  const cwd = containerId ? containers().find((row) => row.id === containerId)?.cwd : undefined;
  if (!cwd) return;
  beginNewSession(sessionId, cwd);
  void startNewSession(sessionId, cwd);
}

/** Opens (or focuses) one session's transcript. A loaded view whose process
 * was released (sheet closed, container archived) reconnects before this
 * resolves, so the reopened sheet can act on the session (issue #54). */
export async function hydrateSession(sessionId: string): Promise<void> {
  const view = viewFor(sessionId);
  focusSession(sessionId);
  if (view?.loaded) {
    endLoading(sessionId);
    clearReleasedView(sessionId);
    await ensureLiveSession(sessionId);
    return;
  }
  // The restored sheet is visible but its file may not be in the sidebar's
  // scan yet: draw the loading page now, and let the scan's retry open it.
  // The 10 s gate turns a session that never resolves back into the empty
  // conversation page.
  beginLoading(sessionId);
  const path = view?.path || sessions().find((row) => row.id === sessionId)?.path;
  if (!path) {
    await rebuildEmptySession(sessionId);
    return;
  }
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
