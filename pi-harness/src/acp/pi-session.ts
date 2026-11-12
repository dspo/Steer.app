/**
 * The pi glue behind the ACP surface: one in-process pi SDK session per ACP
 * session, its events mapped onto `session/update` payloads (v2 §4.1 — the
 * adapter embeds the SDK, no RPC subprocess).
 *
 * This is the createAgentSession wiring of the legacy loopback engine
 * (src/server.ts) reshaped for a protocol peer: no Zu registry, no wire
 * events, no containers — the ACP sessionId is pi's sessionId and pi's
 * session files stay the only durable authority. The dispatch/subagent
 * extension is deliberately absent (v2 §12: P3), and the legacy server keeps
 * serving the existing app untouched until the v2 P4 removal.
 *
 * Env the adapter reads:
 *   ACP_NO_EXTENSIONS=1            — load pi with no extensions at all
 *   ACP_EXTRA_EXTENSION_PATHS=a,b  — additional extension paths
 *
 * Project trust is conservative: a saved decision in pi's trust store is
 * honored; an unsaved one is treated as untrusted (project-local extensions
 * and settings stay unloaded) and logged — the dialog bridge is a later
 * stage (v2 §5.3 x-zu/ui.request).
 */

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

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
import type { AgentSessionEvent, ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import type { SessionUpdate, StopReason } from "@agentclientprotocol/sdk";
import { codedError } from "./errors";
import {
  assistantDeltaUpdate,
  stopReasonFromPi,
  toolCallEndUpdate,
  toolCallPartialUpdate,
  toolCallStartUpdate,
} from "./mapping";
import { replayUpdates, type ReplayEntry } from "./replay";
import type { HarnessPorts, HarnessSession, HarnessLog } from "./app";

type PiAgentSession = Awaited<ReturnType<typeof createAgentSession>>["session"];

const AGENT_DIR = getAgentDir();
const trustStore = new ProjectTrustStore(AGENT_DIR);

const extraExtensionPaths = (process.env.ACP_EXTRA_EXTENSION_PATHS ?? "")
  .split(",")
  .map((path) => path.trim())
  .filter(Boolean);
const noExtensions = process.env.ACP_NO_EXTENSIONS === "1";

/**
 * The one model registry for the process, awaited by every session: the
 * session's model, its picker and pi's catalog stay one view. A failed load
 * falls back to pi's per-session default; the failure is logged, never
 * silent.
 */
const modelRegistry: Promise<ModelRuntime | undefined> = ModelRuntime.create().catch((error: unknown) => {
  console.error(`[pi-acp] model registry unavailable: ${error instanceof Error ? error.message : String(error)}`);
  return undefined;
});

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

  private constructor(manager: SessionManager, session: PiAgentSession, cwd: string, log: HarnessLog) {
    this.manager = manager;
    this.session = session;
    this.cwd = cwd;
    this.log = log;
    this.id = manager.getSessionId();
    this.subscribe();
  }

  static async create(cwd: string, log: HarnessLog): Promise<PiHarnessSession> {
    const manager = SessionManager.create(cwd);
    return PiHarnessSession.build(manager, cwd, log);
  }

  static async open(path: string, cwd: string, log: HarnessLog): Promise<PiHarnessSession> {
    const manager = SessionManager.open(path);
    return PiHarnessSession.build(manager, cwd, log);
  }

  private static async build(manager: SessionManager, cwd: string, log: HarnessLog): Promise<PiHarnessSession> {
    const { settingsManager, resourceLoader } = await services(cwd, log);
    const created = await createAgentSession({
      sessionManager: manager,
      settingsManager,
      resourceLoader,
      cwd,
      modelRuntime: await modelRegistry,
    });
    const rec = new PiHarnessSession(manager, created.session, cwd, log);
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

  prompt(text: string): Promise<StopReason> {
    this.lastStop = undefined;
    return this.session.prompt(text).then(() => stopReasonFromPi(this.lastStop));
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
        default:
          // Turn lifecycle, compaction, retries, queue updates: no P0 update
          // shape (v2 §5.0 moves them to core events in later stages).
          return;
      }
    });
  }

  /**
   * Extension dialogs resolve pi's defaults and say so on stderr — explicit,
   * logged degradation (Q37) until the dialog bridge lands (v2 §5.3).
   * Notifications have no channel in P0 and are logged.
   */
  private uiContext(): ExtensionUIContext {
    const log = (method: string, detail: string) => this.log(`extension ui ${method} unavailable: ${detail}`);
    const noop = (method: string) => (..._args: unknown[]) => {
      log(method, "not supported over ACP yet");
      return undefined;
    };
    return {
      select: (title, _options, _opts) => {
        log("select", title);
        return Promise.resolve(undefined);
      },
      confirm: (title, _message, _opts) => {
        log("confirm", title);
        return Promise.resolve(false);
      },
      input: (title, _placeholder, _opts) => {
        log("input", title);
        return Promise.resolve(undefined);
      },
      editor: (title, _prefill) => {
        log("editor", title);
        return Promise.resolve(undefined);
      },
      notify: (message, _type) => {
        log("notify", message);
      },
      setStatus: (key, text) => {
        log("setStatus", `${key}: ${text}`);
      },
      setTitle: (title) => {
        log("setTitle", title);
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
        log("onTerminalInput", "not supported over ACP yet");
        return () => {};
      },
      getEditorText: () => {
        log("getEditorText", "not supported over ACP yet");
        return "";
      },
      getEditorComponent: () => {
        log("getEditorComponent", "not supported over ACP yet");
        return undefined;
      },
      getToolsExpanded: () => false,
      setToolsExpanded: noop("setToolsExpanded"),
      getAllThemes: () => [],
      getTheme: () => {
        log("getTheme", "not supported over ACP yet");
        return undefined;
      },
      setTheme: () => {
        return Promise.resolve({ success: false, error: "the client owns its theme" });
      },
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
async function services(cwd: string, log: HarnessLog) {
  const needsTrust = hasTrustRequiringProjectResources(cwd);
  const projectTrusted = !needsTrust || trustStore.get(cwd) === true;
  if (needsTrust && !projectTrusted) {
    log(`project resources for ${cwd} stay unloaded: no saved trust decision`);
  }
  const settingsManager = SettingsManager.create(cwd, AGENT_DIR, { projectTrusted });
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir: AGENT_DIR,
    settingsManager,
    additionalExtensionPaths: extraExtensionPaths,
    noExtensions,
    ...(needsTrust && !projectTrusted
      ? {
          // No dialog channel in P0: an unsaved decision is a NO, written to
          // neither the trust store nor the session.
          resolveProjectTrust: async () => false,
        }
      : {}),
  });
  await resourceLoader.reload();
  return { settingsManager, resourceLoader };
}

/** The HarnessPorts over real pi sessions. */
export function createPiPorts(log: HarnessLog): HarnessPorts {
  return {
    createSession: (cwd: string) => PiHarnessSession.create(cwd, log),
    loadSession: async (sessionId: string, cwd: string) => {
      const path = findPiSessionFile(sessionId);
      if (!path) {
        throw codedError(-32002, "session_not_found", `no session file for ${sessionId} under ${join(AGENT_DIR, "sessions")}`, {
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
      return PiHarnessSession.open(path, cwd, log);
    },
  };
}

/**
 * Resolves a session id to its file under `~/.pi/agent/sessions/` by file
 * name (pi names files `<timestamp>_<sessionId>.jsonl`). A bounded walk —
 * no full listing, no network.
 */
export function findPiSessionFile(sessionId: string): string | undefined {
  const root = join(AGENT_DIR, "sessions");
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
