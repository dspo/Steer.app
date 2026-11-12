/**
 * Zu engine: a loopback WebSocket host around pi's SDK.
 *
 * One process serves every session (pi has no multiplexing protocol; the
 * SDK is the documented way to run several in one host). The UI is the only
 * client. Everything the UI learns comes from pi's own events, and pi's
 * session files stay the authority — the engine keeps no transcript mirror.
 *
 * Wire: see `contracts/protocol.ts` and `contracts/protocol.md`. Every
 * message names its protocol version; a mismatched peer is rejected, not
 * guessed at. The engine increments a persisted `generation` on each start,
 * so a reconnecting shell can tell a restart from a dropped socket.
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";

import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  hasTrustRequiringProjectResources,
  ModelRuntime,
  ProjectTrustStore,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";

import {
  PROTOCOL_VERSION,
  UI_REQUEST_TIMEOUT_MS,
  makeErrorReply,
  makeEvent,
  makeReply,
  makeUIRequest,
  makeWelcome,
  parseEnvelope,
  validateCommand,
  type ContainerData,
  type ContainerKind,
  type ContainerListData,
  type ContainerRecord,
  type ProjectData,
  type ProjectRecord,
  type ProjectRoot,
  type ProjectsData,
  type Envelope,
  type EventMessage,
  type EventType,
  type Reply,
  type SessionContextUsage,
  type SessionExtensionsData,
  type SessionInfoResult,
  type SessionMeta,
  type SessionModelInfo,
  type SessionModelOption,
  type SessionModelProvider,
  type SessionModelsData,
  type SessionModelsReason,
  type StateSnapshot,
  type UIMethod,
  type UIResponsePayload,
} from "../../contracts/protocol";
import {
  readLayout,
  readProjects,
  readRegistry,
  readSettings,
  stateDir,
  writeLayout,
  writeProjects,
  writeRegistry,
  writeSettings,
  type ProjectsFile,
  type Registry,
} from "./store";
import { dispatchExtension, SubagentManager, type SubagentHost } from "./subagents";
import { PI_VERSION } from "./version";

/** 0 lets the system pick one, so two hosts on a machine never collide;
 * the chosen port is published beside the state for the native module. */
const PORT = Number(process.env.ZU_PORT ?? 0);
const TOKEN = process.env.ZU_TOKEN ?? "";
const AGENT_DIR = getAgentDir();
const TRUST_YES = "Trust this folder";
const TRUST_NO = "Do not trust";

type AgentSession = Awaited<ReturnType<typeof createAgentSession>>["session"];

interface Rec {
  id: string;
  path: string;
  cwd: string;
  manager: SessionManager;
  session: AgentSession;
  /** The connection that opened it; UI requests go here while it is alive. */
  client?: any;
  name?: string;
  containerId?: string;
  /** The live run, if a turn is in flight (also in `registry.runs`). */
  runId?: string;
  /** LRU order: the least recently used idle session is disposed first. */
  lastUsed: number;
  extensions: SessionExtensionsData;
}

/** How many pi sessions stay in memory; the rest rehydrate from their files. */
const MAX_OPEN_SESSIONS = 8;

/** Open sessions by pi session id. */
const open = new Map<string, Rec>();
/** Connections subscribed to events (after `state.subscribe`). */
const subscribers = new Set<any>();
/** Extension UI requests awaiting a `ui.response`, by request id. */
const pendingUI = new Map<string, { resolve: (result: unknown) => void; timer: any }>();
const trustStore = new ProjectTrustStore(AGENT_DIR);

let uiSeq = 0;

let registry: Registry = readRegistry();
let projectsFile: ProjectsFile = readProjects();

const subagents = new SubagentManager({
  agentDir: AGENT_DIR,
  captainFor: (id) => open.get(id),
  settledRuns: () => registry.subagentRuns,
  saveSettled: (run) => {
    registry.subagentRuns = [...registry.subagentRuns.filter((entry) => entry.runId !== run.runId), run];
    saveRegistry();
  },
  appendCaptainNote: (captainId, kind, text, data) => {
    const captain = open.get(captainId);
    try {
      captain?.manager.appendCustomEntry(kind === "dispatch" ? "zu.dispatch" : "zu.delivery", data);
    } catch {
      // A closed captain still gets the shell event below.
    }
    emit("subagent.note", { kind, text, ...(data as Record<string, unknown>) }, captainId);
  },
  emit: (type, data, sessionId) => emit(type as EventType, data, sessionId),
  projectTrusted: (cwd) => trustStore.get(cwd) === true,
  isArchived: (captainId) => {
    const container = containerForSession(captainId);
    return !!container?.archived;
  },
} satisfies SubagentHost);
let runSeq = 0;
let projectSeq = 0;

const startedAt = Date.now();
const generation = nextGeneration();
reconcileRegistry();
const extraExtensionPaths = (process.env.ZU_EXTENSION_PATHS ?? "")
  .split(",")
  .map((path) => path.trim())
  .filter(Boolean);

/**
 * The process's one model registry, created here rather than as a side
 * effect of the first session: `pi --list-models` and every session's
 * picker then read the same catalog, and a failed load is reported (the
 * shell says why) instead of turning into an empty list. Sessions await
 * this promise; a failure falls back to pi's per-session default.
 */
const modelRegistry: Promise<ModelRuntime | undefined> = ModelRuntime.create().catch((error: any) => {
  console.warn(`[zu] model registry unavailable: ${String(error?.message ?? error)}`);
  return undefined;
});

function send(ws: any, msg: unknown): void {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    // A closed socket; the next command opens a new one.
  }
}

function emit(type: EventType, data?: unknown, sessionId?: string): void {
  if (subscribers.size === 0) return;
  const message = makeEvent(type, data, sessionId);
  const text = JSON.stringify(message);
  for (const client of subscribers) {
    try {
      client.send(text);
    } catch {
      // Ignored: the socket's close handler removes it.
    }
  }
}

function reply(ws: any, message: Reply): void {
  send(ws, message);
}

/** A message the UI can render: role and its text. */
function plain(message: any): { role: string; text: string; at?: number } {
  const text =
    typeof message.content === "string"
      ? message.content
      : Array.isArray(message.content)
        ? message.content
            .filter((block: any) => block?.type === "text")
            .map((block: any) => block.text)
            .join("")
        : "";
  return { role: message.role, text, at: message.timestamp };
}

function customTypes(manager: SessionManager): string[] {
  return manager
    .getEntries()
    .filter((entry) => entry.type === "custom")
    .map((entry) => String((entry as any).customType));
}

function sessionData(rec: Rec) {
  return {
    id: rec.id,
    path: rec.path,
    cwd: rec.cwd,
    name: rec.name,
    containerId: rec.containerId,
    messages: (rec.session.state?.messages ?? []).map(plain),
    customTypes: customTypes(rec.manager),
  };
}

