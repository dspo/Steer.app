import { batch, computed, signal } from "nsh";
import { State } from "../../domains/state";
import { K, t } from "../../ui/i18n";
import type { AcpUpdate } from "./acp/acp";
import {
  closeReservedSession,
  closeSession as closeHostSession,
  liveSession,
  openExistingSession,
  openNewSession,
  SUPERSEDE_RESPONSE,
  type AcpSession,
  type ElicitationRequest,
  type PermissionRequest,
  type PiCommand,
  type PiConfigOption,
  type PiUsage,
} from "./acp/host";
import {
  emptyTranscript,
  reduceTranscript,
  reduceUpdates,
  transcriptRows,
  userEntry,
  type Entry,
  type TranscriptState,
} from "./transcript";
import { notifySettled } from "../../core/notifications";
import { sessionSheetId } from "./sheets";
import type {
  SessionBanner,
  SessionContextUsage,
  SessionData,
  SessionInfoData,
  SessionModelInfo,
  SessionModelsData,
  SessionThinkingLevel,
} from "./protocol";

/**
 * The session store, keyed by pi session id. M3 can show several sessions at
 * once (a container is a group of panels), so a transcript is per session,
 * not one global conversation: every update is folded into its session's
 * transcript, whatever sheet is displayed.
 *
 * The transcript's authority is still pi's session file. A view is a
 * projection that a reconnect or a rehydration rebuilds from the engine;
 * `entries`/`streaming`/`interrupted` remain as accessors over the active
 * session for callers that only care about the one in front.
 */

export type SessionMeta = {
  id: string;
  path: string;
  cwd: string;
  name: string;
  created: number;
  modified: number;
  messageCount: number;
  preview: string;
};

/** One session's projected state. */
type SessionView = {
  id: string;
  path: string;
  cwd: string;
  name: string;
  containerId?: string;
  /** The conversation as ACP entries (transcript.ts); the list's rows. */
  transcript: TranscriptState;
  streaming: boolean;
  interrupted: boolean;
  loaded: boolean;
  /** The restored sheet's history is in flight: draw the loading page, not
   * the empty conversation (issue #20 follow-up, Q121). */
  loading: boolean;
  /** The model the session runs, from `session.info`. */
  model?: SessionModelInfo;
  /** pi's thinking level; `off` means the model does not think. */
  thinkingLevel?: SessionThinkingLevel;
  /** pi's live context gauge, from `session.info`. */
  contextUsage?: SessionContextUsage;
  /** The `_zu/session_banner` facts, when the distro announced any. */
  banner?: SessionBanner;
  /** The pi session id the view's turns ride, when it differs from the key
   * the view was opened under (an ACP mint after an engine-created view). */
  piId?: string;
  error?: string;
  /** ACP protocol state: config selectors, commands, usage, approval mode. */
  configOptions: PiConfigOption[];
  commands: PiCommand[];
  mode: string;
  /** The approval modes the distro offers and the current one. */
  modes: Array<{ id: string; name: string; description?: string }>;
  usage: PiUsage | null;
  /** Follow-ups waiting behind the running turn. */
  queued: number;
  sessionState: "starting" | "ready" | "streaming" | "waiting_user" | "interrupted" | "dead";
};

/** Every session the shell has opened or adopted, by pi id. */
export const views = signal<Record<string, SessionView>>({});
/** The session whose sheet was last active (the sidebar's focus). */
export const activeId = signal<string | null>(null);
/** The sidebar's rows, newest first. */
export const sessions = signal<SessionMeta[]>([]);
/** The last store-level error. */
export const error = signal<string | null>(null);

/** The active session's transcript rows, for callers that do not pass an id. */
export const entries = computed<Entry[]>(() => transcriptRows(views()[activeId() ?? ""]?.transcript));
export const streaming = computed<boolean>(() => views()[activeId() ?? ""]?.streaming ?? false);
export const interrupted = computed<boolean>(() => views()[activeId() ?? ""]?.interrupted ?? false);
export const activeCwd = computed<string>(() => views()[activeId() ?? ""]?.cwd ?? "");
export const activePath = computed<string>(() => views()[activeId() ?? ""]?.path ?? "");

let reconciling = false;
const opening = new Map<string, Promise<SessionView | undefined>>();

function blankView(id: string, patch: Partial<SessionView> = {}): SessionView {
  return {
    id,
    path: "",
    cwd: "",
    name: "",
    transcript: emptyTranscript(),
    streaming: false,
    interrupted: false,
    loaded: false,
    loading: false,
    configOptions: [],
    commands: [],
    mode: "ask",
    modes: [],
    usage: null,
    queued: 0,
    sessionState: "starting",
    ...patch,
  };
}

/**
 * The legacy `SessionData` shape (the test transport's session rows) → the
 * transcript entries it stands for. Only user and assistant prose ever
 * crossed that wire; ids are minted in file order.
 */
function project(data: any): TranscriptState {
  const rows = ((data?.messages ?? []) as Array<{ role?: string; text?: string }>).filter(
    (message) => message.text && (message.role === "user" || message.role === "assistant"),
  );
  const entries: Entry[] = rows.map((row, index) =>
    row.role === "user" ? userEntry(`seed:${index}`, String(row.text)) : { kind: "assistant", id: `seed:${index}`, text: String(row.text) },
  );
  return { entries, draft: null, seq: 0 };
}

function patchView(id: string, patch: Partial<SessionView>): void {
  const current = views()[id] ?? blankView(id);
  views.set({ ...views(), [id]: { ...current, ...patch } });
}

/** The restored sheet's loading face: true while its history is in flight,
 * false once the replay lands (or the loading gate gives up). Setting false
 * never creates a view for an id that is already gone. */
export function setSessionLoading(id: string, loading: boolean): void {
  if (!views()[id] && !loading) return;
  patchView(id, { loading });
}

// --- the ACP transport (pi-acp-IMPLEMENTATION.md) -------------------------
//
// Pi sessions ride one persistent `pi-acp` process each (design D1). The view
// keys and the store's outward behavior are the same as the old engine's;
// only the transport under `send`/`stop`/`open` differs. Config selectors,
// commands, usage, approval modes, permissions and elicitation are protocol
// state projected into the view; subagents use the `_zu/subagents/*` lane.

/** The in-flight ACP turn per view key (the stop button's handle). */
const acpTurns = new Map<string, { cancel(): void }>();
/** Texts queued while a turn runs (the follow-up lane without the engine). */
const acpQueues = new Map<string, string[]>();

/** A pending server→client request, awaiting the user's answer. */
export interface PendingPermission {
  sessionId: string;
  request: PermissionRequest;
  resolve: (response: { outcome: { outcome: string; optionId?: string } }) => void;
}

