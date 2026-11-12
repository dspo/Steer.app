import { signal } from "nsh";
import { onEngineEvent, request } from "./engine";
import type { PlainMessage, SubagentRun } from "../contracts/protocol";
import { activeContainerId, openAuxSheet } from "./containers";

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
let transport: SubagentTransport = request;

/** Replaces the engine transport (tests drive the roster without a sidecar). */
export function setSubagentTransport(next: SubagentTransport | null): void {
  transport = next ?? request;
}

let loading = false;

export async function loadSubagents(containerId?: string): Promise<void> {
  const target = containerId ?? activeContainerId();
  if (!target || loading) return;
  loading = true;
  try {
    const data = await transport("subagent.list", { containerId: target }, 10000);
    runs.set((data?.runs ?? []) as SubagentRun[]);
    subagentError.set(null);
  } catch (failure) {
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
  try {
    const data = await transport("subagent.transcript", { runId }, 10000);
    transcript.set((data?.messages ?? []) as PlainMessage[]);
    subagentError.set(null);
  } catch (failure) {
    subagentError.set(String(failure));
  }
}

export async function abortRun(runId: string): Promise<void> {
  try {
    await transport("subagent.abort", { runId }, 10000);
    await loadSubagents();
  } catch (failure) {
    subagentError.set(String(failure));
  }
}

onEngineEvent((event) => {
  if (event.type !== "subagent.started" && event.type !== "subagent.settled") return;
  const run = (event.data as any)?.run as SubagentRun | undefined;
  if (!run) return;
  if (run.containerId && run.containerId === activeContainerId()) {
    if (event.type === "subagent.started") openSubagents();
    void loadSubagents(run.containerId);
    if (selectedRunId() === run.runId) void selectRun(run.runId);
  }
});
