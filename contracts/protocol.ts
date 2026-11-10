/**
 * The wire contract between the shell (TSX) and the engine (Bun sidecar).
 *
 * This module is the single shared surface: both sides import these types,
 * the command table and the envelope constructors. The engine validates
 * every command against the table before running it; `protocol.md` is the
 * prose half of the same contract.
 *
 * Envelope, v1:
 *
 *   command   { v, id, sessionId?, type, payload? }
 *   reply     { v, id, type: "reply", payload: { command, ok, data?, error?, code? } }
 *   event     { v, type, sessionId?, data? }
 *   ui.request  { v, id, type: "ui.request", sessionId?, data: { method, params?, timeoutMs? } }
 *   ui.response { v, id, type: "ui.response", payload: { ok, result?, error? } }
 *
 * `id` is the sender's correlation id: a command's reply repeats it, and an
 * extension UI request's response repeats it. Every message names the
 * protocol version; a peer on another version is rejected, never guessed at.
 */

/** The protocol this build speaks. Bump it only for an incompatible change. */
export const PROTOCOL_VERSION = 1;

export type CommandGroup = "engine" | "session" | "subagent" | "state" | "container" | "project" | "layout" | "ui";

/**
 * What replaying the same command envelope means:
 *
 * - `safe`: the same result, no extra effect (read-only or idempotent);
 * - `duplicate`: the effect happens again (a prompt, a new session);
 * - `ignored`: a second copy is dropped (a UI response already matched).
 */
export type ReplaySemantics = "safe" | "duplicate" | "ignored";

export interface CommandSpec {
  group: CommandGroup;
  /** Running it twice with the same payload leaves the same state. */
  idempotent: boolean;
  replay: ReplaySemantics;
  /** One line the UI and `protocol.md` use. */
  note: string;
}

/**
 * Every command of v1, by name. Commands are grouped exactly as the
 * architecture doc's table groups them; the grouping is carried in the
 * name too, so a new command cannot land in the wrong family silently.
 */
