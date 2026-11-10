import { batch, signal } from "nsh";
import { onDisconnect, onEngineEvent, onSnapshot, request } from "./engine";
import type { StateSnapshot } from "./contracts/protocol";

/**
 * The session store: what the sidebar lists and what the conversation
 * sheet renders. Everything here is folded from engine events; the
 * transcript's authority is pi's session file, never this store.
 *
 * On a reconnect the store rebuilds from the engine's snapshot: sessions
 * the engine still has are adopted, the active session is reopened by its
 * file path when the engine lost it, and a turn that was running when the
 * connection dropped is marked interrupted rather than left streaming.
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
export type Msg = { role: Role; text: string; at?: number; tool?: { name: string; state: ToolState } };

/** The sidebar's rows, newest first. */
export const sessions = signal<SessionMeta[]>([]);
/** The open session's pi id. */
export const activeId = signal<string | null>(null);
/** The open session's transcript. */
export const messages = signal<Msg[]>([]);
/** A run is streaming in the open session. */
export const streaming = signal(false);
/** The last turn was cut off by an engine restart; the transcript is kept. */
export const interrupted = signal(false);
/** The last store-level error. */
export const error = signal<string | null>(null);
/** The open session's directory (its container stands in for M1). */
export const activeCwd = signal<string>("");
/** The open session's file: the same path reopens it after a restart. */
export const activePath = signal<string>("");

let reconciling = false;

const assistant = (): Msg | undefined => {
  const list = messages();
  const last = list[list.length - 1];
  return last?.role === "assistant" ? last : undefined;
};

// Deltas collect here and reach the signal once per frame, as the gallery's
// chat does: a token-by-token set would re-render per chunk.
let pendingText = "";
let frameQueued = false;
const flush = () => {
  frameQueued = false;
  if (!pendingText) return;
  const delta = pendingText;
  pendingText = "";
  const list = messages();
  const last = list[list.length - 1];
  if (last?.role === "assistant") {
    messages.set([...list.slice(0, -1), { ...last, text: last.text + delta }]);
  } else {
    messages.set([...list, { role: "assistant", text: delta }]);
  }
};
const queueFlush = () => {
  if (frameQueued) return;
  frameQueued = true;
  // A timer, not requestAnimationFrame: the headless test runner has no
  // frame loop, so deltas would collect until the turn ended.
  setTimeout(flush, 16);
};

/** Marks the last turn as cut off and stops its streaming indicator. */
function markInterrupted(): void {
  flush();
  streaming.set(false);
  interrupted.set(true);
}

onEngineEvent((event) => {
  switch (event.type) {
    case "message.delta": {
      if (event.sessionId !== activeId()) return;
      pendingText += String((event.data as any)?.delta ?? "");
      queueFlush();
      break;
    }
    case "message.complete": {
      if (event.sessionId !== activeId()) return;
      flush();
      const message = (event.data ?? {}) as any;
      // The stream already showed the assistant's text, and the user's own
      // message was added locally; only an assistant reply with no streamed
      // text lands here whole.
      if (message.role === "assistant" && !assistant() && message.text) {
        messages.set([...messages(), { role: "assistant", text: String(message.text) }]);
      }
      break;
    }
    case "agent.state": {
      if (event.sessionId !== activeId()) return;
      const running = (event.data as any)?.state === "running";
      if (running) interrupted.set(false);
      else flush();
      streaming.set(running);
      break;
    }
    case "tool.start":
    case "tool.end": {
      if (event.sessionId !== activeId()) return;
      const data = (event.data ?? {}) as any;
      const label = String(data.toolName ?? "tool");
      const list = messages();
      if (event.type === "tool.start") {
        messages.set([...list, { role: "tool", text: label, tool: { name: label, state: "running" } }]);
      } else {
        const state: ToolState = data.isError ? "failed" : "done";
        const index = list.map((m) => m.role).lastIndexOf("tool");
        const row = { role: "tool" as const, text: label, tool: { name: label, state } };
        if (index >= 0) {
          messages.set([...list.slice(0, index), row, ...list.slice(index + 1)]);
        } else {
          messages.set([...list, row]);
        }
      }
      break;
    }
    case "session.info": {
      if (event.sessionId !== activeId()) return;
      const path = String((event.data as any)?.path ?? "");
      if (path) activePath.set(path);
      break;
    }
    case "error": {
      if (event.sessionId && event.sessionId !== activeId()) return;
      error.set(String((event.data as any)?.message ?? "engine error"));
      streaming.set(false);
      break;
    }
    default:
      break;
  }
});

