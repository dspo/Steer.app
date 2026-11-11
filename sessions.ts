import { batch, computed, signal } from "nsh";
import { onDisconnect, onEngineEvent, onSnapshot, request } from "./engine";
import type {
  SessionContextUsage,
  SessionData,
  SessionInfoData,
  SessionModelInfo,
  SessionModelsData,
  SessionThinkingLevel,
  StateSnapshot,
} from "./contracts/protocol";

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

export type Role = "user" | "assistant" | "tool" | "note";
export type ToolState = "running" | "done" | "failed";
export type Msg = {
  role: Role;
  text: string;
  at?: number;
  tool?: { id?: string; name: string; state: ToolState };
};

/** One session's projected state. */
export type SessionView = {
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

/**
 * Folds a (possibly partial) `session.info` payload into a view. Events carry
 * one changed field at a time (a model switch, a thinking level, the context
 * gauge after a turn); the reply carries them all. An absent field leaves the
 * view's value alone.
 */
export function applySessionInfo(id: string, data: SessionInfoData | null | undefined): void {
  if (!data) return;
  const patch: Partial<SessionView> = {};
  if (typeof data.path === "string" && data.path) patch.path = data.path;
  if (typeof data.name === "string" && data.name) patch.name = data.name;
  if (data.model && typeof data.model === "object") patch.model = data.model;
  if (typeof data.thinkingLevel === "string") patch.thinkingLevel = data.thinkingLevel;
  if (data.contextUsage && typeof data.contextUsage === "object") patch.contextUsage = data.contextUsage;
  if (Object.keys(patch).length > 0) patchView(id, patch);
}

/** Asks the engine for a session's composer data and folds it into the view. */
export async function refreshSessionInfo(id: string): Promise<void> {
  if (!id) return;
  try {
    const data = await request("session.info", { sessionId: id }, 30000);
    applySessionInfo(id, data as SessionInfoData);
  } catch {
    // The session's sheet still renders its transcript; the next event or a
    // later reopen supplies the composer's data.
  }
}

/** What the model picker has for a session: its grouped choices or a load state. */
export type SessionModelsState = {
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

/** The view of `id`, if the shell has seen it. */
export function viewFor(id: string | null | undefined): SessionView | undefined {
  return id ? views()[id] : undefined;
}

/** Makes `id` the session the shell's non-keyed controls act on. */
export function focusSession(id: string): void {
  activeId.set(id);
}

/** The label a sheet or a sidebar row shows for a session. */
export function sessionTitle(id: string): string {
  const view = views()[id];
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

onEngineEvent((event) => {
  const id = event.sessionId;
  switch (event.type) {
    case "message.delta": {
      if (!id) return;
      pendingDeltas.set(id, (pendingDeltas.get(id) ?? "") + String((event.data as any)?.delta ?? ""));
      queueFlush();
      break;
    }
    case "message.complete": {
      if (!id) return;
      flushDeltas();
      const message = (event.data ?? {}) as any;
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
      const running = (event.data as any)?.state === "running";
      if (!running) flushDeltas();
      patchView(id, { streaming: running, ...(running ? { interrupted: false } : {}) });
      break;
    }
    case "tool.start":
    case "tool.end": {
      if (!id) return;
      const data = (event.data ?? {}) as any;
      const label = String(data.toolName ?? "tool");
      const callId = data.toolCallId ? String(data.toolCallId) : undefined;
      const current = views()[id] ?? blankView(id);
      const list = current.messages;
      if (event.type === "tool.start") {
        patchView(id, {
          messages: [...list, { role: "tool", text: label, tool: { id: callId, name: label, state: "running" } }],
        });
      } else {
        const state: ToolState = data.isError ? "failed" : "done";
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
      const data = (event.data ?? {}) as SessionInfoData;
      applySessionInfo(id, data);
      if (data.name) {
        sessions.set(
          sessions().map((row) => (row.id === id ? { ...row, name: String(data.name) } : row)),
        );
      }
      break;
    }
    case "subagent.note": {
      if (!id) return;
      const data = (event.data ?? {}) as any;
      const current = views()[id] ?? blankView(id);
      patchView(id, {
        messages: [...current.messages, { role: "note", text: String(data.text ?? "") }],
      });
      break;
    }
    case "error": {
      const message = String((event.data as any)?.message ?? "engine error");
      if (id) patchView(id, { streaming: false, error: message });
      else error.set(message);
      break;
    }
    default:
      break;
  }
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
// reconnect decides from the snapshot whether they really stopped.
onDisconnect(() => {
  flushDeltas();
  const next = { ...views() };
  let changed = false;
  for (const [id, view] of Object.entries(next)) {
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

/** Reloads the sidebar from pi's session directory. */
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

/** Creates a session in `cwd` and opens it (without a container). */
export async function createSession(cwd: string): Promise<string> {
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
 */
export async function send(text: string, sessionId?: string): Promise<void> {
  const id = sessionId ?? activeId();
  const trimmed = text.trim();
  const view = viewFor(id);
  if (!id || !trimmed || !view) return;
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
 * streaming edge cannot strand the message.
 */
export async function followUp(text: string, sessionId?: string): Promise<void> {
  const id = sessionId ?? activeId();
  const trimmed = text.trim();
  const view = viewFor(id);
  if (!id || !trimmed || !view) return;
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
 * to the model at its next safe point. Idle degrades to a prompt.
 */
export async function steer(text: string, sessionId?: string): Promise<void> {
  const id = sessionId ?? activeId();
  const trimmed = text.trim();
  const view = viewFor(id);
  if (!id || !trimmed || !view) return;
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
 * accepts it after the cancel either way.
 */
export async function interrupt(text: string, sessionId?: string): Promise<void> {
  const id = sessionId ?? activeId();
  const trimmed = text.trim();
  const view = viewFor(id);
  if (!id || !trimmed || !view) return;
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

/** Stops the run of `sessionId` (the active session by default). */
export async function stop(sessionId?: string): Promise<void> {
  const id = sessionId ?? activeId();
  if (!id) return;
  try {
    await request("session.abort", { sessionId: id });
  } catch (failure) {
    patchView(id, { streaming: false, error: String(failure) });
  }
}

/** Sets the session's thinking level (the `/thinking` command's engine leg). */
export async function setThinkingLevel(id: string, level: SessionThinkingLevel): Promise<boolean> {
  try {
    const data = (await sessionRequest("session.setThinking", { sessionId: id, level }, 30000)) as SessionInfoData;
    applySessionInfo(id, data);
    return true;
  } catch (failure) {
    patchView(id, { error: String(failure) });
    return false;
  }
}

/** Starts a manual compaction (the `/compact` command's engine leg). */
export async function compactSession(id: string, instructions?: string): Promise<boolean> {
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
