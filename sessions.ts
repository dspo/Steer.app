import { batch, computed, signal } from "nsh";
import { onDisconnect, onEngineEvent, onSnapshot, request } from "./engine";
import type { SessionData, StateSnapshot } from "./contracts/protocol";

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

export type Role = "user" | "assistant" | "tool";
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
      const data = (event.data ?? {}) as any;
      patchView(id, {
        ...(data.path ? { path: String(data.path) } : {}),
        ...(data.name ? { name: String(data.name) } : {}),
      });
      if (data.name) {
        sessions.set(
          sessions().map((row) => (row.id === id ? { ...row, name: String(data.name) } : row)),
        );
      }
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

/** Sends a prompt to `sessionId` (the active session by default). */
export async function send(text: string, sessionId?: string): Promise<void> {
  const id = sessionId ?? activeId();
  const trimmed = text.trim();
  const view = viewFor(id);
  if (!id || !trimmed || !view || view.streaming) return;
  patchView(id, {
    messages: [...view.messages, { role: "user", text: trimmed }],
    streaming: true,
    interrupted: false,
    error: undefined,
  });
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