/** The model the composer names: provider, ids and the window it has. */
function modelData(rec: Rec): SessionModelInfo | undefined {
  const model: any = rec.session.model;
  if (!model) return undefined;
  const provider = String(model.provider ?? "");
  const id = String(model.id ?? "");
  // With no usable model pi keeps a placeholder; the composer must not name
  // it as a choice. An absent `model` is what the shell's no-model state is.
  if (!provider || provider === "unknown" || !id || id === "unknown") return undefined;
  const contextWindow = Number(model.contextWindow ?? 0);
  return {
    provider,
    id,
    name: String(model.name ?? model.id ?? ""),
    ...(contextWindow > 0 ? { contextWindow } : {}),
    reasoning: !!model.reasoning,
  };
}

/** The session's live context gauge, when pi can estimate one. */
function contextUsageData(rec: Rec): SessionContextUsage | undefined {
  try {
    const usage = rec.session.getContextUsage();
    if (!usage) return undefined;
    return {
      tokens: typeof usage.tokens === "number" ? usage.tokens : null,
      contextWindow: Number(usage.contextWindow ?? 0),
      percent: typeof usage.percent === "number" ? usage.percent : null,
    };
  } catch {
    // A session that is still booting or already disposed: no gauge yet.
    return undefined;
  }
}

/** `session.info`'s reply and its event's data (optional fields are left out). */
function sessionInfo(rec: Rec): SessionInfoResult {
  const model = modelData(rec);
  const contextUsage = contextUsageData(rec);
  return {
    sessionId: rec.id,
    path: rec.path,
    name: rec.name,
    running: rec.session.isStreaming,
    customTypes: customTypes(rec.manager),
    thinkingLevel: String(rec.session.thinkingLevel ?? "off"),
    ...(model ? { model } : {}),
    ...(contextUsage ? { contextUsage } : {}),
  };
}

/**
 * Why the picker has nothing to list. `no_catalog`: pi found no providers at
 * all; `no_credentials`: providers exist but none has auth; `no_models`: auth
 * exists but no chat model is listed; `unavailable`: asking pi failed.
 */
function modelsReason(runtime: ModelRuntime, failure?: string): SessionModelsReason {
  if (failure) return { code: "unavailable", message: failure };
  const providers = runtime.getProviders();
  if (providers.length === 0) return { code: "no_catalog" };
  if (!providers.some((provider) => runtime.hasConfiguredAuth(provider.id))) return { code: "no_credentials" };
  return { code: "no_models" };
}

