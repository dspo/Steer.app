/**
 * JSON-RPC 2.0 over a line transport: id pairing, timeouts and dispatch.
 *
 * This is the TS half of the v2 §3 transport layering: the native `Acp`
 * class ships bytes (ndjson frames, the newline, the process); this module
 * owns everything JSON. One channel per harness process. Requests pair by
 * their wire id; a response for an unknown id is dropped (logged, never
 * silent); a transport death fails every pending request at once.
 *
 * Server→client requests (ACP's `session/request_permission`, a later
 * stage) are paired too: the handler gets the id and answers through
 * `reply`/`replyError`. Nothing here knows ACP vocabulary beyond the
 * envelope.
 */

/** One JSON-RPC message as this client produces or consumes it. */
export interface JsonrpcMessage {
  jsonrpc?: "2.0";
  id?: number | string | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: JsonrpcError;
}

export interface JsonrpcError {
  code: number;
  message: string;
  data?: unknown;
}

/** A request that failed: the transport died, timed out, or got an error reply. */
export class JsonrpcFailure extends Error {
  /** The JSON-RPC error code, when a reply carried one. */
  readonly code: number | null;
  /** The reply's `data.code` string (the distro's machine-readable code). */
  readonly dataCode: string | null;

  constructor(message: string, code: number | null = null, dataCode: string | null = null) {
    super(message);
    this.name = "JsonrpcFailure";
    this.code = code;
    this.dataCode = dataCode;
  }
}

/** A notification or server→client request, already paired. */
export interface ServerMessage {
  method: string;
  params: any;
  /** Set only for a server→client request, which wants a reply. */
  id: number | string | null;
}

interface Pending {
  resolve: (result: any) => void;
  reject: (error: JsonrpcFailure) => void;
  timer: any;
}

export class JsonrpcChannel {
  private readonly emit: (line: string) => void;
  private readonly pending = new Map<string, Pending>();
  private nextId = 0;
  private onRequestHandler: ((message: ServerMessage) => void) | null = null;
  private onMessageHandler: ((message: ServerMessage) => void) | null = null;
  private closed = false;

  constructor(emit: (line: string) => void) {
    this.emit = emit;
  }

  /** Installs the server→client request handler (permission prompts, later). */
  onRequest(handler: ((message: ServerMessage) => void) | null): void {
    this.onRequestHandler = handler;
  }

  /** Installs the notification handler (`session/update`, …). */
  onMessage(handler: ((message: ServerMessage) => void) | null): void {
    this.onMessageHandler = handler;
  }

  /** Feeds one complete stdout line; unparseable lines are logged, not fatal. */
  handleLine(line: string, log: (text: string) => void = () => {}): void {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;
    let message: JsonrpcMessage;
    try {
      message = JSON.parse(trimmed) as JsonrpcMessage;
    } catch {
      log(`unparseable frame from the harness: ${trimmed.slice(0, 200)}`);
      return;
    }
    const hasId = message.id !== undefined && message.id !== null;
    if (hasId && (message.result !== undefined || message.error !== undefined)) {
      const entry = this.pending.get(String(message.id));
      if (!entry) {
        log(`a reply for unknown id ${String(message.id)} was dropped`);
        return;
      }
      this.pending.delete(String(message.id));
      clearTimeout(entry.timer);
      if (message.error) {
        const data = message.error.data as { code?: unknown } | undefined;
        entry.reject(
          new JsonrpcFailure(
            String(message.error.message ?? `error ${String(message.error.code)}`),
            typeof message.error.code === "number" ? message.error.code : null,
            data && typeof data.code === "string" ? data.code : null,
          ),
        );
      } else {
        entry.resolve(message.result);
      }
      return;
    }
    if (typeof message.method !== "string") {
      log(`a frame with neither reply nor method was dropped: ${trimmed.slice(0, 200)}`);
      return;
    }
    const server: ServerMessage = {
      method: message.method,
      params: (message.params ?? {}) as any,
      id: hasId ? (message.id as number | string) : null,
    };
    if (hasId) {
      if (this.onRequestHandler) this.onRequestHandler(server);
      else {
        log(`no handler for the server request ${server.method}; it is refused`);
        this.replyError(server.id as number | string, -32601, `no client handler for ${server.method}`);
      }
      return;
    }
    if (this.onMessageHandler) this.onMessageHandler(server);
  }

  /** Sends a request and pairs its reply; a timeout covers the round trip
   * when given (`undefined` waits for the reply or the transport's death —
   * the shape a turn's prompt takes). */
  request<T = any>(method: string, params?: unknown, timeoutMs?: number): Promise<T> {
    if (this.closed) {
      return Promise.reject(new JsonrpcFailure("the harness transport is closed"));
    }
    const id = ++this.nextId;
    return new Promise<T>((resolve, reject) => {
      const timer = timeoutMs
        ? setTimeout(() => {
          this.pending.delete(String(id));
          reject(new JsonrpcFailure(`${method} timed out after ${timeoutMs} ms`));
        }, timeoutMs)
        : null;
      this.pending.set(String(id), { resolve, reject, timer });
      this.emit(JSON.stringify({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) }));
    });
  }

  /** Sends a notification (no id, no reply). */
  notify(method: string, params?: unknown): void {
    if (this.closed) return;
    this.emit(JSON.stringify({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) }));
  }

  /** Answers a server→client request. */
  reply(id: number | string, result: unknown): void {
    this.emit(JSON.stringify({ jsonrpc: "2.0", id, result }));
  }

  /** Refuses a server→client request with a coded error. */
  replyError(id: number | string, code: number, message: string): void {
    this.emit(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }));
  }

  /** Whether requests are still waiting for replies. */
  get hasPending(): boolean {
    return this.pending.size > 0;
  }

  /**
   * The transport ended: every unanswered request fails with `reason`. A
   * later `request` on this channel fails the same way instead of hanging.
   */
  failAll(reason: string): void {
    this.closed = true;
    for (const [, entry] of [...this.pending]) {
      clearTimeout(entry.timer);
      entry.reject(new JsonrpcFailure(reason));
    }
    this.pending.clear();
  }
}
