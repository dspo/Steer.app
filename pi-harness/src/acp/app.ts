/**
 * The ACP agent-side method surface, served on the official SDK
 * (`@agentclientprotocol/sdk`, ACP v1 — the "0.11 baseline" vocabulary of
 * docs/zu-pi-harness-ARCHITECTURE.v2.md §5).
 *
 * The SDK owns the wire: ndjson framing with a 32 MiB line cap (§7.3), JSON-RPC
 * 2.0 id pairing, batch-array rejection, and error responses for parse /
 * unknown-method / bad-params. This module owns the semantics:
 *
 *   initialize    → protocolVersion + agentCapabilities + authMethods: []
 *   session/new   → one pi session per ACP sessionId
 *   session/load  → resume from ~/.pi/agent/sessions + full update replay
 *   session/prompt→ one turn; settle = stopReason
 *   session/cancel→ abort; the pending prompt answers stopReason: cancelled
 *
 * This file must not import pi. The pi glue sits behind `HarnessPorts`
 * (src/acp/pi-session.ts), which keeps `bun test` free of pi and of network.
 */

import {
  PROTOCOL_VERSION,
  agent,
  type AgentApp,
  type AgentContext,
  type ContentBlock,
  type LoadSessionRequest,
  type NewSessionRequest,
  type SessionNotification,
  type SessionUpdate,
  type StopReason,
} from "@agentclientprotocol/sdk";
import { codedError, JSONRPC_CODE, normalizeError, sessionNotFoundError } from "./errors";
import { PI_VERSION } from "../version";
import { promptBlocksToText } from "./mapping";

/** What the adapter needs from a live session. Implemented by the pi glue. */
export interface HarnessSession {
  /** pi's session id; doubles as the ACP sessionId (v2 §4.3). */
  readonly id: string;
  /** Runs one turn; resolves with the ACP stop reason when it settles. */
  prompt(text: string): Promise<StopReason>;
  /** Stops the running turn; the pending prompt then resolves `cancelled`. */
  abort(): Promise<void>;
  /** Releases pi's resources; the session file on disk stays. */
  dispose(): void;
  /** The load replay: this session's history as update payloads. */
  replay(): SessionUpdate[];
  /** Live update payloads, pushed synchronously and in pi's event order. */
  onUpdate(push: (update: SessionUpdate) => void): void;
}

/** How the method surface obtains sessions (pi in production, fakes in tests). */
export interface HarnessPorts {
  createSession(cwd: string): Promise<HarnessSession>;
  loadSession(sessionId: string, cwd: string): Promise<HarnessSession>;
}

/** One stderr line; stdout is protocol-only. */
export type HarnessLog = (line: string) => void;

/**
 * Builds the agent app. Connect it with `app.connect(ndJsonStream(...))`.
 */