export interface PendingElicitation {
  sessionId: string;
  request: ElicitationRequest;
  resolve: (response: { action: string; content?: Record<string, unknown> }) => void;
}

export const pendingPermissions = signal<Record<string, PendingPermission>>({});
export const pendingElicitations = signal<Record<string, PendingElicitation>>({});

/** One parked interactive-tool ask (B2). `resolve` exists only while the
 * asking turn is still waiting live; entries seeded after a restart carry no
 * resolve and are answered over the wire (`_zu/ask/answer`). */
export interface PendingAsk {
  sessionId: string;
  toolCallId: string;
  args: unknown;
  resolve?: (response: unknown) => void;
}

export const pendingAsks = signal<Record<string, PendingAsk>>({});

/**
 * Delivers the user's answer to a parked interactive-tool ask (B2): a live
 * wait resolves in-process (the tool formats its own toolResult); anything
 * else goes to the harness, which injects the answer into the conversation
 * and triggers a turn.
 */
export async function answerAsk(sessionId: string, toolCallId: string, response: unknown): Promise<void> {
  const recordKey = `${sessionId}:${toolCallId}`;
  const entry = pendingAsks()[recordKey];
  if (entry) {
    const next = { ...pendingAsks() };
    delete next[recordKey];
    pendingAsks.set(next);
    entry.resolve?.(response);
  }
  if (entry?.resolve) {
    resumeAfterAnswer(sessionId);
    return;
  }
  const session = liveSession(sessionId);
  if (session && !session.dead) {
    try {
      await session.requestCustom("_zu/ask/answer", { sessionId, toolCallId, response });
    } catch (failure) {
      patchView(sessionId, { error: String(failure instanceof Error ? failure.message : failure) });
    }
  }
  resumeAfterAnswer(sessionId);
}

/** Answers the first pending approval of a session (the approval card). */
export function answerPermission(sessionId: string, optionId: string): void {
  const entries = Object.entries(pendingPermissions()).filter(
    ([, entry]) => entry.sessionId === sessionId,
  );
  if (entries.length === 0) return;
  const [id, entry] = entries[0];
  const next = { ...pendingPermissions() };
  delete next[id];
  pendingPermissions.set(next);
  entry.resolve({ outcome: { outcome: optionId === "cancel" ? "cancelled" : "selected", optionId } });
  resumeAfterAnswer(sessionId);
}

/** A session is only "waiting for you" while a request or ask is pending. */
function resumeAfterAnswer(key: string): void {
  const stillWaiting =
    Object.values(pendingPermissions()).some((entry) => entry.sessionId === key) ||
    Object.values(pendingElicitations()).some((entry) => entry.sessionId === key) ||
    Object.values(pendingAsks()).some((entry) => entry.sessionId === key);
  if (stillWaiting) return;
  const view = views()[key];
  patchView(key, { sessionState: view?.streaming ? "streaming" : "ready" });
}

/** Resolves a session's pending requests when its process goes away. */
function cancelPending(key: string): void {
  const permissions = { ...pendingPermissions() };
  const elicitations = { ...pendingElicitations() };
  let changed = false;
  for (const [id, entry] of Object.entries(permissions)) {
    if (entry.sessionId !== key) continue;
    delete permissions[id];
    entry.resolve({ outcome: { outcome: "cancelled" } });
    changed = true;
  }
  for (const [id, entry] of Object.entries(elicitations)) {
    if (entry.sessionId !== key) continue;
    delete elicitations[id];
    entry.resolve({ action: "cancel" });
    changed = true;
  }
  const asks = { ...pendingAsks() };
  for (const [id, entry] of Object.entries(asks)) {
    if (entry.sessionId !== key) continue;
    delete asks[id];
    entry.resolve?.({ action: "cancel" });
    changed = true;
  }
  if (changed) {
    pendingPermissions.set(permissions);
    pendingElicitations.set(elicitations);
    pendingAsks.set(asks);
  }
}

/** Answers the pending elicitation of a session. */
export function answerElicitation(
  sessionId: string,
  action: string,
  content?: Record<string, unknown>,
): void {
  const entries = Object.entries(pendingElicitations()).filter(
    ([, entry]) => entry.sessionId === sessionId,
  );
  if (entries.length === 0) return;
  const [id, entry] = entries[0];
  const next = { ...pendingElicitations() };
  delete next[id];
  pendingElicitations.set(next);
  entry.resolve({ action, ...(content ? { content } : {}) });
  resumeAfterAnswer(sessionId);
}

/** Copies the host session's protocol state into the view. */
function syncProtocolState(key: string): void {
  const session = liveSession(key);
  if (!session) return;
  const modelConfig = session.configOptions.find((option) => option.id === "model");
  const thought = session.configOptions.find((option) => option.id === "thought_level");
  const model = modelConfig
    ? {
        provider: modelConfig.currentValue.split("/")[0] ?? "",
        id: modelConfig.currentValue.split("/").slice(1).join("/"),
        name:
          modelConfig.options.find((option) => option.value === modelConfig.currentValue)?.name ??
          modelConfig.currentValue,
      }
    : undefined;
  const usage = session.usage
    ? {
        tokens: session.usage.used,
        contextWindow: session.usage.size,
        percent: session.usage.size > 0 ? Math.round((session.usage.used / session.usage.size) * 100) : null,
      }
    : undefined;
  const waiting =
    Object.values(pendingPermissions()).some((entry) => entry.sessionId === key) ||
    Object.values(pendingElicitations()).some((entry) => entry.sessionId === key) ||
    Object.values(pendingAsks()).some((entry) => entry.sessionId === key);
  patchView(key, {
    configOptions: session.configOptions,
    commands: session.commands,
    mode: session.modes.currentModeId,
    modes: session.modes.availableModes,
    usage: session.usage,
    ...(model ? { model } : {}),
    ...(thought ? { thinkingLevel: thought.currentValue as SessionThinkingLevel } : {}),
    ...(usage ? { contextUsage: usage } : {}),
    ...(session.banner ? { banner: session.banner } : {}),
    ...(session.title ? { name: session.title } : {}),
    sessionState: session.dead
      ? "dead"
      : waiting
        ? "waiting_user"
        : views()[key]?.sessionState === "streaming"
          ? "streaming"
          : "ready",
  });
}