/** The two-level model picker's data: providers, their models, the current one. */
async function modelsData(rec: Rec, refresh: boolean): Promise<SessionModelsData> {
  const runtime = rec.session.modelRuntime;
  let available: any[] = [];
  let failure: string | undefined;
  try {
    // The registry's snapshot is what the startup pass (or the last retry)
    // paid for; `refresh` asks pi's auth checks again, which is how signing
    // in lands without a restart. An empty snapshot always asks, so a machine
    // that gains its first credential recovers on the next open.
    const snapshot = runtime.getAvailableSnapshot();
    available = [...(refresh || snapshot.length === 0 ? await runtime.getAvailable() : snapshot)];
  } catch (error: any) {
    // A failed read is a reason in the reply, never a silent empty menu.
    failure = String(error?.message ?? error);
  }
  const groups = new Map<string, SessionModelProvider>();
  for (const model of available) {
    // `getAvailable` is chat models; skip anything a newer pi adds.
    if (model?.type && model.type !== "chat") continue;
    const providerId = String(model.provider ?? "");
    if (!providerId || !model.id) continue;
    let group = groups.get(providerId);
    if (!group) {
      const provider = runtime.getProvider(providerId);
      group = { id: providerId, name: String(provider?.name ?? providerId), models: [] };
      groups.set(providerId, group);
    }
    const contextWindow = Number(model.contextWindow ?? 0);
    const option: SessionModelOption = {
      provider: providerId,
      id: String(model.id),
      name: String(model.name ?? model.id),
      reasoning: !!model.reasoning,
      ...(contextWindow > 0 ? { contextWindow } : {}),
    };
    group.models.push(option);
  }
  const providers = [...groups.values()]
    .map((group) => ({
      ...group,
      models: group.models.slice().sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const current = modelData(rec);
  const thinkingLevel = String(rec.session.thinkingLevel ?? "off") as SessionModelsData["thinkingLevel"];
  return {
    providers,
    ...(current ? { current } : {}),
    thinkingLevel,
    ...(providers.length === 0 ? { reason: modelsReason(runtime, failure) } : {}),
  };
}

function snapshot(): StateSnapshot {
  return {
    generation,
    protocol: PROTOCOL_VERSION,
    pi: PI_VERSION,
    pid: process.pid,
    startedAt,
    containers: registry.containers.map(containerView),
    activeContainerId: registry.activeContainerId,
    openSessions: [...open.values()].map((rec) => ({
      sessionId: rec.id,
      path: rec.path,
      cwd: rec.cwd,
      name: rec.name,
      containerId: rec.containerId,
      running: rec.session.isStreaming,
    })),
    activeRuns: [...open.values()].filter((rec) => rec.session.isStreaming).map((rec) => rec.id),
    unread: {},
  };
}

function saveRegistry(): void {
  writeRegistry(registry);
}

function saveProjects(): void {
  writeProjects(projectsFile);
}

/** A container as the shell sees it: the registry record plus its explicit project. */
function containerView(container: ContainerRecord): ContainerRecord {
  return { ...container, projectId: projectsFile.membership[container.id] ?? null };
}

function findProject(id: string): ProjectRecord | undefined {
  return projectsFile.projects.find((project) => project.id === id);
}

function primaryRoot(project: ProjectRecord): ProjectRoot {
  return project.roots.find((root) => root.primary) ?? project.roots[0];
}

function projectsData(project?: ProjectRecord): ProjectsData | ProjectData {
  const data = { projects: projectsFile.projects, membership: projectsFile.membership };
  return project ? { ...data, project } : data;
}

/**
 * Exactly one primary root; omitted flags make the first root primary and
 * several primaries are an error. Roots must be existing directories, since
 * a container's cwd is snapshotted from the primary.
 */
function normalizeRoots(roots: Array<{ path: string; primary?: boolean }>): ProjectRoot[] {
  if (!Array.isArray(roots) || roots.length === 0) throw new Error("a project needs at least one root");
  const seen = new Set<string>();
  const normalized: ProjectRoot[] = [];
  let primaries = 0;
  for (const root of roots) {
    const path = String(root?.path ?? "").trim();
    if (!path || !isAbsolute(path)) throw new Error(`project root is not an absolute path: ${path}`);
    if (seen.has(path)) continue;
    seen.add(path);
    if (!existsSync(path) || !statSync(path).isDirectory()) {
      throw new Error(`project root is not a directory: ${path}`);
    }
    const primary = root.primary === true;
    if (primary) primaries++;
    normalized.push({ path, primary });
  }
  if (normalized.length === 0) throw new Error("a project needs at least one root");
  if (primaries > 1) throw new Error("a project has exactly one primary root");
  if (primaries === 0) normalized[0].primary = true;
  return normalized;
}

function createProject(payload: { name?: string; roots: Array<{ path: string; primary?: boolean }> }): ProjectRecord {
  const roots = normalizeRoots(payload?.roots ?? []);
  const primary = primaryRoot({ roots } as ProjectRecord);
  const requested = String(payload?.name ?? "").trim();
  const now = Date.now();
  const project: ProjectRecord = {
    id: `p-${now.toString(36)}-${++projectSeq}`,
    name: requested || basename(primary.path),
    nameOverridden: requested.length > 0,
    roots,
    position: projectsFile.projects.length,
    createdAt: now,
    updatedAt: now,
  };
  projectsFile.projects.push(project);
  saveProjects();
  return project;
}

function updateProject(project: ProjectRecord, payload: { name?: string; roots?: Array<{ path: string; primary?: boolean }> }): ProjectRecord {
  if (payload.roots !== undefined) project.roots = normalizeRoots(payload.roots);
  const requested = payload.name === undefined ? undefined : String(payload.name).trim();
  if (requested !== undefined) {
    if (requested.length > 0) {
      project.name = requested;
      project.nameOverridden = true;
    } else if (!project.nameOverridden) {
      project.name = basename(primaryRoot(project).path);
    }
  } else if (!project.nameOverridden) {
    project.name = basename(primaryRoot(project).path);
  }
  project.updatedAt = Date.now();
  saveProjects();
  return project;
}

function setMembership(containerId: string, projectId: string | null | undefined): void {
  if (!findContainer(containerId)) throw new Error("container not found");
  if (projectId !== null && !findProject(projectId)) throw new Error("project not found");
  if (projectId === null) delete projectsFile.membership[containerId];
  else projectsFile.membership[containerId] = projectId;
  saveProjects();
}

function touch(rec: Rec): void {
  rec.lastUsed = Date.now();
}

/** Disposes idle sessions beyond the LRU budget; a running turn is never evicted. */
function evictSessions(keepId?: string): void {
  if (open.size <= MAX_OPEN_SESSIONS) return;
  const candidates = [...open.values()]
    .filter((rec) => rec.session.isStreaming === false && rec.id !== keepId)
    .sort((a, b) => a.lastUsed - b.lastUsed);
  while (open.size > MAX_OPEN_SESSIONS && candidates.length > 0) {
    const victim = candidates.shift()!;
    try {
      victim.session.dispose();
    } catch {
      // Already disposed.
    }
    open.delete(victim.id);
  }
}

function findContainer(id: string): ContainerRecord | undefined {
  return registry.containers.find((container) => container.id === id);
}

function containerForSession(sessionId: string): ContainerRecord | undefined {
  return registry.containers.find((container) =>
    container.sessions.some((session) => session.sessionId === sessionId),
  );
}

function containerForPath(path: string): ContainerRecord | undefined {
  return registry.containers.find((container) =>
    container.sessions.some((session) => session.path === path),
  );
}

/** A registry entry by session id, with the container that owns it. */
function registrySession(sessionId: string): { container: ContainerRecord; path: string } | undefined {
  for (const container of registry.containers) {
    const session = container.sessions.find((entry) => entry.sessionId === sessionId);
    if (session) return { container, path: session.path };
  }
  return undefined;
}

function containerForSessionPathOrId(sessionId: string, path: string): ContainerRecord | undefined {
  return containerForSession(sessionId) ?? (path ? containerForPath(path) : undefined);
}

/** Records (or refreshes) a session in its container; keeps the file path current. */
function noteContainerSession(rec: Rec): void {
  const container = rec.containerId ? findContainer(rec.containerId) : containerForSessionPathOrId(rec.id, rec.path);
  if (!container) return;
  const existing = container.sessions.find((session) => session.sessionId === rec.id);
  if (existing) {
    if (rec.path && existing.path !== rec.path) existing.path = rec.path;
    if (rec.name && existing.name !== rec.name) existing.name = rec.name;
  } else {
    container.sessions.push({ sessionId: rec.id, path: rec.path, name: rec.name });
  }
  rec.containerId = container.id;
  container.updatedAt = Date.now();
  saveRegistry();
}

/**
 * Startup reconciliation: runs are volatile (the process that owned them is
 * gone) and an active pointer at an archived container moves to a live one.
 * A session file is allowed to be missing: a container that has not had its
 * first message has a path but no file yet, so file existence is not a
 * death test in M3.
 */
function reconcileRegistry(): void {
  let changed = registry.runs.length > 0;
  registry.runs = [];
  if (registry.activeContainerId) {
    const active = findContainer(registry.activeContainerId);
    if (!active || active.archived) {
      registry.activeContainerId =
        registry.containers.find((container) => !container.archived)?.id ?? null;
      changed = true;
    }
  }
  if (changed) saveRegistry();
}

function uptimeMs(): number {
  return Date.now() - startedAt;
}

/**
 * Asks one connection for a decision, resolving with `fallback` when the
 * timeout passes or the request cannot be delivered. The request lives in
 * `pendingUI` until the matching `ui.response`.
 */
function requestUI(
  ws: any,
  sessionId: string | undefined,
  method: UIMethod,
  params: Record<string, unknown>,
  fallback: unknown,
  timeoutMs = UI_REQUEST_TIMEOUT_MS,
): Promise<unknown> {
  const id = `u${++uiSeq}`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingUI.delete(id);
      resolve(fallback);
    }, timeoutMs);
    pendingUI.set(id, { resolve, timer });
    send(ws, makeUIRequest(id, method, params, timeoutMs, sessionId));
  });
}

function resolveUIResponse(message: Envelope): void {
  const entry = pendingUI.get(String(message.id));
  if (!entry) return;
  pendingUI.delete(String(message.id));
  clearTimeout(entry.timer);
  const payload = (message.payload ?? {}) as UIResponsePayload;
  entry.resolve(payload.ok ? payload.result : undefined);
}

/** Records a method the shell cannot show, so it is never silently dropped. */
function unsupported(sessionId: string | undefined, method: string): void {
  console.warn(`[zu] extension UI method not supported: ${method}`);
  emit("ui.unsupported", { method }, sessionId);
}

function unsubscribeAll(): void {
  for (const entry of pendingUI.values()) {
    clearTimeout(entry.timer);
    entry.resolve(undefined);
  }
  pendingUI.clear();
}

/**
 * The pi UI context bound to one session. Dialogs go to the shell as
 * `ui.request`; notification, status and title are events; every method the
 * shell does not implement is logged and announced, never a silent no-op.
 */
