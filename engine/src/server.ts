/**
 * Zu engine: a loopback WebSocket host around pi's SDK.
 *
 * One process serves every session (pi has no multiplexing protocol; the
 * SDK is the documented way to run several in one host). The UI is the only
 * client. Everything the UI learns comes from pi's own events, and pi's
 * session files stay the authority — the engine keeps no transcript mirror.
 *
 * Wire: see `contracts/protocol.ts` and `contracts/protocol.md`. Every
 * message names its protocol version; a mismatched peer is rejected, not
 * guessed at. The engine increments a persisted `generation` on each start,
 * so a reconnecting shell can tell a restart from a dropped socket.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  hasTrustRequiringProjectResources,
  ProjectTrustStore,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";

import {
  PROTOCOL_VERSION,
  UI_REQUEST_TIMEOUT_MS,
  makeErrorReply,
  makeEvent,
  makeReply,
  makeUIRequest,
  makeWelcome,
  parseEnvelope,
  validateCommand,
  type Envelope,
  type EventMessage,
  type EventType,
  type Reply,
  type SessionExtensionsData,
  type SessionMeta,
  type StateSnapshot,
  type UIMethod,
  type UIResponsePayload,
} from "../../contracts/protocol";
import { PI_VERSION } from "./version";

const PORT = Number(process.env.ZU_PORT ?? 47823);
const TOKEN = process.env.ZU_TOKEN ?? "";
const AGENT_DIR = getAgentDir();
const TRUST_YES = "Trust this folder";
const TRUST_NO = "Do not trust";

type AgentSession = Awaited<ReturnType<typeof createAgentSession>>["session"];

interface Rec {
  id: string;
  path: string;
  cwd: string;
  manager: SessionManager;
  session: AgentSession;
  /** The connection that opened it; UI requests go here while it is alive. */
  client?: any;
  name?: string;
  extensions: SessionExtensionsData;
}

/** Open sessions by pi session id. */
const open = new Map<string, Rec>();
/** Connections subscribed to events (after `state.subscribe`). */
const subscribers = new Set<any>();
/** Extension UI requests awaiting a `ui.response`, by request id. */
const pendingUI = new Map<string, { resolve: (result: unknown) => void; timer: any }>();
const trustStore = new ProjectTrustStore(AGENT_DIR);

let uiSeq = 0;

const startedAt = Date.now();
const generation = nextGeneration();
const extraExtensionPaths = (process.env.ZU_EXTENSION_PATHS ?? "")
  .split(",")
  .map((path) => path.trim())
  .filter(Boolean);

function send(ws: any, msg: unknown): void {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    // A closed socket; the next command opens a new one.
  }
}

function emit(type: EventType, data?: unknown, sessionId?: string): void {
  if (subscribers.size === 0) return;
  const message = makeEvent(type, data, sessionId);
  const text = JSON.stringify(message);
  for (const client of subscribers) {
    try {
      client.send(text);
    } catch {
      // Ignored: the socket's close handler removes it.
    }
  }
}

function reply(ws: any, message: Reply): void {
  send(ws, message);
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

function customTypes(manager: SessionManager): string[] {
  return manager
    .getEntries()
    .filter((entry) => entry.type === "custom")
    .map((entry) => String((entry as any).customType));
}

function sessionData(rec: Rec) {
  return {
    id: rec.id,
    path: rec.path,
    cwd: rec.cwd,
    name: rec.name,
    messages: (rec.session.state?.messages ?? []).map(plain),
    customTypes: customTypes(rec.manager),
  };
}

function snapshot(): StateSnapshot {
  return {
    generation,
    protocol: PROTOCOL_VERSION,
    pi: PI_VERSION,
    pid: process.pid,
    startedAt,
    containers: [],
    openSessions: [...open.values()].map((rec) => ({
      sessionId: rec.id,
      path: rec.path,
      cwd: rec.cwd,
      name: rec.name,
      running: rec.session.isStreaming,
    })),
    activeRuns: [...open.values()].filter((rec) => rec.session.isStreaming).map((rec) => rec.id),
    unread: {},
  };
}

function uptimeMs(): number {
  return Date.now() - startedAt;
}

/**
 * Asks one connection for a decision, resolving with `fallback` when the
 * timeout passes or the request cannot be delivered. The request lives in
 * `pendingUI` until the matching `ui.response`.
 */
function requestUI(
  ws: any,
  sessionId: string | undefined,
  method: UIMethod,
  params: Record<string, unknown>,
  fallback: unknown,
  timeoutMs = UI_REQUEST_TIMEOUT_MS,
): Promise<unknown> {
  const id = `u${++uiSeq}`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingUI.delete(id);
      resolve(fallback);
    }, timeoutMs);
    pendingUI.set(id, { resolve, timer });
    send(ws, makeUIRequest(id, method, params, timeoutMs, sessionId));
  });
}