/** Installs the session's client bridge: updates fold, requests wait for UI. */
function attachSession(key: string, session: AcpSession): void {
  session.setHandlers({
    onUpdate: (update) => {
      queueAcpUpdate(key, update);
      syncProtocolState(key);
      if (update.sessionUpdate === "config_option_update") void loadSessionModels(key, true);
    },
    requestPermission: (request) =>
      new Promise((resolve) => {
        const id = `${key}:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        pendingPermissions.set({
          ...pendingPermissions(),
          [id]: { sessionId: key, request, resolve },
        });
        patchView(key, { sessionState: "waiting_user" });
      }),
    requestElicitation: (request) =>
      new Promise((resolve) => {
        const id = `${key}:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        pendingElicitations.set({
          ...pendingElicitations(),
          [id]: { sessionId: key, request, resolve },
        });
        patchView(key, { sessionState: "waiting_user" });
      }),
    // A1: the ask_user_question card. Keyed by the harness's toolCallId so
    // the entry lines up with B2's seeded shape (`args.questions`); answering
    // resolves this promise, which is the `_zu/ask/create` JSON-RPC response.
    requestAsk: (request) =>
      new Promise((resolve) => {
        const recordKey = `${key}:${request.toolCallId}`;
        if (pendingAsks()[recordKey]) {
          // Practically unreachable (toolCallIds are unique per call); keep
          // the existing card and settle the stray request as dismissed.
          resolve({ action: "cancel" });
          return;
        }
        pendingAsks.set({
          ...pendingAsks(),
          [recordKey]: {
            sessionId: key,
            toolCallId: request.toolCallId,
            args: { questions: request.questions },
            resolve: resolve as (response: unknown) => void,
          },
        });
        patchView(key, { sessionState: "waiting_user" });
      }),
    onExit: (reason) => {
      acpTurns.delete(key);
      acpQueues.delete(key);
      cancelPending(key);
      patchView(key, {
        queued: 0,
        streaming: false,
        interrupted: true,
        error: reason,
        sessionState: "interrupted",
      });
    },
  });
  syncProtocolState(key);
}

/** Drops a session's question cards before the user's own message prompts.
 * Live waits answer the harness's `_zu/ask/create` with the supersede
 * sentinel: the tool acks + ends its turn and B2's registry writes the
 * receipt (idempotent with the harness's own supersedeAll — whichever fires
 * first settles the ask). Seeded cards (no live waiter after a restart) are
 * retired via the wire sentinel — without it the next open would re-seed
 * questions the user answered by typing (B2). Best-effort: a dead process
 * has nothing left to retire, and the next seed would surface what is still
 * genuinely pending. */
function supersedePendingAsks(key: string): void {
  const entries = Object.entries(pendingAsks());
  const keep = entries.filter(([, entry]) => entry.sessionId !== key);
  if (keep.length === entries.length) return;
  const queued = seededSupersedes.get(key) ?? [];
  for (const [, entry] of entries) {
    if (entry.sessionId !== key) continue;
    if (entry.resolve) entry.resolve(SUPERSEDE_RESPONSE);
    else if (!queued.some((record) => record.toolCallId === entry.toolCallId)) {
      queued.push({ toolCallId: entry.toolCallId });
    }
  }
  seededSupersedes.set(key, queued);
  pendingAsks.set(Object.fromEntries(keep));
}

/** Skipped seeded asks (no live waiter) waiting for a live session to retire
 * them on the harness (B2). Keyed by session id; drained by
 * `retireSeededAsks`, dropped with the session by `releaseSession`. */
const seededSupersedes = new Map<string, Array<{ toolCallId: string }>>();

/** Retires skipped seeded asks on the harness via wire sentinels, once a
 * live session exists (B2). Runs on a live session — a dead process has
 * nothing to retire, and retiring before the reopen would let the reopen's
 * seed re-present the questions the user just answered by typing. A failed
 * retire (e.g. an older harness without the method) falls back to the
 * follow-up seed re-presenting the card — honest, if noisy. */
async function retireSeededAsks(key: string, session: AcpSession): Promise<void> {
  const queued = seededSupersedes.get(key);
  if (!queued || queued.length === 0 || session.dead) return;
  seededSupersedes.set(key, []);
  await Promise.allSettled(
    queued.map((record) =>
      session.requestCustom("_zu/ask/answer", {
        sessionId: key,
        toolCallId: record.toolCallId,
        response: SUPERSEDE_RESPONSE,
      }),
    ),
  );
  // A skip typed while this retire was in flight re-queued ids; keep those.
  const left = seededSupersedes.get(key);
  if (left && left.length === 0) seededSupersedes.delete(key);
}

/** Pulls `_zu/ask/pending` after an open so questions that outlived a restart
 * come back as answerable cards (B2). Best-effort: an older harness answers
 * method_not_found, and no card is the honest result then. */
async function seedPendingAsks(key: string, session: AcpSession): Promise<void> {
  try {
    const reply = await session.requestCustom<{ asks?: Array<{ toolCallId?: unknown; args?: unknown }> }>(
      "_zu/ask/pending",
      { sessionId: session.id },
    );
    const asks = Array.isArray(reply?.asks) ? reply.asks : [];
    const next = { ...pendingAsks() };
    let changed = false;
    for (const ask of asks) {
      const toolCallId = String(ask?.toolCallId ?? "");
      if (!toolCallId) continue;
      const recordKey = `${key}:${toolCallId}`;
      if (next[recordKey]) continue; // a live waiter keeps its resolve
      next[recordKey] = { sessionId: key, toolCallId, args: ask.args };
      changed = true;
    }
    if (changed) {
      pendingAsks.set(next);
      syncProtocolState(key);
    }
  } catch {
    // The harness predates the mailbox, or the process just died — skip.
  }
}

/** True when pi sessions ride the ACP harness (always, since the cutover). */
export function acpEnabled(): boolean {
  return true;
}

/**
 * Whether the ACP branch owns the session commands: the transport says so
 * and no fixture transport is installed (the tests' seams ride the same
 * shapes the engine did, whatever the production transport is).
 */
function useAcpBranch(): boolean {
  return acpEnabled() && sessionTransport === null && modelTransport === null;
}

/** The view key of a pi session id: they are the same since the persistent
 * runtime mints the id at creation. */
function viewKeyFor(id: string | null | undefined): string | null {
  return id ?? null;
}

/**
 * Queues one ACP update for its session's transcript. The banner is not
 * transcript: it lands on the view directly (it arrives once per bind).
 */
function queueAcpUpdate(key: string, update: AcpUpdate): void {
  if (update.sessionUpdate === "_zu/session_banner") {
    patchView(key, { banner: update.banner as SessionBanner | undefined });
    return;
  }
  const pending = pendingUpdates.get(key) ?? [];
  pending.push(update);
  pendingUpdates.set(key, pending);
  queueFlush();
}

