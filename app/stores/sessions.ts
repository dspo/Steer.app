import { batch, computed, signal } from "nsh";
import { onDisconnect, onEngineEvent, onSnapshot, request } from "./engine";
import { K, t } from "../ui/i18n";
import {
  loadTranscript,
  piTransport,
  startTurn,
  type AcpUpdate,
  type TurnHandle,
} from "../harness/pi-acp/acp";
import { transcriptFromReplay, updateToStoreEvents } from "../harness/pi-acp/fold";
import type {
  SessionContextUsage,
  SessionData,
  SessionInfoData,
  SessionModelInfo,
  SessionModelsData,
  SessionThinkingLevel,
  StateSnapshot,
} from "../../contracts/protocol";

/**
 * The session store, keyed by pi session id. M3 can show several sessions at
 * once (a container is a group of panels), so a transcript is per session,
 * not one global conversation: every event is folded into its session's
 * view, whatever sheet is displayed.
 *
 * The transcript's authority is still pi's session file. A view is a
 * projection that a reconnect or a rehydration rebuilds from the engine;
 * `messages`/`streaming`/`interrupted` remain as accessors over the active
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

type Role = "user" | "assistant" | "tool" | "note";
type ToolState = "running" | "done" | "failed";
export type Msg = {
  role: Role;
  text: string;
  at?: number;
  tool?: { id?: string; name: string; state: ToolState };
};

/** One session's projected state. */
type SessionView = {
  id: string;
  path: string;
  cwd: string;
  name: string;
  containerId?: string;
  messages: Msg[];
  streaming: boolean;
  interrupted: boolean;
  loaded: boolean;
  /** The model the session runs, from `session.info`. */
  model?: SessionModelInfo;
  /** pi's thinking level; `off` means the model does not think. */
  thinkingLevel?: SessionThinkingLevel;
  /** pi's live context gauge, from `session.info`. */
  contextUsage?: SessionContextUsage;
  /** The pi session id the view's turns ride, when it differs from the key
   * the view was opened under (an ACP mint after an engine-created view). */
  piId?: string;
  error?: string;
};

/** Every session the shell has opened or adopted, by pi id. */
export const views = signal<Record<string, SessionView>>({});
/** The session whose sheet was last active (the sidebar's focus). */
export const activeId = signal<string | null>(null);
/** The sidebar's rows, newest first. */
export const sessions = signal<SessionMeta[]>([]);
/** The last store-level error. */
export const error = signal<string | null>(null);

/** The active session's transcript, for callers that do not pass an id. */
export const messages = computed<Msg[]>(() => views()[activeId() ?? ""]?.messages ?? []);
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
    messages: [],
    streaming: false,
    interrupted: false,
    loaded: false,
    ...patch,
  };
}

/** Replaces a view field by field; the record is immutable so bindings see it. */
function patchView(id: string, patch: Partial<SessionView>): void {
  const current = views()[id] ?? blankView(id);
  views.set({ ...views(), [id]: { ...current, ...patch } });
}

// --- the ACP transport branch (v2 §7; B1 parallel leg) -----------------------
//
// When `ZU_PI_TRANSPORT=acp`, pi sessions ride per-turn harness processes
// instead of the engine's WS sessions. The view keys and the store's outward
// behavior stay the same; only the transport under `send`/`stop`/`open`
// changes. The engine path above stays the default and keeps serving
// everything the distro does not (the read list in B1, the composer's
// model/thinking/context data, subagents) — those degrade with reasons here
// rather than failing obscurely.

/** The ACP alias map: a pi session id → the view key it is shown under. A
 * view's pi id can be minted (or re-minted) after the view exists, and the
 * dock's sheets hold the key they were opened with. */
const acpAliasByPiId = new Map<string, string>();
/** The in-flight ACP turn per view key (the stop button's handle). */
const acpTurns = new Map<string, TurnHandle>();
/** Texts queued while a turn runs (the follow-up lane without the engine). */
const acpQueues = new Map<string, string[]>();

