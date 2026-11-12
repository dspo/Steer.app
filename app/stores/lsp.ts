import { signal } from "nsh";
import type {
  EditorCompletionItem,
  EditorCompletionKind,
  EditorCompletionTrigger,
  EditorDiagnostic,
  EditorDiagnosticSeverity,
  EditorDiagnosticTag,
  EditorPosition,
  EditorRange,
} from "nsh/base";
import { Lsp, type LspExit } from "zu/native";
import { baseName, canonicalRoot, listDir } from "./fs";
import { languageFor } from "../ui/languages";

/**
 * The UI's LSP client.
 *
 * One native `Lsp` process per container and language family, owned here and
 * not by an editor sheet: hiding a tab, switching containers or opening
 * Problems must not kill the server or lose its diagnostics. `src/lsp.rs`
 * owns the process and the `Content-Length` framing; this module owns the
 * JSON-RPC ids, timeouts, cancellation, the document set and the mapping into
 * the editor's 0-based `EditorRange` shape.
 *
 * Synchronization is **full text**: `initialize` advertises client sync, and
 * every `didChange` carries the whole document (`contentChanges: [{ text }]`),
 * never incremental ranges. That is what the editor's `onChange` gives us and
 * what `editors.ts` stores; claiming incremental edits without computing them
 * would be a lie. The cost is a larger notification on every pause in typing
 * (debounced by `CHANGE_DEBOUNCE_MS`), which is acceptable for the 2 MiB file
 * cap `zu/fs` enforces.
 *
 * Nothing here goes through the engine wire, the agent or the network: the
 * language server is a local child process, and its bytes go from
 * `Callback::post` to this module and the editor's props.
 */

/** The families this build knows; each starts one server per container. */
type LspFamily = "rust" | "typescript" | "go";

/** A language server's lifecycle. */
type LspState = "starting" | "ready" | "error" | "stopped";

/** One server process, as the Problems sheet and the status line read it. */
export interface LspServerInfo {
  key: string;
  containerId: string;
  family: LspFamily;
  /** The language ids it serves (`rust`, `typescript`, `typescriptreact`, ...). */
  languages: string[];
  command: string;
  args: string[];
  root: string;
  state: LspState;
  pid: number | null;
  /** Why it failed to start or why it died. */
  error: string | null;
  /** The server's own indexing progress (`Indexing 3/42`), when it reports one. */
  progress: string | null;
  /** The last stderr lines, for the server-error state. */
  log: string[];
  /** The documents synchronized right now. */
  documents: number;
  startedAt: number | null;
  initializedAt: number | null;
}

/** A raw LSP position: line and UTF-16 column, both from 0. */
interface LspPosition {
  line: number;
  character: number;
}

/** A raw LSP range. */
interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

/** One published diagnostic, as the server sent it. */
interface LspDiagnostic {
  range: LspRange;
  severity?: number | null;
  code?: string | number | null;
  source?: string | null;
  message: string;
  tags?: number[] | null;
  codeDescription?: { href: string } | null;
  relatedInformation?: Array<{
    location: { uri?: string | null; range: LspRange };
    message: string;
  }> | null;
}

/** The diagnostics of one file, plus where they came from. */
interface LspFileDiagnostics {
  containerId: string;
  path: string;
  uri: string;
  diagnostics: LspDiagnostic[];
  updatedAt: number;
}

/** A hover result, as the editor's card draws it (Markdown). */
interface LspHoverResult {
  markdown: string;
  range?: LspRange | null;
}

/** Where a definition points, only inside the container root. */
interface LspDefinitionResult {
  path: string;
  /** The symbol's own range in the target (for the hover underline). */
  range: EditorRange;
  /** The target range to reveal. */
  target: EditorRange;
}

/** Completion items ready for `EditorRef.presentCompletions`. */
export interface LspCompletionResult {
  items: EditorCompletionItem[];
  incomplete: boolean;
}

/** A navigation the editor sheet applies once its document is ready. */
interface RevealTarget {
  sheetId: string;
  range: EditorRange;
  nonce: number;
  at: number;
}

/** One row of the Problems sheet, derived from the diagnostics store. */
export interface ProblemRow {
  id: string;
  containerId: string;
  path: string;
  uri: string;
  severity: EditorDiagnosticSeverity;
  range: EditorRange;
  line: number;
  column: number;
  message: string;
  source: string | null;
  code: string | null;
  updatedAt: number;
}

/** The servers, by `${containerId}:${family}`. */
export const lspServers = signal<Record<string, LspServerInfo>>({});

/** Diagnostics by container, then by canonical file path. */
const lspDiagnostics = signal<Record<string, Record<string, LspFileDiagnostics>>>({});

/** Navigations waiting for an editor sheet to be ready, by sheet id. */
export const pendingReveals = signal<Record<string, RevealTarget>>({});

/** The last navigation requested (definition or Problems); a diagnostic aid. */
export const lastReveal = signal<RevealTarget | null>(null);

/** How long typing pauses before the full text is sent. */
const CHANGE_DEBOUNCE_MS = 180;
/** A language server's `initialize` can compile/index before it answers. */
const INITIALIZE_TIMEOUT_MS = 60_000;
/** Hover answers should feel immediate; a slow one becomes no card. */
const HOVER_TIMEOUT_MS = 8_000;
/** Definition is a navigation, so it gets a little longer than hover. */
const DEFINITION_TIMEOUT_MS = 10_000;
/** Completion is latency-sensitive; past this the list is closed. */
const COMPLETION_TIMEOUT_MS = 8_000;
/** More items than this in a list is noise, not a completion list. */
const MAX_COMPLETION_ITEMS = 300;
/** Stderr lines kept per server. */
const MAX_LOG_LINES = 8;
/** Characters kept per stderr line. */
const MAX_LOG_LINE = 500;

