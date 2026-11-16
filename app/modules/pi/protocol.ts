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

export type SubagentStatus = "running" | "settled" | "failed" | "aborted" | "interrupted";

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

export interface SessionInfoData {
  name?: string;
  thinkingLevel?: SessionThinkingLevel;
  /** The session's approval mode, when the reply carries it. */
  mode?: string;
  path?: string;
  model?: SessionModelInfo;
  contextUsage?: SessionContextUsage;
}

/** Settings the shell stores in `zu/settings.json`. */
export interface SettingsData {
  sidebarWidth?: number;
  [key: string]: unknown;
}