export const COMMANDS = {
  "engine.ping": { group: "engine", idempotent: true, replay: "safe", note: "Liveness check; the reply is a timestamp." },
  "engine.info": {
    group: "engine",
    idempotent: true,
    replay: "safe",
    note: "Build, protocol and generation of the running engine.",
  },
  "engine.health": {
    group: "engine",
    idempotent: true,
    replay: "safe",
    note: "Health with uptime and open-session count.",
  },
  "session.list": {
    group: "session",
    idempotent: true,
    replay: "safe",
    note: "Every pi session on disk, newest first.",
  },
  "session.create": {
    group: "session",
    idempotent: false,
    replay: "duplicate",
    note: "Creates a new pi session in a cwd; a replay creates another one.",
  },
  "session.open": {
    group: "session",
    idempotent: true,
    replay: "safe",
    note: "Opens a session by file path; the same path yields the same open session.",
  },
  "session.info": {
    group: "session",
    idempotent: true,
    replay: "safe",
    note: "A session's file, name, run state and custom entry types.",
  },
  "session.tools": {
    group: "session",
    idempotent: true,
    replay: "safe",
    note: "The tools registered in a session, including the dispatch tool on a captain.",
  },
  "subagent.list": {
    group: "subagent",
    idempotent: true,
    replay: "safe",
    note: "Live and settled subagent runs of a container or captain.",
  },
  "subagent.transcript": {
    group: "subagent",
    idempotent: true,
    replay: "safe",
    note: "A subagent run's read-only transcript (live from memory, settled from its file).",
  },
  "subagent.dispatch": {
    group: "subagent",
    idempotent: false,
    replay: "duplicate",
    note: "Starts a subagent run, or resumes a settled one by run id.",
  },
  "subagent.abort": {
    group: "subagent",
    idempotent: true,
    replay: "safe",
    note: "Aborts a live subagent run; aborting a settled run is a no-op.",
  },
  "session.extensions": {
    group: "session",
    idempotent: true,
    replay: "safe",
    note: "The extensions loaded into a session, with load errors.",
  },
  "session.prompt": {
    group: "session",
    idempotent: false,
    replay: "duplicate",
    note: "Starts a turn; a replay is another turn, never a retry.",
  },
  "session.steer": {
    group: "session",
    idempotent: false,
    replay: "duplicate",
    note: "Interrupts the running turn with a message; idle is an error.",
  },
  "session.followUp": {
    group: "session",
    idempotent: false,
    replay: "duplicate",
    note: "Queues a message after the running turn; idle is an error.",
  },
  "session.abort": {
    group: "session",
    idempotent: true,
    replay: "safe",
    note: "Stops the running turn; aborting an idle session is a no-op.",
  },
  "session.close": {
    group: "session",
    idempotent: true,
    replay: "safe",
    note: "Drops the engine's in-memory session; the file stays.",
  },
  "project.list": {
    group: "project",
    idempotent: true,
    replay: "safe",
    note: "Projects and the container-to-project membership map.",
  },
  "project.create": {
    group: "project",
    idempotent: false,
    replay: "duplicate",
    note: "Creates a user project from one or more roots, exactly one primary.",
  },
  "project.update": {
    group: "project",
    idempotent: true,
    replay: "safe",
    note: "Renames a project or replaces its roots; container cwds are snapshots and do not move.",
  },
  "project.setMembership": {
    group: "project",
    idempotent: true,
    replay: "safe",
    note: "Puts a container in a project, or in Chats (null); explicit, never inferred from cwd.",
  },
  "container.list": {
    group: "container",
    idempotent: true,
    replay: "safe",
    note: "Every container in the registry, archived ones included, and the active container.",
  },
  "container.create": {
    group: "container",
    idempotent: false,
    replay: "duplicate",
    note: "Creates a pi container and its captain session, or an external kind (Terminal/Claude/Codex/Copilot) with no session; a replay creates another one.",
  },
  "container.show": {
    group: "container",
    idempotent: true,
    replay: "safe",
    note: "Makes a container active; the shell then restores its layout and opens its sessions.",
  },
  "container.attachSession": {
    group: "container",
    idempotent: true,
    replay: "safe",
    note: "Adds a pi session file to a container; a session belongs to one container.",
  },
  "container.archive": {
    group: "container",
    idempotent: true,
    replay: "safe",
    note: "Marks a container archived and tears its engine sessions down; data stays.",
  },
  "container.unarchive": {
    group: "container",
    idempotent: true,
    replay: "safe",
    note: "Brings an archived container back to the list; its layout was never deleted.",
  },
  "layout.get": {
    group: "layout",
    idempotent: true,
    replay: "safe",
    note: "The view stash of a container: DockArea layout and zoomed panel.",
  },
  "layout.put": {
    group: "layout",
    idempotent: true,
    replay: "safe",
    note: "Replaces a container's view stash; last write wins.",
  },
  "state.snapshot": {
    group: "state",
    idempotent: true,
    replay: "safe",
    note: "Containers, open sessions, active runs, unread counts and generation.",
  },
  "state.subscribe": {
    group: "state",
    idempotent: true,
    replay: "safe",
    note: "Starts the event stream for this connection and returns the snapshot.",
  },
} as const satisfies Record<string, CommandSpec>;

export type CommandType = keyof typeof COMMANDS;