/** True when pi sessions ride the ACP harness. */
export function acpEnabled(): boolean {
  return piTransport() === "acp";
}

/** Resolves a pi session id (or alias) to the view key it folds into. */
function viewKeyFor(id: string | null | undefined): string | null {
  if (!id) return null;
  const aliased = acpAliasByPiId.get(id);
  return aliased ?? id;
}

/** Records that pi id `piId` is shown under view key `key`. */
function notePiId(key: string, piId: string): void {
  const view = views()[key];
  if (view) patchView(key, { piId });
  if (piId !== key) acpAliasByPiId.set(piId, key);
}

/** Translates one ACP update into the store's fold. */
function foldAcpUpdate(key: string, update: AcpUpdate): void {
  for (const event of updateToStoreEvents(update)) {
    foldStoreEvent(key, event.type, event.data);
  }
}

/**
 * Runs one ACP turn for view `key`, folding updates as they stream, marking
 * the settle, and pumping the follow-up queue. The turn's result may mint a
 * pi id the view did not have (the first prompt, or a captain whose file was
 * never cast); the alias map keeps the view where its sheet is.
 */
function runAcpTurn(key: string, text: string): void {
  const view = views()[key];
  if (!view) return;
  const cwd = view.cwd || "/";
  let aliasNoted = false;
  const handle = startTurn({
    cwd,
    text,
    ...(view.piId ? { sessionId: view.piId } : {}),
    freshSessionFallback: true,
    onReplay: (updates) => {
      // A load replays before the turn: it is the file's truth, folded as
      // the transcript's base (the streamed deltas go on top of it).
      const rows = transcriptFromReplay(updates);
      const current = views()[key];
      if (current && rows.length > 0) patchView(key, { messages: rows });
    },
    hooks: {
      onUpdate: (update) => {
        const piId = handle?.sessionId;
        if (piId && piId !== key && !aliasNoted) {
          aliasNoted = true;
          notePiId(key, piId);
        }
        foldAcpUpdate(key, update);
      },
      onNotice: () => {
        // Harness stderr is transport detail; the turn's outcome carries it
        // when there is something to report.
      },
    },
  });
  acpTurns.set(key, handle);
  foldStoreEvent(key, "agent.state", { state: "running" });
  handle.done
    .then((result) => {
      acpTurns.delete(key);
      if (result.sessionId) notePiId(key, result.sessionId);
      foldStoreEvent(key, "agent.state", { state: "idle" });
      void pumpAcpQueue(key);
    })
    .catch((failure) => {
      acpTurns.delete(key);
      foldStoreEvent(key, "agent.state", { state: "idle" });
      patchView(key, { error: String(failure instanceof Error ? failure.message : failure) });
    });
}

/** Sends the next queued text as its own turn (settle-and-continue). */
async function pumpAcpQueue(key: string): Promise<void> {
  const queued = acpQueues.get(key);
  if (!queued || queued.length === 0) return;
  const [next, ...rest] = queued;
  if (rest.length > 0) acpQueues.set(key, rest);
  else acpQueues.delete(key);
  if (next) runAcpTurn(key, next);
}

