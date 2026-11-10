import { signal } from "nsh";
import { Engine } from "zu/native";

/**
 * The UI's single connection to the engine sidecar.
 *
 * One loopback WebSocket carries every command and every event. Commands
 * are correlated by an `id` the engine repeats on its reply; events carry
 * no id and go to the listeners. The sidecar is started through the Rust
 * native module, which resolves its path and hands back the port and
 * handshake token.
 */

export type EnginePhase = "stopped" | "starting" | "connected" | "error";

/** What the shell shows in its status line. */
export const phase = signal<EnginePhase>("stopped");
/** `{ pi, protocol }` once the welcome arrives. */
export const info = signal<{ pi: string; protocol: number } | null>(null);
/** The last failure, shown until the next attempt. */
export const lastError = signal<string | null>(null);

type Listener = (event: any) => void;

let socket: WebSocket | null = null;
let nextId = 0;
const pending = new Map<string, { resolve: (data: any) => void; reject: (message: string) => void }>();
const listeners = new Set<Listener>();

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Subscribes to engine events; the returned function stops it. */
export function onEngineEvent(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
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
      resolve: (data) => {
        clearTimeout(timer);
        resolve(data);
      },
      reject: (message) => {
        clearTimeout(timer);
        reject(message);
      },
    });
    socket.send(JSON.stringify({ id, type, ...payload }));
  });
}

/** Starts the sidecar (if needed) and connects, retrying while it boots. */
export async function connect(): Promise<void> {
  if (phase() === "connected") return;
  phase.set("starting");
  lastError.set(null);
  try {
    await Engine.start();
  } catch (error) {
    phase.set("error");
    lastError.set(String(error));
    return;
  }
  const port = Engine.port();
  const token = Engine.token();
  for (let attempt = 0; attempt < 60; attempt++) {
    if (await attemptConnect(port, token)) return;
    await sleep(100);
  }
  phase.set("error");
  lastError.set(`engine did not answer on 127.0.0.1:${port} — see ${Engine.logPath()}`);
}

/** Stops the sidecar and forgets the socket. */
export async function disconnect(): Promise<void> {
  socket?.close();
  socket = null;
  phase.set("stopped");
  info.set(null);
  await Engine.stop();
}

function attemptConnect(port: number, token: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const timer = setTimeout(() => {
      ws.close();
      settle(false);
    }, 1500);
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "hello", token }));
    };
    ws.onmessage = (event) => {
      let message: any;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (message.type === "welcome") {
        clearTimeout(timer);
        socket = ws;
        ws.onmessage = (event) => handleMessage(event.data);
        ws.onclose = () => {
          if (socket === ws) socket = null;
          if (phase() === "connected") {
            phase.set("stopped");
            info.set(null);
          }
        };
        info.set({ pi: message.pi, protocol: message.protocol });
        phase.set("connected");
        settle(true);
        return;
      }
      if (message.type === "error" && message.message === "bad token") {
        clearTimeout(timer);
        lastError.set("the engine rejected the handshake token; restart it");
        ws.close();
        settle(false);
      }
    };
    ws.onerror = () => {
      clearTimeout(timer);
      settle(false);
    };
  });
}

function handleMessage(raw: unknown) {
  let message: any;
  try {
    message = JSON.parse(String(raw));
  } catch {
    return;
  }
  if (message.type === "reply") {
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.ok) entry.resolve(message.data);
    else entry.reject(String(message.error ?? "command failed"));
    return;
  }
  for (const listener of [...listeners]) listener(message);
}
