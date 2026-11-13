/**
 * The dispatch surface: subagent runs created inside the engine, visible to
 * the shell, and owned by their captain.
 *
 * pi's documented subagent extension spawns a `pi` process per task. Zu keeps
 * the run in-process instead: a second AgentSession with an isolated context,
 * a custom session directory, a `parentSession` header and the captain's
 * model. The dispatch tool is registered only on captain sessions, so a
 * subagent can never dispatch again (the two-level rule); the shell reads the
 * roster and transcripts through the wire.
 */

import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Type } from "typebox";
import {
  createAgentSession,
  DefaultResourceLoader,
  parseFrontmatter,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
/** The subagent surface's own vocabulary (the app has no shared wire type
 * for these; they travel over the `_zu/subagents/*` extension methods). */
export interface PlainMessage {
  role: string;
  text: string;
  at?: number;
}

export type SubagentStatus = "running" | "settled" | "failed" | "aborted" | "interrupted";

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

export interface SubagentTranscriptData {
  run?: SubagentRun;
  messages: PlainMessage[];
}

/** `~/.pi/zu/subagents` — beside the session files, never inside pi's own
 * conversation directory. */
function stateDir(): string {
  return join(process.env.PI_CODING_AGENT_DIR ?? `${process.env.HOME ?? ""}/.pi/agent`, "..", "zu");
}

export interface CaptainLike {
  id: string;
  path: string;
  cwd: string;
  containerId?: string;
  manager: SessionManager;
  session: any;
}

export interface SubagentHost {
  agentDir: string;
  /** A captain's open record, or undefined when the session is not open. */
  captainFor(id: string): CaptainLike | undefined;
  /** Settled runs persisted in the registry. */
  settledRuns(): SubagentRun[];
  saveSettled(run: SubagentRun): void;
  appendCaptainNote(captainId: string, kind: "dispatch" | "delivery", text: string, data: unknown): void;
  emit(type: string, data?: unknown, sessionId?: string): void;
  projectTrusted(cwd: string): boolean;
  isArchived(captainId: string): boolean;
}

export interface AgentDefinition {
  name: string;
  description: string;
  systemPrompt: string;
  tools?: string[];
  model?: string;
  thinking?: string;
  source: "builtin" | "personal" | "project";
}

interface LiveRun {
  run: SubagentRun;
  session: any;
  manager: SessionManager;
  aborted: boolean;
  promise: Promise<void>;
}

const BUILTIN_AGENTS: AgentDefinition[] = [
  {
    name: "worker",
    description: "General-purpose subagent with the full coding tool set and an isolated context.",
    systemPrompt:
      "You are a worker subagent with full capabilities. Work autonomously on the delegated task, using the tools you need. Finish with a short report: what changed, which files, and anything the captain must know.",
    source: "builtin",
  },
  {
    name: "scout",
    description: "Fast read-only recon: locate code, trace flows, and return compressed context.",
    systemPrompt:
      "You are a scout subagent. Read only: search, inspect and summarize. Do not modify files. Return the paths, symbols and facts the captain needs, compressed.",
    tools: ["read", "grep", "find", "ls"],
    source: "builtin",
  },
  {
    name: "planner",
    description: "Read-only planning: turn a goal into an ordered implementation plan.",
    systemPrompt:
      "You are a planner subagent. Inspect the code read-only and return a concrete, ordered plan with file paths, risks and verification steps. Do not edit.",
    tools: ["read", "grep", "find", "ls"],
    source: "builtin",
  },
  {
    name: "reviewer",
    description: "Read-only review of a change or design; returns findings and a verdict.",
    systemPrompt:
      "You are a reviewer subagent. Inspect the given change read-only and report correctness, edge cases and missing tests. End with a one-line verdict: pass or concerns.",
    tools: ["read", "grep", "find", "ls"],
    source: "builtin",
  },
];

function readAgents(dir: string, source: AgentDefinition["source"]): AgentDefinition[] {
  let names: string[] = [];
  try {
    names = readdirSync(dir).filter((name) => name.endsWith(".md"));
  } catch {
    return [];
  }
  const agents: AgentDefinition[] = [];
  for (const name of names) {
    try {
      const content = readFileSync(join(dir, name), "utf8");
      const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(content);
      const defined = typeof frontmatter.name === "string" && frontmatter.name.trim() ? frontmatter.name.trim() : name.replace(/\.md$/, "");
      const tools = Array.isArray(frontmatter.tools)
        ? (frontmatter.tools as unknown[]).map(String).filter(Boolean)
        : undefined;
      agents.push({
        name: defined,
        description: String(frontmatter.description ?? ""),
        systemPrompt: body.trim(),
        tools,
        model: typeof frontmatter.model === "string" ? frontmatter.model : undefined,
        thinking: typeof frontmatter.thinking === "string" ? frontmatter.thinking : undefined,
        source,
      });
    } catch {
      // A malformed definition is skipped; the builtin of the same name stays.
    }
  }
  return agents;
}

export function discoverAgents(cwd: string, agentDir: string, projectTrusted: boolean): AgentDefinition[] {
  const found = new Map<string, AgentDefinition>();
  for (const agent of BUILTIN_AGENTS) found.set(agent.name, agent);
  for (const agent of readAgents(join(agentDir, "agents"), "personal")) found.set(agent.name, agent);
  if (projectTrusted) {
    for (const agent of readAgents(join(cwd, ".pi", "agents"), "project")) found.set(agent.name, agent);
  }
  return [...found.values()];
}

function plain(message: any): PlainMessage {
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

function finalOutput(messages: any[]): string {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role !== "assistant") continue;
    const text = plain(message).text;
    if (text) return text;
  }
  return "";
}

