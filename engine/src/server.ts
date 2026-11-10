/**
 * Zu engine: a loopback WebSocket host around pi's SDK.
 *
 * One process serves every session (pi has no multiplexing protocol; the
 * SDK is the documented way to run several in one host). The UI is the only
 * client. Everything the UI learns comes from pi's own events, and pi's
 * session files stay the authority — the engine keeps no transcript mirror.
 *
 * Wire: JSON records over the socket, each `{ id?, type, ... }`. Commands
 * carry an `id` that the matching `reply` repeats.
 */

import { createAgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import { PI_VERSION } from "./version";

const PORT = Number(process.env.ZU_PORT ?? 47823);
const TOKEN = process.env.ZU_TOKEN ?? "";
const PROTOCOL = 1;

type AgentSession = Awaited<ReturnType<typeof createAgentSession>>["session"];

/** Open sessions by pi session id. */
const open = new Map<string, AgentSession>();
/** The manager each open session persists through (custom entries, leaf). */
const managers = new Map<string, SessionManager>();
/** Every connected UI; commands answer one, events go to all. */
const clients = new Set<any>();

function send(ws: any, msg: unknown): void {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    // A closed socket; the next command opens a new one.
  }
}

function broadcast(msg: unknown): void {
  const text = JSON.stringify(msg);
  for (const client of clients) {
    try {
      client.send(text);
    } catch {
      // Ignored: the socket's close handler removes it.
    }
  }
}

function reply(ws: any, id: string | undefined, command: string, data?: unknown): void {
  send(ws, { id, type: "reply", command, ok: true, data });
}

function fail(ws: any, id: string | undefined, command: string, message: string): void {
  send(ws, { id, type: "reply", command, ok: false, error: message });
}

/** A message the UI can render: role and its text. */
function plain(message: any): { role: string; text: string; at?: number } {
  const text =
    typeof message.content === "string"
      ? message.content
      : Array.isArray(message.content)
        ? message.content
            .filter((block: any) => block?.type === "text")
            .map((block: any) => block.text)
            .join("")
        : "";
  return { role: message.role, text, at: message.timestamp };
}

/** Attaches the session's events to the UI. One session, one subscription. */
function subscribe(id: string, session: AgentSession): void {
  session.subscribe((event: any) => {
    switch (event.type) {
      case "message_update": {
        const update = event.assistantMessageEvent;
        if (update?.type === "text_delta" && update.delta) {
          broadcast({ type: "message.delta", sessionId: id, delta: update.delta });
        }
        break;
      }
      case "message_end": {
        const message = plain(event.message);
        // System messages carry pi's prompt; the transcript has none.
        if (message.role === "system") break;
        broadcast({ type: "message.complete", sessionId: id, message });
        break;
      }
      case "agent_start":
        broadcast({ type: "agent.state", sessionId: id, state: "running" });
        break;
      case "agent_settled": {
        // A durable mark of the run's end, written where pi keeps the
        // transcript: pi's own loader reads it, its context ignores it, and
        // a CLI sees the entry. Q10's mechanism, used from M1 on.
        try {
          managers.get(id)?.appendCustomEntry("zu.turn", { at: Date.now() });
        } catch {
          // A read-only or already-closed session: the turn itself stands.
        }
        broadcast({ type: "agent.state", sessionId: id, state: "idle" });
        break;
      }
      case "agent_end":
        // Not the end of the turn: retries, compaction and steering may follow.
        break;
      case "tool_execution_start":
        broadcast({ type: "tool.start", sessionId: id, toolName: event.toolName ?? "tool" });
        break;
      case "tool_execution_end":
        broadcast({ type: "tool.end", sessionId: id, toolName: event.toolName ?? "tool", isError: !!event.isError });
        break;
      case "extension_error":
        broadcast({ type: "error", sessionId: id, message: String(event.error ?? "extension error") });
        break;
      default:
        break;
    }
  });
}

async function openSession(
  path: string,
): Promise<{ id: string; path: string; messages: any[]; customTypes: string[] }> {
  const manager = SessionManager.open(path);
  const id = manager.getSessionId();
  managers.set(id, manager);
  const customTypes = () =>
    manager
      .getEntries()
      .filter((entry) => entry.type === "custom")
      .map((entry) => String((entry as any).customType));
  const existing = open.get(id);
  if (existing) {
    return { id, path, messages: (existing.state?.messages ?? []).map(plain), customTypes: customTypes() };
  }
  const { session } = await createAgentSession({ sessionManager: manager });
  open.set(id, session);
  subscribe(id, session);
  return { id, path, messages: (session.state?.messages ?? []).map(plain), customTypes: customTypes() };
}