export function createAcpApp(ports: HarnessPorts, log: HarnessLog = () => {}): AgentApp {
  const sessions = new Map<string, HarnessSession>();
  /** Each session's live updates flow to the context that created it. */
  const clients = new Map<string, AgentContext>();
  /** Whether a `session/prompt` turn is in flight, per session. */
  const busy = new Set<string>();
  /** Serializes each session's outbound updates; notify is async. */
  const pumps = new Map<string, Promise<void>>();

  const app = agent({ name: "pi-harness" });

  app.onRequest("initialize", (cx) => {
    const requested = cx.params.protocolVersion;
    // We speak exactly ACP v1; echo a matching request, else declare ours and
    // let the client decide (the schema documents both halves of this rule).
    const protocolVersion = requested === PROTOCOL_VERSION ? requested : PROTOCOL_VERSION;
    return {
      protocolVersion,
      agentCapabilities: {
        loadSession: true,
        promptCapabilities: { image: false, audio: false, embeddedContext: false },
      },
      // Credentials come from ~/.pi, shared with the user's own pi CLI; the
      // distro needs no login flow (v2 §5.0).
      authMethods: [],
      agentInfo: { name: "pi-harness", version: PI_VERSION },
    };
  });

  app.onRequest("session/new", mcpServersLenient<NewSessionRequest>, async (cx) => {
    // `mcpServers` is accepted and explicitly ignored: pi runs its own MCP
    // configuration, and ignoring is a declared behavior, not an accident
    // (v2 §5.2). Clients that omit the field entirely are served too — the
    // lenient parser below defaults it to `[]`.
    void cx.params.mcpServers;
    void cx.params.additionalDirectories;
    const session = await withLog("session_new_failed", () => ports.createSession(cx.params.cwd));
    adopt(session, cx.client);
    return { sessionId: session.id };
  });

  app.onRequest("session/load", mcpServersLenient<LoadSessionRequest>, async (cx) => {
    const session = await withLog("session_load_failed", () =>
      ports.loadSession(cx.params.sessionId, cx.params.cwd),
    );
    adopt(session, cx.client);
    // ACP v1: the replay precedes the response, in order.
    for (const update of session.replay()) {
      await notifyUpdate(session.id, update);
    }
    return {};
  });

  app.onRequest("session/prompt", async (cx) => {
    const session = requireSession(cx.params.sessionId);
    if (busy.has(session.id)) {
      throw codedError(
        JSONRPC_CODE.invalidRequest,
        "session_busy",
        "a turn is already running; send session/cancel first",
        { sessionId: session.id },
      );
    }
    const blocks = cx.params.prompt as ContentBlock[];
    const converted = promptBlocksToText(blocks);
    if (!converted.ok) throw converted.error;
    busy.add(session.id);
    try {
      const stopReason = await session.prompt(converted.text);
      // The turn's updates leave before the stop response: the pump chain is
      // the per-session ordering guarantee, and the response is the turn's
      // last frame on the wire.
      await pumps.get(session.id);
      return { stopReason };
    } catch (error) {
      throw normalizeError(error, "prompt_failed");
    } finally {
      busy.delete(session.id);
    }
  });

  app.onRequest("*", (cx) => {
    // Fallback after normal dispatch: an unknown method still answers with a
    // coded error — the repo ships zero uncoded errors, protocol misses
    // included.
    throw codedError(JSONRPC_CODE.methodNotFound, "method_not_found", `unknown method: ${cx.method}`);
  });

  app.onNotification("session/cancel", (cx) => {
    const session = sessions.get(cx.params.sessionId);
    if (!session) {
      // Notifications get no reply; a cancel for an unknown session is logged
      // so the condition is never silently swallowed.
      log(`session/cancel for unknown session ${cx.params.sessionId}`);
      return;
    }
    void session.abort().catch((error) => {
      log(`abort failed for ${session.id}: ${error instanceof Error ? error.message : String(error)}`);
    });
  });

  /**
   * Brings a session under the map: one live session object per id (v2 §11.2
   * — one harness per sessionPath). A `session/load` replaces the object a
   * previous `session/new` or load created for the same id; the old one is
   * disposed, the update pump is rewired to the new object.
   */
  function adopt(session: HarnessSession, client: AgentContext): void {
    const previous = sessions.get(session.id);
    if (previous && previous !== session) {
      try {
        previous.dispose();
      } catch (error) {
        log(`disposing replaced session ${session.id} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    sessions.set(session.id, session);
    clients.set(session.id, client);
    // The pump chain belongs to the previous object; start a fresh one.
    pumps.delete(session.id);
    pump(session);
  }

  /** The live update pump: one ordered chain per session. */
  function pump(session: HarnessSession): void {
    pumps.set(session.id, Promise.resolve());
    session.onUpdate((update) => {
      const current = pumps.get(session.id) ?? Promise.resolve();
      const next = current.then(() => notifyUpdate(session.id, update));
      pumps.set(
        session.id,
        next.catch(() => {}),
      );
    });
  }

  async function notifyUpdate(sessionId: string, update: SessionUpdate): Promise<void> {
    const client = clients.get(sessionId);
    if (!client) {
      log(`no client context for session ${sessionId}; update dropped (${describe(update)})`);
      return;
    }
    try {
      const notification: SessionNotification = { sessionId, update };
      await client.notify("session/update", notification);
    } catch (error) {
      log(`session/update failed for ${sessionId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function requireSession(sessionId: string): HarnessSession {
    const session = sessions.get(sessionId);
    if (!session) throw sessionNotFoundError(sessionId);
    return session;
  }

  async function withLog(stringCode: string, op: () => Promise<HarnessSession>): Promise<HarnessSession> {
    try {
      return await op();
    } catch (error) {
      // Rethrown so the SDK turns it into a coded JSON-RPC error; logged so
      // the operator sees the same failure on stderr.
      const normalized = normalizeError(error, stringCode);
      log(`${stringCode}: ${normalized.message}`);
      throw normalized;
    }
  }

  return app;
}

function describe(update: SessionUpdate): string {
  return String((update as { sessionUpdate?: unknown }).sessionUpdate ?? "update");
}

/**
 * The schema parses `mcpServers` as an array that defaults on null only, so a
 * request that omits the field would be refused before the handler runs.
 * The harness ignores MCP servers anyway (pi keeps its own configuration,
 * v2 §5.2), so an absent field means an empty list.
 */
function mcpServersLenient<T>(raw: unknown): T {
  const value = (raw ?? {}) as Record<string, unknown>;
  if (value.mcpServers === undefined || value.mcpServers === null) value.mcpServers = [];
  return value as T;
}