/** Every event of v1. Events carry `data`; the envelope carries `sessionId`. */
export const EVENTS = {
  "engine.heartbeat": { scope: "engine", note: "Liveness, generation and open-session count every 5 s." },
  "message.delta": { scope: "session", note: "A streamed text chunk of the assistant's message." },
  "message.complete": { scope: "session", note: "A finished message; the file is the authority." },
  "agent.state": { scope: "session", note: "A turn started (`running`) or settled (`idle`)." },
  "session.info": { scope: "session", note: "The session's name or thinking level changed." },
  "tool.start": { scope: "session", note: "A tool call started." },
  "tool.update": { scope: "session", note: "A tool call produced a partial result." },
  "tool.end": { scope: "session", note: "A tool call finished, successfully or not." },
  "queue.update": { scope: "session", note: "Steering and follow-up queues changed." },
  "compaction.start": { scope: "session", note: "Compaction started (manual, threshold or overflow)." },
  "compaction.end": { scope: "session", note: "Compaction ended; aborted and willRetry say how." },
  "retry.start": { scope: "session", note: "An automatic retry was scheduled." },
  "retry.end": { scope: "session", note: "An automatic retry succeeded or gave up." },
  "ui.request": { scope: "ui", note: "The engine asks the shell for a user decision." },
  "ui.notify": { scope: "ui", note: "An extension notification for the shell's toast stack." },
  "ui.status": { scope: "ui", note: "An extension status line, by key; absent text clears it." },
  "ui.title": { scope: "ui", note: "An extension asked for the window title." },
  "ui.unsupported": { scope: "ui", note: "An extension UI method the shell cannot show; logged, never silent." },
  "subagent.started": { scope: "subagent", note: "A subagent run started (live in memory)." },
  "subagent.settled": { scope: "subagent", note: "A subagent run settled; the run and output are on the wire." },
  "subagent.note": { scope: "subagent", note: "A dispatch/delivery note for the captain's transcript." },
  "error": { scope: "engine", note: "A command or extension failed outside a reply." },
} as const;

export type EventType = keyof typeof EVENTS;

/** The handshake a connection opens with. Not a command: it has no reply. */
export const HANDSHAKE_TYPE = "hello";
/** The engine's handshake answer. */
export const WELCOME_TYPE = "welcome";

export interface Envelope {
  v: number;
  id?: string;
  sessionId?: string;
  type: string;
  payload?: unknown;
  data?: unknown;
  token?: string;
}

export interface ReplyPayload {
  command: string;
  ok: boolean;
  data?: unknown;
  error?: string;
  /** A machine-readable failure (`protocol_mismatch`, `unknown_command`, ...). */
  code?: string;
}

export interface Reply {
  v: number;
  id: string;
  type: "reply";
  payload: ReplyPayload;
}

export interface EventMessage {
  v: number;
  /** A `ui.request` is the one event with a correlation id. */
  id?: string;
  type: string;
  sessionId?: string;
  data?: unknown;
}

export interface WelcomePayload {
  protocol: number;
  pi: string;
  generation: number;
  pid: number;
  startedAt: number;
}

export interface Welcome {
  v: number;
  type: typeof WELCOME_TYPE;
  payload: WelcomePayload;
}

/** The extension UI methods the shell implements. */
export const UI_METHODS = ["confirm", "select", "input", "editor"] as const;
export type UIMethod = (typeof UI_METHODS)[number];

export interface UIRequestPayload {
  method: UIMethod;
  params: Record<string, unknown>;
  timeoutMs: number;
}

export interface UIRequest {
  v: number;
  id: string;
  type: "ui.request";
  sessionId?: string;
  data: UIRequestPayload;
}

export interface UIResponsePayload {
  ok: boolean;
  result?: unknown;
  error?: string;
}

export interface UIResponse {
  v: number;
  id: string;
  type: "ui.response";
  payload: UIResponsePayload;
}

/** How long the shell has to answer an extension UI request by default. */
export const UI_REQUEST_TIMEOUT_MS = 120_000;

/* Payloads and results ---------------------------------------------------- */

export interface SessionMeta {
  id: string;
  path: string;
  cwd: string;
  name: string;
  created: number;
  modified: number;
  messageCount: number;
  preview: string;
}

export interface SessionListData {
  sessions: SessionMeta[];
}

export interface SessionCreatePayload {
  cwd: string;
}

export interface SessionOpenPayload {
  path: string;
}

export interface SessionPromptPayload {
  sessionId: string;
  text: string;
}

export interface SessionIdPayload {
  sessionId: string;
}

export interface PlainMessage {
  role: string;
  text: string;
  at?: number;
}

export interface SessionData {
  id: string;
  path: string;
  cwd: string;
  name?: string;
  containerId?: string;
  messages: PlainMessage[];
  customTypes?: string[];
}

export type SubagentStatus = "running" | "settled" | "failed" | "aborted" | "interrupted";