async function newSession(cwd: string): Promise<{ id: string; path?: string; messages: any[] }> {
  const manager = SessionManager.create(cwd);
  const id = manager.getSessionId();
  managers.set(id, manager);
  const { session } = await createAgentSession({ sessionManager: manager });
  open.set(id, session);
  subscribe(id, session);
  return { id, path: manager.getSessionFile(), messages: [] };
}

async function listSessions(): Promise<any[]> {
  const infos = await SessionManager.listAll();
  infos.sort((a, b) => +new Date(b.modified) - +new Date(a.modified));
  return infos.slice(0, 200).map((info) => ({
    id: info.id,
    path: info.path,
    cwd: info.cwd,
    name: info.name ?? "",
    created: +new Date(info.created),
    modified: +new Date(info.modified),
    messageCount: info.messageCount,
    preview: (info.firstMessage ?? "").slice(0, 160),
  }));
}

async function handle(ws: any, msg: any): Promise<void> {
  const { id, type } = msg;
  switch (type) {
    case "hello": {
      if (msg.token !== TOKEN) {
        send(ws, { type: "error", message: "bad token" });
        ws.close();
        return;
      }
      clients.add(ws);
      send(ws, { type: "welcome", pi: PI_VERSION, protocol: PROTOCOL, pid: process.pid });
      return;
    }
    case "ping": {
      reply(ws, id, "ping", { at: Date.now() });
      return;
    }
    case "session.list": {
      try {
        reply(ws, id, type, { sessions: await listSessions() });
      } catch (error: any) {
        fail(ws, id, type, String(error?.message ?? error));
      }
      return;
    }
    case "session.open": {
      try {
        reply(ws, id, type, await openSession(String(msg.path)));
      } catch (error: any) {
        fail(ws, id, type, String(error?.message ?? error));
      }
      return;
    }
    case "session.create": {
      try {
        reply(ws, id, type, await newSession(String(msg.cwd ?? process.cwd())));
      } catch (error: any) {
        fail(ws, id, type, String(error?.message ?? error));
      }
      return;
    }
    case "session.prompt": {
      const session = open.get(String(msg.sessionId));
      if (!session) return fail(ws, id, type, "session not open");
      reply(ws, id, type, { accepted: true });
      // Not awaited: events stream while the run continues.
      void session.prompt(String(msg.text ?? "")).catch((error: any) => {
        broadcast({ type: "error", sessionId: msg.sessionId, message: String(error?.message ?? error) });
        broadcast({ type: "agent.state", sessionId: msg.sessionId, state: "idle" });
      });
      return;
    }
    case "session.abort": {
      const session = open.get(String(msg.sessionId));
      if (!session) return fail(ws, id, type, "session not open");
      await session.abort();
      // The aborted run may not settle; the UI's streaming state follows this.
      broadcast({ type: "agent.state", sessionId: String(msg.sessionId), state: "idle" });
      reply(ws, id, type, {});
      return;
    }
    case "session.info": {
      const sid = String(msg.sessionId);
      const manager = managers.get(sid);
      if (!manager) return fail(ws, id, type, "session not open");
      reply(ws, id, type, {
        sessionId: sid,
        path: manager.getSessionFile(),
        customTypes: manager
          .getEntries()
          .filter((entry) => entry.type === "custom")
          .map((entry) => String((entry as any).customType)),
      });
      return;
    }
    case "session.close": {
      const session = open.get(String(msg.sessionId));
      if (session) {
        session.dispose?.();
        open.delete(String(msg.sessionId));
        managers.delete(String(msg.sessionId));
      }
      reply(ws, id, type, {});
      return;
    }
    default:
      fail(ws, id, String(type), `unknown command ${type}`);
  }
}

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: PORT,
  fetch(request, srv) {
    if (srv.upgrade(request, { data: {} })) return undefined;
    return new Response("zu engine");
  },
  websocket: {
    open(ws) {},
    message(ws, raw) {
      let msg: any;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        send(ws, { type: "error", message: "bad json" });
        return;
      }
      void handle(ws, msg);
    },
    close(ws) {
      clients.delete(ws);
    },
  },
});

console.log(`zu-engine listening on 127.0.0.1:${server.port} (pi ${PI_VERSION})`);

// The host owns this process. If it goes away without stopping us (a crash,
// a force quit), exit: an orphan would hold the port and the session files.
const parent = process.ppid;
setInterval(() => {
  if (process.ppid !== parent) {
    for (const session of open.values()) session.dispose?.();
    process.exit(0);
  }
}, 1000);

// A signal from the host ends the process cleanly.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    for (const session of open.values()) session.dispose?.();
    process.exit(0);
  });
}