function createUIContext(rec: Rec): ExtensionUIContext {
  const ask = (method: UIMethod, params: Record<string, unknown>, fallback: unknown, timeout?: number) =>
    requestUI(rec.client, rec.id, method, params, fallback, timeout);

  const noop = (method: string) => (..._args: unknown[]) => {
    unsupported(rec.id, method);
    return undefined;
  };

  return {
    select: (title, options, opts) =>
      ask("select", { title, options }, undefined, opts?.timeout) as Promise<string | undefined>,
    confirm: (title, message, opts) =>
      ask("confirm", { title, message }, false, opts?.timeout) as Promise<boolean>,
    input: (title, placeholder, opts) =>
      ask("input", { title, placeholder }, undefined, opts?.timeout) as Promise<string | undefined>,
    editor: (title, prefill) =>
      ask("editor", { title, prefill }, undefined, UI_REQUEST_TIMEOUT_MS * 2) as Promise<string | undefined>,
    notify: (message, type = "info") => {
      emit("ui.notify", { message, type }, rec.id);
    },
    setStatus: (key, text) => {
      emit("ui.status", { key, text }, rec.id);
    },
    setTitle: (title) => {
      emit("ui.title", { title }, rec.id);
    },
    setWorkingMessage: noop("setWorkingMessage"),
    setWorkingVisible: noop("setWorkingVisible"),
    setWorkingIndicator: noop("setWorkingIndicator"),
    setHiddenThinkingLabel: noop("setHiddenThinkingLabel"),
    setWidget: noop("setWidget"),
    setFooter: noop("setFooter"),
    setHeader: noop("setHeader"),
    custom: noop("custom"),
    pasteToEditor: noop("pasteToEditor"),
    setEditorText: noop("setEditorText"),
    addAutocompleteProvider: noop("addAutocompleteProvider"),
    setEditorComponent: noop("setEditorComponent"),
    onTerminalInput: () => {
      unsupported(rec.id, "onTerminalInput");
      return () => {};
    },
    getEditorText: () => {
      unsupported(rec.id, "getEditorText");
      return "";
    },
    getEditorComponent: () => {
      unsupported(rec.id, "getEditorComponent");
      return undefined;
    },
    getToolsExpanded: () => false,
    setToolsExpanded: noop("setToolsExpanded"),
    getAllThemes: () => [],
    getTheme: () => {
      unsupported(rec.id, "getTheme");
      return undefined;
    },
    setTheme: () => {
      unsupported(rec.id, "setTheme");
      return { success: false, error: "the shell owns its theme" };
    },
    theme: undefined as any,
  } as ExtensionUIContext;
}

/** One session's pi events, projected onto the wire events. */
function subscribe(rec: Rec): void {
  rec.session.subscribe((event: any) => {
    const sessionId = rec.id;
    switch (event.type) {
      case "message_update": {
        const update = event.assistantMessageEvent;
        if (update?.type === "text_delta" && update.delta) {
          emit("message.delta", { delta: update.delta }, sessionId);
        }
        break;
      }
      case "message_end": {
        const message = plain(event.message);
        // System messages carry pi's prompt; the transcript has none.
        if (message.role === "system") break;
        notePath(rec);
        emit("message.complete", message, sessionId);
        break;
      }
      case "agent_start":
        emit("agent.state", { state: "running" }, sessionId);
        break;
      case "agent_settled": {
        // A durable mark of the run's end, written where pi keeps the
        // transcript: pi's own loader reads it, its context ignores it, and
        // a CLI sees the entry. Q10's mechanism, used from M1 on.
        try {
          rec.manager.appendCustomEntry("zu.turn", { at: Date.now() });
        } catch {
          // A read-only or already-closed session: the turn itself stands.
        }
        notePath(rec);
        finishRun(rec);
        emit("agent.state", { state: "idle" }, sessionId);
        // The context gauge moves with every turn; push it with the turn's
        // end so an idle composer does not need to poll.
        const contextUsage = contextUsageData(rec);
        if (contextUsage) emit("session.info", { contextUsage }, sessionId);
        break;
      }
      case "agent_end":
        // Not the end of the turn: retries, compaction and steering may follow.
        break;
      case "tool_execution_start":
        emit("tool.start", { toolName: event.toolName ?? "tool", toolCallId: event.toolCallId }, sessionId);
        break;
      case "tool_execution_update":
        emit("tool.update", { toolName: event.toolName ?? "tool", toolCallId: event.toolCallId }, sessionId);
        break;
      case "tool_execution_end":
        emit(
          "tool.end",
          { toolName: event.toolName ?? "tool", toolCallId: event.toolCallId, isError: !!event.isError },
          sessionId,
        );
        break;
      case "queue_update":
        emit("queue.update", { steering: event.steering ?? [], followUp: event.followUp ?? [] }, sessionId);
        break;
      case "compaction_start":
        emit("compaction.start", { reason: event.reason }, sessionId);
        break;
      case "compaction_end":
        emit(
          "compaction.end",
          {
            reason: event.reason,
            aborted: event.aborted,
            willRetry: event.willRetry,
            errorMessage: event.errorMessage,
          },
          sessionId,
        );
        break;
      case "auto_retry_start":
        emit(
          "retry.start",
          {
            attempt: event.attempt,
            maxAttempts: event.maxAttempts,
            delayMs: event.delayMs,
            errorMessage: event.errorMessage,
          },
          sessionId,
        );
        break;
      case "auto_retry_end":
        emit(
          "retry.end",
          { attempt: event.attempt, success: event.success, finalError: event.finalError },
          sessionId,
        );
        break;
      case "session_info_changed":
        rec.name = event.name;
        if (rec.containerId) noteContainerSession(rec);
        emit("session.info", { name: event.name }, sessionId);
        break;
      case "thinking_level_changed":
        emit("session.info", { thinkingLevel: event.level }, sessionId);
        break;
      case "entry_appended": {
        // A model change is a durable session entry (pi writes it before the
        // model-select event); tell the composer so its name follows.
        if (event.entry?.type !== "model_change") break;
        const model = modelData(rec);
        if (model) emit("session.info", { model, thinkingLevel: String(rec.session.thinkingLevel ?? "off") }, sessionId);
        break;
      }
      case "extension_error":
        emit("error", { message: String(event.error ?? "extension error") }, sessionId);
        break;
      default:
        break;
    }
  });
}

/** A created session's file appears only after its first message. */
function notePath(rec: Rec): void {
  const path = rec.manager.getSessionFile() ?? "";
  const changed = !!path && path !== rec.path;
  if (changed) rec.path = path;
  if (changed) noteContainerSession(rec);
  if (changed) emit("session.info", { path }, rec.id);
}

/** The trust decision a session's project resources need, persisted by pi. */
async function resolveTrust(ws: any, cwd: string): Promise<boolean> {
  const saved = trustStore.get(cwd);
  if (saved !== null) return saved;
  const choice = await requestUI(
    ws,
    undefined,
    "select",
    {
      title: `Trust ${cwd}?`,
      description:
        "This folder has project-local pi resources. Trusting it lets them load; Zu records the decision in pi's trust store.",
      options: [TRUST_YES, TRUST_NO],
    },
    TRUST_NO,
  );
  const trusted = choice === TRUST_YES;
  trustStore.set(cwd, trusted);
  return trusted;
}

