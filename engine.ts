import { signal } from "nsh";
import { K, t } from "./i18n";
import { Engine } from "zu/native";
import {
  PROTOCOL_VERSION,
  UI_REQUEST_TIMEOUT_MS,
  makeUIResponse,
  parseEnvelope,
  type EventMessage,
  type Reply,
  type StateSnapshot,
  type UIMethod,
  type Welcome,
} from "./contracts/protocol";

/**
 * The shell's single connection to the engine sidecar.
 *
 * One loopback WebSocket carries commands, replies, events and extension UI
 * requests. Commands are correlated by an `id`; events are dispatched to the
 * listeners. The sidecar is started through the Rust native module, which
 * resolves its path and publishes the port it actually bound (an ephemeral
 * one unless `ZU_PORT` names a fixed port). The shell only ever dials that
 * published port.
 *
 * The connection is *supervised*, not merely retried a few times: `connect`
 * and a dropped socket both enter one loop that keeps restarting the sidecar
 * and redialing with a capped backoff until the connection is verified or
 * the user explicitly stops it. Commands issued while the loop is starting
 * or recovering wait for the next connection instead of failing with
 * "engine is not connected"; only a genuine persistent failure is reported
 * (with the log path), while the loop keeps trying in the background.
 */

export type EnginePhase =
  | "stopped"
  | "starting"
  | "connected"
  | "recovering"
  | "incompatible"
  | "error";

/** What the shell shows in its status line. */
export const phase = signal<EnginePhase>("stopped");
/** The welcome's `{ pi, protocol, generation, pid, startedAt }` while connected. */
export const info = signal<{ pi: string; protocol: number; generation: number; pid: number; startedAt: number } | null>(
  null,
);
/** The snapshot from the last subscribe (or reconnect). */
export const snapshot = signal<StateSnapshot | null>(null);
/** Set when a reconnect sees a higher generation: the engine did restart. */
export const recovered = signal<{ from: number; to: number; at: number } | null>(null);
/** The last failure, set only after retries stay failed (it names the log). */
export const lastError = signal<string | null>(null);
/** The last heartbeat, for the watchdog and the status line. */
export const heartbeatAt = signal(0);

type Listener = (event: EventMessage) => void;
type SnapshotListener = (snapshot: StateSnapshot) => void;
type PendingEntry = {
  type: string;
  /** Issued while the engine was down: retry it on the next connection. */
  retryable: boolean;
  resolve: (data: any) => void;
  reject: (message: string) => void;
  resend: () => void;
};

let socket: WebSocket | null = null;
let nextId = 0;
let lastConnectError = "";
const pending = new Map<string, PendingEntry>();
/** Commands waiting for the next connection; each removes itself to send. */
const waiters = new Set<() => void>();
const listeners = new Set<Listener>();
const snapshotListeners = new Set<SnapshotListener>();
const disconnectListeners = new Set<() => void>();

let intentionalClose = false;
/** The one running supervision loop, if any. */
let supervisor: Promise<void> | null = null;
/** Bumped by `disconnect`/a new loop so an older loop stops touching state. */
let supervisorEpoch = 0;
let watchdog: any = null;
let recoveredTimer: any = null;