const ERR_UNAVAILABLE = "ERR_LSP_UNAVAILABLE";
const ERR_TIMEOUT = "ERR_LSP_TIMEOUT";
const ERR_EXIT = "ERR_LSP_EXIT";
const ERR_STOPPED = "ERR_LSP_STOPPED";
const ERR_RESPONSE = "ERR_LSP_RESPONSE";
const ERR_SEND = "ERR_LSP_SEND";

/** A failure from the LSP layer, with a code the UI can branch on. */
interface LspFailure {
  code: string;
  message: string;
}

/** The failure of `error`, keeping the LSP layer's code when there is one. */
function lspFailure(error: unknown): LspFailure {
  const value = error as { code?: unknown; message?: unknown } | null | undefined;
  return {
    code: typeof value?.code === "string" ? value.code : ERR_UNAVAILABLE,
    message: typeof value?.message === "string" ? value.message : String(error),
  };
}

/** One language server's definition: argv, no shell, its own cwd. */
interface LspCommand {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/**
 * Test seam: maps a family to the server argv. `null` disables the family
 * (the headless UI test uses a controlled child process this way). The
 * packaged app keeps the default map.
 */
type LspCommandResolver = (family: LspFamily) => LspCommand | null;

let commandResolver: LspCommandResolver | null = null;

/** Overrides the language map; `null` restores the defaults. */
export function setLspCommandResolver(resolver: LspCommandResolver | null): void {
  commandResolver = resolver;
}

interface ServerSpec extends LspCommand {
  languages: string[];
}

/** The default map: the three servers M11 supports, as installed. */
const DEFAULT_SERVERS: Record<LspFamily, ServerSpec> = {
  rust: {
    command: "rust-analyzer",
    args: [],
    languages: ["rust"],
  },
  typescript: {
    command: "typescript-language-server",
    args: ["--stdio"],
    languages: ["typescript", "typescriptreact", "javascript", "javascriptreact"],
  },
  go: {
    command: "gopls",
    args: [],
    languages: ["go"],
  },
};

/** The family that serves an editor language, `null` for an unsupported one. */
function lspFamilyFor(language: string): LspFamily | null {
  if (language === "rust") return "rust";
  if (
    language === "typescript" ||
    language === "tsx" ||
    language === "javascript" ||
    language === "jsx"
  ) {
    return "typescript";
  }
  if (language === "go") return "go";
  return null;
}

/** The LSP `languageId` for a path. */
function lspLanguageId(path: string): string {
  const language = languageFor(path);
  if (language === "tsx") return "typescriptreact";
  if (language === "jsx") return "javascriptreact";
  return language;
}

// --- paths and URIs --------------------------------------------------------

/** `file://` URI of an absolute path, escaped segment by segment. */
export function pathToUri(path: string): string {
  const clean = path.replace(/\\/g, "/");
  const encoded = clean
    .split("/")
    .map((part, index) => (index === 0 ? "" : encodeURIComponent(part)))
    .join("/");
  return `file://${encoded}`;
}

/** The path a `file:` URI names, `null` for another scheme. */
function uriToPath(uri: string): string | null {
  if (!uri.startsWith("file://")) return null;
  let rest = uri.slice("file://".length);
  if (rest.startsWith("localhost/")) rest = rest.slice("localhost".length);
  try {
    return decodeURIComponent(rest);
  } catch {
    return rest;
  }
}

/** Whether `path` is the root or inside it (canonical paths). */
function insideRoot(root: string, path: string): boolean {
  if (path === root) return true;
  const base = root.endsWith("/") ? root : `${root}/`;
  return path.startsWith(base);
}

// --- pending navigations ---------------------------------------------------

let revealNonce = 0;

/** Asks the editor sheet `sheetId` to reveal `range` once its text is ready. */
export function requestReveal(sheetId: string, range: EditorRange): void {
  const target: RevealTarget = { sheetId, range, nonce: ++revealNonce, at: Date.now() };
  pendingReveals.set({ ...pendingReveals(), [sheetId]: target });
  lastReveal.set(target);
}

/** Drops the reveal of `sheetId` when it is still `nonce`'s (a newer one wins). */
export function clearPendingReveal(sheetId: string, nonce: number): void {
  const current = pendingReveals();
  const target = current[sheetId];
  if (!target || target.nonce !== nonce) return;
  const next = { ...current };
  delete next[sheetId];
  pendingReveals.set(next);
}

// --- the client ------------------------------------------------------------

interface DocumentState {
  path: string;
  uri: string;
  languageId: string;
  version: number;
  text: string;
  open: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

interface Pending {
  resolve: (value: any) => void;
  reject: (error: LspFailure) => void;
  timer: ReturnType<typeof setTimeout>;
  method: string;
}

class LspClient {
  readonly key: string;
  readonly containerId: string;
  readonly family: LspFamily;
  readonly root: string;
  readonly rootUri: string;
  private readonly spec: ServerSpec;
  private server: Lsp | null = null;
  private readonly documents = new Map<string, DocumentState>();
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private stopping = false;
  private initialized = false;
  /** Bumped per process, so a stopped server's late messages are ignored. */
  private generation = 0;
  private hoverId: number | null = null;
  private readonly definitionIds = new Map<string, number>();
  private readonly completionIds = new Map<string, number>();
  private readonly progressTitles = new Map<string | number, string>();

