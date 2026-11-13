import { HarnessConnection, type AcpUpdate } from "./acp";

/**
 * The persistent ACP session runtime (docs/pi-acp-IMPLEMENTATION.md A0):
 * one `pi-acp` process per open conversation, kept between turns.
 *
 * The store owns the view; this module owns the process. There is no cap,
 * no idle TTL and no RSS recycling (design D1): a process lives until the
 * session sheet closes, its container is archived, or the app quits. A crash
 * is surfaced as an interrupted session; the next action resumes it.
 */

/** One session configuration selector (ACP `SessionConfigOption`). */
export interface PiConfigOption {
  id: string;
  name: string;
  category?: string;
  type: "select";
  currentValue: string;
  options: Array<{ value: string; name: string; description?: string }>;
}

/** One command the distro can execute from a prompt. */
export interface PiCommand {
  name: string;
  description: string;
}

/** The approval-policy modes (`session/set_mode`). */
export interface PiModeState {
  currentModeId: string;
  availableModes: Array<{ id: string; name: string; description?: string }>;
}

export interface PiUsage {
  used: number;
  size: number;
  cost?: unknown;
}

export interface PermissionRequest {
  sessionId: string;
  toolCall?: { toolCallId?: string; title?: string; kind?: string; rawInput?: unknown };
  options?: Array<{ optionId: string; name: string; kind?: string }>;
}

export interface ElicitationRequest {
  sessionId: string;
  message?: string;
  requestedSchema?: unknown;
}

export type PermissionResponse = { outcome: { outcome: string; optionId?: string } };
export type ElicitationResponse = { action: string; content?: Record<string, unknown> };

/** What the store provides to answer server→client requests. */
export interface SessionHandlers {
  onUpdate(update: AcpUpdate): void;
  requestPermission(request: PermissionRequest): Promise<PermissionResponse>;
  requestElicitation(request: ElicitationRequest): Promise<ElicitationResponse>;
  onExit(reason: string): void;
}

/** One live ACP session: its process, protocol state and client bridge. */
export class AcpSession {
  readonly id: string;
  readonly cwd: string;
  configOptions: PiConfigOption[] = [];
  commands: PiCommand[] = [];
  modes: PiModeState = { currentModeId: "ask", availableModes: [] };
  usage: PiUsage | null = null;
  /** The session's title as the distro reports it. */
  title: string | null = null;
  dead = false;

  private handlers: SessionHandlers | null = null;

  constructor(
    private readonly connection: HarnessConnection,
    result: any,
    cwd: string,
  ) {
    this.id = String(result?.sessionId ?? connection.boundSessionId ?? "");
    this.cwd = cwd;
    this.adoptResult(result);
    connection.onUpdate((sessionId, update) => {
      if (sessionId && sessionId !== this.id) return;
      this.dispatch(update);
    });
    connection.onRequest((message) => this.handleClientRequest(message));
  }

  adoptResult(result: any): void {
    if (Array.isArray(result?.configOptions)) this.configOptions = result.configOptions;
    if (result?.modes) this.modes = result.modes;
  }

  /**
   * Updates that arrived before the session object existed (the distro
   * announces its command table before answering `session/new`/`resume`).
   * They still carry protocol state, so fold them in without a handler.
   */
  absorb(updates: AcpUpdate[]): void {
    for (const update of updates) this.dispatch(update);
  }

  setHandlers(handlers: SessionHandlers | null): void {
    this.handlers = handlers;
  }

  /** Resolves once the prompt settles. */
  async prompt(text: string): Promise<string> {
    if (this.dead) throw new Error("the session's process is gone");
    const reply = await this.connection.channel.request("session/prompt", {
      sessionId: this.id,
      prompt: [{ type: "text", text }],
    });
    return String((reply as any)?.stopReason ?? "end_turn");
  }

  /** `session/cancel`: the pending prompt settles `cancelled`. */
  cancel(): void {
    if (this.dead) return;
    this.connection.channel.notify("session/cancel", { sessionId: this.id });
  }

  async setConfig(configId: string, value: string): Promise<void> {
    const reply = await this.connection.channel.request("session/set_config_option", {
      sessionId: this.id,
      configId,
      type: "select",
      value,
    });
    if (Array.isArray((reply as any)?.configOptions)) this.configOptions = (reply as any).configOptions;
  }

  /** An ACP extension method (`_zu/...`) on this session's connection. */
  async requestCustom<T = any>(method: string, params?: Record<string, unknown>): Promise<T> {
    return this.connection.channel.request(method, params) as Promise<T>;
  }

  async setMode(modeId: string): Promise<void> {
    await this.connection.channel.request("session/set_mode", { sessionId: this.id, modeId });
    this.modes = { ...this.modes, currentModeId: modeId };
  }

  /** One-shot close: session/close, then the process's graceful exit. */
  async close(): Promise<void> {
    if (this.dead) return;
    this.dead = true;
    await this.connection.closeSession(this.id).catch(() => {});
    this.connection.close();
  }

