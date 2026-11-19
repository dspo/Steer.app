import { Acp, type AcpExit } from "../../../domains/acp";
import { JsonrpcChannel, JsonrpcFailure, type ServerMessage } from "./jsonrpc";

/**
 * The pi sessions' ACP client: one harness process per conversation, over
 * stdio ndjson. This module owns one connection's lifecycle — spawn →
 * initialize (the 60 s watchdog) → `session/new`/`load`/`resume` → prompts
 * and notifications → `session/close` then stdin close (the graceful exit).
 *
 * The process is persistent (design D1): it stays between turns, and the
 * session's sheet/container/app lifecycle decides when it goes. A crash
 * fails every pending request; the store marks the session interrupted and
 * the next action resumes it. The durable authority is pi's session file.
 *
 * This is the only pi-session transport since the cutover. The host above
 * (`host.ts`) owns the process registry and the server→client requests.
 */

/** One ACP `session/update` payload (the distro's shape, deliberately loose). */
export interface AcpUpdate {
  sessionUpdate?: string;
  [field: string]: unknown;
}

/** One harness process, from spawn to exit. */
export class HarnessConnection {
  readonly process: Acp;
  readonly channel: JsonrpcChannel;
  /** Stderr kept for error reports (reviu's launch-stderr tail pattern). */
  stderrTail = "";
  private exited = false;
  private exitListener: ((exit: AcpExit) => void) | null = null;
  /** Where `session/update` payloads go while the connection lives. */
  updateSink: ((sessionId: string, update: AcpUpdate) => void) | null = null;
  /** The client's answer for server→client requests (permission/elicitation). */
  requestHandler: ((message: ServerMessage) => void) | null = null;
  /** When set, updates land here instead of the sink (the load replay). */
  replaySink: ((update: AcpUpdate) => void) | null = null;
  /** The session id this connection's updates belong to. */
  boundSessionId: string | null = null;

  constructor(options: { cwd: string; command?: string; args?: string[]; env?: Record<string, string> }) {
    // `Acp.start` spawns synchronously and throws on failure (a coded error
    // with the program's name when the harness is missing).
    this.process = Acp.start(
      {
        cwd: options.cwd,
        ...(options.command ? { command: options.command } : {}),
        ...(options.args ? { args: options.args } : {}),
        ...(options.env ? { env: options.env } : {}),
      },
      (line: string) => this.channel.handleLine(line, (text) => this.note(`${text}\n`)),
      (text: string) => this.note(text),
      (exit: AcpExit) => {
        this.exited = true;
        const why = `the harness exited (exit ${exit.code === null ? String(exit.signal ?? "unknown") : exit.code})`;
        // Pending requests must settle whether or not a listener is attached:
        // a process death is a turn's other way out.
        this.channel.failAll(why);
        this.note(`${why}\n`);
        if (this.exitListener) this.exitListener(exit);
      },
    );
    this.channel = new JsonrpcChannel((line) => {
      try {
        this.process.send(line);
      } catch (failure) {
        // A write into a dying stdin: the exit event fails the pending turns.
        this.note(`send failed: ${describe(failure)}\n`);
      }
    });
    this.channel.onMessage((message: ServerMessage) => {
      if (message.method !== "session/update") return;
      const update = message.params?.update as AcpUpdate | undefined;
      const sessionId = message.params?.sessionId as string | undefined;
      if (!update) return;
      if (this.replaySink) this.replaySink(update);
      else if (this.updateSink) this.updateSink(sessionId ?? this.boundSessionId ?? "", update);
    });
    this.channel.onRequest((message: ServerMessage) => {
      if (this.requestHandler) {
        this.requestHandler(message);
        return;
      }
      this.channel.replyError(message.id as number, -32601, `the client does not serve ${message.method}`);
    });
  }

  /** Spawns and shakes hands; a silent harness is a failed start, with stderr.
   * `onPhase` names the stages the starting page shows (issue #56): the
   * process spawn, then the initialize handshake. `onSpawned` hands the
   * connection out the moment the process exists — before the handshake
   * answers — so a cancel that landed meanwhile has something to hang up. */
  static async start(options: {
    cwd: string;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    onPhase?: (phase: "process" | "handshake") => void;
    onSpawned?: (connection: HarnessConnection) => void;
  }): Promise<HarnessConnection> {
    options.onPhase?.("process");
    // The merge feeds the constructor only; the callbacks keep reading the
    // caller's options (a `options = merged` here would wipe them).
    const override: { command?: string; args?: string[]; env?: Record<string, string> } = commandOverride ?? {};
    const merged: { cwd: string; command?: string; args?: string[]; env?: Record<string, string> } = {
      cwd: options.cwd,
      command: options.command ?? override.command,
      args: options.args ?? override.args,
      env: { ...(override.env ?? {}), ...(options.env ?? {}) },
    };
    let connection: HarnessConnection;
    try {
      connection = new HarnessConnection(merged);
    } catch (failure) {
      throw new Error(`the pi harness could not start: ${describe(failure)}`);
    }
    options.onSpawned?.(connection);
    options.onPhase?.("handshake");
    try {
      const init = await connection.channel.request(
        "initialize",
        { protocolVersion: 1, clientCapabilities: {} },
        INITIALIZE_TIMEOUT_MS,
      );
      if (Number(init?.protocolVersion) !== 1) {
        throw new Error(`the harness speaks protocol ${String(init?.protocolVersion)}, this app speaks 1`);
      }
    } catch (failure) {
      connection.kill("the harness did not become ready");
      throw new Error(withTail(describe(failure), connection.stderrTail));
    }
    return connection;
  }