  constructor(containerId: string, family: LspFamily, root: string, spec: ServerSpec) {
    this.containerId = containerId;
    this.family = family;
    this.root = root;
    this.rootUri = pathToUri(root);
    this.key = `${containerId}:${family}`;
    this.spec = spec;
  }

  /** Starts the process and the `initialize` handshake (once). */
  start(): void {
    if (this.server) return;
    this.stopping = false;
    this.initialized = false;
    const generation = ++this.generation;
    this.publish({
      containerId: this.containerId,
      family: this.family,
      languages: this.spec.languages,
      command: this.spec.command,
      args: this.spec.args ?? [],
      root: this.root,
      state: "starting",
      pid: null,
      error: null,
      progress: null,
      documents: this.documents.size,
      startedAt: Date.now(),
      initializedAt: null,
    });
    try {
      this.server = Lsp.start(
        {
          command: this.spec.command,
          args: this.spec.args ?? [],
          cwd: this.root,
          env: this.spec.env ?? null,
        },
        (message) => {
          if (generation === this.generation) this.onMessage(message);
        },
        (text) => {
          if (generation === this.generation) this.onStderr(text);
        },
        (exit) => {
          if (generation === this.generation) this.onExit(exit);
        },
      );
      this.publish({ pid: this.server.pid });
      void this.initialize();
    } catch (error) {
      const problem = lspFailure(error);
      this.server = null;
      this.publish({ state: "error", error: `${problem.code}: ${problem.message}` });
      this.log(`cannot start ${this.spec.command}: ${problem.message}`);
    }
  }

  /** Sends `initialize`; on its answer, `initialized` and every queued didOpen. */
  private async initialize(): Promise<void> {
    const params = {
      processId: null,
      clientInfo: { name: "Zu", version: "0.1.0" },
      rootUri: this.rootUri,
      rootPath: this.root,
      workspaceFolders: [{ uri: this.rootUri, name: baseName(this.root) }],
      capabilities: {
        workspace: {
          workspaceFolders: true,
          configuration: true,
          didChangeConfiguration: { dynamicRegistration: false },
          didChangeWatchedFiles: { dynamicRegistration: false },
        },
        textDocument: {
          synchronization: {
            dynamicRegistration: false,
            willSave: false,
            didSave: true,
            willSaveWaitUntil: false,
          },
          hover: { contentFormat: ["markdown", "plaintext"] },
          definition: { linkSupport: true },
          declaration: { linkSupport: true },
          completion: {
            contextSupport: true,
            completionItem: {
              // No snippet support: the editor inserts plain text, so asking
              // for snippets would show `${1:name}` literally.
              snippetSupport: false,
              documentationFormat: ["markdown", "plaintext"],
              insertReplaceSupport: false,
              resolveSupport: { properties: [] },
            },
          },
          publishDiagnostics: {
            relatedInformation: true,
            versionSupport: true,
            tagSupport: { valueSet: [1, 2] },
          },
        },
      },
      trace: "off",
    };
    const { promise } = this.startRequest("initialize", params, INITIALIZE_TIMEOUT_MS);
    try {
      const result = await promise;
      const name =
        typeof result?.serverInfo?.name === "string" ? result.serverInfo.name : this.spec.command;
      this.initialized = true;
      this.publish({
        state: "ready",
        initializedAt: Date.now(),
        error: null,
        command: name,
      });
      this.notify("initialized", {});
      this.openAll();
    } catch (error) {
      const problem = lspFailure(error);
      this.publish({
        state: "error",
        error:
          problem.code === ERR_TIMEOUT
            ? `initialize timed out after ${INITIALIZE_TIMEOUT_MS / 1000}s`
            : `${problem.code}: ${problem.message}`,
      });
      this.stopProcess();
      rejectAll(this.pending, { code: ERR_EXIT, message: "the server did not initialize" });
    }
  }

  /** The process ended (a crash, a stop, or a signal). */
  private onExit(exit: LspExit): void {
    const deliberate = this.stopping;
    this.server = null;
    this.initialized = false;
    rejectAll(this.pending, {
      code: deliberate ? ERR_STOPPED : ERR_EXIT,
      message: deliberate
        ? "the language server was stopped"
        : `the language server exited (${exit.code ?? exit.signal ?? "unknown"})`,
    });
    if (deliberate) {
      this.publish({ state: "stopped", progress: null, pid: null });
      return;
    }
    const detail = exit.signal
      ? `signal ${exit.signal}`
      : exit.code !== null && exit.code !== undefined
        ? `exit ${exit.code}`
        : "no status";
    this.publish({
      state: "error",
      progress: null,
      pid: null,
      error: `the language server exited (${detail})`,
    });
    this.log(`the language server exited (${detail})`);
  }

  private stopProcess(): void {
    const server = this.server;
    this.server = null;
    if (server) server.stop();
  }

  /** Stops the process; the documents stay queued for a restart. */
  stop(): void {
    this.stopping = true;
    this.initialized = false;
    this.clearTimers();
    rejectAll(this.pending, { code: ERR_STOPPED, message: "the language server was stopped" });
    this.stopProcess();
    this.publish({ state: "stopped", progress: null, pid: null });
  }

  /** A fresh process with the same documents reopened. */
  restart(): void {
    this.stop();
    this.start();
  }