/** A subagent run: live in memory, settled in registry.subagentRuns. */
export interface SubagentRun {
  runId: string;
  captainId: string;
  containerId: string;
  agent: string;
  task: string;
  status: SubagentStatus;
  startedAt: number;
  settledAt?: number;
  verdict?: string;
  output?: string;
  sessionPath?: string;
}

export interface SubagentListData {
  runs: SubagentRun[];
}

export interface SubagentListPayload {
  containerId?: string;
  captainId?: string;
}

export interface SubagentTranscriptPayload {
  runId: string;
}

export interface SubagentTranscriptData {
  run: SubagentRun;
  messages: PlainMessage[];
}

export interface SubagentDispatchPayload {
  captainId: string;
  agent?: string;
  task?: string;
  runId?: string;
}

export interface ExtensionInfo {
  path: string;
  hidden: boolean;
}

export interface ExtensionErrorInfo {
  path: string;
  error: string;
}

export interface SessionExtensionsData {
  extensions: ExtensionInfo[];
  errors: ExtensionErrorInfo[];
}

export interface OpenSessionInfo {
  sessionId: string;
  path: string;
  cwd: string;
  name?: string;
  containerId?: string;
  running: boolean;
}

/** The kinds a container can be: `Pi` (one captain session) or an external terminal/TUI. */
export type ContainerKind = "Pi" | "Terminal" | "Claude" | "Codex" | "Copilot";

/** One pi session in a container; the captain is `sessions[0]`. */
export interface ContainerSession {
  sessionId: string;
  path: string;
  name?: string;
}

/** A container as the registry stores it (M3's first relational object). */
export interface ContainerRecord {
  id: string;
  kind: ContainerKind;
  cwd: string;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
  sessions: ContainerSession[];
  /** Its project, from the explicit membership map; null is the Chats bucket. */
  projectId?: string | null;
}

/** One root of a project; exactly one root is primary. */
export interface ProjectRoot {
  path: string;
  primary: boolean;
}

/** A user-created project. */
export interface ProjectRecord {
  id: string;
  name: string;
  /** True when the name was given, false while it follows the primary folder. */
  nameOverridden: boolean;
  roots: ProjectRoot[];
  position: number;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectsData {
  projects: ProjectRecord[];
  membership: Record<string, string | null>;
}

export interface ProjectCreatePayload {
  name?: string;
  roots: Array<{ path: string; primary?: boolean }>;
}

export interface ProjectUpdatePayload {
  projectId: string;
  name?: string;
  roots?: Array<{ path: string; primary?: boolean }>;
}

export interface ProjectMembershipPayload {
  containerId: string;
  projectId: string | null;
}

export interface ProjectData extends ProjectsData {
  project: ProjectRecord;
}

/** Kept as the snapshot's name for a container. */
export type ContainerInfo = ContainerRecord;

export interface StateSnapshot {
  generation: number;
  protocol: number;
  pi: string;
  pid: number;
  startedAt: number;
  containers: ContainerRecord[];
  activeContainerId: string | null;
  openSessions: OpenSessionInfo[];
  activeRuns: string[];
  unread: Record<string, number>;
}

export interface ContainerListData {
  containers: ContainerRecord[];
  activeContainerId: string | null;
}

export interface ContainerCreatePayload {
  /** `Pi` when left out; an external kind creates no pi session. */
  kind?: ContainerKind;
  cwd?: string;
  projectId?: string | null;
}

export interface ContainerIdPayload {
  containerId: string;
}

export interface ContainerAttachPayload {
  containerId: string;
  path: string;
}

/** A container command's reply: the record, plus the session it opened. */
export interface ContainerData {
  container: ContainerRecord;
  session?: SessionData;
}

export interface ContainerLayoutData {
  containerId: string;
  layout: unknown | null;
  zoom: string | null;
  updatedAt?: number;
}

export interface ContainerLayoutPutPayload {
  containerId: string;
  layout: unknown;
  zoom: string | null;
}

export interface EngineInfoData extends StateSnapshot {
  uptimeMs: number;
  sessions: number;
}

export interface EngineHealthData {
  at: number;
  generation: number;
  uptimeMs: number;
  sessions: number;
}

export interface AgentStateData {
  state: "running" | "idle";
}

export interface SessionInfoData {
  name?: string;
  thinkingLevel?: string;
  /** The session's file, once pi has written one. */
  path?: string;
}

export interface ToolData {
  toolName: string;
  toolCallId?: string;
  isError?: boolean;
}

export interface QueueUpdateData {
  steering: string[];
  followUp: string[];
}

export interface CompactionData {
  reason: "manual" | "threshold" | "overflow";
  aborted?: boolean;
  willRetry?: boolean;
  errorMessage?: string;
}

export interface RetryData {
  attempt: number;
  maxAttempts: number;
  delayMs?: number;
  errorMessage?: string;
  success?: boolean;
  finalError?: string;
}

/* Construction and parsing ------------------------------------------------ */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Parses a JSON frame; `null` when it is not an object. */
export function parseEnvelope(raw: unknown): Envelope | null {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!isRecord(value)) return null;
  if (typeof value.type !== "string") return null;
  if (value.id !== undefined && typeof value.id !== "string") return null;
  if (value.sessionId !== undefined && typeof value.sessionId !== "string") return null;
  return value as unknown as Envelope;
}