/**
 * Creates pi's services for one cwd, resolving project trust through the
 * shell before project-local extensions and settings load (Q23/Q33).
 */
async function services(cwd: string, ws: any, extensionFactories: any[] = []) {
  const needsTrust = hasTrustRequiringProjectResources(cwd);
  const projectTrusted = !needsTrust || trustStore.get(cwd) === true;
  const settingsManager = SettingsManager.create(cwd, AGENT_DIR, { projectTrusted });
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir: AGENT_DIR,
    settingsManager,
    additionalExtensionPaths: extraExtensionPaths,
    extensionFactories,
    noExtensions: process.env.ZU_NO_EXTENSIONS === "1",
  });
  await resourceLoader.reload(
    needsTrust && !projectTrusted
      ? {
          resolveProjectTrust: async () => resolveTrust(ws, cwd),
        }
      : undefined,
  );
  return { settingsManager, resourceLoader };
}

async function makeRecord(manager: SessionManager, ws: any, cwd: string): Promise<Rec> {
  const id = manager.getSessionId();
  const { settingsManager, resourceLoader } = await services(cwd, ws, [dispatchExtension(subagents, id)]);
  const created = await createAgentSession({
    sessionManager: manager,
    settingsManager,
    resourceLoader,
    cwd,
    // The shared registry, awaited: the session's model, its picker and the
    // CLI all come from one catalog.
    modelRuntime: await modelRegistry,
  });
  const storedPath = manager.getSessionFile() ?? "";
  const rec: Rec = {
    id,
    // A newly created session has a path before pi has written the file; the
    // registry and the view keep it empty until the first message, so a
    // restart never tries to open a file that does not exist.
    path: storedPath && existsSync(storedPath) ? storedPath : "",
    cwd,
    manager,
    session: created.session,
    client: ws,
    name: manager.getSessionName(),
    lastUsed: Date.now(),
    extensions: {
      extensions: created.extensionsResult.extensions.map((extension) => ({
        path: extension.path,
        hidden: !!extension.hidden,
      })),
      errors: created.extensionsResult.errors.map((failure) => ({
        path: failure.path,
        error: String(failure.error),
      })),
    },
  };
  rec.containerId = containerForSessionPathOrId(id, rec.path)?.id;
  open.set(id, rec);
  subscribe(rec);
  try {
    await created.session.bindExtensions({
      uiContext: createUIContext(rec),
      mode: "rpc",
      abortHandler: () => {
        void created.session.abort();
      },
      onError: (failure) => {
        emit("error", { message: `${failure.event}: ${String(failure.error)}` }, id);
      },
    });
  } catch (failure: any) {
    emit("error", { message: String(failure?.message ?? failure) }, id);
  }
  evictSessions(id);
  return rec;
}

async function openSession(path: string, ws: any) {
  for (const rec of open.values()) {
    if (rec.path === path) {
      rec.client = ws;
      touch(rec);
      return rec;
    }
  }
  const manager = SessionManager.open(path);
  return makeRecord(manager, ws, manager.getCwd());
}

async function createSession(cwd: string, ws: any) {
  const manager = SessionManager.create(cwd);
  return makeRecord(manager, ws, cwd);
}

/** The kinds a container may be; only `Pi` gets a captain session. */
const CONTAINER_KINDS: ContainerKind[] = ["Pi", "Terminal", "Claude", "Codex", "Copilot"];

function isExternalKind(kind: ContainerKind): boolean {
  return kind !== "Pi";
}

/**
 * The single entry that creates a container. A `Pi` container gets its
 * captain session; an external one (a terminal or an agent TUI) is a
 * persisted registry record only — its PTY lives in the native module and
 * is deliberately volatile (restarting the app restarts the shell).
 */
async function createContainer(
  cwd: string,
  ws: any,
  projectId: string | null = null,
  kind: ContainerKind = "Pi",
): Promise<ContainerData> {
  const project = projectId ? findProject(projectId) : undefined;
  if (projectId && !project) throw new Error("project not found");
  const targetCwd = project ? primaryRoot(project).path : cwd;
  const now = Date.now();
  if (isExternalKind(kind)) {
    // External containers have no pi session and no session file: the PTY
    // is their only member, and it is owned by the native module. The cwd is
    // where that process starts, so it must exist now.
    if (!existsSync(targetCwd) || !statSync(targetCwd).isDirectory()) {
      throw new Error(`cwd is not a directory: ${targetCwd}`);
    }
    const container: ContainerRecord = {
      id: `external:${kind.toLowerCase()}:${randomUUID()}`,
      kind,
      cwd: targetCwd,
      archived: false,
      createdAt: now,
      updatedAt: now,
      sessions: [],
    };
    registry.containers.push(container);
    registry.activeContainerId = container.id;
    saveRegistry();
    if (projectId) projectsFile.membership[container.id] = projectId;
    else delete projectsFile.membership[container.id];
    saveProjects();
    return { container: containerView(container) };
  }
  const rec = await createSession(targetCwd, ws);
  const container: ContainerRecord = {
    id: `pi:${rec.id}`,
    kind: "Pi",
    cwd: targetCwd,
    archived: false,
    createdAt: now,
    updatedAt: now,
    sessions: [{ sessionId: rec.id, path: rec.path, name: rec.name }],
  };
  registry.containers.push(container);
  registry.activeContainerId = container.id;
  rec.containerId = container.id;
  saveRegistry();
  if (projectId) projectsFile.membership[container.id] = projectId;
  else delete projectsFile.membership[container.id];
  saveProjects();
  return { container: containerView(container), session: sessionData(rec) };
}

function setActiveContainer(id: string | null): void {
  registry.activeContainerId = id;
  saveRegistry();
}

/** Makes a container active; the shell restores its layout from `layout.get`. */
function showContainer(id: string): ContainerRecord | undefined {
  const container = findContainer(id);
  if (!container || container.archived) return undefined;
  setActiveContainer(container.id);
  return containerView(container);
}

/** Adds a pi session file to a container; a session lives in one container. */
async function attachSession(containerId: string, path: string, ws: any): Promise<ContainerData> {
  const container = findContainer(containerId);
  if (!container || container.archived) throw new Error("container not found or archived");
  if (container.kind !== "Pi") throw new Error("an external container holds no pi sessions");
  const rec = await openSession(path, ws);
  const previous = containerForSession(rec.id);
  if (previous && previous.id !== container.id) {
    if (previous.sessions[0]?.sessionId === rec.id) {
      throw new Error("the captain of another container cannot be moved");
    }
    previous.sessions = previous.sessions.filter((session) => session.sessionId !== rec.id);
    previous.updatedAt = Date.now();
  }
  if (!container.sessions.some((session) => session.sessionId === rec.id)) {
    container.sessions.push({ sessionId: rec.id, path: rec.path, name: rec.name });
  }
  container.updatedAt = Date.now();
  rec.containerId = container.id;
  saveRegistry();
  return { container: containerView(container), session: sessionData(rec) };
}