function resolveUIResponse(message: Envelope): void {
  const entry = pendingUI.get(String(message.id));
  if (!entry) return;
  pendingUI.delete(String(message.id));
  clearTimeout(entry.timer);
  const payload = (message.payload ?? {}) as UIResponsePayload;
  entry.resolve(payload.ok ? payload.result : undefined);
}

/** Records a method the shell cannot show, so it is never silently dropped. */
function unsupported(sessionId: string | undefined, method: string): void {
  console.warn(`[zu] extension UI method not supported: ${method}`);
  emit("ui.unsupported", { method }, sessionId);
}

function unsubscribeAll(): void {
  for (const entry of pendingUI.values()) {
    clearTimeout(entry.timer);
    entry.resolve(undefined);
  }
  pendingUI.clear();
}

/**
 * The pi UI context bound to one session. Dialogs go to the shell as
 * `ui.request`; notification, status and title are events; every method the
 * shell does not implement is logged and announced, never a silent no-op.
 */
function createUIContext(rec: Rec): ExtensionUIContext {
  const ask = (method: UIMethod, params: Record<string, unknown>, fallback: unknown, timeout?: number) =>
    requestUI(rec.client, rec.id, method, params, fallback, timeout);

  const noop = (method: string) => (..._args: unknown[]) => {
    unsupported(rec.id, method);
    return undefined;
  };

  return {
    select: (title, options, opts) =>
      ask("select", { title, options }, undefined, opts?.timeout) as Promise<string | undefined>,
    confirm: (title, message, opts) =>
      ask("confirm", { title, message }, false, opts?.timeout) as Promise<boolean>,
    input: (title, placeholder, opts) =>
      ask("input", { title, placeholder }, undefined, opts?.timeout) as Promise<string | undefined>,
    editor: (title, prefill) =>
      ask("editor", { title, prefill }, undefined, UI_REQUEST_TIMEOUT_MS * 2) as Promise<string | undefined>,
    notify: (message, type = "info") => {
      emit("ui.notify", { message, type }, rec.id);
    },
    setStatus: (key, text) => {
      emit("ui.status", { key, text }, rec.id);
    },
    setTitle: (title) => {
      emit("ui.title", { title }, rec.id);
    },
    setWorkingMessage: noop("setWorkingMessage"),
    setWorkingVisible: noop("setWorkingVisible"),
    setWorkingIndicator: noop("setWorkingIndicator"),
    setHiddenThinkingLabel: noop("setHiddenThinkingLabel"),
    setWidget: noop("setWidget"),
    setFooter: noop("setFooter"),
    setHeader: noop("setHeader"),
    custom: noop("custom"),
    pasteToEditor: noop("pasteToEditor"),
    setEditorText: noop("setEditorText"),
    addAutocompleteProvider: noop("addAutocompleteProvider"),
    setEditorComponent: noop("setEditorComponent"),
    onTerminalInput: () => {
      unsupported(rec.id, "onTerminalInput");
      return () => {};
    },
    getEditorText: () => {
      unsupported(rec.id, "getEditorText");
      return "";
    },
    getEditorComponent: () => {
      unsupported(rec.id, "getEditorComponent");
      return undefined;
    },
    getToolsExpanded: () => false,
    setToolsExpanded: noop("setToolsExpanded"),
    getAllThemes: () => [],
    getTheme: () => {
      unsupported(rec.id, "getTheme");
      return undefined;
    },
    setTheme: () => {
      unsupported(rec.id, "setTheme");
      return { success: false, error: "the shell owns its theme" };
    },
    theme: undefined as any,
  } as ExtensionUIContext;
}