  /** Marks the session dead when its process died on its own. */
  markDead(reason: string): void {
    if (this.dead) return;
    this.dead = true;
    this.handlers?.onExit(reason);
  }

  private dispatch(update: AcpUpdate): void {
    if (update.sessionUpdate === "config_option_update" && Array.isArray(update.configOptions)) {
      this.configOptions = update.configOptions as PiConfigOption[];
    } else if (update.sessionUpdate === "available_commands_update" && Array.isArray(update.availableCommands)) {
      this.commands = update.availableCommands as PiCommand[];
    } else if (update.sessionUpdate === "current_mode_update" && typeof update.currentModeId === "string") {
      this.modes = { ...this.modes, currentModeId: update.currentModeId };
    } else if (update.sessionUpdate === "usage_update") {
      this.usage = { used: Number(update.used ?? 0), size: Number(update.size ?? 0) };
    } else if (update.sessionUpdate === "session_info_update" && typeof update.title === "string") {
      this.title = update.title;
    }
    this.handlers?.onUpdate(update);
  }

  private handleClientRequest(message: { method: string; params: any; id: number | string | null }): void {
    const id = message.id;
    if (id === null || id === undefined) return;
    if (message.method === "session/request_permission") {
      const request = message.params as PermissionRequest;
      const pending = this.handlers?.requestPermission(request);
      void (pending ?? Promise.resolve({ outcome: { outcome: "cancelled" } }))
        .then((response) => this.connection.respond(id, response))
        .catch(() => this.connection.respond(id, { outcome: { outcome: "cancelled" } }));
      return;
    }
    if (message.method === "elicitation/create") {
      const request = message.params as ElicitationRequest;
      const pending = this.handlers?.requestElicitation(request);
      void (pending ?? Promise.resolve({ action: "cancel" }))
        .then((response) => this.connection.respond(id, response))
        .catch(() => this.connection.respond(id, { action: "cancel" }));
      return;
    }
    this.connection.respondError(id, -32601, `the client does not serve ${message.method}`);
  }
}

/** The process registry: session id → live session. */
const sessions = new Map<string, AcpSession>();

function adopt(session: AcpSession): AcpSession {
  sessions.set(session.id, session);
  return session;
}

/** Opens a fresh session (spawn + initialize + session/new). */
export async function openNewSession(cwd: string): Promise<AcpSession> {
  const connection = await HarnessConnection.start({ cwd });
  try {
    const early: AcpUpdate[] = [];
    connection.onUpdate((_sessionId, update) => early.push(update));
    const result = await connection.newSession(cwd);
    const session = adopt(new AcpSession(connection, result, cwd));
    session.absorb(early);
    connection.onExit((exit) => {
      sessions.delete(session.id);
      session.markDead(
        `the harness exited (${exit.code === null ? String(exit.signal ?? "unknown") : exit.code})`,
      );
    });
    return session;
  } catch (failure) {
    connection.kill("session/new failed");
    throw failure;
  }
}

/**
 * Opens an existing session. `load` replays the transcript (the read face);
 * without it the session is resumed without history.
 */
export async function openExistingSession(
  sessionId: string,
  cwd: string,
  options: { load?: boolean } = {},
): Promise<{ session: AcpSession; replay: AcpUpdate[] }> {
  const existing = sessions.get(sessionId);
  if (existing && !existing.dead) return { session: existing, replay: [] };
  const connection = await HarnessConnection.start({ cwd });
  try {
    let result: any;
    let replay: AcpUpdate[] = [];
    const early: AcpUpdate[] = [];
    connection.onUpdate((_sessionId, update) => early.push(update));
    if (options.load) {
      const loaded = await connection.loadSession(sessionId, cwd);
      result = loaded.result;
      replay = loaded.updates;
      result = { ...result, sessionId };
    } else {
      result = await connection.resumeSession(sessionId, cwd);
      result = { ...result, sessionId };
    }
    const session = adopt(new AcpSession(connection, result, cwd));
    session.absorb([...replay, ...early]);
    connection.onExit((exit) => {
      sessions.delete(session.id);
      session.markDead(
        `the harness exited (${exit.code === null ? String(exit.signal ?? "unknown") : exit.code})`,
      );
    });
    return { session, replay };
  } catch (failure) {
    connection.kill("session resume failed");
    throw failure;
  }
}

/** The live session for an id, if this host owns one. */
export function liveSession(sessionId: string): AcpSession | undefined {
  return sessions.get(sessionId);
}

/** Closes one session and its process. */
export async function closeSession(sessionId: string): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) return;
  sessions.delete(sessionId);
  await session.close();
}

/** Closes every session (app quit / container archive). */
export async function closeAllSessions(): Promise<void> {
  const all = [...sessions.values()];
  sessions.clear();
  await Promise.all(all.map((session) => session.close()));
}

/** Closes every session whose cwd is the container's workspace. */
export async function closeContainerSessions(cwd: string): Promise<void> {
  const doomed = [...sessions.values()].filter((session) => session.cwd === cwd);
  for (const session of doomed) sessions.delete(session.id);
  await Promise.all(doomed.map((session) => session.close()));
}