  /** Forgets the process and its state (a container was archived). */
  dispose(): void {
    this.stop();
    for (const doc of this.documents.values()) this.clearDocTimer(doc);
    this.documents.clear();
  }

  // --- documents -----------------------------------------------------------

  openDocument(path: string, text: string, languageId: string): void {
    if (!insideRoot(this.root, path)) return;
    const existing = this.documents.get(path);
    if (existing) {
      this.changeDocument(path, text);
      return;
    }
    const doc: DocumentState = {
      path,
      uri: pathToUri(path),
      languageId,
      version: 1,
      text,
      open: false,
      timer: null,
    };
    this.documents.set(path, doc);
    this.publish({ documents: this.documents.size });
    if (this.initialized) this.didOpen(doc);
  }

  changeDocument(path: string, text: string): void {
    const doc = this.documents.get(path);
    if (!doc || doc.text === text) return;
    doc.text = text;
    if (!doc.open) return;
    this.clearDocTimer(doc);
    doc.timer = setTimeout(() => {
      doc.timer = null;
      if (!doc.open || !this.initialized) return;
      this.flushChange(doc);
    }, CHANGE_DEBOUNCE_MS);
  }

  saveDocument(path: string, text: string): void {
    const doc = this.documents.get(path);
    if (!doc || !doc.open) return;
    this.clearDocTimer(doc);
    doc.text = text;
    // A save must not overtake the change it saves.
    this.flushChange(doc);
    this.send({
      jsonrpc: "2.0",
      method: "textDocument/didSave",
      params: { textDocument: { uri: doc.uri }, text },
    });
  }

  closeDocument(path: string): void {
    const doc = this.documents.get(path);
    if (!doc) return;
    this.clearDocTimer(doc);
    if (doc.open) {
      this.send({
        jsonrpc: "2.0",
        method: "textDocument/didClose",
        params: { textDocument: { uri: doc.uri } },
      });
    }
    this.documents.delete(path);
    clearDiagnostics(this.containerId, path);
    this.publish({ documents: this.documents.size });
  }

  private didOpen(doc: DocumentState): void {
    doc.open = true;
    doc.version = 1;
    this.send({
      jsonrpc: "2.0",
      method: "textDocument/didOpen",
      params: {
        textDocument: {
          uri: doc.uri,
          languageId: doc.languageId,
          version: doc.version,
          text: doc.text,
        },
      },
    });
  }

  private flushChange(doc: DocumentState): void {
    doc.version += 1;
    // Full document sync, honestly: the whole text, no incremental ranges.
    this.send({
      jsonrpc: "2.0",
      method: "textDocument/didChange",
      params: {
        textDocument: { uri: doc.uri, version: doc.version },
        contentChanges: [{ text: doc.text }],
      },
    });
  }

  private openAll(): void {
    for (const doc of this.documents.values()) {
      if (!doc.open) this.didOpen(doc);
    }
  }

  private clearDocTimer(doc: DocumentState): void {
    if (doc.timer !== null) {
      clearTimeout(doc.timer);
      doc.timer = null;
    }
  }

  private clearTimers(): void {
    for (const doc of this.documents.values()) this.clearDocTimer(doc);
  }

  // --- requests ------------------------------------------------------------

  private startRequest(
    method: string,
    params: unknown,
    timeoutMs: number,
  ): { id: number; promise: Promise<any> } {
    if (!this.server) {
      return {
        id: 0,
        promise: Promise.reject({
          code: ERR_UNAVAILABLE,
          message: "the language server is not running",
        } satisfies LspFailure),
      };
    }
    const id = this.nextId++;
    const promise = new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.cancel(id);
        reject({ code: ERR_TIMEOUT, message: `${method} timed out after ${timeoutMs}ms` });
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
    });
    if (!this.send({ jsonrpc: "2.0", id, method, params })) {
      const pending = this.pending.get(id);
      if (pending) {
        this.pending.delete(id);
        clearTimeout(pending.timer);
        pending.reject({
          code: ERR_SEND,
          message: "the language server did not accept the request",
        });
      }
    }
    return { id, promise };
  }

  private async request(method: string, params: unknown, timeoutMs: number): Promise<any> {
    if (!this.server || !this.initialized) {
      throw { code: ERR_UNAVAILABLE, message: "the language server is not ready" } satisfies LspFailure;
    }
    return this.startRequest(method, params, timeoutMs).promise;
  }

  /** Asks the server to drop a request; its answer can then be ignored. */
  private cancel(id: number): void {
    if (id <= 0) return;
    if (this.server) {
      this.send({ jsonrpc: "2.0", method: "$/cancelRequest", params: { id } });
    }
  }

  // --- LSP answers ---------------------------------------------------------

  async hover(path: string, position: EditorPosition): Promise<LspHoverResult | null> {
    if (!this.server || !this.initialized) return null;
    const doc = this.documents.get(path);
    if (!doc || !doc.open) return null;
    if (this.hoverId !== null) this.cancel(this.hoverId);
    const { id, promise } = this.startRequest(
      "textDocument/hover",
      { textDocument: { uri: doc.uri }, position },
      HOVER_TIMEOUT_MS,
    );
    this.hoverId = id;
    try {
      const result = await promise;
      return result ? { markdown: hoverMarkdown(result.contents), range: result.range ?? null } : null;
    } catch {
      return null;
    } finally {
      if (this.hoverId === id) this.hoverId = null;
    }
  }