// Updates collect per session and reach the signal once per 16ms frame, as
// the gallery's chat does: a chunk-by-chunk set would re-render per token.
const pendingUpdates = new Map<string, AcpUpdate[]>();
let frameQueued = false;
const flushUpdates = () => {
  frameQueued = false;
  if (pendingUpdates.size === 0) return;
  const batchEntries = [...pendingUpdates];
  pendingUpdates.clear();
  const next = { ...views() };
  for (const [id, updates] of batchEntries) {
    const current = next[id] ?? blankView(id);
    let transcript = current.transcript;
    for (const update of updates) transcript = reduceTranscript(transcript, update);
    next[id] = { ...current, transcript };
  }
  views.set(next);
};
const queueFlush = () => {
  if (frameQueued) return;
  frameQueued = true;
  // A timer, not requestAnimationFrame: the headless test runner has no
  // frame loop, so deltas would collect until the turn ended.
  setTimeout(flushUpdates, 16);
};

/**
 * Ensures the view has a live ACP session, resuming its process if it died.
 * Runs one turn for view `key`, folding updates as they stream, marking the
 * settle, and pumping the follow-up queue.
 */
function aliveSessionFor(key: string): AcpSession | undefined {
  const view = views()[key];
  const existing = liveSession(view?.id ?? key) ?? liveSession(key);
  return existing && !existing.dead ? existing : undefined;
}

/** Reconnects already in flight per view key (issue #54): a menu open, a
 * model pick and the turn's own ensure share one resume, so a released
 * session never spawns two processes for one click. */
const reconnecting = new Map<string, Promise<AcpSession | null>>();
/** Releases bump this generation: a resume that started before the sheet
 * closed must neither adopt its harness into the live registry nor repaint
 * the view with it (issue #64 review, P2). */
const reconnectGenerations = new Map<string, number>();
const releasedViews = new Set<string>();

/** A pick that needed a resume but could not get one: mirror the reason
 * into the menu so the open picker is not silent (issue #64 review, P3). */
function mirrorReconnectFailure(id: string): void {
  const detail = views()[id]?.error;
  if (!detail) return;
  patchModels(id, {
    ...(sessionModels()[id] ?? { status: "error" as const }),
    status: "error",
    error: detail,
  });
}

/** Clears only the error a reconnect itself wrote; a turn's error stays
 * until its own retry (issue #64 review, P1). */
function clearReconnectError(key: string): void {
  const current = views()[key];
  if (!current?.error) return;
  const zh = t(K.session.reconnectFailed, { error: "", locale: "zh-CN" });
  const en = t(K.session.reconnectFailed, { error: "", locale: "en" });
  if (current.error.startsWith(zh) || current.error.startsWith(en)) {
    patchView(key, { error: undefined });
  }
}

/** One resume for a view whose process is gone. The shared leg under
 * `ensureAcpSession`: the failure lands on the view (the chat's quiet error
 * line), never silently. */
function connectExisting(key: string): Promise<AcpSession | null> {
  const inFlight = reconnecting.get(key);
  if (inFlight) return inFlight;
  const view = views()[key];
  if (!view) return Promise.resolve(null);
  releasedViews.delete(key);
  const generation = reconnectGenerations.get(key) ?? 0;
  const valid = () =>
    !releasedViews.has(key) && (reconnectGenerations.get(key) ?? 0) === generation && !!views()[key];
  const request = (async () => {
    try {
      const { session } = await openExistingSession(view.id, view.cwd || "/", {
        load: false,
        shouldAdopt: valid,
      });
      if (!valid()) {
        await closeReservedSession(session);
        return null;
      }
      attachSession(key, session);
      clearReconnectError(key);
      return session;
    } catch (failure) {
      if (valid()) {
        patchView(key, {
          error: t(K.session.reconnectFailed, {
            error: String(failure instanceof Error ? failure.message : failure),
          }),
          sessionState: "interrupted",
          streaming: false,
        });
      }
      return null;
    } finally {
      reconnecting.delete(key);
    }
  })();
  reconnecting.set(key, request);
  return request;
}

export async function ensureAcpSession(
  key: string,
  options?: { seed?: boolean },
): Promise<AcpSession | null> {
  const view = views()[key];
  if (!view) return null;
  const existing = aliveSessionFor(key);
  if (existing) {
    attachSession(key, existing);
    return existing;
  }
  const session = await connectExisting(key);
  if (!session) return null;
  // The previous process may have died mid-ask; the load-side repair has
  // already acked the tail, so the asks are listable again (B2). Callers
  // that supersede first turn seeding off and seed explicitly after.
  if (options?.seed !== false) void seedPendingAsks(key, session);
  return session;
}

/** A live session for `id`, resuming a released or dead process first
 * (issue #54): a loaded view whose sheet was closed gets its process back
 * before the caller acts on it — reopen, model pick, effort pick. The
 * legacy transport owns no process, so it is a no-op there. */
export async function ensureLiveSession(id: string | null | undefined): Promise<AcpSession | null> {
  if (!id || !useAcpBranch()) return null;
  return ensureAcpSession(id);
}

async function runAcpTurn(key: string, text: string): Promise<void> {
  // The user's own words supersede any waiting ask (B2): drop the cards here,
  // the harness resolves its live waits when the prompt reaches it.
  supersedePendingAsks(key);
  const wasLive = aliveSessionFor(key) !== undefined;
  const session = await ensureAcpSession(key, { seed: false });
  if (!session) return;
  acpTurns.set(key, { cancel: () => session.cancel() });
  patchView(key, { sessionState: "streaming", streaming: true, interrupted: false });
  // The skipped seeded asks retire before the turn's prompt fires, and — on
  // a reopen — the re-seed runs after the retire: seeding earlier would
  // re-present the questions the user just answered by typing.
  const retire = retireSeededAsks(key, session);
  if (!wasLive) await seedPendingAsks(key, session);
  await retire;
  try {
    await session.prompt(text);
    flushUpdates();
    patchView(key, { sessionState: "ready", streaming: false });
    void notifySettled({
      sheetId: sessionSheetId(key),
      title: sessionTitle(key),
      body: settledPreview(key),
    });
    void pumpAcpQueue(key);
  } catch (failure) {
    patchView(key, {
      sessionState: "interrupted",
      streaming: false,
      error: String(failure instanceof Error ? failure.message : failure),
    });
  } finally {
    acpTurns.delete(key);
  }
}