/**
 * Owns live runs and projects the settled ones from the registry. Live runs
 * are intentionally memory-only (a restart cannot resume them); settled runs
 * keep their session file under `zu/subagents/{captainId}/`.
 */
export class SubagentManager {
  private live = new Map<string, LiveRun>();
  private seq = 0;

  constructor(private host: SubagentHost) {}

  private nextRunId(): string {
    return `run-${Date.now().toString(36)}-${++this.seq}`;
  }

  list(filter: { containerId?: string; captainId?: string }): SubagentRun[] {
    const live = [...this.live.values()].map((entry) => entry.run);
    const settled = this.host.settledRuns();
    const byId = new Map<string, SubagentRun>();
    for (const run of settled) byId.set(run.runId, run);
    // A live run is newer than its settled copy, if a resume kept the run id.
    for (const run of live) byId.set(run.runId, run);
    return [...byId.values()]
      .filter((run) => !filter.captainId || run.captainId === filter.captainId)
      .filter((run) => !filter.containerId || run.containerId === filter.containerId)
      .sort((a, b) => b.startedAt - a.startedAt);
  }

  run(runId: string): SubagentRun | undefined {
    return this.live.get(runId)?.run ?? this.host.settledRuns().find((run) => run.runId === runId);
  }

  /** Starts a new run and returns its ack before the model turn completes. */
  spawn(captainId: string, agentName: string, task: string): SubagentRun {
    const captain = this.host.captainFor(captainId);
    if (!captain) throw new Error("captain session is not open");
    if (this.host.isArchived(captainId)) throw new Error("the captain's container is archived");
    const definition =
      discoverAgents(captain.cwd, this.host.agentDir, this.host.projectTrusted(captain.cwd)).find(
        (agent) => agent.name === agentName,
      ) ?? null;
    if (!definition) throw new Error(`unknown agent: ${agentName}`);
    const run: SubagentRun = {
      runId: this.nextRunId(),
      captainId,
      containerId: captain.containerId ?? "",
      agent: definition.name,
      task,
      status: "running",
      startedAt: Date.now(),
    };
    this.begin(captain, definition, run, task, false);
    return run;
  }

  /** Re-runs a settled subagent by opening its session file again. */
  resume(captainId: string, runId: string, task: string): SubagentRun {
    const captain = this.host.captainFor(captainId);
    if (!captain) throw new Error("captain session is not open");
    if (this.live.has(runId)) throw new Error("run is still live");
    const previous = this.host.settledRuns().find((run) => run.runId === runId);
    if (!previous?.sessionPath) throw new Error("settled run has no session file");
    const definition =
      discoverAgents(captain.cwd, this.host.agentDir, this.host.projectTrusted(captain.cwd)).find(
        (agent) => agent.name === previous.agent,
      ) ?? null;
    if (!definition) throw new Error(`unknown agent: ${previous.agent}`);
    const run: SubagentRun = {
      ...previous,
      task,
      status: "running",
      startedAt: Date.now(),
      settledAt: undefined,
      verdict: undefined,
      output: undefined,
    };
    this.begin(captain, definition, run, task, true);
    return run;
  }