/** One session's pi events, projected onto the wire events. */
function subscribe(rec: Rec): void {
  rec.session.subscribe((event: any) => {
    const sessionId = rec.id;
    switch (event.type) {
      case "message_update": {
        const update = event.assistantMessageEvent;
        if (update?.type === "text_delta" && update.delta) {
          emit("message.delta", { delta: update.delta }, sessionId);
        }
        break;
      }
      case "message_end": {
        const message = plain(event.message);
        // System messages carry pi's prompt; the transcript has none.
        if (message.role === "system") break;
        notePath(rec);
        emit("message.complete", message, sessionId);
        break;
      }
      case "agent_start":
        emit("agent.state", { state: "running" }, sessionId);
        break;
      case "agent_settled": {
        // A durable mark of the run's end, written where pi keeps the
        // transcript: pi's own loader reads it, its context ignores it, and
        // a CLI sees the entry. Q10's mechanism, used from M1 on.
        try {
          rec.manager.appendCustomEntry("zu.turn", { at: Date.now() });
        } catch {
          // A read-only or already-closed session: the turn itself stands.
        }
        notePath(rec);
        emit("agent.state", { state: "idle" }, sessionId);
        break;
      }
      case "agent_end":
        // Not the end of the turn: retries, compaction and steering may follow.
        break;
      case "tool_execution_start":
        emit("tool.start", { toolName: event.toolName ?? "tool", toolCallId: event.toolCallId }, sessionId);
        break;
      case "tool_execution_update":
        emit("tool.update", { toolName: event.toolName ?? "tool", toolCallId: event.toolCallId }, sessionId);
        break;
      case "tool_execution_end":
        emit(
          "tool.end",
          { toolName: event.toolName ?? "tool", toolCallId: event.toolCallId, isError: !!event.isError },
          sessionId,
        );
        break;
      case "queue_update":
        emit("queue.update", { steering: event.steering ?? [], followUp: event.followUp ?? [] }, sessionId);
        break;
      case "compaction_start":
        emit("compaction.start", { reason: event.reason }, sessionId);
        break;
      case "compaction_end":
        emit(
          "compaction.end",
          {
            reason: event.reason,
            aborted: event.aborted,
            willRetry: event.willRetry,
            errorMessage: event.errorMessage,
          },
          sessionId,
        );
        break;
      case "auto_retry_start":
        emit(
          "retry.start",
          {
            attempt: event.attempt,
            maxAttempts: event.maxAttempts,
            delayMs: event.delayMs,
            errorMessage: event.errorMessage,
          },
          sessionId,
        );
        break;
      case "auto_retry_end":
        emit(
          "retry.end",
          { attempt: event.attempt, success: event.success, finalError: event.finalError },
          sessionId,
        );
        break;
      case "session_info_changed":
        rec.name = event.name;
        emit("session.info", { name: event.name }, sessionId);
        break;
      case "thinking_level_changed":
        emit("session.info", { thinkingLevel: event.level }, sessionId);
        break;
      case "extension_error":
        emit("error", { message: String(event.error ?? "extension error") }, sessionId);
        break;
      default:
        break;
    }
  });
}

/** A created session's file appears only after its first message. */
function notePath(rec: Rec): void {
  const path = rec.manager.getSessionFile() ?? "";
  if (path && path !== rec.path) {
    rec.path = path;
    emit("session.info", { path }, rec.id);
  }
}

/** The trust decision a session's project resources need, persisted by pi. */
async function resolveTrust(ws: any, cwd: string): Promise<boolean> {
  const saved = trustStore.get(cwd);
  if (saved !== null) return saved;
  const choice = await requestUI(
    ws,
    undefined,
    "select",
    {
      title: `Trust ${cwd}?`,
      description:
        "This folder has project-local pi resources. Trusting it lets them load; Zu records the decision in pi's trust store.",
      options: [TRUST_YES, TRUST_NO],
    },
    TRUST_NO,
  );
  const trusted = choice === TRUST_YES;
  trustStore.set(cwd, trusted);
  return trusted;
}

/**
 * Creates pi's services for one cwd, resolving project trust through the
 * shell before project-local extensions and settings load (Q23/Q33).
 */
async function services(cwd: string, ws: any) {
  const needsTrust = hasTrustRequiringProjectResources(cwd);
  const projectTrusted = !needsTrust || trustStore.get(cwd) === true;
  const settingsManager = SettingsManager.create(cwd, AGENT_DIR, { projectTrusted });
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir: AGENT_DIR,
    settingsManager,
    additionalExtensionPaths: extraExtensionPaths,
  });
  await resourceLoader.reload(
    needsTrust && !projectTrusted
      ? {
          resolveProjectTrust: async () => resolveTrust(ws, cwd),
        }
      : undefined,
  );
  return { settingsManager, resourceLoader };
}

