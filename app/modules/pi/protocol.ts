/**
 * The pi module's own vocabulary. These shapes used to live in the shared
 * the deleted legacy engine wire; they are the pi client's
 * types now — the ACP harness's `session/update` payloads are folded into
 * them, and no other module or the shell sees them.
 */

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

export type SubagentStatus = "queued" | "running" | "settled" | "failed" | "aborted" | "interrupted";

/** A subagent run: live in memory, settled in the registry file. */
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
  /** The result was delivered to, or read by, the captain's model. */
  collected?: boolean;
}

// --- session plan (A2) -------------------------------------------------------
// The plan's wire shapes, mirroring the harness store's TodoFile. They are
// plain projections on purpose: the app never imports the harness.

export type PlanStatus = "pending" | "in_progress" | "done";
export type PlanOrigin = "agent" | "user";

export interface PlanTodo {
  id: string;
  title: string;
  status: PlanStatus;
  origin: PlanOrigin;
  note?: string;
  summary?: string;
  verification?: string;
  commitSubject?: string;
}

export interface PlanGroup {
  id: string;
  title: string;
  todos: PlanTodo[];
}

export interface PlanFile {
  v: 1;
  todos: PlanTodo[];
  groups: PlanGroup[];
}

/** The derived state of a group; never stored, computed on render. */
export type PlanGroupStatus = "pending" | "active" | "done";

/** One edit the panel sends over `_zu/todos/write`; the harness validates. */
export type PlanOp =
  | { kind: "add"; title: string; origin: PlanOrigin; group?: string }
  | {
      kind: "update";
      id: string;
      status?: PlanStatus;
      note?: string;
      summary?: string;
      verification?: string;
      commitSubject?: string;
    }
  | { kind: "promote"; id: string }
  | { kind: "remove"; id: string }
  | { kind: "writeGroups"; groups: Array<{ id?: string; title: string; todos: Array<{ id?: string; title: string }> }> };

export const EMPTY_PLAN: PlanFile = { v: 1, todos: [], groups: [] };

/** A group's derived status, same rule as the store's `groupStatus`. */
export function planGroupStatus(group: PlanGroup): PlanGroupStatus {
  if (group.todos.length === 0) return "pending";
  if (group.todos.every((todo) => todo.status === "done")) return "done";
  if (group.todos.some((todo) => todo.status === "in_progress")) return "active";
  return "pending";
}

/**
 * The plan's current item for the composer banner: the in_progress step if
 * one is set (it is globally unique), else the next pending step scanning
 * the groups first, then the loose lane. `null` when there is nothing left
 * to do — an all-done plan shows no banner, and with it no entry to the
 * finished history (accepted for this version).
 */
export function planCurrentItem(file: PlanFile): { title: string; active: boolean } | null {
  const active = [...file.todos, ...file.groups.flatMap((group) => group.todos)].find(
    (todo) => todo.status === "in_progress",
  );
  if (active) return { title: active.title, active: true };
  for (const group of file.groups) {
    const next = group.todos.find((todo) => todo.status === "pending");
    if (next) return { title: next.title, active: false };
  }
  const next = file.todos.find((todo) => todo.status === "pending");
  return next ? { title: next.title, active: false } : null;
}

export interface SessionModelInfo {
  provider: string;
  id: string;
  name: string;
  contextWindow?: number;
  reasoning?: boolean;
}

export interface SessionModelOption {
  provider: string;
  id: string;
  name: string;
  contextWindow?: number;
  reasoning?: boolean;
}

export interface SessionModelProvider {
  id: string;
  name: string;
  models: SessionModelOption[];
  /** The provider's credential source as pi's own word (issue #54):
   * stored / environment / runtime / models_json_key / …, or `none` —
   * the composer renders it in the user's words. */
  authSource?: string;
  /** The env variable name when the source is `environment`. */
  authLabel?: string;
}

export type SessionModelsReasonCode = "no_catalog" | "no_credentials" | "no_models" | "unavailable";

export interface SessionModelsReason {
  code: SessionModelsReasonCode;
  message?: string;
}

export interface SessionModelsData {
  providers: SessionModelProvider[];
  current?: SessionModelInfo;
  thinkingLevel?: SessionThinkingLevel;
  reason?: SessionModelsReason;
}

export interface SessionContextUsage {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
}

/** pi's selectable thinking levels; `off` means the model does not think. */
export type SessionThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

/** One resource warning in the session banner (a load diagnostic). */
export interface SessionBannerWarning {
  severity: "warning" | "error";
  source: "skill" | "extension" | "prompt" | "theme";
  message: string;
}

/**
 * The `_zu/session_banner` payload (issue #20 §4.2): the transcript's first
 * line — the pinned pi version, the session's model and thinking level, and
 * the loaded resources. Absent when the distro had nothing to say; the UI
 * draws no banner rather than a fake empty one.
 */
export interface SessionBanner {
  version: string;
  model?: { provider: string; id: string; name?: string };
  thinkingLevel?: string;
  skills: Array<{ name: string; description?: string; source: string }>;
  extensions: Array<{ name: string; path: string; source: string }>;
  warnings: SessionBannerWarning[];
}

export interface SessionInfoData {
  name?: string;
  thinkingLevel?: SessionThinkingLevel;
  path?: string;
  model?: SessionModelInfo;
  contextUsage?: SessionContextUsage;
}

/** Settings the shell stores in `zu/settings.json`. */
export interface SettingsData {
  sidebarWidth?: number;
  [key: string]: unknown;
}