  async definition(path: string, position: EditorPosition): Promise<LspDefinitionResult | null> {
    if (!this.server || !this.initialized) return null;
    const doc = this.documents.get(path);
    if (!doc || !doc.open) return null;
    const previous = this.definitionIds.get(path);
    if (previous !== undefined) this.cancel(previous);
    const { id, promise } = this.startRequest(
      "textDocument/definition",
      { textDocument: { uri: doc.uri }, position },
      DEFINITION_TIMEOUT_MS,
    );
    this.definitionIds.set(path, id);
    let result: any;
    try {
      result = await promise;
    } finally {
      if (this.definitionIds.get(path) === id) this.definitionIds.delete(path);
    }
    const first = Array.isArray(result) ? result[0] : result;
    if (!first) return null;
    const targetUri = first.targetUri ?? first.uri;
    const range = first.targetSelectionRange ?? first.targetRange ?? first.range;
    const target = first.targetRange ?? first.range;
    if (typeof targetUri !== "string" || !range) return null;
    const targetPath = uriToPath(targetUri);
    if (!targetPath || !insideRoot(this.root, targetPath)) return null;
    return {
      path: targetPath,
      range: clampRange(range),
      target: clampRange(target),
    };
  }

  async completion(
    path: string,
    position: EditorPosition,
    trigger: EditorCompletionTrigger,
    character?: string | null,
  ): Promise<LspCompletionResult> {
    if (!this.server || !this.initialized) return { items: [], incomplete: false };
    const doc = this.documents.get(path);
    if (!doc || !doc.open) return { items: [], incomplete: false };
    const previous = this.completionIds.get(path);
    if (previous !== undefined) this.cancel(previous);
    const { id, promise } = this.startRequest(
      "textDocument/completion",
      {
        textDocument: { uri: doc.uri },
        position,
        context:
          trigger === "typing"
            ? { triggerKind: 1 }
            : trigger === "character"
              ? { triggerKind: 2, triggerCharacter: character ?? "" }
              : { triggerKind: 3 },
      },
      COMPLETION_TIMEOUT_MS,
    );
    this.completionIds.set(path, id);
    try {
      const result = await promise;
      const list = Array.isArray(result) ? result : (result?.items ?? []);
      const items: EditorCompletionItem[] = [];
      for (const item of list) {
        const mapped = completionItem(item);
        if (mapped) items.push(mapped);
        if (items.length >= MAX_COMPLETION_ITEMS) break;
      }
      return { items, incomplete: Boolean(result && !Array.isArray(result) && result.isIncomplete) };
    } finally {
      if (this.completionIds.get(path) === id) this.completionIds.delete(path);
    }
  }

  // --- messages ------------------------------------------------------------

  private onMessage(raw: string): void {
    let message: any;
    try {
      message = JSON.parse(raw);
    } catch (error) {
      this.log(`a server message was not JSON: ${String(error)}`);
      return;
    }
    if (!message || typeof message !== "object") return;
    if (typeof message.method === "string" && message.id !== undefined && message.id !== null) {
      this.answerServerRequest(message);
      return;
    }
    if (message.id !== undefined && message.id !== null) {
      this.settle(message);
      return;
    }
    if (typeof message.method !== "string") return;
    this.onNotification(message.method, message.params);
  }

