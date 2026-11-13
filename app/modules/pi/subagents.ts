import { signal } from "nsh";
import { K, t } from "../../ui/i18n";
import type { PlainMessage, SubagentRun } from "./protocol";
import { activeContainerId } from "../../core/containers";
import { openAuxSheet, sessionIdsOfContainer } from "./container";
import { liveSession } from "./acp/host";
import { ensureAcpSession } from "./sessions";

/**
 * The shell's projection of subagent runs. Live runs come from the engine's
 * memory; settled runs from its registry. The roster sheet is opened on the
 * first dispatch of the active container and can be opened by hand.
 */

export const runs = signal<SubagentRun[]>([]);
export const selectedRunId = signal<string | null>(null);
export const transcript = signal<PlainMessage[]>([]);
export const subagentError = signal<string | null>(null);

type SubagentTransport = (type: string, payload?: Record<string, unknown>, timeoutMs?: number) => Promise<any>;
/** Test seam only; production goes through the live ACP session. */
let transport: SubagentTransport | null = null;

/** Replaces the roster transport (tests drive it without a harness). */
export function setSubagentTransport(next: SubagentTransport | null): void {
  transport = next;
}

let loading = false;

/**
 * The container's captain session: a live process, or one resumed for the
 * read (the roster must survive a restart, when only settled runs remain).
 */
async function sessionForContainer(containerId: string) {
  const sessionId = sessionIdsOfContainer(containerId)[0];
  if (!sessionId) return null;
  const live = liveSession(sessionId);
  if (live && !live.dead) return live;
  return ensureAcpSession(sessionId);
}

async function request(containerId: string, method: string, params: Record<string, unknown>): Promise<any> {
  if (transport) return transport(method.replace("_zu/subagents/", "subagent."), params, 10000);
  const session = await sessionForContainer(containerId);
  if (!session) throw new Error("the container has no session to read the roster from");
  return session.requestCustom(method, { ...params, sessionId: session.id });
}

export async function loadSubagents(containerId?: string): Promise<void> {
  const target = containerId ?? activeContainerId();
  if (!target || loading) return;
  loading = true;
  try {
    const data = await request(target, "_zu/subagents/list", {});
    runs.set((data?.runs ?? []) as SubagentRun[]);
    subagentError.set(null);
  } catch (failure) {
    runs.set([]);
    subagentError.set(String(failure));
  } finally {
    loading = false;
  }
}

/** Opens the roster sheet of the active container and loads it. */
export function openSubagents(): void {
  const container = activeContainerId();
  if (!container) return;
  openAuxSheet("subagents");
  void loadSubagents(container);
}

/** Selects a run and reads its read-only transcript. */
export async function selectRun(runId: string): Promise<void> {
  selectedRunId.set(runId);
  transcript.set([]);
  const containerId = activeContainerId();
  if (!containerId) return;
  try {
    const data = await request(containerId, "_zu/subagents/transcript", { runId });
    transcript.set((data?.messages ?? []) as PlainMessage[]);
    subagentError.set(null);
  } catch (failure) {
    subagentError.set(String(failure));
  }
}

export async function abortRun(runId: string): Promise<void> {
  const containerId = activeContainerId();
  if (!containerId) return;
  try {
    await request(containerId, "_zu/subagents/abort", { runId });
    await loadSubagents(containerId);
  } catch (failure) {
    subagentError.set(String(failure));
  }
}