function nextActiveContainer(): string | null {
  return (
    registry.containers
      .filter((container) => !container.archived)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0]?.id ?? null
  );
}

/**
 * The one teardown path: archive flips `alive()` false, aborts and disposes
 * every engine session of the container and drops its live runs. The record,
 * its session files and its layout stay, so unarchive finds them again.
 */
async function setArchived(id: string, archived: boolean): Promise<ContainerListData> {
  const container = findContainer(id);
  if (!container) throw new Error("container not found");
  container.archived = archived;
  container.updatedAt = Date.now();
  if (archived) {
    for (const session of container.sessions) {
      await subagents.archiveCaptain(session.sessionId);
      const rec = open.get(session.sessionId);
      if (rec) {
        if (rec.session.isStreaming) {
          try {
            await rec.session.abort();
          } catch {
            // A dead session is already gone.
          }
        }
        try {
          rec.session.dispose();
        } catch {
          // Already disposed.
        }
        open.delete(rec.id);
      }
      registry.runs = registry.runs.filter((run) => run.sessionId !== session.sessionId);
    }
    if (registry.activeContainerId === id) registry.activeContainerId = nextActiveContainer();
  }
  saveRegistry();
  return {
    containers: registry.containers.map(containerView),
    activeContainerId: registry.activeContainerId,
  };
}

function startRun(rec: Rec): void {
  if (rec.runId) return;
  const run = {
    id: `run-${++runSeq}`,
    containerId: rec.containerId ?? "",
    sessionId: rec.id,
    startedAt: Date.now(),
  };
  rec.runId = run.id;
  registry.runs = [...registry.runs.filter((entry) => entry.sessionId !== rec.id), run];
  saveRegistry();
}

function finishRun(rec: Rec): void {
  if (!rec.runId) return;
  rec.runId = undefined;
  registry.runs = registry.runs.filter((run) => run.sessionId !== rec.id);
  saveRegistry();
}

/**
 * The newest mtime under pi's session directory (directories included, so a
 * created or deleted file moves the watermark). The index below re-parses
 * only when this changes; 660+ sessions otherwise come from the cache.
 */
let sessionIndex: { watermark: number; sessions: SessionMeta[] } | null = null;

function sessionWatermark(): number {
  let newest = 0;
  const visit = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
      newest = Math.max(newest, statSync(dir).mtimeMs);
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(path);
      } else {
        try {
          newest = Math.max(newest, statSync(path).mtimeMs);
        } catch {
          // A file removed while walking: the directory mtime already moved.
        }
      }
    }
  };
  visit(join(AGENT_DIR, "sessions"));
  return newest;
}

async function listSessions(): Promise<SessionMeta[]> {
  const watermark = sessionWatermark();
  if (sessionIndex && sessionIndex.watermark === watermark) return sessionIndex.sessions;
  const infos = await SessionManager.listAll();
  infos.sort((a, b) => +new Date(b.modified) - +new Date(a.modified));
  const sessions = infos.slice(0, 2000).map((info) => ({
    id: info.id,
    path: info.path,
    cwd: info.cwd,
    name: info.name ?? "",
    created: +new Date(info.created),
    modified: +new Date(info.modified),
    messageCount: info.messageCount,
    preview: (info.firstMessage ?? "").slice(0, 160),
  }));
  sessionIndex = { watermark, sessions };
  return sessions;
}

/**
 * The open record for a command. A container session evicted by the LRU is
 * rehydrated from its file on demand, so a sheet the shell kept can prompt
 * again without reopening it explicitly.
 */
async function requireSession(
  ws: any,
  message: Envelope,
  payload: Record<string, any>,
): Promise<Rec | undefined> {
  const id = String(payload.sessionId ?? "");
  let rec = open.get(id);
  if (!rec) {
    const stored = registrySession(id);
    if (stored && !stored.container.archived && stored.path) {
      try {
        rec = await openSession(stored.path, ws);
      } catch {
        rec = undefined;
      }
    }
  }
  if (!rec) {
    reply(ws, makeErrorReply(String(message.id), message.type, "session not open", "session_not_open"));
    return undefined;
  }
  rec.client = ws;
  touch(rec);
  return rec;
}