  /** `session/new` with the full response (configOptions/modes). A client-
   * minted id rides `_meta` (issue #56): a pairing extension a standard
   * client omits, in which case the harness mints its own id as before. */
  async newSession(cwd: string, options?: { sessionId?: string }): Promise<any> {
    try {
      const created = await this.channel.request(
        "session/new",
        {
          cwd,
          mcpServers: [],
          ...(options?.sessionId ? { _meta: { sessionId: options.sessionId } } : {}),
        },
        BIND_TIMEOUT_MS,
      );
      const sessionId = String(created?.sessionId ?? "");
      if (!sessionId) throw new Error("session/new returned no sessionId");
      this.boundSessionId = sessionId;
      return created;
    } catch (failure) {
      this.kill("the session could not be minted");
      throw new Error(withTail(describe(failure), this.stderrTail));
    }
  }

  /** `session/resume` — reattach without replay. A coded refusal (the
   * harness answered, it did not die) keeps the connection alive and is
   * rethrown typed: the empty-session rebuild rides that connection. */
  async resumeSession(sessionId: string, cwd: string): Promise<any> {
    this.boundSessionId = sessionId;
    try {
      return await this.channel.request(
        "session/resume",
        { sessionId, cwd, mcpServers: [] },
        BIND_TIMEOUT_MS,
      );
    } catch (failure) {
      if (failure instanceof JsonrpcFailure) {
        // A coded refusal is the harness answering, not dying: the
        // connection stays usable (the session_not_found rebuild rides it,
        // issue #56 follow-up), and the flattened text — code first, the
        // store's error-line format — rides along.
        throw new JsonrpcFailure(describe(failure), failure.code, failure.dataCode);
      }
      this.kill("the session could not be resumed");
      throw new Error(withTail(describe(failure), this.stderrTail));
    }
  }

  /** `session/load` with both the response and its replay. */
  async loadSession(sessionId: string, cwd: string): Promise<{ result: any; updates: AcpUpdate[] }> {
    this.boundSessionId = sessionId;
    const replay: AcpUpdate[] = [];
    this.replaySink = (update) => replay.push(update);
    try {
      const result = await this.channel.request(
        "session/load",
        { sessionId, cwd, mcpServers: [] },
        BIND_TIMEOUT_MS,
      );
      return { result, updates: replay };
    } catch (failure) {
      this.kill("the session could not be loaded");
      throw new Error(withTail(describe(failure), this.stderrTail));
    } finally {
      this.replaySink = null;
    }
  }

  /** `session/close` — free the session, keep the process for the caller. */
  async closeSession(sessionId: string): Promise<void> {
    try {
      await this.channel.request("session/close", { sessionId }, BIND_TIMEOUT_MS);
    } catch (failure) {
      this.note(`session/close failed: ${describe(failure)}\n`);
    }
  }

  /** Routes `session/update` payloads to a callback. */
  onUpdate(listener: ((sessionId: string, update: AcpUpdate) => void) | null): void {
    this.updateSink = listener;
  }

  /** Installs the server→client request handler. */
  onRequest(listener: ((message: ServerMessage) => void) | null): void {
    this.requestHandler = listener;
  }

  /** Answers a server→client request (the handler reads the message id). */
  respond(id: number | string, result: unknown): void {
    this.channel.reply(id, result);
  }

  /** Refuses a server→client request. */
  respondError(id: number | string, code: number, message: string): void {
    this.channel.replyError(id, code, message);
  }

  onExit(listener: ((exit: AcpExit) => void) | null): void {
    this.exitListener = listener;
    if (listener && this.exited) listener({ code: this.process.exitCode, signal: this.process.exitSignal });
  }

  /** The graceful exit: stdin goes to EOF; the group is the fallback. */
  close(): void {
    try {
      this.process.finish();
    } catch {
      // Already gone.
    }
    setTimeout(() => {
      if (this.process.alive()) this.process.kill();
    }, EXIT_GRACE_MS);
  }

  /** Hangs up the process group at once. */
  kill(reason: string): void {
    this.note(`${reason}; the process group is hung up\n`);
    try {
      this.process.kill();
    } catch {
      // Already gone.
    }
  }

  private note(text: string): void {
    this.stderrTail = (this.stderrTail + text).slice(-STDERR_TAIL_BYTES);
  }
}

/** The handshake and bind watchdogs. */
const INITIALIZE_TIMEOUT_MS = 60_000;
/** `session/new` and `session/load` ride the same watchdog budget. */
const BIND_TIMEOUT_MS = 60_000;
/** After a settle, how long the harness may take to flush and exit before
 * the process group is hung up for it. */
const EXIT_GRACE_MS = 5_000;
/** Stderr kept for error reports. */
const STDERR_TAIL_BYTES = 4000;

/** The test/fixture override for the harness binary: when set, sessions
 * spawn this program instead of resolving `pi-acp`. The packaged app never
 * calls this. */
let commandOverride: { command: string; args?: string[]; env?: Record<string, string> } | null = null;

export function setAcpCommandOverride(
  override: { command: string; args?: string[]; env?: Record<string, string> } | null,
): void {
  commandOverride = override;
}

function describe(failure: unknown): string {
  // The distro's machine-readable code rides `data.code`; carrying it in the
  // text keeps the store's error line actionable without a second channel.
  if (failure instanceof JsonrpcFailure) {
    return failure.dataCode ? `${failure.dataCode}: ${failure.message}` : failure.message;
  }
  if (failure instanceof Error) return failure.message;
  return String(failure);
}

function withTail(message: string, tail: string): string {
  const trimmed = tail.trim();
  return trimmed ? `${message} — harness stderr tail: ${trimmed}` : message;
}