  private settle(message: any): void {
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) {
      pending.reject({
        code: ERR_RESPONSE,
        message:
          typeof message.error.message === "string"
            ? message.error.message
            : `${pending.method} failed`,
      });
    } else {
      pending.resolve(message.result ?? null);
    }
  }

  private answerServerRequest(message: any): void {
    let result: any = null;
    switch (message.method) {
      case "workspace/configuration": {
        const items = Array.isArray(message.params?.items) ? message.params.items : [];
        result = items.map(() => null);
        break;
      }
      case "workspace/workspaceFolders":
        result = [{ uri: this.rootUri, name: baseName(this.root) }];
        break;
      case "workspace/applyEdit":
        result = { applied: false };
        break;
      case "window/showDocument":
        result = { success: false };
        break;
      case "window/showMessageRequest":
        result = null;
        break;
      // Registration and progress creation are acknowledged with null.
      case "client/registerCapability":
      case "client/unregisterCapability":
      case "window/workDoneProgress/create":
      default:
        result = null;
        break;
    }
    this.send({ jsonrpc: "2.0", id: message.id, result });
  }

  private onNotification(method: string, params: any): void {
    switch (method) {
      case "textDocument/publishDiagnostics":
        this.onDiagnostics(params);
        break;
      case "$/progress":
        this.onProgress(params);
        break;
      case "window/logMessage":
        if (typeof params?.message === "string") this.log(params.message);
        break;
      case "window/showMessage":
        if (typeof params?.message === "string") this.log(params.message);
        break;
      default:
        break;
    }
  }

  private onDiagnostics(params: any): void {
    const uri = params?.uri;
    if (typeof uri !== "string") return;
    const path = uriToPath(uri);
    if (!path || !insideRoot(this.root, path)) return;
    // Only open documents: Problems is a view of the editors, not a
    // workspace-wide index, and a closed file's stale list would outlive it.
    if (!this.documents.has(path)) return;
    const version = this.documents.get(path)?.version ?? 0;
    if (typeof params.version === "number" && params.version > 0 && params.version < version) {
      return;
    }
    const diagnostics: LspDiagnostic[] = Array.isArray(params.diagnostics)
      ? params.diagnostics.filter(
          (row: any) => row && typeof row.message === "string" && row.range,
        )
      : [];
    setFileDiagnostics(this.containerId, {
      containerId: this.containerId,
      path,
      uri,
      diagnostics,
      updatedAt: Date.now(),
    });
  }

  private onProgress(params: any): void {
    const token = params?.token;
    const value = params?.value;
    if (typeof token !== "string" && typeof token !== "number") return;
    if (!value || typeof value !== "object") return;
    if (value.kind === "begin") {
      const title = typeof value.title === "string" ? value.title : "indexing";
      this.progressTitles.set(token, title);
      this.publish({ progress: title });
    } else if (value.kind === "report") {
      const title = this.progressTitles.get(token) ?? "indexing";
      const percent = typeof value.percentage === "number" ? ` ${Math.round(value.percentage)}%` : "";
      const message = typeof value.message === "string" ? ` · ${value.message}` : "";
      this.publish({ progress: `${title}${percent}${message}` });
    } else if (value.kind === "end") {
      this.progressTitles.delete(token);
      this.publish({ progress: null });
    }
  }

  private onStderr(text: string): void {
    for (const line of text.split(/\r?\n/)) {
      if (line.trim().length > 0) this.log(line);
    }
  }

  private log(line: string): void {
    const clean = line.length > MAX_LOG_LINE ? `${line.slice(0, MAX_LOG_LINE)}…` : line;
    const current = lspServers()[this.key];
    if (!current) return;
    const log = [...current.log, clean].slice(-MAX_LOG_LINES);
    this.publish({ log });
  }

  private send(message: Record<string, unknown>): boolean {
    const server = this.server;
    if (!server) return false;
    try {
      server.send(JSON.stringify(message));
      return true;
    } catch (error) {
      const problem = lspFailure(error);
      this.log(`${problem.code}: ${problem.message}`);
      if (problem.code === "ERR_LSP_CLOSED") this.publish({ error: problem.message });
      return false;
    }
  }

  private notify(method: string, params: unknown): void {
    this.send({ jsonrpc: "2.0", method, params });
  }

  private publish(changes: Partial<LspServerInfo>): void {
    const current = lspServers();
    const previous = current[this.key] ?? {
      key: this.key,
      containerId: this.containerId,
      family: this.family,
      languages: this.spec.languages,
      command: this.spec.command,
      args: this.spec.args ?? [],
      root: this.root,
      state: "starting" as LspState,
      pid: null,
      error: null,
      progress: null,
      log: [],
      documents: this.documents.size,
      startedAt: null,
      initializedAt: null,
    };
    lspServers.set({ ...current, [this.key]: { ...previous, ...changes } });
  }
}

/** Rejects every pending request and empties the map. */
function rejectAll(pending: Map<number, Pending>, failure: LspFailure): void {
  for (const entry of pending.values()) {
    clearTimeout(entry.timer);
    entry.reject(failure);
  }
  pending.clear();
}

// --- diagnostics store -----------------------------------------------------

function setFileDiagnostics(containerId: string, file: LspFileDiagnostics): void {
  const all = lspDiagnostics();
  const files = { ...(all[containerId] ?? {}) };
  if (file.diagnostics.length === 0) delete files[file.path];
  else files[file.path] = file;
  lspDiagnostics.set({ ...all, [containerId]: files });
}

function clearDiagnostics(containerId: string, path: string): void {
  const all = lspDiagnostics();
  const files = all[containerId];
  if (!files || !(path in files)) return;
  const next = { ...files };
  delete next[path];
  lspDiagnostics.set({ ...all, [containerId]: next });
}

const SEVERITIES: Record<number, EditorDiagnosticSeverity> = {
  1: "error",
  2: "warning",
  3: "info",
  4: "hint",
};

function severityOf(value: number | null | undefined): EditorDiagnosticSeverity {
  return value !== null && value !== undefined && SEVERITIES[value]
    ? SEVERITIES[value]
    : "error";
}

/** The ordering Problems and the editor use. */
function severityRank(severity: EditorDiagnosticSeverity): number {
  return severity === "error" ? 0 : severity === "warning" ? 1 : severity === "info" ? 2 : 3;
}

function clampPosition(position: LspPosition): EditorPosition {
  return {
    line: Math.max(0, Math.floor(Number(position?.line) || 0)),
    column: Math.max(0, Math.floor(Number(position?.character) || 0)),
  };
}

function clampRange(range: LspRange): EditorRange {
  return {
    start: clampPosition(range?.start),
    end: clampPosition(range?.end),
  };
}

/** One published diagnostic in the editor's shape. */
function toEditorDiagnostic(diagnostic: LspDiagnostic): EditorDiagnostic {
  const tags: EditorDiagnosticTag[] = [];
  for (const tag of diagnostic.tags ?? []) {
    if (tag === 1) tags.push("unnecessary");
    if (tag === 2) tags.push("deprecated");
  }
  return {
    range: clampRange(diagnostic.range),
    severity: severityOf(diagnostic.severity),
    message: diagnostic.message,
    source: diagnostic.source ?? null,
    code:
      diagnostic.code === null || diagnostic.code === undefined ? null : String(diagnostic.code),
    codeDescription: diagnostic.codeDescription?.href
      ? { href: diagnostic.codeDescription.href }
      : null,
    tags,
    relatedInformation: (diagnostic.relatedInformation ?? []).map((row) => ({
      location: {
        uri: row.location?.uri ?? null,
        range: clampRange(row.location?.range),
      },
      message: row.message,
    })),
  };
}

