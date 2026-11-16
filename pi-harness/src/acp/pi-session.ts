/**
 * The pi glue behind the ACP surface: one in-process pi SDK session per ACP
 * session, its events mapped onto `session/update` payloads (v2 §4.1 — the
 * adapter embeds the SDK, no RPC subprocess).
 *
 * This is the createAgentSession wiring behind a protocol peer: no Zu
 * registry, no wire events, no containers — the ACP sessionId is pi's
 * sessionId and pi's session files stay the only durable authority. The
 * dispatch extension and the subagent manager are restored, scoped to the
 * captain session; the ACP process is persistent for the conversation.
 *
 * Env the adapter reads:
 *   ACP_NO_EXTENSIONS=1            — load pi with no extensions at all
 *   ACP_EXTRA_EXTENSION_PATHS=a,b  — additional extension paths
 *
 * Project trust is conservative: a saved decision in pi's trust store is
 * honored; an unsaved one is treated as untrusted (project-local extensions
 * and settings stay unloaded) and logged.
 */

import { mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  createAgentSessionFromServices,
  getAgentDir,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import type {
  AgentSession,
  AgentSessionEvent,
  ExtensionAPI,
  ExtensionUIContext,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type {
  AvailableCommand,
  CreateElicitationRequest,
  CreateElicitationResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionConfigOption,
  SessionModeState,
  SessionUpdate,
  StopReason,
} from "@agentclientprotocol/sdk";
import { codedError } from "./errors";
import {
  assistantDeltaUpdate,
  describeToolCall,
  isRecord,
  piToolKind,
  stopReasonFromPi,
  toolCallEndUpdate,
  toolCallPartialUpdate,
  toolCallStartUpdate,
} from "./mapping";
import { replayUpdates, type ReplayEntry } from "./replay";
import { composeExtensions, ZU_EXTENSIONS } from "../extensions/registry";
import { DISPATCH_RULE, promptSectionExtension } from "../extensions/prompt-section";
import { ARTIFACTS_RULE, artifactsExtension } from "../extensions/artifacts";
import { readZuSettings, zuStateDir } from "../settings";
import { createPiServices } from "../pi/services";
import type { AcpMcpServer } from "../pi/mcp";
import type { TrustElicit } from "../pi/trust";
import { SubagentManager, dispatchExtension, type SubagentHost, type SubagentRun } from "./subagents";
import type { HarnessClientBridge, HarnessPorts, HarnessSession, HarnessSessionContext, HarnessLog } from "./app";

type PiAgentSession = AgentSession;
type ThinkingLevel = Parameters<PiAgentSession["setThinkingLevel"]>[0];

/** `enabledModels` patterns are fuzzy in pi; this is the conservative subset. */
function modelAllowed(patterns: string[], model: { provider: string; id: string; name?: string }): boolean {
  const ref = `${model.provider}/${model.id}`;
  const name = model.name ?? ref;
  return patterns.some((pattern) => {
    if (pattern === ref) return true;
    if (pattern.endsWith("/*")) return model.provider === pattern.slice(0, -2);
    if (pattern.includes("/")) return ref.startsWith(pattern) || name.toLowerCase().includes(pattern.toLowerCase());
    return model.id.toLowerCase().includes(pattern.toLowerCase()) || name.toLowerCase().includes(pattern.toLowerCase());
  });
}

/** What the ACP layer can carry into one Pi session's construction. */
export interface PiSessionOptions {
  agentDir?: string;
  /** The ACP client's trust question (session/new is still in flight). */
  elicit?: TrustElicit;
  /** Client-supplied MCP servers (captain only). */
  mcpServers?: AcpMcpServer[];
  /** A captain's decision, inherited by a subagent. */
  trusted?: boolean;
}

/** The approval-policy modes advertised through `session/set_mode`. */
const APPROVAL_MODES: SessionModeState = {
  currentModeId: "ask",
  availableModes: [
    { id: "ask", name: "Ask", description: "Ask before destructive tools and commands." },
    { id: "auto", name: "Auto", description: "Run tools without asking." },
    { id: "read-only", name: "Read-only", description: "Block writes, commands and network tools." },
  ],
};

/** Tools that are safe to run without a prompt in `ask` mode. */
const READ_ONLY_TOOLS = new Set(["read", "ls", "find", "grep", "glob", "search", "view"]);

/** The session's live approval gate: mode, remembered allows, client bridge. */
class PermissionGate {
  mode = "ask";
  sessionId = "";
  bridge: HarnessClientBridge | null = null;
  private readonly allowed = new Set<string>();

  constructor(private readonly log: HarnessLog) {}

  extension(): (pi: ExtensionAPI) => void {
    return (pi: ExtensionAPI) => {
      pi.on("tool_call", (async (event: any) => this.check(event)) as never);
    };
  }

  private async check(event: ToolCallLike): Promise<{ block?: boolean; reason?: string } | void> {
    const tool = String(event.toolName ?? "");
    if (this.mode === "auto") return;
    if (this.mode === "read-only") {
      if (READ_ONLY_TOOLS.has(tool)) return;
      return { block: true, reason: "read-only mode: writes, commands and network tools are blocked" };
    }
    if (READ_ONLY_TOOLS.has(tool)) return;
    if (this.allowed.has(tool)) return;
    if (!this.bridge) {
      this.log(`permission required for ${tool}, but no client bridge is attached`);
      return { block: true, reason: "no approval channel is attached" };
    }
    const title = describeToolCall(tool, event.input);
    try {
      const response = await this.bridge.requestPermission({
        sessionId: this.sessionId,
        toolCall: {
          toolCallId: String(event.toolCallId ?? ""),
          title,
          kind: piToolKind(tool),
          status: "pending",
          ...(isRecord(event.input) ? { rawInput: event.input } : {}),
        },
        options: [
          { optionId: "allow_once", name: "Allow once", kind: "allow_once" },
          { optionId: "allow_always", name: "Always allow", kind: "allow_always" },
          { optionId: "reject", name: "Reject", kind: "reject_once" },
        ],
      });
      const outcome = (response as { outcome?: { outcome?: string; optionId?: string } }).outcome;
      if (outcome?.outcome !== "selected") {
        return { block: true, reason: "the approval was cancelled" };
      }
      if (outcome.optionId === "allow_always") this.allowed.add(tool);
      if (outcome.optionId === "allow_once" || outcome.optionId === "allow_always") return;
      return { block: true, reason: "rejected by the user" };
    } catch (error) {
      this.log(`permission request failed: ${String(error)}`);
      return { block: true, reason: "the approval request failed" };
    }
  }
}

interface ToolCallLike {
  toolName?: string;
  toolCallId?: string;
  input?: unknown;
}

/**
 * The captain's extension factories, in binding order:
 * 1. permission gate — must observe every tool call, so it binds first;
 * 2. prompt sections — byte-stable captain rules (see ../extensions/prompt-section.ts);
 *    stateless, so their position only needs to stay between the two stateful ones;
 * 3. artifacts guard — blocks `write` of new files under system temp roots
 *    (see ../extensions/artifacts.ts); a second `tool_call` handler beside the gate;
 * 4. dispatch — registers the `dispatch` tool, whose usage the rules above shape.
 */
export function hostExtensionFactories(
  gate: Pick<PermissionGate, "extension">,
  subagentManager: SubagentManager,
  captainId: string,
  log?: HarnessLog,
) {
  return [
    gate.extension(),
    promptSectionExtension("zu-dispatch", DISPATCH_RULE, log),
    promptSectionExtension("zu-artifacts", ARTIFACTS_RULE, log),
    artifactsExtension(log),
    dispatchExtension(subagentManager, captainId),
  ];
}

function extraExtensionPaths(): string[] {
  return (process.env.ACP_EXTRA_EXTENSION_PATHS ?? "")
    .split(",")
    .map((path) => path.trim())
    .filter(Boolean);
}

function extensionsDisabled(): boolean {
  return process.env.ACP_NO_EXTENSIONS === "1";
}

class PiHarnessSession implements HarnessSession {
  readonly id: string;
  readonly cwd: string;

  private readonly manager: SessionManager;
  private readonly session: PiAgentSession;
  private readonly log: HarnessLog;
  private push: ((update: SessionUpdate) => void) | undefined;
  /** Chunks of one pi message share an ACP messageId; bumped per message. */
  private messageSeq = 0;
  private currentMessageId = "";
  /** The last settled assistant stop reason of the running turn. */
  private lastStop: string | undefined;
  /** The approval gate the permission extension uses. */
  private readonly gate: PermissionGate;
  /** The settings the session's services loaded (model scope, defaults). */
  private readonly settingsManager: SettingsManager;
  /** The subagent manager bound to this captain. */
  private readonly subagentManager: SubagentManager;
  /** Compaction ids are per session and stable across start/end events. */
  private compactionSeq = 0;
  private currentCompactionId = "";

  private constructor(
    manager: SessionManager,
    session: PiAgentSession,
    cwd: string,
    log: HarnessLog,
    gate: PermissionGate,
    settingsManager: SettingsManager,
    subagentManager: SubagentManager,
  ) {
    this.manager = manager;
    this.session = session;
    this.cwd = cwd;
    this.log = log;
    this.gate = gate;
    this.settingsManager = settingsManager;
    this.subagentManager = subagentManager;
    this.id = manager.getSessionId();
    this.gate.sessionId = this.id;
    this.subscribe();
  }

  static async create(cwd: string, log: HarnessLog, options: PiSessionOptions = {}): Promise<PiHarnessSession> {
    const manager = SessionManager.create(cwd);
    return PiHarnessSession.build(manager, cwd, log, options);
  }

  static async open(path: string, cwd: string, log: HarnessLog, options: PiSessionOptions = {}): Promise<PiHarnessSession> {
    const manager = SessionManager.open(path);
    return PiHarnessSession.build(manager, cwd, log, options);
  }

  private static async build(
    manager: SessionManager,
    cwd: string,
    log: HarnessLog,
    options: PiSessionOptions,
  ): Promise<PiHarnessSession> {
    const agentDir = options.agentDir ?? getAgentDir();
    // Built-in extensions: the user's `disabledExtensions` decides which ones
    // compose, and an enabled extension's skills ride along. Read once per
    // build; a settings change lands on the next session/new|load (no hot
    // reload — see docs/pi-acp-IMPLEMENTATION.md §18).
    const zuSettings = await readZuSettings(agentDir);
    const composed = composeExtensions(ZU_EXTENSIONS, zuSettings);
    const gate = new PermissionGate(log);
    const captainId = manager.getSessionId();
    const sessionRef: { session: PiAgentSession | null } = { session: null };
    const trustRef = { trusted: options.trusted ?? false };
    const subagentManager = new SubagentManager(
      subagentHost(cwd, manager, sessionRef, log, agentDir, () => trustRef.trusted),
    );
    const built = await createPiServices({
      cwd,
      agentDir,
      ...(options.trusted === undefined ? {} : { trusted: options.trusted }),
      ...(options.elicit ? { elicit: options.elicit } : {}),
      ...(options.mcpServers ? { mcpServers: options.mcpServers } : {}),
      extensionFactories: [...hostExtensionFactories(gate, subagentManager, captainId, log), ...composed.factories],
      additionalSkillPaths: composed.skillDirs,
      additionalExtensionPaths: extraExtensionPaths(),
      noExtensions: extensionsDisabled(),
      log,
    });
    trustRef.trusted = built.trusted;
    const created = await createAgentSessionFromServices({
      services: built.services,
      sessionManager: manager,
    });
    sessionRef.session = created.session;
    const rec = new PiHarnessSession(
      manager,
      created.session,
      cwd,
      log,
      gate,
      built.services.settingsManager,
      subagentManager,
    );
    try {
      await created.session.bindExtensions({
        uiContext: rec.uiContext(),
        mode: "rpc",
        abortHandler: () => {
          void created.session.abort();
        },
        onError: (failure) => {
          log(`extension error in ${rec.id}: ${failure.event}: ${String(failure.error)}`);
        },
      });
    } catch (error) {
      log(`bindExtensions failed for ${rec.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
    return rec;
  }

  async prompt(text: string): Promise<StopReason> {
    this.lastStop = undefined;
    // `/compact` is the one built-in the distro executes itself; extension
    // commands, templates and skills are handled by `session.prompt`.
    const trimmed = text.trim();
    if (trimmed === "/compact" || trimmed.startsWith("/compact ")) {
      await this.session.compact(trimmed.slice("/compact".length).trim() || undefined);
      this.emitUsage();
      return "end_turn";
    }
    await this.session.prompt(text);
    this.emitUsage();
    return stopReasonFromPi(this.lastStop);
  }

  async abort(): Promise<void> {
    await this.session.abort();
  }

  dispose(): void {
    try {
      this.session.dispose();
    } catch {
      // Already disposed.
    }
  }

  /** The load replay, mapped from pi's own projection of the session file. */
  /** The ACP extension surface for subagents (`_zu/subagents/*`). */
  get subagents() {
    return {
      list: (filter: { captainId?: string } = {}) =>
        this.subagentManager.list({ ...filter, captainId: filter.captainId ?? this.id }),
      transcript: (runId: string) => this.subagentManager.transcript(runId),
      dispatch: (agent: string, task: string) => this.subagentManager.spawn(this.id, agent, task),
      abort: (runId: string) => this.subagentManager.abort(runId),
    };
  }

  configOptions(): SessionConfigOption[] {
    const runtime = this.session.modelRuntime;
    const all = runtime?.getAvailableSnapshot?.() ?? [];
    const enabled = this.settingsManager.getEnabledModels();
    const models = enabled ? all.filter((model) => modelAllowed(enabled, model)) : all;
    const current = this.session.model;
    const options = models.map((model) => ({
      value: `${model.provider}/${model.id}`,
      name: model.name ?? `${model.provider}/${model.id}`,
      description: model.provider,
    }));
    // The active model must stay selectable even when a scope pattern is
    // narrower than the session's restored model.
    if (current && !options.some((option) => option.value === `${current.provider}/${current.id}`)) {
      options.unshift({ value: `${current.provider}/${current.id}`, name: current.name ?? `${current.provider}/${current.id}`, description: current.provider });
    }
    const levels = this.session.getAvailableThinkingLevels().map((level) => ({
      value: level,
      name: level,
    }));
    const configs: SessionConfigOption[] = [];
    if (options.length > 0) {
      configs.push({
        id: "model",
        name: "Model",
        category: "model",
        type: "select",
        currentValue: current ? `${current.provider}/${current.id}` : options[0].value,
        options,
      });
    }
    if (levels.length > 0) {
      configs.push({
        id: "thought_level",
        name: "Thinking",
        category: "thought_level",
        type: "select",
        currentValue: this.session.thinkingLevel,
        options: levels,
      });
    }
    return configs;
  }

  availableCommands(): AvailableCommand[] {
    const commands = this.session.extensionRunner.getRegisteredCommands().map((command) => ({
      name: command.invocationName,
      description: command.description ?? "",
    }));
    const templates = this.session.promptTemplates.map((template) => ({
      name: template.name,
      description: template.description ?? "",
    }));
    const skills = this.session.resourceLoader.getSkills().skills.map((skill) => ({
      name: `skill:${skill.name}`,
      description: skill.description ?? "",
    }));
    return [
      { name: "compact", description: "Compact the conversation context." },
      ...commands,
      ...templates,
      ...skills,
    ];
  }

  async setConfigOption(configId: string, value: string): Promise<SessionConfigOption[]> {
    if (configId === "model") {
      const [provider, ...rest] = value.split("/");
      const id = rest.join("/");
      const model = provider && id ? this.session.modelRuntime.getModel(provider, id) : undefined;
      if (!model) {
        throw codedError(-32602, "unknown_model", `unknown model ${value}`);
      }
      await this.session.setModel(model, { persist: false });
      this.emitConfig();
      return this.configOptions();
    }
    if (configId === "thought_level") {
      const levels = this.session.getAvailableThinkingLevels();
      if (!levels.includes(value as ThinkingLevel)) {
        throw codedError(-32602, "invalid_thought_level", `unknown thinking level ${value}`);
      }
      this.session.setThinkingLevel(value as ThinkingLevel, { persist: false });
      this.emitConfig();
      return this.configOptions();
    }
    throw codedError(-32602, "unknown_config_option", `unknown config option ${configId}`);
  }

  modeState(): SessionModeState {
    return {
      currentModeId: this.gate.mode,
      availableModes: APPROVAL_MODES.availableModes,
    };
  }

  async setMode(modeId: string): Promise<void> {
    if (!APPROVAL_MODES.availableModes.some((mode) => mode.id === modeId)) {
      throw codedError(-32602, "unknown_mode", `unknown mode ${modeId}`);
    }
    this.gate.mode = modeId;
    this.emit({ sessionUpdate: "current_mode_update", currentModeId: modeId });
  }

  attachClient(bridge: HarnessClientBridge | null): void {
    this.gate.bridge = bridge;
  }

  private emitConfig(): void {
    this.emit({ sessionUpdate: "config_option_update", configOptions: this.configOptions() });
  }

  private emitUsage(): void {
    const usage = this.session.getContextUsage();
    if (!usage || usage.tokens === null) return;
    this.emit({ sessionUpdate: "usage_update", used: usage.tokens, size: usage.contextWindow });
  }

  replay(): SessionUpdate[] {
    const projection = this.manager.buildSessionProjection();
    const entries: ReplayEntry[] = projection.entries.map((projected) => ({
      sourceId: projected.sourceEntry.id,
      messages: projected.messages.map((message) => message as ReplayMessageShape),
    }));
    return replayUpdates(entries);
  }

  onUpdate(push: (update: SessionUpdate) => void): void {
    this.push = push;
  }

  private emit(update: SessionUpdate | undefined): void {
    if (update) this.push?.(update);
  }

  private nextMessageId(): string {
    this.messageSeq += 1;
    return `m${this.messageSeq}`;
  }

  /** pi events in, ACP update payloads out — synchronously, preserving order. */
  private subscribe(): void {
    this.session.subscribe((event: AgentSessionEvent) => {
      switch (event.type) {
        case "message_start": {
          if ((event.message as { role?: string })?.role === "assistant") {
            this.currentMessageId = this.nextMessageId();
          }
          return;
        }
        case "message_update": {
          this.emit(assistantDeltaUpdate(event.assistantMessageEvent, this.currentMessageId));
          return;
        }
        case "message_end": {
          const message = event.message as {
            role?: string;
            stopReason?: string;
            errorMessage?: string;
          };
          if (message?.role !== "assistant") return;
          // Track the turn's final stop reason; the prompt reply reads it.
          this.lastStop = message.stopReason;
          // A provider error has no ACP stop reason; its text goes out as a
          // chunk so the client sees why the turn ended (mapping.ts).
          if (message.stopReason === "error" && message.errorMessage) {
            this.emit({
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: `error: ${message.errorMessage}` },
              messageId: this.currentMessageId || this.nextMessageId(),
            });
          }
          return;
        }
        case "tool_execution_start": {
          if (event.parentToolCallId) return; // a nested call; its parent card carries the run
          this.emit(toolCallStartUpdate(event.toolCallId, event.toolName, event.args));
          return;
        }
        case "tool_execution_update": {
          if (event.parentToolCallId) return;
          this.emit(toolCallPartialUpdate(event.toolCallId, event.partialResult));
          return;
        }
        case "tool_execution_end": {
          if (event.parentToolCallId) return;
          this.emit(toolCallEndUpdate(event.toolCallId, event.result, event.isError));
          return;
        }
        case "thinking_level_changed": {
          this.emitConfig();
          return;
        }
        case "session_info_changed": {
          this.emit({ sessionUpdate: "session_info_update", title: event.name ?? null });
          return;
        }
        case "compaction_start": {
          this.compactionSeq += 1;
          this.currentCompactionId = `c${this.compactionSeq}`;
          this.emit({
            sessionUpdate: "compaction_update",
            compactionId: this.currentCompactionId,
            status: "in_progress",
          });
          return;
        }
        case "compaction_end": {
          const id = this.currentCompactionId || `c${++this.compactionSeq}`;
          const status = event.aborted ? "cancelled" : event.errorMessage ? "failed" : "completed";
          this.emit({
            sessionUpdate: "compaction_update",
            compactionId: id,
            status,
            ...(event.result?.summary ? { summary: [{ type: "text", text: event.result.summary }] } : {}),
            ...(event.errorMessage ? { error: event.errorMessage } : {}),
          });
          this.emitUsage();
          return;
        }
        default:
          // Turn lifecycle, compaction, retries, queue updates: no P0 update
          // shape (v2 §5.0 moves them to core events in later stages).
          return;
      }
    });
  }

  /**
   * The extension UI bridge: confirm/select/input/editor are an ACP
   * elicitation form; notify/status/title become notices and session info.
   * The rich presentation surfaces ACP has no equivalent for degrade to a
   * warning notice, which the client renders in the transcript.
   */
  private uiContext(): ExtensionUIContext {
    const unsupported = (method: string) => (..._args: unknown[]) => {
      this.log(`extension ui ${method} is not supported over ACP`);
      this.emit({
        sessionUpdate: "notice",
        notice: {
          severity: "warning",
          title: `${method} is not supported`,
          description: "This extension UI surface has no ACP equivalent yet.",
        },
      });
      return undefined;
    };
    const form = async (
      message: string,
      properties: Record<string, unknown>,
      required: string[],
    ): Promise<{ action?: string; content?: Record<string, unknown> } | undefined> => {
      if (!this.gate.bridge) {
        this.log("extension ui requested without a client bridge");
        return undefined;
      }
      try {
        return (await this.gate.bridge.elicit({
          mode: "form",
          sessionId: this.id,
          message,
          requestedSchema: { type: "object", properties, required },
        })) as { action?: string; content?: Record<string, unknown> };
      } catch (error) {
        this.log(`extension ui elicitation failed: ${String(error)}`);
        return undefined;
      }
    };
    return {
      select: async (title, options) => {
        const result = await form(title, {
          choice: { type: "string", title, enum: options },
        }, ["choice"]);
        if (result?.action !== "accept") return undefined;
        const value = result.content?.choice;
        return typeof value === "string" ? value : undefined;
      },
      confirm: async (title, message) => {
        const result = await form(`${title}\n${message}`, {
          confirmed: { type: "boolean", title, description: message },
        }, ["confirmed"]);
        return result?.action === "accept" && result.content?.confirmed === true;
      },
      input: async (title, placeholder) => {
        const result = await form(title, {
          value: { type: "string", title, description: placeholder ?? "" },
        }, ["value"]);
        if (result?.action !== "accept") return undefined;
        const value = result.content?.value;
        return typeof value === "string" ? value : undefined;
      },
      editor: async (title, prefill) => {
        const result = await form(title, {
          value: { type: "string", title, description: "Markdown or plain text", default: prefill ?? "" },
        }, ["value"]);
        if (result?.action !== "accept") return undefined;
        const value = result.content?.value;
        return typeof value === "string" ? value : undefined;
      },
      notify: (message, type) => {
        this.emit({
          sessionUpdate: "notice",
          notice: {
            severity: type === "error" ? "error" : type === "warning" ? "warning" : "info",
            title: message,
          },
        });
      },
      setStatus: (key, text) => {
        this.emit({
          sessionUpdate: "notice",
          notice: {
            severity: "info",
            title: `${key}${text ? `: ${text}` : ""}`,
          },
        });
      },
      setTitle: (title) => {
        this.emit({ sessionUpdate: "session_info_update", title });
      },
      setWorkingMessage: unsupported("setWorkingMessage") as never,
      setWorkingVisible: unsupported("setWorkingVisible") as never,
      setWorkingIndicator: unsupported("setWorkingIndicator") as never,
      setHiddenThinkingLabel: unsupported("setHiddenThinkingLabel") as never,
      setWidget: unsupported("setWidget") as never,
      setFooter: unsupported("setFooter") as never,
      setHeader: unsupported("setHeader") as never,
      custom: unsupported("custom") as never,
      pasteToEditor: unsupported("pasteToEditor") as never,
      setEditorText: unsupported("setEditorText") as never,
      addAutocompleteProvider: unsupported("addAutocompleteProvider") as never,
      setEditorComponent: unsupported("setEditorComponent") as never,
      onTerminalInput: () => {
        this.log("extension ui onTerminalInput is not supported over ACP");
        return () => {};
      },
      getEditorText: () => "",
      getEditorComponent: () => undefined,
      getToolsExpanded: () => false,
      setToolsExpanded: unsupported("setToolsExpanded") as never,
      getAllThemes: () => [],
      getTheme: () => undefined,
      setTheme: () => Promise.resolve({ success: false, error: "the client owns its theme" }),
      theme: undefined as never,
    } as ExtensionUIContext;
  }
}

/** The projection message shape the replay reads; a pi AgentMessage view. */
type ReplayMessageShape = import("./replay").ReplayMessage;

/**
 * pi's services for one cwd, with conservative project trust: the saved
 * decision stands, an unsaved one stays untrusted (and logged) — project
 * resources stay unloaded instead of silently loading.
 */
/** The subagent manager's host: this session is its captain; settled runs
 * live in `~/.pi/zu/subagents/index.json`. */
function subagentHost(
  cwd: string,
  manager: SessionManager,
  sessionRef: { session: PiAgentSession | null },
  log: HarnessLog,
  agentDir: string,
  trusted: () => boolean,
): SubagentHost {
  const root = join(zuStateDir(agentDir), "subagents");
  const index = join(root, "index.json");
  const readIndex = (): SubagentRun[] => {
    try {
      const parsed = JSON.parse(readFileSync(index, "utf8")) as { runs?: SubagentRun[] };
      return Array.isArray(parsed.runs) ? parsed.runs : [];
    } catch {
      return [];
    }
  };
  return {
    agentDir,
    captainFor: (id) =>
      sessionRef.session
        ? {
            id,
            path: manager.getSessionFile() ?? "",
            cwd,
            manager,
            session: sessionRef.session,
          }
        : undefined,
    settledRuns: readIndex,
    saveSettled: (run) => {
      try {
        mkdirSync(root, { recursive: true });
        const runs = readIndex().filter((entry) => entry.runId !== run.runId).concat(run);
        const temp = `${index}.tmp`;
        writeFileSync(temp, JSON.stringify({ v: 1, runs }, null, 2));
        renameSync(temp, index);
      } catch (error) {
        log(`subagent index write failed: ${String(error)}`);
      }
    },
    appendCaptainNote: (id, kind, text, data) => {
      try {
        manager.appendCustomEntry(kind === "dispatch" ? "zu.dispatch" : "zu.delivery", { ...(data as object), text });
      } catch (error) {
        log(`captain note failed for ${id}: ${String(error)}`);
      }
    },
    emit: (type, _data) => log(`subagent ${type}`),
    projectTrusted: () => trusted(),
    isArchived: () => false,
  };
}

/** The HarnessPorts over real pi sessions. */
export interface PiPortsOptions {
  agentDir?: string;
}

function optionsFor(context: HarnessSessionContext | undefined, base: PiPortsOptions): PiSessionOptions {
  return {
    ...(base.agentDir ? { agentDir: base.agentDir } : {}),
    ...(context?.elicit ? { elicit: context.elicit } : {}),
    ...(context?.mcpServers ? { mcpServers: context.mcpServers as AcpMcpServer[] } : {}),
  };
}

export function createPiPorts(log: HarnessLog, base: PiPortsOptions = {}): HarnessPorts {
  return {
    createSession: (cwd: string, context?: HarnessSessionContext) =>
      PiHarnessSession.create(cwd, log, optionsFor(context, base)),
    resumeSession: async (sessionId: string, cwd: string, context?: HarnessSessionContext) => {
      return createPiPorts(log, base).loadSession(sessionId, cwd, context);
    },
    loadSession: async (sessionId: string, cwd: string, context?: HarnessSessionContext) => {
      const path = findPiSessionFile(sessionId, base.agentDir);
      if (!path) {
        throw codedError(-32002, "session_not_found", `no session file for ${sessionId} under ${join(base.agentDir ?? getAgentDir(), "sessions")}`, {
          sessionId,
        });
      }
      const manager = SessionManager.open(path);
      const sessionCwd = manager.getCwd();
      if (sessionCwd !== cwd) {
        throw codedError(
          -32602,
          "cwd_mismatch",
          `session ${sessionId} belongs to ${sessionCwd}, not ${cwd}`,
          { sessionId },
        );
      }
      return PiHarnessSession.open(path, cwd, log, optionsFor(context, base));
    },
  };
}

/**
 * Resolves a session id to its file under `~/.pi/agent/sessions/` by file
 * name (pi names files `<timestamp>_<sessionId>.jsonl`). A bounded walk —
 * no full listing, no network.
 */
export function findPiSessionFile(sessionId: string, agentDir = getAgentDir()): string | undefined {
  const root = join(agentDir, "sessions");
  let found: string | undefined;
  let foundMtime = 0;
  const suffix = `_${sessionId}.jsonl`;
  const visit = (dir: string, depth: number): void => {
    if (depth > 3) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(path, depth + 1);
      } else if (entry.name.endsWith(suffix)) {
        try {
          const mtime = statSync(path).mtimeMs;
          if (mtime > foundMtime) {
            foundMtime = mtime;
            found = path;
          }
        } catch {
          // Removed while walking.
        }
      }
    }
  };
  visit(root, 0);
  return found;
}