/** How many consecutive attempts may fail before a sidecar is replaced. */
const WEDGED_ATTEMPTS = 3;
/** The retry budget's ceiling: fast at first, then one attempt every 5 s. */
const MAX_BACKOFF_MS = 5000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Subscribes to engine events; the returned function stops it. */
export function onEngineEvent(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Subscribes to snapshots (the first after connecting, then reconnects). */
export function onSnapshot(listener: SnapshotListener): () => void {
  snapshotListeners.add(listener);
  return () => snapshotListeners.delete(listener);
}

/** Subscribes to an unexpected loss of the connection (not a user disconnect). */
export function onDisconnect(listener: () => void): () => void {
  disconnectListeners.add(listener);
  return () => disconnectListeners.delete(listener);
}

function emitLocal(event: EventMessage): void {
  for (const listener of [...listeners]) listener(event);
}

/**
 * Sends a command and resolves with its reply's data.
 *
 * While the engine is starting or recovering the command waits for the next
 * connection; it is sent as soon as one is verified. The timeout covers the
 * wait and the reply together, so a command issued during a reconnect either
 * succeeds after it or times out clearly.
 *
 * `options.retryable` is for the supervisor's own commands: `state.subscribe`
 * must fail rather than wait, so the supervisor can redial.
 */
export function request(
  type: string,
  payload: Record<string, unknown> = {},
  timeoutMs = 20000,
  options: { retryable?: boolean } = {},
): Promise<any> {
  return new Promise((resolve, reject) => {
    const issuedWhileDown = !socket || phase() !== "connected";
    const retryable = options.retryable ?? issuedWhileDown;
    let settled = false;
    let id = "";
    const timer = setTimeout(() => {
      fail(`${type} timed out after ${timeoutMs} ms`);
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      waiters.delete(attempt);
      if (id) pending.delete(id);
    };
    const succeed = (data: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(data);
    };
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(message);
    };
    function attempt() {
      if (settled) return;
      // An explicit stop is a real state, not a transient one: say so and
      // let the caller decide. The supervisor never leaves this state on its
      // own, so a queued command cannot wait forever on it.
      if (phase() === "stopped" && !supervisor) {
        fail("the engine is stopped");
        return;
      }
      if (phase() === "incompatible") {
        fail("the engine speaks an incompatible protocol; update the app");
        return;
      }
      const ws = socket;
      if (!ws) {
        waiters.add(attempt);
        return;
      }
      if (id) pending.delete(id);
      id = `r${++nextId}`;
      pending.set(id, { type, retryable, resolve: succeed, reject: fail, resend: attempt });
      try {
        ws.send(JSON.stringify({ v: PROTOCOL_VERSION, id, type, payload }));
      } catch (failure) {
        pending.delete(id);
        id = "";
        if (settled) return;
        waiters.add(attempt);
        beginRecovery(`engine socket failed: ${String(failure)}`);
      }
    }
    attempt();
  });
}

/** Answers an extension's outstanding UI request. */
export function respondUI(id: string, result: unknown): void {
  if (!socket) return;
  const message = makeUIResponse(id, { ok: true, result });
  try {
    socket.send(JSON.stringify(message));
  } catch {
    // The engine is gone; its own timeout resolves the request.
  }
}

/** Asks the engine for a user decision; never used by the shell itself. */
export function requestUITimeout(method: UIMethod): number {
  return method === "editor" ? UI_REQUEST_TIMEOUT_MS * 2 : UI_REQUEST_TIMEOUT_MS;
}

/**
 * Starts the sidecar (if needed) and connects. Resolves once the connection
 * is verified; keeps retrying with a capped backoff until then, unless the
 * user stops the engine first.
 */
export async function connect(): Promise<void> {
  intentionalClose = false;
  if (supervisor) return supervisor;
  if (phase() === "connected") return;
  await supervise("starting");
}

/** Stops the sidecar and forgets the socket, without auto-restarting it. */
export async function disconnect(): Promise<void> {
  intentionalClose = true;
  // Detach the loop: a later `connect` must be able to start a fresh one
  // without waiting out the old loop's backoff sleep.
  supervisorEpoch++;
  supervisor = null;
  stopWatchdog();
  const ws = socket;
  socket = null;
  try {
    ws?.close();
  } catch {
    // Already closed.
  }
  rejectPending("the engine was stopped");
  phase.set("stopped");
  info.set(null);
  snapshot.set(null);
  heartbeatAt.set(0);
  recovered.set(null);
  lastError.set(null);
  clearTimeout(recoveredTimer);
  kickWaiters();
  await Engine.stop();
}

/** The user's "try again" action: resume the loop whether or not it stopped. */
export async function retry(): Promise<void> {
  stopWatchdog();
  recovered.set(null);
  if (phase() === "connected") return;
  intentionalClose = false;
  if (supervisor) return supervisor;
  await connect();
}

/** True once this loop has been superseded by a stop or a newer loop. */
function stopRequested(epoch: number): boolean {
  return intentionalClose || supervisorEpoch !== epoch;
}

/**
 * The single supervision loop. One pass makes the sidecar healthy, dials it,
 * verifies pid/port and the `state.subscribe` round trip, then declares the
 * connection. Any failure backs off and tries again; the loop only ends on
 * success, a protocol mismatch, or an explicit stop.
 */
function supervise(initial: "starting" | "recovering"): Promise<void> {
  if (supervisor) return supervisor;
  const epoch = ++supervisorEpoch;
  phase.set(initial);
  if (initial === "starting") lastError.set(null);
  const before = info()?.generation ?? null;
  const run = (async () => {
    let delay = 250;
    let failures = 0;
    let misses = 0;
    while (!stopRequested(epoch)) {
      let outcome: "connected" | "incompatible" | "retry" = "retry";
      let detail = "";
      try {
        outcome = await superviseOnce(epoch, before);
      } catch (failure) {
        detail = String(failure);
        // A throw after a socket was installed must not leave that socket
        // as the shell's connection while the loop redials.
        if (phase() !== "connected") dropSocket();
      }
      if (outcome === "connected" || outcome === "incompatible") return;
      if (stopRequested(epoch)) return;
      failures++;
      misses++;
      reportFailure(failures, detail || lastConnectError);
      // A sidecar that is up but has missed several attempts in a row is
      // wedged, not slow (start already waited for its published port):
      // replace it once per burst instead of dialing a dead listener forever.
      if (misses >= WEDGED_ATTEMPTS) {
        misses = 0;
        if (Engine.status() === "running") {
          try {
            await Engine.kill();
          } catch {
            // Already gone.
          }
        }
      }
      if (stopRequested(epoch)) return;
      await sleep(delay);
      delay = Math.min(delay * 2, MAX_BACKOFF_MS);
    }
  })();
  supervisor = run;
  void run.finally(() => {
    if (supervisor === run) supervisor = null;
  });
  return run;
}

/** One supervision attempt: make the sidecar healthy, dial and verify it. */
async function superviseOnce(
  epoch: number,
  before: number | null,
): Promise<"connected" | "incompatible" | "retry"> {
  // 1. A dead or stale sidecar is replaced; a healthy one is reused.
  let port = 0;
  if (Engine.status() === "running") {
    port = Engine.port();
  }
  if (port === 0 || Engine.pid() === 0) {
    await Engine.start();
    port = Engine.port();
  }
  if (stopRequested(epoch)) return "retry";
  if (port <= 0) {
    lastConnectError = "the engine started but published no port";
    return "retry";
  }

  // 2. Dial the published port only.
  let result: "ok" | "failed" | "incompatible";
  try {
    result = await attemptConnect(port, Engine.token());
  } catch (failure) {
    lastConnectError = `dial threw: ${String(failure)}`;
    result = "failed";
  }
  if (stopRequested(epoch)) {
    dropSocket();
    return "retry";
  }
  if (result === "incompatible") return "incompatible";
  if (result !== "ok") return "retry";

  // 3. Verify it is the process and port this host owns before trusting it.
  const pid = info()?.pid ?? 0;
  const owned = Engine.status() === "running" && Engine.verify(pid, port);
  if (!owned) {
    lastConnectError = `the sidecar answered on port ${port}, but pid/port did not match`;
    dropSocket();
    try {
      await Engine.kill();
    } catch {
      // Already gone.
    }
    return "retry";
  }

  // 4. A real round trip: the snapshot is the proof the connection works.
  if (!(await synchronize(before))) {
    dropSocket();
    return "retry";
  }
  if (stopRequested(epoch)) {
    dropSocket();
    return "retry";
  }
  phase.set("connected");
  lastError.set(null);
  lastConnectError = "";
  startWatchdog();
  flushWaiters();
  return "connected";
}

/**
 * Shows a failure only once it is persistent: a transient death stays a
 * "recovering" phase, while a loop that keeps failing names the log and the
 * last status so the user can act. The loop keeps retrying regardless.
 */
function reportFailure(failures: number, detail: string): void {
  if (failures < WEDGED_ATTEMPTS) return;
  const status = Engine.status();
  const exit = Engine.exitCode();
  const log = Engine.logPath();
  const extra = detail ? ` (${detail})` : "";
  lastError.set(
    `${t(K.engine.startFailed, { log })} [status ${status}, exit ${exit === null ? "none" : exit}]${extra}`,
  );
}

/** Starts the watchdog (one per connection). */
function startWatchdog(): void {
  if (watchdog) return;
  watchdog = setInterval(() => {
    if (phase() !== "connected") return;
    if (Date.now() - heartbeatAt() < 15000) return;
    beginRecovery("engine stopped answering (no heartbeat for 15 s)");
  }, 5000);
}

function stopWatchdog(): void {
  clearInterval(watchdog);
  watchdog = null;
}

/**
 * Handles an unexpected loss of the connection: one path for a closed
 * socket, a failed send and a missed heartbeat. The supervision loop owns
 * the restart; this only resets the connection and tells the shell.
 */
function beginRecovery(reason: string): void {
  if (intentionalClose) return;
  if (phase() === "incompatible") return;
  const ws = socket;
  socket = null;
  if (ws) {
    try {
      ws.close();
    } catch {
      // Already closed.
    }
  }
  stopWatchdog();
  settlePendingForReconnect();
  for (const listener of [...disconnectListeners]) listener();
  if (phase() !== "recovering") phase.set("recovering");
  lastConnectError = reason;
  void supervise("recovering");
}

/** Drops a socket the supervisor has decided not to trust. */
function dropSocket(): void {
  const ws = socket;
  socket = null;
  if (ws) {
    try {
      ws.close();
    } catch {
      // Already closed.
    }
  }
}

/** Resolves every command waiting for the next connection. */
function flushWaiters(): void {
  for (const waiter of [...waiters]) {
    waiters.delete(waiter);
    waiter();
  }
}

/** Wakes waiters so a stopped engine rejects them now, not at their timeout. */
function kickWaiters(): void {
  for (const waiter of [...waiters]) {
    waiters.delete(waiter);
    waiter();
  }
}

/**
 * A dropped socket loses every unanswered command. Commands that were issued
 * while the engine was down are retried on the next connection (their whole
 * promise is "wait for the engine"); a command that was already in flight is
 * rejected clearly, because replaying it could repeat a turn or a write.
 */
function settlePendingForReconnect(): void {
  for (const [id, entry] of [...pending]) {
    pending.delete(id);
    if (entry.retryable) waiters.add(entry.resend);
    else entry.reject(`the engine connection dropped before ${entry.type} answered`);
  }
}

function rejectPending(reason: string): void {
  for (const [id, entry] of [...pending]) {
    pending.delete(id);
    entry.reject(`${reason} before ${entry.type} answered`);
  }
}

function onSocketClosed(ws: WebSocket): void {
  if (socket !== ws) return;
  beginRecovery("engine disconnected");
}

async function synchronize(beforeGeneration: number | null): Promise<boolean> {
  try {
    const next = (await request("state.subscribe", {}, 10000, { retryable: false })) as StateSnapshot;
    // The snapshot must come from the process the welcome announced: a
    // mismatched pid/generation means another sidecar answered the port.
    const announced = info();
    if (!announced || next.pid !== announced.pid || next.generation !== announced.generation) {
      lastConnectError = `state.subscribe answered pid ${String(next.pid)}/gen ${String(next.generation)}, expected ${String(announced?.pid)}/${String(announced?.generation)}`;
      return false;
    }
    snapshot.set(next);
    if (beforeGeneration !== null && next.generation > beforeGeneration) {
      recovered.set({ from: beforeGeneration, to: next.generation, at: Date.now() });
      clearTimeout(recoveredTimer);
      recoveredTimer = setTimeout(() => recovered.set(null), 10000);
    }
    for (const listener of [...snapshotListeners]) listener(next);
    return true;
  } catch (failure) {
    lastConnectError = `state.subscribe failed: ${String(failure)}`;
    return false;
  }
}

function attemptConnect(port: number, token: string): Promise<"ok" | "failed" | "incompatible"> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (result: "ok" | "failed" | "incompatible") => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    let ws: WebSocket;
    try {
      ws = new WebSocket(`ws://127.0.0.1:${port}`);
    } catch (failure) {
      lastConnectError = `construct: ${String(failure)}`;
      settle("failed");
      return;
    }
    const timer = setTimeout(() => {
      lastConnectError = "connect timeout";
      ws.close();
      settle("failed");
    }, 1500);
    ws.onopen = () => {
      ws.send(JSON.stringify({ v: PROTOCOL_VERSION, type: "hello", token }));
    };
    ws.onmessage = (event) => {
      const message = parseEnvelope(String(event.data));
      if (!message) return;
      if (message.type === "welcome") {
        clearTimeout(timer);
        const welcome = message as Welcome;
        if (Number(welcome.payload?.protocol) !== PROTOCOL_VERSION) {
          phase.set("incompatible");
          lastError.set(
            `engine speaks protocol v${String(welcome.payload?.protocol)}, this app speaks v${PROTOCOL_VERSION}; update the app`,
          );
          ws.close();
          settle("incompatible");
          return;
        }
        socket = ws;
        ws.onmessage = (event) => handleMessage(event.data);
        ws.onclose = () => onSocketClosed(ws);
        info.set({
          pi: String(welcome.payload?.pi ?? ""),
          protocol: PROTOCOL_VERSION,
          generation: Number(welcome.payload?.generation ?? 0),
          pid: Number(welcome.payload?.pid ?? 0),
          startedAt: Number(welcome.payload?.startedAt ?? 0),
        });
        heartbeatAt.set(Date.now());
        // `connected` is declared only after the health check and the
        // snapshot round trip in `superviseOnce`.
        settle("ok");
        return;
      }
      if (message.type === "error") {
        const payload = (message.payload ?? {}) as { code?: string; message?: string };
        clearTimeout(timer);
        if (payload.code === "protocol_mismatch") {
          phase.set("incompatible");
          lastError.set(String(payload.message ?? "the engine speaks another protocol version"));
          settle("incompatible");
        } else {
          lastConnectError = String(payload.message ?? "the engine rejected the handshake");
          settle("failed");
        }
        ws.close();
      }
    };
    ws.onerror = (event: any) => {
      lastConnectError = `socket error: ${String(event?.message ?? event?.error ?? "error")}`;
      clearTimeout(timer);
      settle("failed");
    };
    ws.onclose = (event: any) => {
      if (settled) return;
      lastConnectError = `closed ${String(event?.code ?? "")} ${String(event?.reason ?? "")}`.trim();
      clearTimeout(timer);
      settle("failed");
    };
  });
}

function handleMessage(raw: unknown): void {
  const message = parseEnvelope(String(raw));
  if (!message) return;
  if (message.type === "reply") {
    const reply = message as Reply;
    const entry = pending.get(reply.id);
    if (!entry) return;
    pending.delete(reply.id);
    if (reply.payload?.ok) entry.resolve(reply.payload.data);
    else entry.reject(String(reply.payload?.error ?? "command failed"));
    return;
  }
  if (message.type === "engine.heartbeat") heartbeatAt.set(Date.now());
  emitLocal(message as EventMessage);
}
