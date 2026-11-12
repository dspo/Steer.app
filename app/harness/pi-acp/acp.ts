import { Acp, type AcpExit } from "zu/native";
import { JsonrpcChannel, JsonrpcFailure, type ServerMessage } from "./jsonrpc";

/**
 * The pi sessions' ACP client: one harness process per turn, over stdio
 * ndjson (v2 §7). This module owns the connection lifecycle — spawn →
 * initialize (the 60 s watchdog) → `session/new` (minted at the first real
 * prompt, v2 §4.3) or `session/load` (whose replay is the transcript
 * rebuild) → `session/prompt` (a pending prompt is the turn;
 * `session/update` streams as it runs; the `stopReason` reply settles it) →
 * stdin close (the graceful exit). `session/cancel` is the stop.
 *
 * The process model is the v2 one: settle and exit, no supervision, no
 * reconnect — a retry is a user action and a new process. The durable
 * authority is pi's session file; updates are acceleration.
 *
 * This is the parallel leg (B1): the engine transport stays the default and
 * everything it serves keeps working. `piTransport()` names the pi-session
 * transport; the surfaces the distro does not serve yet (dispatch/subagents,
 * modes/models, steering) degrade above this module, in the stores.
 */

/** Which transport pi sessions ride. Since the cutover the ACP harness is
 * the default; `ZU_PI_TRANSPORT=engine` opts a dev run back into the legacy
 * engine while it still exists. */
export type PiTransport = "engine" | "acp";

/** The pinned transport, when a test or a fixture set one. */
let transportOverride: PiTransport | null = null;

/** The transport for new pi-session work: an explicit pin, else the
 * `ZU_PI_TRANSPORT` env (`engine` | anything else = the ACP default). */
export function piTransport(): PiTransport {
  if (transportOverride) return transportOverride;
  const value = (process.env.ZU_PI_TRANSPORT ?? "").trim().toLowerCase();
  return value === "engine" ? "engine" : "acp";
}

/** Pins the transport for this process (tests and fixtures; `null` resumes
 * reading the env). The packaged app never calls this. */
export function setPiTransport(mode: PiTransport | null): void {
  transportOverride = mode;
}

/** Points the transport switch at a value by env name (a dev run's flag). */
export function setPiTransportEnv(value: string): void {
  if (value === "") delete process.env.ZU_PI_TRANSPORT;
  else process.env.ZU_PI_TRANSPORT = value;
}

/** One ACP `session/update` payload (the distro's shape, deliberately loose). */
export interface AcpUpdate {
  sessionUpdate?: string;
  [field: string]: unknown;
}