/** The diagnostics of one open file, as `Editor.diagnostics` takes them. */
export function diagnosticsFor(containerId: string, path: string): EditorDiagnostic[] {
  const file = lspDiagnostics()[containerId]?.[path];
  if (!file) return [];
  return file.diagnostics.map(toEditorDiagnostic);
}

/** The problems of one container, ordered by severity, path and line. */
export function problemsFor(containerId: string): ProblemRow[] {
  const files = lspDiagnostics()[containerId] ?? {};
  const rows: ProblemRow[] = [];
  for (const file of Object.values(files)) {
    const relative = file.path;
    for (let index = 0; index < file.diagnostics.length; index += 1) {
      const diagnostic = file.diagnostics[index];
      const range = clampRange(diagnostic.range);
      rows.push({
        id: `${relative}#${index}`,
        containerId,
        path: file.path,
        uri: file.uri,
        severity: severityOf(diagnostic.severity),
        range,
        line: range.start.line,
        column: range.start.column,
        message: diagnostic.message,
        source: diagnostic.source ?? null,
        code:
          diagnostic.code === null || diagnostic.code === undefined
            ? null
            : String(diagnostic.code),
        updatedAt: file.updatedAt,
      });
    }
  }
  rows.sort(
    (left, right) =>
      severityRank(left.severity) - severityRank(right.severity) ||
      left.path.localeCompare(right.path) ||
      left.line - right.line ||
      left.column - right.column,
  );
  return rows;
}

/** How many errors and warnings one container has. */
export function problemCounts(containerId: string): { errors: number; warnings: number; total: number } {
  let errors = 0;
  let warnings = 0;
  let total = 0;
  for (const row of problemsFor(containerId)) {
    total += 1;
    if (row.severity === "error") errors += 1;
    if (row.severity === "warning") warnings += 1;
  }
  return { errors, warnings, total };
}

// --- the container's clients ----------------------------------------------

const clients = new Map<string, LspClient>();

function clientKey(containerId: string, family: LspFamily): string {
  return `${containerId}:${family}`;
}

function serverSpec(family: LspFamily): ServerSpec {
  const override = commandResolver?.(family);
  if (override) {
    return {
      command: override.command,
      args: override.args ?? [],
      env: override.env,
      languages: DEFAULT_SERVERS[family].languages,
    };
  }
  return DEFAULT_SERVERS[family];
}

function ensureClient(containerId: string, root: string, family: LspFamily): LspClient | null {
  const key = clientKey(containerId, family);
  const existing = clients.get(key);
  if (existing && existing.root === root) {
    // A server that crashed (or was stopped while its documents stayed
    // queued) gets another chance when a supported file opens again; the
    // Problems sheet also has an explicit restart.
    existing.start();
    return existing;
  }
  if (commandResolver && commandResolver(family) === null) return null;
  const spec = serverSpec(family);
  const client = new LspClient(containerId, family, root, spec);
  clients.set(key, client);
  client.start();
  return client;
}

function clientFor(containerId: string, family: LspFamily): LspClient | null {
  return clients.get(clientKey(containerId, family)) ?? null;
}

/** The client that serves `path`, if its family is supported here. */
function clientForPath(containerId: string, path: string): LspClient | null {
  const family = lspFamilyFor(languageFor(path));
  return family ? clientFor(containerId, family) : null;
}

/**
 * Opens (or refreshes) a document with its server; starts the container's
 * server the first time a supported file opens. `root` must be canonical
 * (`canonicalRoot`).
 */
export function openLspDocument(
  containerId: string,
  root: string,
  path: string,
  text: string,
  language: string,
): void {
  const family = lspFamilyFor(language);
  if (!family || !root || !insideRoot(root, path)) return;
  const client = ensureClient(containerId, root, family);
  client?.openDocument(path, text, lspLanguageId(path));
}

/** Tells the server the whole new text (debounced; full-document sync). */
export function documentChanged(containerId: string, path: string, text: string): void {
  const client = clientForPath(containerId, path);
  client?.changeDocument(path, text);
}

/** Tells the server the saved text; the save wins over a pending change. */
export function documentSaved(containerId: string, path: string, text: string): void {
  const client = clientForPath(containerId, path);
  client?.saveDocument(path, text);
}

/** The sheet closed: `didClose`, and its diagnostics leave Problems. */
export function documentClosed(containerId: string, path: string): void {
  const client = clientForPath(containerId, path);
  client?.closeDocument(path);
}

/**
 * Starts the servers a container's project markers call for, without opening
 * a file: Problems is the other place a server may start. No marker, no
 * process (opening a supported file still starts one).
 */
export async function ensureContainerLsp(containerId: string, root: string): Promise<void> {
  if (!root) return;
  let base = root;
  try {
    base = await canonicalRoot(root);
  } catch {
    base = root;
  }
  let names: Set<string>;
  try {
    names = new Set((await listDir(base, ".")).map((entry) => entry.name));
  } catch {
    return;
  }
  if (names.has("Cargo.toml")) ensureClient(containerId, base, "rust");
  if (names.has("package.json") || names.has("tsconfig.json")) {
    ensureClient(containerId, base, "typescript");
  }
  if (names.has("go.mod")) ensureClient(containerId, base, "go");
}

/** Restarts one family's server (Problems' restart button). */
export function restartLsp(containerId: string, family: LspFamily): void {
  const client = clientFor(containerId, family);
  if (client) {
    client.restart();
    return;
  }
  const server = lspServers()[clientKey(containerId, family)];
  if (server) {
    const spec = serverSpec(family);
    const next = new LspClient(containerId, family, server.root, spec);
    clients.set(clientKey(containerId, family), next);
    next.start();
  }
}