/** The last assistant sentence, as a short notification body. */
function settledPreview(sessionId: string): string {
  const list = transcriptRows(views()[sessionId]?.transcript);
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const entry = list[index];
    if (entry.kind !== "assistant" || !entry.text) continue;
    const line = entry.text.replace(/\s+/g, " ").trim();
    if (line) return line.length > 140 ? `${line.slice(0, 137)}…` : line;
  }
  return "";
}

/** Sends the next queued text as its own turn (settle-and-continue). */
async function pumpAcpQueue(key: string): Promise<void> {
  const queued = acpQueues.get(key);
  if (!queued || queued.length === 0) return;
  const [next, ...rest] = queued;
  if (rest.length > 0) acpQueues.set(key, rest);
  else acpQueues.delete(key);
  patchView(key, { queued: rest.length });
  if (next) runAcpTurn(key, next);
}

/** Whether a store-level turn is in flight for `id` (the tests' busy read;
 * the optimistic row also flips `streaming`, which is not the turn's truth). */
export function turnActive(id: string | null | undefined): boolean {
  const key = viewKeyFor(id) ?? id;
  return !!key && acpTurns.has(key);
}

/** The ACP send: a running turn queues the text; an idle view starts one. */
function acpSend(key: string, text: string): void {
  // The user's own words supersede waiting asks at send time (A1): a turn
  // parked on a live ask card must not block the queue — and the queued
  // turn's supersede — behind the very card the message is answering.
  supersedePendingAsks(key);
  const busy = acpTurns.has(key) || (views()[key]?.streaming ?? false);
  if (busy) {
    const next = [...(acpQueues.get(key) ?? []), text];
    acpQueues.set(key, next);
    patchView(key, { queued: next.length });
    optimisticUser(key, text);
    return;
  }
  optimisticUser(key, text);
  runAcpTurn(key, text);
}

/**
 * Folds a (possibly partial) `session.info` payload into a view. Events carry
 * one changed field at a time (a model switch, a thinking level, the context
 * gauge after a turn); the reply carries them all. An absent field leaves the
 * view's value alone. When a path appears (pi cast the session file on the
 * first turn), the container registry's row learns it too — the row was
 * minted before the file existed.
 */
function applySessionInfo(id: string, data: SessionInfoData | null | undefined): void {
  if (!data) return;
  const patch: Partial<SessionView> = {};
  if (typeof data.path === "string" && data.path) patch.path = data.path;
  if (typeof data.name === "string" && data.name) patch.name = data.name;
  if (data.model && typeof data.model === "object") patch.model = data.model;
  if (typeof data.thinkingLevel === "string") patch.thinkingLevel = data.thinkingLevel;
  if (data.contextUsage && typeof data.contextUsage === "object") patch.contextUsage = data.contextUsage;
  if (Object.keys(patch).length > 0) patchView(id, patch);
  if (typeof data.path === "string" && data.path) sessionPathObserver?.(id, data.path);
}

/** The registry's listener for a session's path appearing. */
let sessionPathObserver: ((id: string, path: string) => void) | null = null;

/** Installs the session-path observer (the container store's row updater). */
export function setSessionPathObserver(next: ((id: string, path: string) => void) | null): void {
  sessionPathObserver = next;
}

/** Asks the engine for a session's composer data and folds it into the view.
 * In ACP mode the protocol (`config_option_update`, `usage_update`,
 * `session_info_update`) is the source, so there is nothing to request. */
export async function refreshSessionInfo(id: string): Promise<void> {
  if (!id || useAcpBranch()) return;
  try {
    const data = await sessionRequest("session.info", { sessionId: id }, 30000);
    applySessionInfo(id, data as SessionInfoData);
  } catch {
    // The session's sheet still renders its transcript; the next event or a
    // later reopen supplies the composer's data.
  }
}

/** What the model picker has for a session: its grouped choices or a load state. */
type SessionModelsState = {
  status: "idle" | "loading" | "ready" | "error";
  data?: SessionModelsData;
  error?: string;
};

/** The picker's data per session, loaded on demand (`session.models`). */
export const sessionModels = signal<Record<string, SessionModelsState>>({});

type ModelTransport = (type: string, payload?: Record<string, unknown>, timeoutMs?: number) => Promise<any>;
let modelTransport: ModelTransport | null = null;

type SessionTransport = (type: string, payload?: Record<string, unknown>, timeoutMs?: number) => Promise<any>;
let sessionTransport: SessionTransport | null = null;

/** Replaces the transport for the session commands (fixtures, tests). */
export function setSessionTransport(next: SessionTransport | null): void {
  sessionTransport = next;
}

const sessionRequest = (type: string, payload?: Record<string, unknown>, timeoutMs?: number) => {
  if (sessionTransport) return sessionTransport(type, payload, timeoutMs);
  return Promise.reject(new Error(`no transport for ${type} (ACP owns the session)`));
};

/** Replaces the transport for the model commands (fixtures, tests). */
export function setModelTransport(next: ModelTransport | null): void {
  modelTransport = next;
}

const modelRequest = (type: string, payload: Record<string, unknown>, timeoutMs: number) => {
  if (modelTransport) return modelTransport(type, payload, timeoutMs);
  return Promise.reject(new Error(`no transport for ${type} (the ACP harness owns the session)`));
};

function patchModels(id: string, next: SessionModelsState): void {
  sessionModels.set({ ...sessionModels(), [id]: next });
}

/**
 * Loads a session's available models. A ready list with providers is reused
 * until `force`; a load already in flight is shared, so opening the menu
 * twice costs one request. `force` asks pi's auth checks again, and an empty
 * answer is never cached: once the user configures a provider, the next open
 * (or retry) finds it without a restart.
 *
 * ACP mode this is a pure read — the live selector wins, and a released
 * session's stale view copy keeps the menu readable. Resuming the process is
 * the caller's intent: the menu open and the retries go through
 * `ensureSessionModels` (issue #54), and a plain read must never spawn.
 */