async function makeRecord(manager: SessionManager, ws: any, cwd: string): Promise<Rec> {
  const id = manager.getSessionId();
  const { settingsManager, resourceLoader } = await services(cwd, ws);
  const created = await createAgentSession({
    sessionManager: manager,
    settingsManager,
    resourceLoader,
    cwd,
  });
  const rec: Rec = {
    id,
    path: manager.getSessionFile() ?? "",
    cwd,
    manager,
    session: created.session,
    client: ws,
    name: manager.getSessionName(),
    extensions: {
      extensions: created.extensionsResult.extensions.map((extension) => ({
        path: extension.path,
        hidden: !!extension.hidden,
      })),
      errors: created.extensionsResult.errors.map((failure) => ({
        path: failure.path,
        error: String(failure.error),
      })),
    },
  };
  open.set(id, rec);
  subscribe(rec);
  try {
    await created.session.bindExtensions({
      uiContext: createUIContext(rec),
      mode: "rpc",
      abortHandler: () => {
        void created.session.abort();
      },
      onError: (failure) => {
        emit("error", { message: `${failure.event}: ${String(failure.error)}` }, id);
      },
    });
  } catch (failure: any) {
    emit("error", { message: String(failure?.message ?? failure) }, id);
  }
  return rec;
}

async function openSession(path: string, ws: any) {
  for (const rec of open.values()) {
    if (rec.path === path) {
      rec.client = ws;
      return rec;
    }
  }
  const manager = SessionManager.open(path);
  return makeRecord(manager, ws, manager.getCwd());
}

async function createSession(cwd: string, ws: any) {
  const manager = SessionManager.create(cwd);
  return makeRecord(manager, ws, cwd);
}

async function listSessions(): Promise<SessionMeta[]> {
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

function requireSession(ws: any, message: Envelope, payload: Record<string, any>): Rec | undefined {
  const id = String(payload.sessionId ?? "");
  const rec = open.get(id);
  if (!rec) {
    reply(ws, makeErrorReply(String(message.id), message.type, "session not open", "session_not_open"));
    return undefined;
  }
  rec.client = ws;
  return rec;
}

async function handle(ws: any, message: Envelope): Promise<void> {
  if (message.type === "hello") {
    if (message.token !== TOKEN) {
      send(ws, { v: PROTOCOL_VERSION, type: "error", payload: { code: "bad_token", message: "bad token" } });
      ws.close();
      return;
    }
    if (message.v !== PROTOCOL_VERSION) {
      send(ws, {
        v: PROTOCOL_VERSION,
        type: "error",
        payload: {
          code: "protocol_mismatch",
          message: `protocol v${String(message.v)} does not match v${PROTOCOL_VERSION}`,
        },
      });
      ws.close();
      return;
    }
    send(ws, makeWelcome({ protocol: PROTOCOL_VERSION, pi: PI_VERSION, generation, pid: process.pid, startedAt }));
    return;
  }

  if (message.type === "ui.response") {
    resolveUIResponse(message);
    return;
  }

  const invalid = validateCommand(message);
  if (invalid) {
    reply(ws, makeErrorReply(String(message.id ?? ""), message.type, invalid.message, invalid.code));
    return;
  }

  const payload = (message.payload ?? {}) as Record<string, any>;
  const id = String(message.id);

  switch (message.type) {
    case "engine.ping": {
      reply(ws, makeReply(id, message.type, { at: Date.now() }));
      return;
    }
    case "engine.info": {
      reply(ws, makeReply(id, message.type, { ...snapshot(), uptimeMs: uptimeMs(), sessions: open.size }));
      return;
    }
    case "engine.health": {
      reply(
        ws,
        makeReply(id, message.type, { at: Date.now(), generation, uptimeMs: uptimeMs(), sessions: open.size }),
      );
      return;
    }
    case "state.snapshot": {
      reply(ws, makeReply(id, message.type, snapshot()));
      return;
    }
    case "state.subscribe": {
      subscribers.add(ws);
      reply(ws, makeReply(id, message.type, snapshot()));
      return;
    }
    case "session.list": {
      try {
        reply(ws, makeReply(id, message.type, { sessions: await listSessions() }));
      } catch (error: any) {
        reply(ws, makeErrorReply(id, message.type, String(error?.message ?? error), "list_failed"));
      }
      return;
    }
    case "session.create": {
      try {
        const rec = await createSession(String(payload.cwd ?? process.cwd()), ws);
        reply(ws, makeReply(id, message.type, sessionData(rec)));
      } catch (error: any) {
        reply(ws, makeErrorReply(id, message.type, String(error?.message ?? error), "create_failed"));
      }
      return;
    }
    case "session.open": {
      try {
        const rec = await openSession(String(payload.path ?? ""), ws);
        reply(ws, makeReply(id, message.type, sessionData(rec)));
      } catch (error: any) {
        reply(ws, makeErrorReply(id, message.type, String(error?.message ?? error), "open_failed"));
      }
      return;
    }
    case "session.info": {
      const rec = requireSession(ws, message, payload);
      if (!rec) return;
      reply(
        ws,
        makeReply(id, message.type, {
          sessionId: rec.id,
          path: rec.path,
          name: rec.name,
          running: rec.session.isStreaming,
          customTypes: customTypes(rec.manager),
        }),
      );
      return;
    }
    case "session.extensions": {
      const rec = requireSession(ws, message, payload);
      if (!rec) return;
      reply(ws, makeReply(id, message.type, rec.extensions));
      return;
    }
    case "session.prompt": {
      const rec = requireSession(ws, message, payload);
      if (!rec) return;
      reply(ws, makeReply(id, message.type, { accepted: true }));
      // Not awaited: events stream while the run continues.
      void rec.session.prompt(String(payload.text ?? "")).catch((error: any) => {
        emit("error", { message: String(error?.message ?? error) }, rec.id);
        emit("agent.state", { state: "idle" }, rec.id);
      });
      return;
    }
    case "session.steer":
    case "session.followUp": {
      const rec = requireSession(ws, message, payload);
      if (!rec) return;
      if (!rec.session.isStreaming) {
        reply(
          ws,
          makeErrorReply(id, message.type, "session is idle; use session.prompt", "session_idle"),
        );
        return;
      }
      const behavior = message.type === "session.steer" ? "steer" : "followUp";
      reply(ws, makeReply(id, message.type, { accepted: true }));
      void rec.session.prompt(String(payload.text ?? ""), { streamingBehavior: behavior }).catch((error: any) => {
        emit("error", { message: String(error?.message ?? error) }, rec.id);
      });
      return;
    }
    case "session.abort": {
      const rec = requireSession(ws, message, payload);
      if (!rec) return;
      await rec.session.abort();
      // The aborted run may not settle; the shell's streaming state follows this.
      emit("agent.state", { state: "idle" }, rec.id);
      reply(ws, makeReply(id, message.type, {}));
      return;
    }
    case "session.close": {
      const sid = String(payload.sessionId ?? "");
      const rec = open.get(sid);
      if (rec) {
        if (rec.session.isStreaming) await rec.session.abort();
        rec.session.dispose();
        open.delete(sid);
      }
      reply(ws, makeReply(id, message.type, {}));
      return;
    }
    default: {
      // validateCommand already rejected unknown names; this keeps the
      // switch exhaustive if a command is added to the table but not here.
      reply(ws, makeErrorReply(id, message.type, `unhandled command ${message.type}`, "unhandled_command"));
    }
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
    open(_ws) {},
    message(ws, raw) {
      const message = parseEnvelope(String(raw));
      if (!message) {
        send(ws, { v: PROTOCOL_VERSION, type: "error", payload: { code: "bad_json", message: "bad json" } });
        return;
      }
      void handle(ws, message);
    },
    close(ws) {
      subscribers.delete(ws);
    },
  },
});