/** One harness process, from spawn to exit. */
class HarnessConnection {
  readonly process: Acp;
  readonly channel: JsonrpcChannel;
  /** Stderr kept for error reports (reviu's launch-stderr tail pattern). */
  stderrTail = "";
  private exited = false;
  private exitListener: ((exit: AcpExit) => void) | null = null;
  /** Where `session/update` payloads go while the connection lives. */
  updateSink: ((sessionId: string, update: AcpUpdate) => void) | null = null;
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
        if (this.exitListener) {
          this.exitListener(exit);
          return;
        }
        // Nobody listens yet (a cancel or a death during the handshake): the
        // pending handshake fails now instead of riding its watchdog.
        const why = `the harness exited before it was ready (exit ${exit.code === null ? String(exit.signal ?? "unknown") : exit.code})`;
        this.channel.failAll(why);
        this.note(`${why}\n`);
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
      if (!update || (sessionId && sessionId !== this.boundSessionId)) return;
      if (this.replaySink) this.replaySink(update);
      else if (this.updateSink) this.updateSink(sessionId ?? this.boundSessionId ?? "", update);
    });
    this.channel.onRequest((message: ServerMessage) => {
      // The distro asks nothing of the client in this stage (permissions are
      // pi-autonomous); a request is refused with the standard code rather
      // than left hanging on the agent side.
      this.channel.replyError(message.id as number, -32601, `the client does not serve ${message.method}`);
    });
  }

  /** Spawns and shakes hands; a silent harness is a failed start, with stderr. */
  static async start(options: { cwd: string; command?: string; args?: string[]; env?: Record<string, string> }): Promise<HarnessConnection> {
    const override: { command?: string; args?: string[]; env?: Record<string, string> } = commandOverride ?? {};
    const merged: { cwd: string; command?: string; args?: string[]; env?: Record<string, string> } = {
      cwd: options.cwd,
      command: options.command ?? override.command,
      args: options.args ?? override.args,
      env: { ...(override.env ?? {}), ...(options.env ?? {}) },
    };
    options = merged;
    let connection: HarnessConnection;
    try {
      connection = new HarnessConnection(options);
    } catch (failure) {
      throw new Error(`the pi harness could not start: ${describe(failure)}`);
    }
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

  /** Mints a session (`session/new`); the harness casts the id. */
  async create(cwd: string): Promise<string> {
    try {
      const created = await this.channel.request(
        "session/new",
        { cwd, mcpServers: [] },
        BIND_TIMEOUT_MS,
      );
      const sessionId = String(created?.sessionId ?? "");
      if (!sessionId) throw new Error("session/new returned no sessionId");
      this.boundSessionId = sessionId;
      return sessionId;
    } catch (failure) {
      this.kill("the session could not be minted");
      throw new Error(withTail(describe(failure), this.stderrTail));
    }
  }

  /** Loads a session and returns its replay, in file order, before returning. */
  async load(sessionId: string, cwd: string): Promise<AcpUpdate[]> {
    this.boundSessionId = sessionId;
    const replay: AcpUpdate[] = [];
    this.replaySink = (update) => replay.push(update);
    try {
      await this.channel.request("session/load", { sessionId, cwd, mcpServers: [] }, BIND_TIMEOUT_MS);
    } catch (failure) {
      this.kill("the session could not be loaded");
      throw new Error(withTail(describe(failure), this.stderrTail));
    } finally {
      this.replaySink = null;
    }
    // ACP v1: the replay precedes the load response, in order.
    return replay;
  }

  /** Runs one prompt; `onUpdate` sees each streamed update and `onSent`
   * fires once the request is on the wire (a cancel requested during the
   * bind lands here, where the agent can actually act on it); resolves
   * settled. */
  async prompt(
    sessionId: string,
    text: string,
    onUpdate: (update: AcpUpdate) => void,
    onSent?: () => void,
  ): Promise<string> {
    this.updateSink = (_bound, update) => onUpdate(update);
    try {
      // No timeout: a turn is as long as it is. The process's death and the
      // explicit stop are the other ways out.
      const reply = this.channel.request("session/prompt", { sessionId, prompt: [{ type: "text", text }] });
      onSent?.();
      return String((await reply)?.stopReason ?? "end_turn");
    } catch (failure) {
      throw new Error(describe(failure));
    } finally {
      this.updateSink = null;
    }
  }

  /** The stop: an ACP notification; the pending prompt answers `cancelled`. */
  cancel(sessionId: string): void {
    this.channel.notify("session/cancel", { sessionId });
  }

  /** Listens for the process's death (a turn's other way out). */
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

/** What a turn reports to the session store. */
export interface TurnHooks {
  /** One live update while the prompt is pending. */
  onUpdate(update: AcpUpdate): void;
  /** A harness note (stderr) worth keeping in the log, not the transcript. */
  onNotice(text: string): void;
}

export interface TurnResult {
  sessionId: string;
  stopReason: string;
}

export interface TurnHandle {
  /** The turn's outcome; rejects on spawn, handshake, bind or process death. */
  done: Promise<TurnResult>;
  /** The pi session id once the harness minted or loaded it, else null. */
  readonly sessionId: string | null;
  /** Stops the turn the way the composer's stop button does. */
  cancel(): void;
}

/** The initialize watchdog (v2 §7.1): a harness not ready in 60 s is a
 * failed start, reported with its stderr tail, never left hanging. */
const INITIALIZE_TIMEOUT_MS = 60_000;
/** `session/new` and `session/load` ride the same watchdog budget. */
const BIND_TIMEOUT_MS = 60_000;
/** After a settle, how long the harness may take to flush and exit before
 * the process group is hung up for it. */
const EXIT_GRACE_MS = 5_000;
/** Stderr kept for error reports. */
const STDERR_TAIL_BYTES = 4000;

/** One in-flight turn per session id (the composer's busy state, the stop
 * button's target). Keyed by the real pi session id. */
const activeTurns = new Map<string, { connection: HarnessConnection; sessionId: string }>();

/** Whether a turn is in flight for `sessionId`. */
export function isTurnActive(sessionId: string): boolean {
  return activeTurns.has(sessionId);
}

/** The active turn of `sessionId`, when one is in flight. */
export function activeTurn(sessionId: string): { cancel(): void } | null {
  const turn = activeTurns.get(sessionId);
  return turn ? { cancel: () => turn.connection.cancel(sessionId) } : null;
}

/**
 * Runs one turn: spawn the harness, shake hands, bind (`session/new` when
 * `sessionId` is absent — the mint happens at the first real prompt; else
 * `session/load`, whose replay goes to `onReplay` first), prompt, settle,
 * and close stdin. The process is never kept between turns.
 */
export function startTurn(options: {
  cwd: string;
  text: string;
  sessionId?: string;
  hooks: TurnHooks;
  onReplay?: (updates: AcpUpdate[]) => void;
  /** When a load finds no session file, mint a fresh session instead of
   * failing (a captain another transport minted but never prompted). */
  freshSessionFallback?: boolean;
  /** Overrides the harness binary (tests drive a stub agent). */
  command?: string;
  /** Extra argv for the override program. */
  args?: string[];
  /** Extra environment entries for this process (the stub's modes in tests). */
  env?: Record<string, string>;
}): TurnHandle {
  let connection: HarnessConnection | null = null;
  let sessionId: string | null = options.sessionId ?? null;
  let settled = false;
  let cancelled = false;

  /** One exit path: the turn is over, the process goes with it. */
  const finish = (): void => {
    if (settled) return;
    settled = true;
    if (sessionId) activeTurns.delete(sessionId);
    connection?.close();
  };

  const done = (async (): Promise<TurnResult> => {
    connection = await HarnessConnection.start(options);
    connection.onExit((exit) => {
      if (settled) return;
      const why = `the harness exited mid-turn (exit ${exit.code === null ? String(exit.signal ?? "unknown") : exit.code})`;
      connection?.channel.failAll(why);
    });

    if (sessionId) {
      try {
        const replay = await connection.load(sessionId, options.cwd);
        if (!settled && replay.length > 0) options.onReplay?.(replay);
      } catch (failure) {
        // A session id whose file does not exist (a captain another
        // transport minted but never prompted) is not a dead turn: when the
        // caller allows it, the harness mints a fresh session and the
        // caller renames its view through the handle's live sessionId.
        if (!(failure instanceof JsonrpcFailure && failure.dataCode === "session_not_found") || !options.freshSessionFallback) {
          throw failure;
        }
        sessionId = await connection.create(options.cwd);
      }
    } else {
      sessionId = await connection.create(options.cwd);
    }
    if (settled) throw new Error("the turn was cancelled while binding");

    const boundId: string = sessionId;
    activeTurns.set(boundId, { connection, sessionId: boundId });
    // A cancel that arrived while the bind was still in flight is retried
    // once the prompt is actually on the wire — a cancel for a prompt that
    // was never sent is a no-op on the agent side, and the turn would hold.
    const cancelIfRequested = () => {
      if (cancelled) connection?.cancel(boundId);
    };
    if (cancelled) connection.cancel(boundId);

    try {
      const stopReason = await connection.prompt(sessionId, options.text, options.hooks.onUpdate, cancelIfRequested);
      return { sessionId, stopReason };
    } finally {
      finish();
    }
  })();

  return {
    done,
    get sessionId() {
      return sessionId;
    },
    cancel() {
      cancelled = true;
      if (connection && sessionId && activeTurns.has(sessionId)) connection.cancel(sessionId);
      else connection?.kill("the turn was cancelled before it started");
    },
  };
}

/** The test/fixture override for the harness binary: when set, turns and
 * transcript loads spawn this program instead of resolving `pi-acp`. The
 * packaged app never calls this. */
let commandOverride: { command: string; args?: string[]; env?: Record<string, string> } | null = null;

export function setAcpCommandOverride(
  override: { command: string; args?: string[]; env?: Record<string, string> } | null,
): void {
  commandOverride = override;
}

/** The harness spawn options for a production call (the resolved `pi-acp`)
 * or a test's stub. */
function harnessSpawn(): { command?: string; args?: string[]; env?: Record<string, string> } {
  return commandOverride ?? {};
}

/**
 * Reopens a session without a turn: spawn, initialize, `session/load`, hand
 * the replay to the caller, close stdin. This is the ACP path's transcript
 * read (v2 §5.4: history is read from files into a process, never from the
 * wire's memory alone).
 */
export async function loadTranscript(options: {
  cwd: string;
  sessionId: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}): Promise<{ sessionId: string; updates: AcpUpdate[] }> {
  const connection = await HarnessConnection.start(options);
  try {
    const updates = await connection.load(options.sessionId, options.cwd);
    return { sessionId: options.sessionId, updates };
  } finally {
    connection.close();
  }
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
