import { batch, signal } from "nsh";
import { onEngineEvent, request } from "./engine";

/**
 * The session store: what the sidebar lists and what the conversation
 * sheet renders. Everything here is folded from engine events; the
 * transcript's authority is pi's session file, never this store.
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
export type Msg = { role: Role; text: string; at?: number };

/** The sidebar's rows, newest first. */
export const sessions = signal<SessionMeta[]>([]);
/** The open session's pi id. */
export const activeId = signal<string | null>(null);
/** The open session's transcript. */
export const messages = signal<Msg[]>([]);
/** A run is streaming in the open session. */
export const streaming = signal(false);
/** The last store-level error. */
export const error = signal<string | null>(null);
/** The open session's directory (its container stands in for M1). */
export const activeCwd = signal<string>("");
/** The open session's file: the same path reopens it after a restart. */
export const activePath = signal<string>("");

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
  requestAnimationFrame(flush);
};

onEngineEvent((event) => {
  switch (event.type) {
    case "message.delta": {
      if (event.sessionId !== activeId()) return;
      pendingText += String(event.delta ?? "");
      queueFlush();
      break;
    }
    case "message.complete": {
      if (event.sessionId !== activeId()) return;
      flush();
      const message = event.message ?? {};
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
      const running = event.state === "running";
      if (!running) flush();
      streaming.set(running);
      break;
    }
    case "tool.start":
    case "tool.end": {
      if (event.sessionId !== activeId()) return;
      const label = String(event.toolName ?? "tool");
      const list = messages();
      if (event.type === "tool.start") {
        messages.set([...list, { role: "tool", text: `${label} …` }]);
      } else {
        const text = `${label} ${event.isError ? "failed" : "done"}`;
        const index = list.map((m) => m.role).lastIndexOf("tool");
        if (index >= 0) {
          messages.set([...list.slice(0, index), { role: "tool", text }, ...list.slice(index + 1)]);
        } else {
          messages.set([...list, { role: "tool", text }]);
        }
      }
      break;
    }
    case "error": {
      if (event.sessionId && event.sessionId !== activeId()) return;
      error.set(String(event.message ?? "engine error"));
      streaming.set(false);
      break;
    }
    default:
      break;
  }
});

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
    const data = await request("session.open", { path });
    batch(() => {
      activeId.set(String(data?.id ?? ""));
      activePath.set(path);
      const meta = sessions().find((row) => row.path === path);
      activeCwd.set(meta?.cwd ?? "");
      messages.set(
        ((data?.messages ?? []) as Msg[]).filter((message) => message.text && (message.role === "user" || message.role === "assistant")),
      );
      streaming.set(false);
      error.set(null);
    });
  } catch (failure) {
    error.set(String(failure));
  }
}

/** Creates a session in `cwd` and opens it. */
export async function createSession(cwd: string): Promise<string> {
  const data = await request("session.create", { cwd });
  const id = String(data?.id ?? "");
  batch(() => {
    activeId.set(id);
    activeCwd.set(cwd);
    activePath.set(String(data?.path ?? ""));
    messages.set([]);
    streaming.set(false);
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