export async function loadSessionModels(id: string, force = false): Promise<void> {
  if (!id) return;
  if (useAcpBranch()) {
    const config = liveSession(id)?.configOptions ?? views()[id]?.configOptions ?? [];
    const modelConfig = config.find((option) => option.id === "model");
    if (!modelConfig) {
      patchModels(id, { status: "error", error: t(K.session.modelsEmpty) });
      return;
    }
    const providers: SessionModelsData["providers"] = [];
    for (const option of modelConfig.options) {
      const at = option.value.indexOf("/");
      const provider = at >= 0 ? option.value.slice(0, at) : option.value;
      const modelId = at >= 0 ? option.value.slice(at + 1) : option.value;
      let group = providers.find((entry) => entry.id === provider);
      if (!group) {
        group = {
          id: provider,
          name: option._meta?.providerName ?? provider,
          models: [],
          ...(option._meta?.authSource ? { authSource: option._meta.authSource } : {}),
          ...(option._meta?.authLabel ? { authLabel: option._meta.authLabel } : {}),
        };
        providers.push(group);
      }
      const window = option._meta?.contextWindow;
      group.models.push({
        provider,
        id: modelId,
        name: option.name,
        ...(window !== undefined && Number.isFinite(window) ? { contextWindow: window } : {}),
      });
    }
    const currentRef = modelConfig.currentValue;
    const at = currentRef.indexOf("/");
    const current = at >= 0
      ? { provider: currentRef.slice(0, at), id: currentRef.slice(at + 1), name: currentRef }
      : undefined;
    const thought = config.find((option) => option.id === "thought_level");
    patchModels(id, {
      status: "ready",
      data: {
        providers,
        ...(current ? { current } : {}),
        ...(thought ? { thinkingLevel: thought.currentValue as SessionThinkingLevel } : {}),
      },
    });
    return;
  }
  const current = sessionModels()[id];
  const reusable = current?.status === "ready" && (current.data?.providers.length ?? 0) > 0;
  if (!force && (reusable || current?.status === "loading")) return;
  patchModels(id, { status: "loading" });
  try {
    const data = (await modelRequest("session.models", { sessionId: id, refresh: force }, 30000)) as SessionModelsData;
    patchModels(id, { status: "ready", data });
    applySessionInfo(id, data);
  } catch (failure) {
    patchModels(id, { status: "error", error: String(failure) });
  }
}

/**
 * The model menu's own ensure (issue #54): opening the menu or hitting its
 * retry on a released (or dead) session resumes the process first, then
 * reads the live selector. A failed resume keeps the previous list readable
 * and names the reason — the menu shows it above the rows, with the retry.
 */
export async function ensureSessionModels(id: string, force = false): Promise<void> {
  if (!id) return;
  if (!useAcpBranch()) return loadSessionModels(id, force);
  if (aliveSessionFor(id)) return loadSessionModels(id, force);
  const session = await ensureAcpSession(id);
  if (session) clearReconnectError(id);
  if (!session) {
    const previous = sessionModels()[id];
    const detail = views()[id]?.error;
    patchModels(id, {
      ...(previous?.data ? { data: previous.data } : {}),
      status: "error",
      error: detail || t(K.session.reconnectFailed, { error: "unknown" }),
    });
    return;
  }
  await loadSessionModels(id, force);
}

/**
 * Switches the session's model through the engine. On success the reply's
 * `session.info` shape is folded in immediately and a fresh `session.info`
 * confirms it; on failure the reason stays with the picker's state.
 */
export async function chooseSessionModel(id: string, provider: string, modelId: string): Promise<boolean> {
  if (!id || !provider || !modelId) return false;
  if (useAcpBranch()) {
    // Issue #54: a released session resumes first — the pick rides the
    // process, and a failed resume lands on the view's error line instead of
    // dying quietly in a menu that does not move.
    const session = await ensureAcpSession(id);
    if (!session) {
      mirrorReconnectFailure(id);
      return false;
    }
    clearReconnectError(id);
    try {
      await session.setConfig("model", `${provider}/${modelId}`);
      syncProtocolState(id);
      await loadSessionModels(id, true);
      return true;
    } catch (failure) {
      patchView(id, { error: String(failure) });
      return false;
    }
  }
  try {
    const data = (await modelRequest("session.setModel", { sessionId: id, provider, id: modelId }, 30000)) as SessionInfoData;
    applySessionInfo(id, data);
    patchModels(id, {
      status: "ready",
      data: {
        ...(sessionModels()[id]?.data ?? { providers: [] }),
        ...(data.model ? { current: data.model } : {}),
        ...(data.thinkingLevel ? { thinkingLevel: data.thinkingLevel } : {}),
      },
    });
    void refreshSessionInfo(id);
    return true;
  } catch (failure) {
    patchModels(id, { ...(sessionModels()[id] ?? { status: "error" as const }), status: "error", error: String(failure) });
    return false;
  }
}

/** The view of `id`, if the shell has seen it. A pi session id minted after
 * its view existed resolves through the ACP alias map to the view's key. */
export function viewFor(id: string | null | undefined): SessionView | undefined {
  return id ? views()[id] : undefined;
}

/** Selects the session's approval policy (`session/set_mode`). */
export async function setSessionMode(id: string, modeId: string): Promise<boolean> {
  const session = liveSession(id);
  if (!session || session.dead) return false;
  try {
    await session.setMode(modeId);
    syncProtocolState(id);
    return true;
  } catch (failure) {
    patchView(id, { error: String(failure) });
    return false;
  }
}

/** A new reopen/hydrate intent cancels the previous release's in-flight
 * invalidation (issue #64 review, P2). */
export function clearReleasedView(id: string): void {
  const key = viewKeyFor(id) ?? id;
  releasedViews.delete(key);
}

/** Releases a session's process and any request still waiting on the user. */
export async function releaseSession(id: string): Promise<void> {
  const key = viewKeyFor(id) ?? id;
  acpTurns.delete(key);
  acpQueues.delete(key);
  seededSupersedes.delete(key);
  cancelPending(key);
  // The resume may not have registered its process yet: invalidate its
  // generation first so it cannot adopt, then close whatever is live.
  reconnectGenerations.set(key, (reconnectGenerations.get(key) ?? 0) + 1);
  releasedViews.add(key);
  await closeHostSession(key);
}

/** Makes `id` the session the shell's non-keyed controls act on. */
export function focusSession(id: string): void {
  activeId.set(id);
}

/** Whether a session has a name of its own: the fallbacks (preview, path,
 * id prefix) are this module's private spellings, and the container titles
 * must not re-derive them. */
export function sessionHasName(id: string): boolean {
  return sessionTitle(id) !== id.slice(0, 8);
}

/** The label a sheet or a sidebar row shows for a session. */
export function sessionTitle(id: string): string {
  const view = views()[viewKeyFor(id) ?? id];
  if (view?.name) return view.name;
  const meta = sessions().find((row) => row.id === id);
  if (meta) return meta.name || meta.preview || id.slice(0, 8);
  return view?.path ? (view.path.split("/").pop() ?? id.slice(0, 8)) : id.slice(0, 8);
}

/** Seeds a view for fixtures (no engine): the same projection a real open builds. */
export function seedSession(id: string, list: Entry[], patch: Partial<SessionView> = {}): void {
  batch(() => {
    patchView(id, { ...patch, transcript: { entries: list, draft: null, seq: 0 }, loaded: true });
    activeId.set(id);
  });
}

