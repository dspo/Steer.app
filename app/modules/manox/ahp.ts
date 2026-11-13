import { signal } from "nsh";
import { Manox, type ManoxFrame } from "../../domains/manox";
import {
  rootReducer,
  sessionReducer,
  chatReducer,
} from "../../../contracts/ahp/reducers";
import {
  ActionType,
} from "../../../contracts/ahp/common/actions";
import type {
  ActionEnvelope,
  StateAction,
} from "../../../contracts/ahp/common/actions";
import type { Snapshot, URI } from "../../../contracts/ahp/common/state";

/** The wire's one message shape, as this client consumes it. */
interface AnyMessage {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: any;
  result?: any;
  error?: { code: number; message: string };
}
import type {
  RootState,
} from "../../../contracts/ahp/channels-root/state";
import type {
  SessionState,
  SessionSummary,
} from "../../../contracts/ahp/channels-session/state";
import type {
  ChatState,
} from "../../../contracts/ahp/channels-chat/state";
import { AhpErrorCodes } from "../../../contracts/ahp/common/errors";

/**
 * The manox harness's AHP connection: a JSON-RPC conversation with the
 * in-proc host half over the native pump's frame strings (DESIGN §3.4,
 * manox leg). Zero translation layer on the read side — channel state is
 * whatever the vendored reducers fold — plus the write-side bookkeeping the
 * protocol puts on the client: request id pairing, the optimistic
 * `dispatchAction{clientSeq}` ledger and its rejection handling, and the
 * `reconnect{lastSeenServerSeq}` path.
 *
 * Fold discipline (the §3.5 gate relies on this):
 * - envelopes with `rejectionReason` are never folded (both legs skip them);
 * - a channel's effective state is the server fold plus, on top, the
 *   still-unconfirmed optimistic dispatches in dispatch order.
 */

/** How the wire is doing; `error` carries the transport story. */
export type ConnectionStatus = "idle" | "connecting" | "ready" | "error";

/** One channel's folded state plus its optimistic ledger. */
export interface ChannelCell {
  uri: URI;
  serverSeq: number;
  /** rootReducer / sessionReducer / chatReducer output. */
  state: RootState | SessionState | ChatState;
  /** Dispatched but not yet confirmed, in dispatch order. */
  pending: Array<{ clientSeq: number; action: StateAction }>;
}

/**
 * The host's last refusal of one of THIS client's dispatches, as the echo
 * carried it (`rejectionReason` on the channel's numbered stream). The §3.4
 * rejection 回报 face: the fold skips refusals and the ledger rolls back, so
 * this signal is the one place the reason stays readable.
 */
export const lastRejection = signal<{
  uri: URI;
  actionType: string;
  reason: string;
} | null>(null);

/** A server-originated catalog fact about a session (root channel). */
export const catalog = signal<Record<string, SessionSummary>>({});
/** The connection status line the conversation sheet shows. */
export const connectionStatus = signal<ConnectionStatus>("idle");
export const connectionError = signal<string | null>(null);
/** Per-channel cells (root / session / chat), keyed by URI. */
export const channels = signal<Record<string, ChannelCell>>({});