/** Stops every server of an archived container. */
export function stopLspContainer(containerId: string): void {
  const all = lspServers();
  let changed = false;
  const next = { ...all };
  for (const [key, client] of clients) {
    if (client.containerId !== containerId) continue;
    client.dispose();
    clients.delete(key);
    if (key in next) {
      delete next[key];
      changed = true;
    }
  }
  if (changed) lspServers.set(next);
  const diagnostics = lspDiagnostics();
  if (containerId in diagnostics) {
    const nextDiagnostics = { ...diagnostics };
    delete nextDiagnostics[containerId];
    lspDiagnostics.set(nextDiagnostics);
  }
}

/** The servers of one container, stable by family. */
export function lspServerList(containerId: string): LspServerInfo[] {
  return Object.values(lspServers())
    .filter((server) => server.containerId === containerId)
    .sort((left, right) => left.family.localeCompare(right.family));
}

/** The aggregate state Problems shows. */
export function lspContainerState(
  containerId: string,
): "idle" | "starting" | "indexing" | "ready" | "error" | "stopped" {
  const servers = lspServerList(containerId);
  if (servers.length === 0) return "idle";
  if (servers.some((server) => server.state === "starting")) return "starting";
  if (servers.some((server) => server.progress !== null)) return "indexing";
  if (servers.some((server) => server.state === "ready")) return "ready";
  if (servers.some((server) => server.state === "error")) return "error";
  return "stopped";
}

// --- the editor's questions ------------------------------------------------

/**
 * `textDocument/hover` for the editor's card. Stale answers are dropped by
 * the caller (its own sequence); a superseded server request is cancelled.
 */
export async function lspHover(
  containerId: string,
  path: string,
  position: EditorPosition,
  text: string,
): Promise<LspHoverResult | null> {
  const client = clientForPath(containerId, path);
  if (!client) return null;
  client.changeDocument(path, text);
  return client.hover(path, position);
}

/** `textDocument/definition`; only targets inside the container root count. */
export async function lspDefinition(
  containerId: string,
  path: string,
  position: EditorPosition,
  text: string,
): Promise<LspDefinitionResult | null> {
  const client = clientForPath(containerId, path);
  if (!client) return null;
  client.changeDocument(path, text);
  return client.definition(path, position);
}

/** `textDocument/completion`, mapped to the editor's item shape. */
export async function lspCompletion(
  containerId: string,
  path: string,
  position: EditorPosition,
  text: string,
  trigger: EditorCompletionTrigger = "invoked",
  character?: string | null,
): Promise<LspCompletionResult> {
  const client = clientForPath(containerId, path);
  if (!client) return { items: [], incomplete: false };
  client.changeDocument(path, text);
  return client.completion(path, position, trigger, character);
}

// --- LSP value mapping -----------------------------------------------------

/** Markdown of a hover answer (`MarkupContent`, `MarkedString`, a list). */
function hoverMarkdown(contents: any): string {
  if (contents === null || contents === undefined) return "";
  if (typeof contents === "string") return contents;
  if (Array.isArray(contents)) {
    return contents
      .map((part) => hoverMarkdown(part))
      .filter((part) => part.trim().length > 0)
      .join("\n\n");
  }
  if (typeof contents !== "object") return String(contents);
  const value = typeof contents.value === "string" ? contents.value : "";
  if (contents.kind === "markdown") return value;
  if (contents.kind === "plaintext") return fenced(value, "");
  if (typeof contents.language === "string") return fenced(value, contents.language);
  return value;
}

function fenced(value: string, language: string): string {
  const fence = value.includes("```") ? "````" : "```";
  return `${fence}${language}\n${value}\n${fence}`;
}

const COMPLETION_KINDS: Record<number, EditorCompletionKind> = {
  1: "text",
  2: "method",
  3: "function",
  4: "constructor",
  5: "field",
  6: "variable",
  7: "class",
  8: "interface",
  9: "module",
  10: "property",
  11: "unit",
  12: "value",
  13: "enum",
  14: "keyword",
  15: "snippet",
  16: "color",
  17: "file",
  18: "reference",
  19: "folder",
  20: "enumMember",
  21: "constant",
  22: "struct",
  23: "event",
  24: "operator",
  25: "typeParameter",
};

/** One `CompletionItem` as the editor presents it, `null` for a malformed one. */
export function completionItem(item: any): EditorCompletionItem | null {
  if (!item || typeof item.label !== "string" || item.label.length === 0) return null;
  const edit = item.textEdit;
  const insertText =
    typeof edit?.newText === "string"
      ? edit.newText
      : typeof item.insertText === "string"
        ? item.insertText
        : item.label;
  const range = edit?.range ?? edit?.replace ?? edit?.insert ?? null;
  return {
    label: item.label,
    kind:
      typeof item.kind === "number" && COMPLETION_KINDS[item.kind]
        ? COMPLETION_KINDS[item.kind]
        : null,
    detail: typeof item.detail === "string" ? item.detail : null,
    documentation: documentationText(item.documentation),
    insertText,
    filterText: typeof item.filterText === "string" ? item.filterText : null,
    sortText: typeof item.sortText === "string" ? item.sortText : null,
    range: range ? clampRange(range) : null,
  };
}

function documentationText(documentation: any): string | null {
  if (typeof documentation === "string") return documentation;
  if (documentation && typeof documentation.value === "string") return documentation.value;
  return null;
}