/**
 * Reloads the sidebar from pi's session directory. Since the read-plane
 * switch (v2 §6) this is a **file fold**: the native scan walks the session
 * directory against an mtime watermark (directories included, so a created
 * or deleted file moves it), skips the parse when nothing moved, and
 * otherwise reads each file's header, name, first user text and message
 * count. No process is consulted — the engine's `session.list` is gone from
 * the read path, whether or not one is running.
 */
export async function refreshSessions(): Promise<void> {
  if (sessionTransport) {
    try {
      const data = await sessionTransport("session.list", {}, 30000);
      sessions.set((data?.sessions ?? []) as SessionMeta[]);
    } catch (failure) {
      error.set(String(failure));
    }
    return;
  }
  try {
    const scan = await State.scanSessions(sessionScan?.watermark ?? 0);
    if (!scan.changed) return;
    sessionScan = {
      watermark: scan.watermark,
      sessions: scan.sessions.map((row) => ({
        id: row.id,
        path: row.path,
        cwd: row.cwd,
        name: row.name,
        created: row.created,
        modified: row.modified,
        messageCount: row.messageCount,
        preview: row.preview,
      })),
    };
    sessions.set(sessionScan.sessions);
    error.set(null);
  } catch (failure) {
    error.set(String(failure));
  }
}

/** The fold's watermark cache: re-parse only when the directory moved. */
let sessionScan: { watermark: number; sessions: SessionMeta[] } | null = null;

/** Adopts a session the engine already opened (a container command's reply). */
export function adoptSession(data: SessionData): SessionView {
  const id = String(data?.id ?? "");
  const view = blankView(id, {
    path: String(data?.path ?? ""),
    cwd: String(data?.cwd ?? ""),
    name: String(data?.name ?? ""),
    containerId: data?.containerId ? String(data.containerId) : undefined,
    transcript: project(data),
    loaded: true,
  });
  patchView(id, view);
  // The reply names the file and transcript; the model, thinking level and
  // context gauge are the composer's and come from `session.info`, merged
  // when it lands.
  void refreshSessionInfo(id);
  return view;
}

/**
 * Opens a session by its file path and loads its transcript. Repeated calls
 * for the same file share one request; a second call focuses the view.
 * ACP mode: the transcript is the `session/load` replay (history is read by
 * a process from the file, never from the wire's memory); the same process
 * stays attached for the session's later turns.
 *
 * A loaded view with no live process (its sheet was closed and the release
 * closed the harness) reconnects before this resolves (issue #54), so the
 * sheet that caused the open can act on the session — the model menu and
 * the effort menu included — instead of “能聊、不能换模型”。
 */
export function openSession(path: string): Promise<SessionView | undefined> {
  const existing = Object.values(views()).find((view) => view.path === path);
  if (existing?.loaded) {
    activeId.set(existing.id);
    if (!useAcpBranch() || aliveSessionFor(existing.id)) return Promise.resolve(existing);
    const inFlight = opening.get(path);
    if (inFlight) return inFlight;
    releasedViews.delete(existing.id);
    const requestOpen = (async () => {
      try {
        await ensureAcpSession(existing.id);
        // The view survives a failed resume: the transcript is still the
        // projection it was, and the quiet error line names the reason.
        return viewFor(existing.id);
      } finally {
        opening.delete(path);
      }
    })();
    opening.set(path, requestOpen);
    return requestOpen;
  }
  const inFlight = opening.get(path);
  if (inFlight) return inFlight;
  const requestOpen = (async () => {
    try {
      if (useAcpBranch()) {
        const id = piSessionIdOfPath(path);
        if (!id) throw new Error(`not a pi session file: ${path}`);
        const meta = sessions().find((row) => row.path === path);
        // The load's cwd must equal the file's own: guess nothing (the
        // harness process would start in a folder the session never lived
        // in, and the distro refuses the mismatch). The fold feeds it —
        // and while the first scan is still walking, the boot's post-fold
        // hydration retries this open; a "not yet" is quiet, not an error.
        if (!meta?.cwd) {
          error.set(null);
          return undefined;
        }
        const { session, replay } = await openExistingSession(id, meta.cwd, { load: true });
        const view = blankView(id, {
          path,
          cwd: meta.cwd,
          name: meta?.name ?? "",
          transcript: reduceUpdates(replay),
          loaded: true,
          sessionState: "ready",
        });
        patchView(id, view);
        attachSession(id, session);
        // Restart-surviving asks become answerable cards again (B2).
        void seedPendingAsks(id, session);
        activeId.set(id);
        error.set(null);
        return view;
      }
      const data = await sessionRequest("session.open", { path }, 120000);
      const view = adoptSession(data);
      activeId.set(view.id);
      error.set(null);
      return view;
    } catch (failure) {
      error.set(String(failure));
      return undefined;
    } finally {
      opening.delete(path);
    }
  })();
  opening.set(path, requestOpen);
  return requestOpen;
}

/** The pi session id in a session file's name
 * (`<timestamp>_<sessionId>.jsonl`), or null when the name is not one. */
function piSessionIdOfPath(path: string): string | null {
  const base = path.split("/").pop() ?? "";
  const match = /_(.+)\.jsonl$/.exec(base);
  return match ? (match[1] ?? null) : null;
}

/**
 * Creates a session in `cwd` and opens it (without a container).
 *
 * ACP mode mints the distro session at once (`session/new`), so the view key
 * is the pi session id from the start; the process stays alive between turns.
 */
export async function createSession(cwd: string): Promise<string> {
  if (useAcpBranch()) {
    const session = await openNewSession(cwd);
    const key = session.id;
    patchView(key, { id: key, cwd, loaded: true, sessionState: "ready" });
    attachSession(key, session);
    activeId.set(key);
    error.set(null);
    return key;
  }
  const data = await sessionRequest("session.create", { cwd }, 120000);
  const view = adoptSession(data);
  activeId.set(view.id);
  error.set(null);
  return view.id;
}

/**
 * Adds the user's own row before the engine answers. The transcript is the
 * user's view of the turn until the reply lands; a failed request keeps the
 * row (the text is not silently lost) and shows the error quietly. The row
 * is minted `pending:` and re-keys onto the entry id the harness's
 * `entry_appended` chunk carries (transcript.ts).
 */
let optimisticSeq = 0;
function optimisticUser(id: string, text: string): void {
  const view = viewFor(id);
  if (!view) return;
  optimisticSeq += 1;
  const state = view.transcript ?? emptyTranscript();
  patchView(id, {
    transcript: { ...state, entries: [...state.entries, userEntry(`pending:${optimisticSeq}`, text)] },
    streaming: true,
    interrupted: false,
    error: undefined,
  });
}