async function handle(ws: any, message: Envelope): Promise<void> {
  if (message.type === "hello") {
    if (message.token !== TOKEN) {
      send(ws, { v: PROTOCOL_VERSION, type: "error", payload: { code: "bad_token", message: "bad token" } });
      ws.close();
      return;
    }
    if (message.v !== PROTOCOL_VERSION) {
      send(ws, {
        v: PROTOCOL_VERSION,
        type: "error",
        payload: {
          code: "protocol_mismatch",
          message: `protocol v${String(message.v)} does not match v${PROTOCOL_VERSION}`,
        },
      });
      ws.close();
      return;
    }
    send(ws, makeWelcome({ protocol: PROTOCOL_VERSION, pi: PI_VERSION, generation, pid: process.pid, startedAt }));
    return;
  }

  if (message.type === "ui.response") {
    resolveUIResponse(message);
    return;
  }

  const invalid = validateCommand(message);
  if (invalid) {
    reply(ws, makeErrorReply(String(message.id ?? ""), message.type, invalid.message, invalid.code));
    return;
  }

  const payload = (message.payload ?? {}) as Record<string, any>;
  const id = String(message.id);

  switch (message.type) {
    case "engine.ping": {
      reply(ws, makeReply(id, message.type, { at: Date.now() }));
      return;
    }
    case "engine.info": {
      reply(ws, makeReply(id, message.type, { ...snapshot(), uptimeMs: uptimeMs(), sessions: open.size }));
      return;
    }
    case "engine.health": {
      reply(
        ws,
        makeReply(id, message.type, { at: Date.now(), generation, uptimeMs: uptimeMs(), sessions: open.size }),
      );
      return;
    }
    case "project.list": {
      reply(ws, makeReply(id, message.type, projectsData()));
      return;
    }
    case "project.create": {
      try {
        const project = createProject({
          name: payload.name === undefined ? undefined : String(payload.name),
          roots: Array.isArray(payload.roots) ? payload.roots : [],
        });
        reply(ws, makeReply(id, message.type, projectsData(project)));
      } catch (error: any) {
        reply(ws, makeErrorReply(id, message.type, String(error?.message ?? error), "project_create_failed"));
      }
      return;
    }
    case "project.update": {
      const project = findProject(String(payload.projectId ?? ""));
      if (!project) {
        reply(ws, makeErrorReply(id, message.type, "project not found", "project_not_found"));
        return;
      }
      try {
        const updated = updateProject(project, {
          name: payload.name === undefined ? undefined : String(payload.name),
          roots: Array.isArray(payload.roots) ? payload.roots : undefined,
        });
        reply(ws, makeReply(id, message.type, projectsData(updated)));
      } catch (error: any) {
        reply(ws, makeErrorReply(id, message.type, String(error?.message ?? error), "project_update_failed"));
      }
      return;
    }
    case "container.list": {
      const data: ContainerListData = {
        containers: registry.containers.map(containerView),
        activeContainerId: registry.activeContainerId,
      };
      reply(ws, makeReply(id, message.type, data));
      return;
    }
    case "container.create": {
      try {
        const requested = payload.kind === undefined ? "Pi" : String(payload.kind);
        if (!CONTAINER_KINDS.includes(requested as ContainerKind)) {
          throw new Error(`unknown container kind: ${requested}`);
        }
        const kind = requested as ContainerKind;
        const projectId = payload.projectId === null ? null : payload.projectId ? String(payload.projectId) : null;
        const project = projectId ? findProject(projectId) : undefined;
        if (projectId && !project) throw new Error("project not found");
        const active = registry.activeContainerId ? findContainer(registry.activeContainerId) : undefined;
        const cwd = project
          ? primaryRoot(project).path
          : String(payload.cwd ?? active?.cwd ?? process.cwd());
        reply(ws, makeReply(id, message.type, await createContainer(cwd, ws, projectId, kind)));
      } catch (error: any) {
        reply(ws, makeErrorReply(id, message.type, String(error?.message ?? error), "container_create_failed"));
      }
      return;
    }
    case "container.show": {
      const container = showContainer(String(payload.containerId ?? ""));
      if (!container) {
        reply(ws, makeErrorReply(id, message.type, "container not found or archived", "container_not_found"));
        return;
      }
      reply(ws, makeReply(id, message.type, { container }));
      return;
    }
    case "container.attachSession": {
      try {
        const data = await attachSession(
          String(payload.containerId ?? ""),
          String(payload.path ?? ""),
          ws,
        );
        reply(ws, makeReply(id, message.type, data));
      } catch (error: any) {
        reply(ws, makeErrorReply(id, message.type, String(error?.message ?? error), "container_attach_failed"));
      }
      return;
    }
    case "container.archive":
    case "container.unarchive": {
      try {
        const data = await setArchived(String(payload.containerId ?? ""), message.type === "container.archive");
        reply(ws, makeReply(id, message.type, data));
      } catch (error: any) {
        reply(ws, makeErrorReply(id, message.type, String(error?.message ?? error), "container_archive_failed"));
      }
      return;
    }
    case "layout.get": {
      reply(ws, makeReply(id, message.type, readLayout(String(payload.containerId ?? ""))));
      return;
    }
    case "layout.put": {
      const containerId = String(payload.containerId ?? "");
      const layout = payload.layout;
      if (!layout || typeof layout !== "object" || Array.isArray(layout)) {
        reply(ws, makeErrorReply(id, message.type, "layout must be an object", "bad_payload"));
        return;
      }
      const zoom = payload.zoom === null || typeof payload.zoom === "string" ? payload.zoom : null;
      reply(ws, makeReply(id, message.type, writeLayout(containerId, layout, zoom)));
      return;
    }
    case "settings.get": {
      reply(ws, makeReply(id, message.type, readSettings()));
      return;
    }
    case "settings.put": {
      const patch: Record<string, unknown> = {};
      if (payload.sidebarWidth !== undefined) {
        const width = Number(payload.sidebarWidth);
        // The shell clamps too; the file never holds an unusable number.
        if (!Number.isFinite(width)) {
          reply(ws, makeErrorReply(id, message.type, "sidebarWidth must be a number", "bad_payload"));
          return;
        }
        patch.sidebarWidth = Math.min(360, Math.max(200, Math.round(width)));
      }
      reply(ws, makeReply(id, message.type, writeSettings(patch)));
      return;
    }
    case "state.snapshot": {
      reply(ws, makeReply(id, message.type, snapshot()));
      return;
    }
    case "state.subscribe": {
      subscribers.add(ws);
      reply(ws, makeReply(id, message.type, snapshot()));
      return;
    }
    case "session.list": {
      try {
        reply(ws, makeReply(id, message.type, { sessions: await listSessions() }));
      } catch (error: any) {
        reply(ws, makeErrorReply(id, message.type, String(error?.message ?? error), "list_failed"));
      }
      return;
    }
    case "session.create": {
      try {
        const rec = await createSession(String(payload.cwd ?? process.cwd()), ws);
        reply(ws, makeReply(id, message.type, sessionData(rec)));
      } catch (error: any) {
        reply(ws, makeErrorReply(id, message.type, String(error?.message ?? error), "create_failed"));
      }
      return;
    }
    case "session.open": {
      try {
        const rec = await openSession(String(payload.path ?? ""), ws);
        reply(ws, makeReply(id, message.type, sessionData(rec)));
      } catch (error: any) {
        reply(ws, makeErrorReply(id, message.type, String(error?.message ?? error), "open_failed"));
      }
      return;
    }
    case "session.info": {
      const rec = await requireSession(ws, message, payload);
      if (!rec) return;
      reply(ws, makeReply(id, message.type, sessionInfo(rec)));
      return;
    }
    case "session.extensions": {
      const rec = await requireSession(ws, message, payload);
      if (!rec) return;
      reply(ws, makeReply(id, message.type, rec.extensions));
      return;
    }
    case "session.tools": {
      const rec = await requireSession(ws, message, payload);
      if (!rec) return;
      reply(
        ws,
        makeReply(id, message.type, {
          tools: rec.session.getAllTools().map((tool: any) => String(tool.name ?? tool)),
        }),
      );
      return;
    }
    case "session.models": {
      const rec = await requireSession(ws, message, payload);
      if (!rec) return;
      try {
        reply(ws, makeReply(id, message.type, await modelsData(rec, payload.refresh === true)));
      } catch (error: any) {
        reply(ws, makeErrorReply(id, message.type, String(error?.message ?? error), "models_failed"));
      }
      return;
    }
    case "session.setModel": {
      const rec = await requireSession(ws, message, payload);
      if (!rec) return;
      const provider = String(payload.provider ?? "");
      const modelId = String(payload.id ?? "");
      if (!provider || !modelId) {
        reply(ws, makeErrorReply(id, message.type, "provider and id are required", "bad_payload"));
        return;
      }
      try {
        const runtime: any = rec.session.modelRuntime;
        const model = runtime?.getModel?.(provider, modelId);
        if (!model) {
          reply(ws, makeErrorReply(id, message.type, `unknown model ${provider}/${modelId}`, "model_not_found"));
          return;
        }
        await rec.session.setModel(model);
        reply(ws, makeReply(id, message.type, sessionInfo(rec)));
      } catch (error: any) {
        reply(ws, makeErrorReply(id, message.type, String(error?.message ?? error), "set_model_failed"));
      }
      return;
    }
    case "session.setThinking": {
      const rec = await requireSession(ws, message, payload);
      if (!rec) return;
      const level = String(payload.level ?? "");
      try {
        rec.session.setThinkingLevel(level as any);
        reply(ws, makeReply(id, message.type, sessionInfo(rec)));
      } catch (error: any) {
        reply(ws, makeErrorReply(id, message.type, String(error?.message ?? error), "set_thinking_failed"));
      }
      return;
    }
    case "session.compact": {
      const rec = await requireSession(ws, message, payload);
      if (!rec) return;
      if (rec.session.isStreaming) {
        reply(ws, makeErrorReply(id, message.type, "session is streaming; try again when idle", "session_busy"));
        return;
      }
      reply(ws, makeReply(id, message.type, { started: true }));
      const instructions = payload.instructions === undefined ? undefined : String(payload.instructions);
      void rec.session
        .compact(instructions)
        .catch((error: any) => {
          emit("error", { message: String(error?.message ?? error) }, rec.id);
          emit("compaction.end", { reason: "manual", aborted: true, willRetry: false, errorMessage: String(error?.message ?? error) }, rec.id);
        });
      return;
    }
    case "subagent.list": {
      reply(
        ws,
        makeReply(id, message.type, {
          runs: subagents.list({
            containerId: payload.containerId === undefined ? undefined : String(payload.containerId),
            captainId: payload.captainId === undefined ? undefined : String(payload.captainId),
          }),
        }),
      );
      return;
    }
    case "subagent.transcript": {
      try {
        reply(ws, makeReply(id, message.type, subagents.transcript(String(payload.runId ?? ""))));
      } catch (error: any) {
        reply(ws, makeErrorReply(id, message.type, String(error?.message ?? error), "subagent_not_found"));
      }
      return;
    }
    case "subagent.dispatch": {
      try {
        const captainId = String(payload.captainId ?? "");
        const task = String(payload.task ?? "");
        if (!task) throw new Error("task is required");
        const run = payload.runId
          ? subagents.resume(captainId, String(payload.runId), task)
          : subagents.spawn(captainId, String(payload.agent ?? "worker"), task);
        reply(ws, makeReply(id, message.type, { run }));
      } catch (error: any) {
        reply(ws, makeErrorReply(id, message.type, String(error?.message ?? error), "subagent_dispatch_failed"));
      }
      return;
    }
    case "subagent.abort": {
      try {
        await subagents.abort(String(payload.runId ?? ""));
        reply(ws, makeReply(id, message.type, {}));
      } catch (error: any) {
        reply(ws, makeErrorReply(id, message.type, String(error?.message ?? error), "subagent_abort_failed"));
      }
      return;
    }
    case "session.prompt": {
      const rec = await requireSession(ws, message, payload);
      if (!rec) return;
      reply(ws, makeReply(id, message.type, { accepted: true }));
      startRun(rec);
      // Not awaited: events stream while the run continues.
      void rec.session.prompt(String(payload.text ?? "")).catch((error: any) => {
        finishRun(rec);
        emit("error", { message: String(error?.message ?? error) }, rec.id);
        emit("agent.state", { state: "idle" }, rec.id);
      });
      return;
    }
    case "session.steer":
    case "session.followUp": {
      const rec = await requireSession(ws, message, payload);
      if (!rec) return;
      if (!rec.session.isStreaming) {
        reply(
          ws,
          makeErrorReply(id, message.type, "session is idle; use session.prompt", "session_idle"),
        );
        return;
      }
      const behavior = message.type === "session.steer" ? "steer" : "followUp";
      reply(ws, makeReply(id, message.type, { accepted: true }));
      startRun(rec);
      void rec.session.prompt(String(payload.text ?? ""), { streamingBehavior: behavior }).catch((error: any) => {
        finishRun(rec);
        emit("error", { message: String(error?.message ?? error) }, rec.id);
      });
      return;
    }
    case "session.abort": {
      const rec = await requireSession(ws, message, payload);
      if (!rec) return;
      await rec.session.abort();
      finishRun(rec);
      // The aborted run may not settle; the shell's streaming state follows this.
      emit("agent.state", { state: "idle" }, rec.id);
      reply(ws, makeReply(id, message.type, {}));
      return;
    }
    case "session.close": {
      const sid = String(payload.sessionId ?? "");
      const rec = open.get(sid);
      if (rec) {
        if (rec.session.isStreaming) await rec.session.abort();
        finishRun(rec);
        rec.session.dispose();
        open.delete(sid);
      }
      reply(ws, makeReply(id, message.type, {}));
      return;
    }
    default: {
      // validateCommand already rejected unknown names; this keeps the
      // switch exhaustive if a command is added to the table but not here.
      reply(ws, makeErrorReply(id, message.type, `unhandled command ${message.type}`, "unhandled_command"));
    }
  }
}

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: PORT,
  fetch(request, srv) {
    if (srv.upgrade(request, { data: {} })) return undefined;
    return new Response("zu engine");
  },
  websocket: {
    open(_ws) {},
    message(ws, raw) {
      const message = parseEnvelope(String(raw));
      if (!message) {
        send(ws, { v: PROTOCOL_VERSION, type: "error", payload: { code: "bad_json", message: "bad json" } });
        return;
      }
      void handle(ws, message);
    },
    close(ws) {
      subscribers.delete(ws);
    },
  },
});

