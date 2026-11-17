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