  private begin(captain: CaptainLike, definition: AgentDefinition, run: SubagentRun, task: string, resume: boolean): void {
    this.host.appendCaptainNote(
      captain.id,
      "dispatch",
      `${resume ? "Resumed" : "Dispatched"} ${run.agent} · ${run.runId}`,
      { runId: run.runId, agent: run.agent, task },
    );
    this.host.emit("subagent.started", { run }, run.runId);
    const entry: LiveRun = {
      run,
      session: null,
      manager: null as any,
      aborted: false,
      promise: Promise.resolve(),
    };
    this.live.set(run.runId, entry);
    entry.promise = this.runTurn(captain, definition, run, task, resume).catch((error: any) => {
      this.settle(run, "failed", String(error?.message ?? error));
    });
  }

  private async runTurn(
    captain: CaptainLike,
    definition: AgentDefinition,
    run: SubagentRun,
    task: string,
    resume: boolean,
  ): Promise<void> {
    const entry = this.live.get(run.runId);
    if (!entry) return;
    const dir = join(stateDir(), "subagents", captain.id);
    mkdirSync(dir, { recursive: true });
    const parent = captain.manager.getSessionFile() ?? captain.path;
    const manager = resume && run.sessionPath
      ? SessionManager.open(run.sessionPath)
      : SessionManager.create(captain.cwd, dir, {
          id: run.runId,
          parentSession: parent || undefined,
        });
    const settings = SettingsManager.create(captain.cwd, this.host.agentDir, { projectTrusted: false });
    const loader = new DefaultResourceLoader({
      cwd: captain.cwd,
      agentDir: this.host.agentDir,
      settingsManager: settings,
      noExtensions: true,
      appendSystemPrompt: [definition.systemPrompt],
    });
    await loader.reload();
    let model = captain.session.model;
    if (definition.model?.includes("/")) {
      const [provider, ...rest] = definition.model.split("/");
      model = captain.session.modelRuntime?.getModel(provider, rest.join("/")) ?? model;
    }
    const created = await createAgentSession({
      cwd: captain.cwd,
      sessionManager: manager,
      settingsManager: settings,
      resourceLoader: loader,
      model,
      thinkingLevel: (definition.thinking as any) ?? captain.session.thinkingLevel,
      tools: definition.tools,
    });
    entry.session = created.session;
    entry.manager = manager;
    run.sessionPath = manager.getSessionFile() ?? "";
    await created.session.prompt(task);
    run.sessionPath = manager.getSessionFile() ?? run.sessionPath;
    const aborted = entry.aborted || created.session.state?.messages?.some((message: any) => message.stopReason === "aborted");
    const output = finalOutput(created.session.state?.messages ?? []);
    const status: SubagentStatus = run.status === "interrupted" ? "interrupted" : aborted ? "aborted" : "settled";
    this.settle(
      run,
      status,
      output,
      status === "settled" ? (output.match(/verdict:\s*(.+)/i)?.[1] ?? "completed") : status,
    );
    created.session.dispose();
  }

  private settle(run: SubagentRun, status: SubagentStatus, output: string, verdict = status): void {
    const entry = this.live.get(run.runId);
    if (!entry) return;
    this.live.delete(run.runId);
    run.status = status;
    run.output = output;
    run.verdict = verdict;
    run.settledAt = Date.now();
    this.host.saveSettled(run);
    this.host.appendCaptainNote(
      run.captainId,
      "delivery",
      `${run.agent} ${status} · ${run.runId}`,
      { runId: run.runId, status, verdict, summary: output.slice(0, 2000) },
    );
    this.host.emit("subagent.settled", { run }, run.runId);
  }

  async wait(runId: string): Promise<SubagentRun | undefined> {
    const entry = this.live.get(runId);
    if (entry) await entry.promise;
    return this.run(runId);
  }

  async inject(runId: string, message: string): Promise<void> {
    const entry = this.live.get(runId);
    if (!entry?.session) throw new Error("run is not live");
    await entry.session.sendUserMessage(message, { deliverAs: "steer" });
  }

  async abort(runId: string): Promise<void> {
    const entry = this.live.get(runId);
    if (!entry?.session) return;
    entry.aborted = true;
    await entry.session.abort();
  }