const portFile = join(stateDir(), "engine.port");
try {
  mkdirSync(dirname(portFile), { recursive: true });
  writeFileSync(portFile, String(server.port));
} catch {
  // A read-only state directory: the caller's ZU_PORT is the answer.
}
console.log(`zu-engine v${PROTOCOL_VERSION} generation ${generation} listening on 127.0.0.1:${server.port} (pi ${PI_VERSION})`);

/** 5000 ms; the shell treats 15 s without one as a dead engine. */
setInterval(() => {
  emit("engine.heartbeat", { at: Date.now(), generation, uptimeMs: uptimeMs(), sessions: open.size });
}, 5000);

// The host owns this process. If it goes away without stopping us (a crash,
// a force quit), exit: an orphan would hold the port and the session files.
const parent = process.ppid;
setInterval(() => {
  if (process.ppid !== parent) shutdown(0);
}, 1000);

function shutdown(code: number): void {
  subagents.dispose();
  for (const rec of open.values()) {
    try {
      rec.session.dispose();
    } catch {
      // Already disposed.
    }
  }
  unsubscribeAll();
  process.exit(code);
}

// A signal from the host ends the process cleanly.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => shutdown(0));
}

/**
 * The persisted generation counter. It lives beside the log and the token;
 * a failed write degrades to a process-local generation rather than keeping
 * the engine from starting.
 */
function nextGeneration(): number {
  const path = join(stateDir(), "engine.generation");
  let previous = 0;
  try {
    const stored = Number.parseInt(readFileSync(path, "utf8").trim(), 10);
    if (Number.isFinite(stored) && stored >= 0) previous = stored;
  } catch {
    // First start: no counter yet.
  }
  const next = previous + 1;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, String(next));
  } catch {
    // A read-only state directory: this generation is process-local.
  }
  return next;
}