/**
 * Sends a prompt to `sessionId` (the active session by default). A prompt
 * while a turn runs is a follow-up (the queue lane), never a second turn.
 * ACP mode: the session's persistent process; a running turn queues the text.
 */
export async function send(text: string, sessionId?: string): Promise<void> {
  const id = sessionId ?? activeId();
  const trimmed = text.trim();
  const view = viewFor(id);
  if (!id || !trimmed || !view) return;
  if (useAcpBranch()) {
    acpSend(viewKeyFor(id) ?? id, trimmed);
    return;
  }
  if (view.streaming) return followUp(trimmed, id);
  optimisticUser(id, trimmed);
  try {
    await sessionRequest("session.prompt", { sessionId: id, text: trimmed });
    // The first turn cast the session file; the composer data (and through
    // it the container registry's row) learns the path.
    void refreshSessionInfo(id);
  } catch (failure) {
    patchView(id, { streaming: false, error: String(failure) });
  }
}

/**
 * Queues `text` behind the running turn (`session.followUp`): the engine
 * sends it once the turn settles. Idle degrades to a prompt, so a stale
 * streaming edge cannot strand the message. ACP mode has no distro queue
 * yet: the text is queued locally and rides its own turn after the settle.
 */
export async function followUp(text: string, sessionId?: string): Promise<void> {
  const id = sessionId ?? activeId();
  const trimmed = text.trim();
  const view = viewFor(id);
  if (!id || !trimmed || !view) return;
  if (useAcpBranch()) {
    acpSend(viewKeyFor(id) ?? id, trimmed);
    return;
  }
  if (!view.streaming) return send(trimmed, id);
  optimisticUser(id, trimmed);
  try {
    await sessionRequest("session.followUp", { sessionId: id, text: trimmed });
  } catch (failure) {
    patchView(id, { error: String(failure) });
  }
}

/**
 * Injects `text` into the running turn (`session.steer`): the engine hands it
 * to the model at its next safe point. Idle degrades to a prompt. The ACP
 * distro has no steering lane: the text becomes a queued turn — the same
 * words, delivered at the next turn boundary.
 */
export async function steer(text: string, sessionId?: string): Promise<void> {
  const id = sessionId ?? activeId();
  const trimmed = text.trim();
  const view = viewFor(id);
  if (!id || !trimmed || !view) return;
  if (useAcpBranch()) {
    acpSend(viewKeyFor(id) ?? id, trimmed);
    return;
  }
  if (!view.streaming) return send(trimmed, id);
  optimisticUser(id, trimmed);
  try {
    await sessionRequest("session.steer", { sessionId: id, text: trimmed });
  } catch (failure) {
    patchView(id, { error: String(failure) });
  }
}

/**
 * Interrupts the running turn and prompts with `text` immediately. The abort
 * is best-effort: the prompt is the part the user asked for, and the engine
 * accepts it after the cancel either way. ACP mode: cancel, then the text
 * rides the next turn through the queue.
 */
export async function interrupt(text: string, sessionId?: string): Promise<void> {
  const id = sessionId ?? activeId();
  const trimmed = text.trim();
  const view = viewFor(id);
  if (!id || !trimmed || !view) return;
  if (useAcpBranch()) {
    const key = viewKeyFor(id) ?? id;
    // The stop is best-effort; `acpSend` queues the text behind whatever the
    // cancelled turn takes to settle, and its user row goes in once.
    acpTurns.get(key)?.cancel();
    acpSend(key, trimmed);
    return;
  }
  if (!view.streaming) return send(trimmed, id);
  optimisticUser(id, trimmed);
  try {
    await sessionRequest("session.abort", { sessionId: id }, 30000);
  } catch {
    // The prompt below reports the real failure; an abort race is not one.
  }
  try {
    await sessionRequest("session.prompt", { sessionId: id, text: trimmed });
  } catch (failure) {
    patchView(id, { streaming: false, error: String(failure) });
  }
}

/** Stops the run of `sessionId` (the active session by default). ACP mode:
 * `session/cancel` to the session's process; the pending prompt settles
 * `cancelled` and the process stays attached. */
export async function stop(sessionId?: string): Promise<void> {
  const id = sessionId ?? activeId();
  if (!id) return;
  if (useAcpBranch()) {
    const key = viewKeyFor(id) ?? id;
    acpTurns.get(key)?.cancel();
    return;
  }
  try {
    await sessionRequest("session.abort", { sessionId: id });
  } catch (failure) {
    patchView(id, { streaming: false, error: String(failure) });
  }
}

/** Sets the session's thinking level (the `/thinking` command's engine leg).
 * ACP mode: the `thought_level` config selector; a released session resumes
 * first (issue #54), and pi clamps the level to the model's own ladder. */
export async function setThinkingLevel(id: string, level: SessionThinkingLevel): Promise<boolean> {
  if (useAcpBranch()) {
    const session = await ensureAcpSession(id);
    if (!session) {
      mirrorReconnectFailure(id);
      return false;
    }
    clearReconnectError(id);
    try {
      await session.setConfig("thought_level", level);
      syncProtocolState(id);
      await loadSessionModels(id, true);
      return true;
    } catch (failure) {
      patchView(id, { error: String(failure) });
      return false;
    }
  }
  try {
    const data = (await sessionRequest("session.setThinking", { sessionId: id, level }, 30000)) as SessionInfoData;
    applySessionInfo(id, data);
    return true;
  } catch (failure) {
    patchView(id, { error: String(failure) });
    return false;
  }
}

/** Starts a manual compaction (the `/compact` command's engine leg). ACP
 * mode: `/compact` is a prompt the distro's dispatcher owns. */
export async function compactSession(id: string, instructions?: string): Promise<boolean> {
  if (useAcpBranch()) {
    if (!liveSession(id)) return false;
    // One turn on the session's process, like any other prompt: the stop
    // button and the queue behave the same while compaction runs.
    void runAcpTurn(id, `/compact${instructions ? ` ${instructions}` : ""}`);
    return true;
  }
  try {
    await sessionRequest("session.compact", { sessionId: id, ...(instructions ? { instructions } : {}) }, 30000);
    return true;
  } catch (failure) {
    patchView(id, { error: String(failure) });
    return false;
  }
}

/**
 * Clears the local transcript view (`/clear`): pi's interactive command
 * clears the screen without touching the session file, and so does this —
 * the history stays on disk and rehydrates on the next open.
 */
export function clearSessionView(id: string): void {
  patchView(id, { transcript: emptyTranscript() });
}