/** The ACP send: a running turn queues the text; an idle view starts one. */
function acpSend(key: string, text: string): void {
  const busy = acpTurns.has(key) || (views()[key]?.streaming ?? false);
  if (busy) {
    acpQueues.set(key, [...(acpQueues.get(key) ?? []), text]);
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
 * view's value alone.
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
}

/** Asks the engine for a session's composer data and folds it into the view.
 * The ACP distro does not expose modes/models/usage yet (v2 §12 P3): in ACP
 * mode this stays empty rather than pretending, and the composer renders
 * without those gauges. */
export async function refreshSessionInfo(id: string): Promise<void> {
  if (!id || acpEnabled()) return;
  try {
    const data = await request("session.info", { sessionId: id }, 30000);
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

const sessionRequest = (type: string, payload?: Record<string, unknown>, timeoutMs?: number) =>
  sessionTransport ? sessionTransport(type, payload, timeoutMs) : request(type, payload, timeoutMs);

/** Replaces the transport for the model commands (fixtures, tests). */
export function setModelTransport(next: ModelTransport | null): void {
  modelTransport = next;
}

const modelRequest = (type: string, payload: Record<string, unknown>, timeoutMs: number) =>
  modelTransport ? modelTransport(type, payload, timeoutMs) : request(type, payload, timeoutMs);

function patchModels(id: string, next: SessionModelsState): void {
  sessionModels.set({ ...sessionModels(), [id]: next });
}

/**
 * Loads a session's available models. A ready list with providers is reused
 * until `force`; a load already in flight is shared, so opening the menu
 * twice costs one request. `force` asks pi's auth checks again, and an empty
 * answer is never cached: once the user configures a provider, the next open
 * (or retry) finds it without a restart.
 */
export async function loadSessionModels(id: string, force = false): Promise<void> {
  if (!id) return;
  if (acpEnabled()) {
    // The distro does not serve a model table yet; the picker says so
    // instead of an empty list or a silent spin.
    patchModels(id, { status: "error", error: t(K.session.acpModelsUnavailable) });
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
 * Switches the session's model through the engine. On success the reply's
 * `session.info` shape is folded in immediately and a fresh `session.info`
 * confirms it; on failure the reason stays with the picker's state.
 */
export async function chooseSessionModel(id: string, provider: string, modelId: string): Promise<boolean> {
  if (!id || !provider || !modelId) return false;
  if (acpEnabled()) {
    patchModels(id, { ...(sessionModels()[id] ?? { status: "error" as const }), status: "error", error: t(K.session.acpModelsUnavailable) });
    return false;
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
  return id ? views()[viewKeyFor(id) ?? id] : undefined;
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
export function seedSession(id: string, list: Msg[], patch: Partial<SessionView> = {}): void {
  batch(() => {
    patchView(id, { ...patch, messages: list, loaded: true });
    activeId.set(id);
  });
}

// Deltas collect per session and reach the signal once per frame, as the
// gallery's chat does: a token-by-token set would re-render per chunk.
const pendingDeltas = new Map<string, string>();
let frameQueued = false;
const flushDeltas = () => {
  frameQueued = false;
  if (pendingDeltas.size === 0) return;
  const batchEntries = [...pendingDeltas];
  pendingDeltas.clear();
  let next = views();
  for (const [id, delta] of batchEntries) {
    const current = next[id] ?? blankView(id);
    const list = current.messages;
    const last = list[list.length - 1];
    const messages =
      last?.role === "assistant"
        ? [...list.slice(0, -1), { ...last, text: last.text + delta }]
        : [...list, { role: "assistant" as const, text: delta }];
    next = { ...next, [id]: { ...current, messages } };
  }
  views.set(next);
};
const queueFlush = () => {
  if (frameQueued) return;
  frameQueued = true;
  // A timer, not requestAnimationFrame: the headless test runner has no
  // frame loop, so deltas would collect until the turn ended.
  setTimeout(flushDeltas, 16);
};

/** Marks a session's last turn as cut off and stops its streaming indicator. */
function markInterrupted(id: string): void {
  flushDeltas();
  const view = views()[id];
  if (!view) return;
  patchView(id, { streaming: false, interrupted: true });
}

/**
 * Folds one store-shaped event into its session's view. The engine events
 * and the ACP updates (translated in `harness/pi-acp/fold.ts`) arrive here
 * in the same shapes, so the store keeps one fold whatever the transport.
 * `id` is resolved through the ACP alias map first: a view whose pi session
 * id was minted (or re-minted) mid-life is keyed by the id it was opened
 * under, so dock sheets stay stable across the rename.
 */
function foldStoreEvent(rawId: string | undefined, type: string, data: unknown): void {
  const id = viewKeyFor(rawId);
  switch (type) {
    case "message.delta": {
      if (!id) return;
      pendingDeltas.set(id, (pendingDeltas.get(id) ?? "") + String((data as any)?.delta ?? ""));
      queueFlush();
      break;
    }
    case "message.complete": {
      if (!id) return;
      flushDeltas();
      const message = (data ?? {}) as any;
      // The stream already showed the assistant's text, and the user's own
      // message was added locally; only an assistant reply with no streamed
      // text lands here whole.
      if (message.role === "assistant" && message.text) {
        const current = views()[id] ?? blankView(id);
        const last = current.messages[current.messages.length - 1];
        if (last?.role !== "assistant") {
          patchView(id, {
            messages: [...current.messages, { role: "assistant", text: String(message.text) }],
          });
        }
      }
      break;
    }
    case "agent.state": {
      if (!id) return;
      const running = (data as any)?.state === "running";
      if (!running) flushDeltas();
      patchView(id, { streaming: running, ...(running ? { interrupted: false } : {}) });
      break;
    }
    case "tool.start":
    case "tool.end": {
      if (!id) return;
      const payload = (data ?? {}) as any;
      const label = String(payload.toolName ?? "tool");
      const callId = payload.toolCallId ? String(payload.toolCallId) : undefined;
      const current = views()[id] ?? blankView(id);
      const list = current.messages;
      if (type === "tool.start") {
        patchView(id, {
          messages: [...list, { role: "tool", text: label, tool: { id: callId, name: label, state: "running" } }],
        });
      } else {
        const state: ToolState = payload.isError ? "failed" : "done";
        const index = callId
          ? list.map((message) => message.tool?.id).lastIndexOf(callId)
          : list.map((message) => message.role).lastIndexOf("tool");
        const row = { role: "tool" as const, text: label, tool: { id: callId, name: label, state } };
        const messages =
          index >= 0
            ? [...list.slice(0, index), row, ...list.slice(index + 1)]
            : [...list, row];
        patchView(id, { messages });
      }
      break;
    }
    case "session.info": {
      if (!id) return;
      const info = (data ?? {}) as SessionInfoData;
      applySessionInfo(id, info);
      if (info.name) {
        sessions.set(
          sessions().map((row) => (row.id === id ? { ...row, name: String(info.name) } : row)),
        );
      }
      break;
    }
    case "subagent.note": {
      if (!id) return;
      const payload = (data ?? {}) as any;
      const current = views()[id] ?? blankView(id);
      patchView(id, {
        messages: [...current.messages, { role: "note", text: String(payload.text ?? "") }],
      });
      break;
    }
    case "error": {
      const message = String((data as any)?.message ?? "engine error");
      if (id) patchView(id, { streaming: false, error: message });
      else error.set(message);
      break;
    }
    default:
      break;
  }
}

onEngineEvent((event) => {
  foldStoreEvent(event.sessionId, event.type, event.data);
});

/**
 * Rebuilds every open session view from an engine snapshot. A restart loses
 * the engine's in-memory sessions; each sheet's file reopens, and a turn that
 * was streaming is labelled interrupted.
 */
onSnapshot((state: StateSnapshot) => {
  void reconcile(state);
});

// The connection died with turns in flight: stop their spinners now; the
// reconnect decides from the snapshot whether they really stopped. An ACP
// turn is not the engine's to judge: its transport is the process, and the
// turn's own settle (or its exit) decides.
onDisconnect(() => {
  flushDeltas();
  const next = { ...views() };
  let changed = false;
  for (const [id, view] of Object.entries(next)) {
    if (acpTurns.has(id) || acpQueues.has(id)) continue;
    if (!view.streaming) continue;
    next[id] = { ...view, streaming: false, interrupted: true };
    changed = true;
  }
  if (changed) views.set(next);
});

async function reconcile(state: StateSnapshot): Promise<void> {
  if (reconciling) return;
  reconciling = true;
  try {
    for (const [id, view] of Object.entries(views())) {
      // An ACP-transported view is not the engine's to judge: its live turn
      // is a process this side owns, and its transcript comes from its own
      // loads. Reopening it engine-side would overwrite the projection and
      // mark a live turn interrupted.
      if (acpTurns.has(id) || acpQueues.has(id) || (acpEnabled() && !!view.piId)) continue;
      if (!view.path) continue;
      const mine = state.openSessions.find((row) => row.path === view.path);
      if (mine) {
        if (mine.running) {
          patchView(id, { streaming: true, interrupted: false });
        } else if (view.streaming) {
          markInterrupted(id);
        }
        continue;
      }
      const wasStreaming = view.streaming;
      try {
        const data = await request("session.open", { path: view.path }, 120000);
        batch(() => {
          patchView(id, {
            id: String(data?.id ?? id),
            cwd: String(data?.cwd ?? view.cwd),
            containerId: data?.containerId ? String(data.containerId) : view.containerId,
            messages: project(data),
            loaded: true,
            streaming: false,
            ...(wasStreaming ? { interrupted: true } : {}),
          });
        });
        void refreshSessionInfo(String(data?.id ?? id));
      } catch (failure) {
        patchView(id, { streaming: false, interrupted: true, error: String(failure) });
      }
    }
    await refreshSessions();
  } finally {
    reconciling = false;
  }
}

function project(data: any): Msg[] {
  return ((data?.messages ?? []) as Msg[]).filter(
    (message) => message.text && (message.role === "user" || message.role === "assistant"),
  );
}

/** Reloads the sidebar from pi's session directory. ACP mode still reads it
 * through the engine in B1 (the parallel leg — the engine is up); the file
 * fold takes this over with `zu/state` in B2. */
export async function refreshSessions(): Promise<void> {
  try {
    const data = await request("session.list", {}, 30000);
    sessions.set((data?.sessions ?? []) as SessionMeta[]);
  } catch (failure) {
    error.set(String(failure));
  }
}

/** Adopts a session the engine already opened (a container command's reply). */
export function adoptSession(data: SessionData): SessionView {
  const id = String(data?.id ?? "");
  const view = blankView(id, {
    path: String(data?.path ?? ""),
    cwd: String(data?.cwd ?? ""),
    name: String(data?.name ?? ""),
    containerId: data?.containerId ? String(data.containerId) : undefined,
    messages: project(data),
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
 * ACP mode: the transcript is the `session/load` replay (v2 §5.4 — history
 * is read by a process from the file, never from the wire's memory), from a
 * harness process that settles and exits without a turn.
 */
export function openSession(path: string): Promise<SessionView | undefined> {
  const existing = Object.values(views()).find((view) => view.path === path);
  if (existing?.loaded) {
    activeId.set(existing.id);
    return Promise.resolve(existing);
  }
  const inFlight = opening.get(path);
  if (inFlight) return inFlight;
  const requestOpen = (async () => {
    try {
      if (acpEnabled()) {
        const id = piSessionIdOfPath(path);
        if (!id) throw new Error(`not a pi session file: ${path}`);
        const meta = sessions().find((row) => row.path === path);
        const cwd = meta?.cwd || path.split("/").slice(0, -1).join("/") || "/";
        const { updates } = await loadTranscript({ cwd, sessionId: id });
        const view = blankView(id, {
          path,
          cwd,
          name: meta?.name ?? "",
          messages: transcriptFromReplay(updates),
          loaded: true,
        });
        patchView(id, view);
        activeId.set(id);
        error.set(null);
        return view;
      }
      const data = await request("session.open", { path }, 120000);
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
 * ACP mode mints nothing here (v2 §4.3: `session/new` happens at the first
 * real prompt): the view is a local key whose first send casts the pi
 * session and records it under `piId`. The key stays stable for the dock.
 */
export async function createSession(cwd: string): Promise<string> {
  if (acpEnabled()) {
    const key = `acp-local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    patchView(key, { id: key, cwd, loaded: true });
    activeId.set(key);
    error.set(null);
    return key;
  }
  const data = await request("session.create", { cwd }, 120000);
  const view = adoptSession(data);
  activeId.set(view.id);
  error.set(null);
  return view.id;
}

/**
 * Adds the user's own row before the engine answers. The transcript is the
 * user's view of the turn until the reply lands; a failed request keeps the
 * row (the text is not silently lost) and shows the error quietly.
 */
function optimisticUser(id: string, text: string): void {
  const view = viewFor(id);
  if (!view) return;
  patchView(id, {
    messages: [...view.messages, { role: "user", text }],
    streaming: true,
    interrupted: false,
    error: undefined,
  });
}

/**
 * Sends a prompt to `sessionId` (the active session by default). A prompt
 * while a turn runs is a follow-up (the queue lane), never a second turn.
 * ACP mode: a per-turn harness process; a running turn queues the text.
 */
export async function send(text: string, sessionId?: string): Promise<void> {
  const id = sessionId ?? activeId();
  const trimmed = text.trim();
  const view = viewFor(id);
  if (!id || !trimmed || !view) return;
  if (acpEnabled()) {
    acpSend(viewKeyFor(id) ?? id, trimmed);
    return;
  }
  if (view.streaming) return followUp(trimmed, id);
  optimisticUser(id, trimmed);
  try {
    await sessionRequest("session.prompt", { sessionId: id, text: trimmed });
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
  if (acpEnabled()) {
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
 * distro has no `_session/steering` yet (v2 §5.3): the text degrades to a
 * queued turn — the same words, delivered at the next turn boundary.
 */
export async function steer(text: string, sessionId?: string): Promise<void> {
  const id = sessionId ?? activeId();
  const trimmed = text.trim();
  const view = viewFor(id);
  if (!id || !trimmed || !view) return;
  if (acpEnabled()) {
    acpSend(viewKeyFor(id) ?? id, trimmed);
    return;
  }
  if (!view.streaming) return send(trimmed, id);
  optimisticUser(id, trimmed);
  try {
    await request("session.steer", { sessionId: id, text: trimmed });
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
  if (acpEnabled()) {
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
    await request("session.abort", { sessionId: id }, 30000);
  } catch {
    // The prompt below reports the real failure; an abort race is not one.
  }
  try {
    await request("session.prompt", { sessionId: id, text: trimmed });
  } catch (failure) {
    patchView(id, { streaming: false, error: String(failure) });
  }
}

/** Stops the run of `sessionId` (the active session by default). ACP mode:
 * `session/cancel` to the harness process; its pending prompt settles
 * `cancelled` and the process exits. */
export async function stop(sessionId?: string): Promise<void> {
  const id = sessionId ?? activeId();
  if (!id) return;
  if (acpEnabled()) {
    const key = viewKeyFor(id) ?? id;
    acpTurns.get(key)?.cancel();
    return;
  }
  try {
    await request("session.abort", { sessionId: id });
  } catch (failure) {
    patchView(id, { streaming: false, error: String(failure) });
  }
}

/** Sets the session's thinking level (the `/thinking` command's engine leg).
 * ACP mode: thinking levels are session modes on the distro, which does not
 * expose them yet — refused with the reason, never guessed. */
export async function setThinkingLevel(id: string, level: SessionThinkingLevel): Promise<boolean> {
  if (acpEnabled()) {
    patchView(id, { error: t(K.session.acpThinkingUnavailable) });
    return false;
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
 * mode: the distro has no compaction trigger yet (v2 §5.3 x-zu/compact) —
 * refused with the reason. */
export async function compactSession(id: string, instructions?: string): Promise<boolean> {
  if (acpEnabled()) {
    patchView(id, { error: t(K.session.acpCompactUnavailable) });
    return false;
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
  patchView(id, { messages: [] });
}