/**
 * Rebuilds the shell's session state from an engine snapshot. An engine
 * restart loses its in-memory sessions; the active one comes back from its
 * file, and its interrupted turn is labelled.
 */
onSnapshot((state: StateSnapshot) => {
  void reconcile(state);
});

// The connection died with a turn in flight: stop the spinner now, and let
// the reconnect decide from the snapshot whether the turn really stopped.
onDisconnect(() => {
  if (streaming()) markInterrupted();
});

async function reconcile(state: StateSnapshot): Promise<void> {
  if (reconciling) return;
  reconciling = true;
  try {
    const path = activePath();
    if (!path) {
      // No open conversation to restore; keep the sidebar current.
      await refreshSessions();
      return;
    }
    const mine = state.openSessions.find((row) => row.path === path);
    if (mine) {
      if (activeId() !== mine.sessionId) activeId.set(mine.sessionId);
      if (mine.running) {
        streaming.set(true);
        interrupted.set(false);
      } else if (streaming()) {
        markInterrupted();
      }
      await refreshSessions();
      return;
    }

    // The engine has no session for this file: reopen it, then decide
    // whether the turn it was running survived.
    const wasStreaming = streaming();
    try {
      const data = await request("session.open", { path }, 120000);
      batch(() => {
        activeId.set(String(data?.id ?? ""));
        activeCwd.set(String(data?.cwd ?? activeCwd()));
        const projected = ((data?.messages ?? []) as Msg[]).filter(
          (message) => message.text && (message.role === "user" || message.role === "assistant"),
        );
        messages.set(projected);
        if (wasStreaming) markInterrupted();
      });
    } catch (failure) {
      error.set(String(failure));
      markInterrupted();
    }
    await refreshSessions();
  } finally {
    reconciling = false;
  }
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

/** Opens a session by its file path and loads its transcript. */
export async function openSession(path: string): Promise<void> {
  try {
    const data = await request("session.open", { path }, 120000);
    batch(() => {
      activeId.set(String(data?.id ?? ""));
      activePath.set(path);
      const meta = sessions().find((row) => row.path === path);
      activeCwd.set(String(data?.cwd ?? meta?.cwd ?? ""));
      messages.set(
        ((data?.messages ?? []) as Msg[]).filter(
          (message) => message.text && (message.role === "user" || message.role === "assistant"),
        ),
      );
      streaming.set(false);
      interrupted.set(false);
      error.set(null);
    });
  } catch (failure) {
    error.set(String(failure));
  }
}

/** Creates a session in `cwd` and opens it. */
export async function createSession(cwd: string): Promise<string> {
  const data = await request("session.create", { cwd }, 120000);
  const id = String(data?.id ?? "");
  batch(() => {
    activeId.set(id);
    activeCwd.set(cwd);
    activePath.set(String(data?.path ?? ""));
    messages.set([]);
    streaming.set(false);
    interrupted.set(false);
    error.set(null);
  });
  return id;
}

/** Sends a prompt to the open session; the reply streams in as events. */
export async function send(text: string): Promise<void> {
  const id = activeId();
  const trimmed = text.trim();
  if (!id || !trimmed || streaming()) return;
  messages.set([...messages(), { role: "user", text: trimmed }]);
  streaming.set(true);
  interrupted.set(false);
  error.set(null);
  try {
    await request("session.prompt", { sessionId: id, text: trimmed });
  } catch (failure) {
    streaming.set(false);
    error.set(String(failure));
  }
}

/** Stops the active run. */
export async function stop(): Promise<void> {
  const id = activeId();
  if (!id) return;
  try {
    await request("session.abort", { sessionId: id });
  } catch (failure) {
    error.set(String(failure));
  }
}