console.log(`zu-engine v${PROTOCOL_VERSION} generation ${generation} listening on 127.0.0.1:${server.port} (pi ${PI_VERSION})`);

/** 5000 ms; the shell treats 15 s without one as a dead engine. */
setInterval(() => {
  emit("engine.heartbeat", { at: Date.now(), generation, uptimeMs: uptimeMs(), sessions: open.size });
}, 5000);

// The host owns this process. If it goes away without stopping us (a crash,
// a force quit), exit: an orphan would hold the port and the session files.
const parent = process.ppid;
setInterval(() => {
  if (process.ppid !== parent) shutdown(0);
}, 1000);

function shutdown(code: number): void {
  for (const rec of open.values()) {
    try {
      rec.session.dispose();
    } catch {
      // Already disposed.
    }
  }
  unsubscribeAll();
  process.exit(code);
}

// A signal from the host ends the process cleanly.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => shutdown(0));
}

/**
 * The persisted generation counter. It lives beside the log and the token;
 * a failed write degrades to a process-local generation rather than keeping
 * the engine from starting.
 */
function nextGeneration(): number {
  const path = join(homedir(), ".pi", "zu", "engine.generation");
  let previous = 0;
  try {
    const stored = Number.parseInt(readFileSync(path, "utf8").trim(), 10);
    if (Number.isFinite(stored) && stored >= 0) previous = stored;
  } catch {
    // First start: no counter yet.
  }
  const next = previous + 1;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, String(next));
  } catch {
    // A read-only state directory: this generation is process-local.
  }
  return next;
}