/** Pending JSON-RPC requests, by wire id. */
interface Pending {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

const pendingRequests = new Map<number, Pending>();
const pendingByClientSeq = new Map<number, { uri: URI; action: StateAction }>();
/** The channel creations this client performed (uri → params), so a rebuilt
 * transport re-issues them (idempotent by uri) before its reconnect leg. */
const creations = new Map<URI, Record<string, unknown>>();
let nextRequestId = 1;
let nextClientSeq = 1;
/** The id `initialize` carries; reconnect reuses it (the spec's contract). */
let clientId = "";
let lastSeenServerSeq = 0;
let subscriptions: URI[] = [];
let started = false;

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `id-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  }
}

/** Serializes one JSON-RPC message to the pump's frame string. */
function emit(message: AnyMessage): void {
  Manox.send(JSON.stringify(message));
}

export function request<T>(method: string, params: Record<string, unknown>): Promise<T> {
  const id = nextRequestId++;
  return new Promise<T>((resolve, reject) => {
    pendingRequests.set(id, { resolve: resolve as (value: unknown) => void, reject });
    emit({ jsonrpc: "2.0", id, method, params });
  });
}

function noteStatus(status: ConnectionStatus, error?: string): void {
  connectionStatus.set(status);
  connectionError.set(error ?? null);
}

/**
 * Starts the pump (idempotent) and wires the frame callback. The host half
 * comes up in-process; nothing here negotiates yet — `initialize` happens in
 * `ensureConnection` so a failing one can be retried.
 */
/** Whether this VM's manox host boots hermetic (throwaway state roots). Set
 * by the gate files before the first connection; the app's own mounts boot
 * against the process's real roots. */
let hermeticBoot = false;

/**Opts the manox host of this process into the hermetic state roots. */
export function setManoxHermetic(): void {
  hermeticBoot = true;
}

export function startConnection(): void {
  if (started) return;
  started = true;
  Manox.start((frame: ManoxFrame) => {
    if (frame.kind === "frame" && frame.text) {
      receive(frame.text);
    } else if (frame.kind === "transport-error") {
      // §3.4: the host half panicked or reset; the shell survived. Surface
      // the error; the reconnect path is the recovery.
      noteStatus("error", frame.error ?? "the host half was reset");
      pendingRequests.forEach((entry) =>
        entry.reject(new Error(frame.error ?? "transport reset")),
      );
      pendingRequests.clear();
    } else if (frame.kind === "stopped") {
      noteStatus("idle");
    }
  }, hermeticBoot);
}

/**
 * Handshakes once per clientId and subscribes to `uris` (idempotent per
 * URI). Used by the thread/chat stores before any read.
 */
export async function ensureConnection(subscribeUris: URI[] = []): Promise<void> {
  startConnection();
  const wanted = subscribeUris.filter((uri) => !channels()[uri]);
  if (connectionStatus() === "ready" && wanted.length === 0) return;
  if (!clientId) clientId = newId();
  try {
    noteStatus("connecting");
    // The root channel is always subscribed: the catalogue notifications
    // (`root/sessionAdded` and friends) fan out to root subscribers only.
    // The stub era broadcast them unconditionally; the real host filters by
    // subscription, so the sidebar's catalog dies without this leg.
    const uris = [...new Set(["ahp-root://", ...subscriptions, ...wanted])];
    await request("initialize", {
      channel: "ahp-root://",
      protocolVersions: ["1.0.0"],
      clientId,
      initialSubscriptions: uris,
    });
    subscriptions = uris;
    for (const uri of uris) await subscribe(uri);
    lastSeenServerSeq = Math.max(
      lastSeenServerSeq,
      ...[...Object.values(channels()).map((cell) => cell.serverSeq), 0],
    );
    noteStatus("ready");
  } catch (failure) {
    noteStatus("error", String(failure));
    throw failure;
  }
}

async function subscribe(uri: URI): Promise<void> {
  const result = await request<{ snapshot?: Snapshot }>("subscribe", { channel: uri });
  if (result?.snapshot) applySnapshot(result.snapshot);
}

/**
 * Creates a channel this client owns (`createSession` for a session, `createChat`
 * for a chat — the pairing is the protocol's only parent link). Recorded so
 * `reconnect` can re-issue them against a rebuilt transport. Both are
 * idempotent by uri at the CLIENT: the real host refuses a re-create of a
 * channel it already holds ("session already exists") — the same fact a
 * successful create would state — so that refusal is adopted, not thrown.
 */
export async function createSessionOn(uri: URI, params: Record<string, unknown> = {}): Promise<void> {
  creations.set(uri, params);
  await request("createSession", { channel: uri, ...params }).catch(alreadyExistsAsCreated);
}

export async function createChatOn(sessionUri: URI, chatUri: URI): Promise<void> {
  creations.set(chatUri, { channel: sessionUri, chat: chatUri });
  await request("createChat", { channel: sessionUri, chat: chatUri }).catch(alreadyExistsAsCreated);
}

/** A channel create the host already holds is a create that succeeded earlier. */
function alreadyExistsAsCreated(failure: unknown): void {
  if (String(failure).includes("already exists")) return;
  throw failure;
}

/** Applies one `Snapshot`: the snapshot leg's whole state. */
function applySnapshot(snapshot: Snapshot): void {
  const cell = channels()[snapshot.resource];
  const next: Record<string, ChannelCell> = { ...channels() };
  next[snapshot.resource] = {
    uri: snapshot.resource,
    serverSeq: snapshot.fromSeq,
    state: snapshot.state as ChannelCell["state"],
    pending: cell?.pending ?? [],
  };
  channels.set(next);
}

/** Folds one envelope into its channel's cell (server truth, no rejections). */
function applyEnvelope(envelope: ActionEnvelope): void {
  if (envelope.rejectionReason) return; // the fold skips refusals (both legs)
  const uri = envelope.channel;
  const cell = channels()[uri];
  if (!cell) return;
  const next = foldCell(cell, envelope.action);
  const all: Record<string, ChannelCell> = { ...channels() };
  all[uri] = next;
  channels.set(all);
}

/** The one fold: the vendored reducer for the channel kind. */
export function foldCell(cell: ChannelCell, action: StateAction): ChannelCell {
  let folded: RootState | SessionState | ChatState;
  if (cell.uri === "ahp-root://") {
    folded = rootReducer(cell.state as RootState, action as never);
  } else if (cell.uri.startsWith("ahp-session:/")) {
    folded = sessionReducer(cell.state as SessionState, action as never);
  } else {
    folded = chatReducer(cell.state as ChatState, action as never);
  }
  return { ...cell, state: folded, serverSeq: Math.max(cell.serverSeq, 0) };
}

/**
 * The channel's effective state: the server fold with the unconfirmed
 * optimistic dispatches folded on top, in dispatch order.
 */
export function effectiveState<T = ChatState>(uri: URI): T | null {
  const cell = channels()[uri];
  if (!cell) return null;
  let current = cell;
  for (const entry of current.pending) {
    current = foldCell(current, entry.action);
  }
  return current.state as T;
}

/**
 * Dispatches one client action optimistically: the ledger holds it until its
 * echo (same `clientId`+`clientSeq`) comes back. `onRejection` fires when
 * the host refused the write (the fold already skipped the envelope).
 */
export function dispatchAction(uri: URI, action: StateAction): void {
  if (!clientId) clientId = newId();
  const clientSeq = nextClientSeq++;
  pendingByClientSeq.set(clientSeq, { uri, action });
  const cell = channels()[uri];
  if (cell) {
    const next: Record<string, ChannelCell> = { ...channels() };
    next[uri] = { ...cell, pending: [...cell.pending, { clientSeq, action }] };
    channels.set(next);
  }
  emit({ jsonrpc: "2.0", method: "dispatchAction", params: { channel: uri, clientSeq, action } });
}

/**
 * Reconnects after a transport error (the M1 drill's both cases, §3.4/§5:
 * a pump transport reset, or a caught host-half panic). The pump rebuilds the
 * transport first (`Manox.restart()` — a fresh host half with a fresh
 * journal), we re-issue the channel creations (idempotent: against a real
 * host half the durable journal restores the same channels), then the
 * reconnect leg reconciles from `lastSeenServerSeq` — snapshots when the gap
 * predates the host's buffer, the missed envelopes folded in order when the
 * whole gap is there. Optimistic ledger entries replay as dispatches; the
 * client's fold survives a leg that has nothing to replay.
 */
export async function reconnect(): Promise<void> {
  startConnection();
  if (!clientId) clientId = newId();
  noteStatus("connecting");
  try {
    Manox.restart();
    await request("initialize", {
      channel: "ahp-root://",
      protocolVersions: ["1.0.0"],
      clientId,
      initialSubscriptions: subscriptions,
    });
    // The rebuilt host half may not know our channels yet; re-create them
    // (idempotent by uri) before asking for the gap.
    for (const [uri, params] of creations) {
      if (uri.startsWith("ahp-session:/")) {
        await createSessionOn(uri, params);
      } else if (uri.startsWith("ahp-chat:/")) {
        await createChatOn(params.channel as URI, uri);
      }
    }
    const result = await request<{ type: string; snapshots?: Snapshot[] }>("reconnect", {
      channel: "ahp-root://",
      clientId,
      lastSeenServerSeq,
      subscriptions,
    });
    if (result.type === "snapshot") {
      for (const snapshot of result.snapshots ?? []) applySnapshot(snapshot);
    } else {
      // Replay leg: fold the missed envelopes in order.
      for (const envelope of (result as { actions?: ActionEnvelope[] }).actions ?? []) {
        lastSeenServerSeq = Math.max(lastSeenServerSeq, envelope.serverSeq);
        if (!envelope.rejectionReason) applyEnvelope(envelope);
      }
    }
    // Unconfirmed dispatches replay: the host may have never seen them.
    for (const [clientSeq, entry] of [...pendingByClientSeq]) {
      emit({
        jsonrpc: "2.0",
        method: "dispatchAction",
        params: { channel: entry.uri, clientSeq, action: entry.action },
      });
    }
    noteStatus("ready");
  } catch (failure) {
    noteStatus("error", String(failure));
    throw failure;
  }
}

/** Tears the pump down (tests and shutdown). */
export function stopConnection(): void {
  Manox.stop();
  started = false;
  clientId = "";
  channels.set({});
  catalog.set({});
  pendingRequests.clear();
  pendingByClientSeq.clear();
  lastRejection.set(null);
  creations.clear();
}

/** Routes one wire frame: responses pair by id; notifications fold. */
function receive(text: string): void {
  let message: AnyMessage;
  try {
    message = JSON.parse(text);
  } catch {
    return;
  }
  if (message.id !== undefined && message.id !== null && ("result" in message || "error" in message)) {
    const entry = pendingRequests.get(message.id);
    if (!entry) return;
    pendingRequests.delete(message.id);
    const error = message.error;
    if (error) {
      if (error.code === AhpErrorCodes.SessionNotFound) {
        entry.reject(new Error("the session does not exist"));
      } else {
        entry.reject(new Error(error.message || `error ${error.code}`));
      }
    } else {
      entry.resolve(message.result);
    }
    return;
  }
  const method = message.method ?? "";
  const params = (message.params ?? {}) as Record<string, unknown>;
  if (method === "action") {
    const envelope = params as unknown as ActionEnvelope;
    lastSeenServerSeq = Math.max(lastSeenServerSeq, envelope.serverSeq);
    const origin = envelope.origin;
    if (origin && origin.clientId === clientId) {
      const claimed = pendingByClientSeq.get(origin.clientSeq);
      pendingByClientSeq.delete(origin.clientSeq);
      const cell = channels()[envelope.channel];
      if (cell) {
        const next: Record<string, ChannelCell> = { ...channels() };
        next[envelope.channel] = {
          ...cell,
          pending: cell.pending.filter((entry) => entry.clientSeq !== origin.clientSeq),
        };
        channels.set(next);
      }
      if (claimed && envelope.rejectionReason) {
        // Optimistic state rolls back: the pending entry is already gone
        // from the ledger, so `effectiveState` folds it no more. The reason
        // stays readable here.
        lastRejection.set({
          uri: envelope.channel,
          actionType: (envelope.action as { type?: string })?.type ?? "",
          reason: envelope.rejectionReason,
        });
      }
    }
    applyEnvelope(envelope);
    return;
  }
  if (method === "root/sessionAdded") {
    const added = params as unknown as { summary: SessionSummary };
    catalog.set({ ...catalog(), [added.summary.resource]: added.summary });
    return;
  }
  if (method === "root/sessionSummaryChanged") {
    const changed = params as unknown as { session: URI; changes: Partial<SessionSummary> };
    const existing = catalog()[changed.session];
    if (existing) {
      catalog.set({ ...catalog(), [changed.session]: { ...existing, ...changed.changes } });
    }
    return;
  }
  if (method === "root/sessionRemoved") {
    const removed = params as unknown as { session: URI };
    const next = { ...catalog() };
    delete next[removed.session];
    catalog.set(next);
  }
}

/** The ActionType table, re-exported for stores and fixtures. */
export { ActionType };
