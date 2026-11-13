import { signal } from "nsh";
import { K, t } from "../../ui/i18n";
import type { PlainMessage, SubagentRun } from "./protocol";
import { activeContainerId } from "../../core/containers";
import { openAuxSheet } from "./container";

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
/** Test seam only: the ACP harness carries no dispatch extension yet. */
let transport: SubagentTransport | null = null;

/** Replaces the roster transport (tests drive it without a harness). */
export function setSubagentTransport(next: SubagentTransport | null): void {
  transport = next;
}

let loading = false;

export async function loadSubagents(containerId?: string): Promise<void> {
  const target = containerId ?? activeContainerId();
  if (!target || loading) return;
  if (transport === null) {
    // The ACP distro carries no dispatch extension yet (P5): the roster says
    // so instead of spinning an empty list or inventing runs.
    runs.set([]);
    subagentError.set(t(K.session.acpSubagentsUnavailable));
    return;
  }
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
  if (!transport) return;
  try {
    const data = await transport("subagent.transcript", { runId }, 10000);
    transcript.set((data?.messages ?? []) as PlainMessage[]);
    subagentError.set(null);
  } catch (failure) {
    subagentError.set(String(failure));
  }
}

export async function abortRun(runId: string): Promise<void> {
  if (!transport) return;
  try {
    await transport("subagent.abort", { runId }, 10000);
    await loadSubagents();
  } catch (failure) {
    subagentError.set(String(failure));
  }
}
