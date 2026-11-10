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
 * resolves its path and hands back the port and handshake token.
 *
 * M2 makes the connection supervised: a dropped socket or a missed
 * heartbeat restarts the sidecar with exponential backoff, and a reconnect
 * takes a `state.snapshot` before the shell trusts anything again.
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
/** The last failure, shown until the next attempt. */
export const lastError = signal<string | null>(null);
/** The last heartbeat, for the watchdog and the status line. */
export const heartbeatAt = signal(0);

type Listener = (event: EventMessage) => void;
type SnapshotListener = (snapshot: StateSnapshot) => void;

let socket: WebSocket | null = null;
let nextId = 0;
let lastConnectError = "";
const pending = new Map<
  string,
  { resolve: (data: any) => void; reject: (message: string) => void; timer: any }
>();
const listeners = new Set<Listener>();
const snapshotListeners = new Set<SnapshotListener>();
const disconnectListeners = new Set<() => void>();

let intentionalClose = false;
let recovering = false;
let watchdog: any = null;
let recoveredTimer: any = null;

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

/** Sends a command and resolves with its reply's data. */
export function request(type: string, payload: Record<string, unknown> = {}, timeoutMs = 20000): Promise<any> {
  return new Promise((resolve, reject) => {
    if (!socket) {
      reject("engine is not connected");
      return;
    }
    const id = `r${++nextId}`;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(`${type} timed out`);
    }, timeoutMs);
    pending.set(id, {
      timer,
      resolve: (data) => {
        clearTimeout(timer);
        resolve(data);
      },
      reject: (message) => {
        clearTimeout(timer);
        reject(message);
      },
    });
    socket.send(JSON.stringify({ v: PROTOCOL_VERSION, id, type, payload }));
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

/** Starts the sidecar (if needed) and connects, retrying while it boots. */
export async function connect(): Promise<void> {
  if (phase() === "connected") return;
  intentionalClose = false;
  recovering = false;
  phase.set("starting");
  lastError.set(null);
  const before = info()?.generation ?? null;
  try {
    await Engine.start();
  } catch (error) {
    phase.set("error");
    lastError.set(String(error));
    return;
  }
  const result = await tryConnectUntilReady();
  if (result === "incompatible") return;
  if (result !== "ok") {
    phase.set("error");
    // A port someone else holds is a different failure from a sidecar that
    // started but did not speak the protocol: say which one it is.
    if (!Engine.portAvailable()) {
      lastError.set(t(K.engine.portBusy, { port: Engine.port() }));
    } else {
      lastError.set(`engine did not answer on 127.0.0.1:${Engine.port()} — see ${Engine.logPath()}`);
    }
    return;
  }
  startWatchdog();
  await synchronize(before);
}

/** Stops the sidecar and forgets the socket, without auto-restarting it. */
export async function disconnect(): Promise<void> {
  intentionalClose = true;
  for (const listener of [...disconnectListeners]) listener();
  stopWatchdog();
  socket?.close();
  socket = null;
  rejectPending("disconnected");
  phase.set("stopped");
  info.set(null);
  snapshot.set(null);
  heartbeatAt.set(0);
  recovered.set(null);
  clearTimeout(recoveredTimer);
  await Engine.stop();
}

/** The user's "try again" action: reconnect whether or not a restart happened. */
export async function retry(): Promise<void> {
  stopWatchdog();
  recovered.set(null);
  if (phase() === "connected") return;
  await connect();
}

async function tryConnectUntilReady(): Promise<"ok" | "failed" | "incompatible"> {
  const port = Engine.port();
  const token = Engine.token();
  for (let attempt = 0; attempt < 60; attempt++) {
    if (intentionalClose) return "failed";
    let result: "ok" | "failed" | "incompatible";
    try {
      result = await attemptConnect(port, token);
    } catch (failure) {
      // A synchronous WebSocket failure (a refused scheme, a closed host)
      // rejects the attempt rather than reporting `failed`; keep its text.
      lastError.set(`connecting to 127.0.0.1:${port} failed: ${String(failure)}`);
      result = "failed";
    }
    if (result === "ok") return "ok";
    if (result === "incompatible") return "incompatible";
    await sleep(100);
  }
  return "failed";
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
        phase.set("connected");
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
          lastError.set(String(payload.message ?? "the engine rejected the handshake"));
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

function onSocketClosed(ws: WebSocket): void {
  if (socket !== ws) return;
  socket = null;
  rejectPending("engine disconnected");
  if (intentionalClose) return;
  if (phase() === "connected" || phase() === "starting") {
    for (const listener of [...disconnectListeners]) listener();
    void recover("engine disconnected");
  }
}

/** Reconnects, restarting the sidecar with exponential backoff if needed. */
async function recover(reason: string): Promise<void> {
  if (recovering || intentionalClose) return;
  recovering = true;
  stopWatchdog();
  phase.set("recovering");
  lastError.set(reason);
  const before = info()?.generation ?? null;
  let delay = 250;
  // A process started by this loop gets every retry's dial before anything
  // kills it: it is booting, not wedged. Only a process from before the
  // disconnect is a candidate for replacement.
  let startedFresh = false;
  for (let attempt = 0; attempt < 10; attempt++) {
    await sleep(delay);
    delay = Math.min(delay * 2, 5000);
    if (intentionalClose) {
      recovering = false;
      return;
    }
    if (!startedFresh && Engine.status() === "running") {
      try {
        Engine.kill();
      } catch {
        // Already gone.
      }
    }
    try {
      await Engine.start();
      startedFresh = true;
    } catch (error) {
      lastError.set(String(error));
      continue;
    }
    let result: "ok" | "failed" | "incompatible";
    try {
      result = await attemptConnect(Engine.port(), Engine.token());
    } catch (failure) {
      lastConnectError = `threw: ${String(failure)}`;
      result = "failed";
    }
    if (result === "ok") {
      recovering = false;
      startWatchdog();
      await synchronize(before);
      return;
    }
    if (result === "incompatible") {
      recovering = false;
      return;
    }
  }
  recovering = false;
  phase.set("error");
  lastError.set(
    `engine did not come back (status ${Engine.status()}, exit ${String(Engine.exitCode())}, dial ${lastConnectError}) — see ${Engine.logPath()}`,
  );
}

async function synchronize(beforeGeneration: number | null): Promise<void> {
  try {
    const next = (await request("state.subscribe", {}, 10000)) as StateSnapshot;
    snapshot.set(next);
    if (beforeGeneration !== null && next.generation > beforeGeneration) {
      recovered.set({ from: beforeGeneration, to: next.generation, at: Date.now() });
      clearTimeout(recoveredTimer);
      recoveredTimer = setTimeout(() => recovered.set(null), 10000);
    }
    for (const listener of [...snapshotListeners]) listener(next);
  } catch (failure) {
    lastError.set(String(failure));
  }
}

function startWatchdog(): void {
  if (watchdog) return;
  watchdog = setInterval(() => {
    if (phase() !== "connected") return;
    if (Date.now() - heartbeatAt() < 15000) return;
    const ws = socket;
    socket = null;
    rejectPending("engine stopped answering");
    try {
      ws?.close();
    } catch {
      // Already closed.
    }
    for (const listener of [...disconnectListeners]) listener();
    void recover("engine stopped answering (no heartbeat for 15 s)");
  }, 5000);
}

function stopWatchdog(): void {
  clearInterval(watchdog);
  watchdog = null;
}

function rejectPending(reason: string): void {
  for (const [id, entry] of [...pending]) {
    pending.delete(id);
    clearTimeout(entry.timer);
    entry.reject(reason);
  }
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