  /** Cascade: a captain's archive interrupts every live run of it. */
  async archiveCaptain(captainId: string): Promise<void> {
    const affected = [...this.live.values()].filter((entry) => entry.run.captainId === captainId);
    for (const entry of affected) {
      entry.run.status = "interrupted";
      entry.aborted = true;
      try {
        await entry.session?.abort();
      } catch {
        // A run that has not created its session yet still gets settled below.
      }
      if (this.live.has(entry.run.runId)) {
        this.settle(entry.run, "interrupted", entry.run.output ?? "", "interrupted");
      }
    }
  }

  transcript(runId: string): SubagentTranscriptData {
    const run = this.run(runId);
    if (!run) throw new Error("run not found");
    const entry = this.live.get(runId);
    if (entry?.session) {
      return { run, messages: (entry.session.state?.messages ?? []).map(plain) };
    }
    if (!run.sessionPath) return { run, messages: [] };
    try {
      const manager = SessionManager.open(run.sessionPath);
      return { run, messages: (manager.buildSessionContext().messages ?? []).map(plain) };
    } catch {
      return { run, messages: [] };
    }
  }

  dispose(): void {
    for (const entry of this.live.values()) {
      try {
        entry.session?.dispose();
      } catch {
        // Already gone.
      }
    }
    this.live.clear();
  }
}

function textResult(text: string, details: unknown = {}, isError = false) {
  return { content: [{ type: "text" as const, text }], details, ...(isError ? { isError: true } : {}) };
}

/** The dispatch tools, registered only on a captain's session. */
export function dispatchExtension(manager: SubagentManager, captainId: string) {
  return (pi: ExtensionAPI): void => {
    pi.registerTool({
      name: "dispatch",
      label: "Dispatch subagent",
      description:
        "Dispatch a subagent run in an isolated context. Without a runId, spawn `agent` with `task`. With a settled runId and a task, resume it. action=inject sends a message to a live run; action=abort stops it. Returns the run id immediately unless wait=true.",
      promptSnippet: "dispatch a subagent run / resume / inject / abort",
      parameters: Type.Object({
        action: Type.Optional(
          Type.Union([Type.Literal("spawn"), Type.Literal("resume"), Type.Literal("inject"), Type.Literal("abort")]),
        ),
        agent: Type.Optional(Type.String()),
        task: Type.Optional(Type.String()),
        runId: Type.Optional(Type.String()),
        message: Type.Optional(Type.String()),
        wait: Type.Optional(Type.Boolean()),
      }),
      async execute(_toolCallId: string, params: any, _signal: any, _onUpdate: any, _ctx: any) {
        try {
          const action = params.action ?? (params.runId ? "resume" : "spawn");
          if (action === "abort") {
            if (!params.runId) return textResult("runId is required to abort", {}, true);
            await manager.abort(params.runId);
            return textResult(`aborted ${params.runId}`, { runId: params.runId });
          }
          if (action === "inject") {
            if (!params.runId || !params.message) return textResult("runId and message are required", {}, true);
            await manager.inject(params.runId, params.message);
            return textResult(`injected into ${params.runId}`, { runId: params.runId });
          }
          if (action === "resume") {
            if (!params.runId || !params.task) return textResult("runId and task are required to resume", {}, true);
            const run = manager.resume(captainId, params.runId, params.task);
            if (params.wait) {
              const settled = await manager.wait(run.runId);
              return textResult(settled?.output ?? "(no output)", { run: settled });
            }
            return textResult(`resumed ${run.runId} (${run.agent})`, { run });
          }
          if (!params.agent || !params.task) return textResult("agent and task are required", {}, true);
          const run = manager.spawn(captainId, params.agent, params.task);
          if (params.wait) {
            const settled = await manager.wait(run.runId);
            return textResult(settled?.output ?? "(no output)", { run: settled });
          }
          return textResult(`dispatched ${run.agent} as ${run.runId}`, { run });
        } catch (error: any) {
          return textResult(String(error?.message ?? error), {}, true);
        }
      },
    });

    pi.registerTool({
      name: "list_agents",
      label: "List subagents",
      description: "List the captain's subagent runs: live and settled, with status and output.",
      parameters: Type.Object({}),
      async execute(_toolCallId: string, _params: any) {
        const runs = manager.list({ captainId });
        return textResult(
          runs.length === 0
            ? "no subagent runs"
            : runs
                .map(
                  (run) =>
                    `${run.runId} ${run.agent} ${run.status}${run.verdict ? ` (${run.verdict})` : ""}: ${run.task.slice(0, 120)}`,
                )
                .join("\n"),
          { runs },
        );
      },
    });
  };
}