/** Whether `type` is a command of this contract. */
export function isCommandType(type: string): type is CommandType {
  return Object.prototype.hasOwnProperty.call(COMMANDS, type);
}

/** Whether `type` is an event of this contract. */
export function isEventType(type: string): type is EventType {
  return Object.prototype.hasOwnProperty.call(EVENTS, type);
}

/**
 * The first thing wrong with a command envelope, or `null`.
 * Version and shape only; each command checks its own payload.
 */
export function validateCommand(envelope: Envelope): { code: string; message: string } | null {
  if (envelope.v !== PROTOCOL_VERSION) {
    return {
      code: "protocol_mismatch",
      message: `protocol v${String(envelope.v)} does not match v${PROTOCOL_VERSION}`,
    };
  }
  if (!envelope.id) return { code: "missing_id", message: "a command needs an id" };
  if (!isCommandType(envelope.type)) {
    return { code: "unknown_command", message: `unknown command ${envelope.type}` };
  }
  if (envelope.payload !== undefined && !isRecord(envelope.payload)) {
    return { code: "bad_payload", message: "payload must be an object" };
  }
  return null;
}

export function commandMeta(type: string): CommandSpec | undefined {
  return isCommandType(type) ? COMMANDS[type] : undefined;
}

export function makeReply(id: string, command: string, data?: unknown): Reply {
  return { v: PROTOCOL_VERSION, id, type: "reply", payload: { command, ok: true, data } };
}

export function makeErrorReply(
  id: string,
  command: string,
  message: string,
  code = "command_failed",
): Reply {
  return { v: PROTOCOL_VERSION, id, type: "reply", payload: { command, ok: false, error: message, code } };
}

export function makeEvent(type: EventType, data?: unknown, sessionId?: string): EventMessage {
  const message: EventMessage = { v: PROTOCOL_VERSION, type };
  if (sessionId !== undefined) message.sessionId = sessionId;
  if (data !== undefined) message.data = data;
  return message;
}

export function makeUIRequest(
  id: string,
  method: UIMethod,
  params: Record<string, unknown>,
  timeoutMs = UI_REQUEST_TIMEOUT_MS,
  sessionId?: string,
): UIRequest {
  const message: UIRequest = {
    v: PROTOCOL_VERSION,
    id,
    type: "ui.request",
    data: { method, params, timeoutMs },
  };
  if (sessionId !== undefined) message.sessionId = sessionId;
  return message;
}

export function makeUIResponse(id: string, payload: UIResponsePayload): UIResponse {
  return { v: PROTOCOL_VERSION, id, type: "ui.response", payload };
}

export function makeWelcome(payload: WelcomePayload): Welcome {
  return { v: PROTOCOL_VERSION, type: WELCOME_TYPE, payload };
}
