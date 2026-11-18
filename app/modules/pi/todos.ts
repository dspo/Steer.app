import { signal } from "nsh";
import { activeContainerId, containers, layout, noteSheetOpened, setLayout } from "../../core/containers";
import { splitRight } from "../../core/dock";
import { sessionIdsOfContainer } from "./container";
import { sessionSheetId } from "./sheets";
import { liveSession } from "./acp/host";
import { ensureAcpSession } from "./sessions";
import { EMPTY_PLAN, type PlanFile, type PlanOp } from "./protocol";

/**
 * The plan's app-side projection (A2). Plans are per pi session; reads and
 * writes ride `_zu/todos/list|write` on the session's harness — the same
 * store the model's `todo_*` tools use — so this module is never the
 * authority, only a viewer over the file. Readers poll while they are drawn:
 * the composer banner (per session) and the plan sheet (per container's
 * first session) each re-read on their own cadence, because the model
 * writes mid-turn and a push channel (`_zu/todos/changed`) can come later
 * without changing these calls.
 */

/** The plan each session's harness answered with, keyed by session id. */
export const plansById = signal<Record<string, PlanFile>>({});

/** Whether each session's model has the `todos` tools registered. */
export const planEnabledById = signal<Record<string, boolean>>({});

/** The panel's last load/write failure (the banner shows nothing instead). */
export const planError = signal<string | null>(null);

type PlanTransport = (type: string, payload?: Record<string, unknown>, timeoutMs?: number) => Promise<any>;
/** Test seam only; production goes through the live ACP session. */
let transport: PlanTransport | null = null;

/** Replaces the plan transport (tests drive it without a harness). */
export function setPlanTransport(next: PlanTransport | null): void {
  transport = next;
}

const loadingBy = new Set<string>();

/**
 * The container's first pi session: a live process, or one resumed for the
 * read (the panel must survive a restart, like the subagent roster).
 */
async function sessionForContainer(containerId: string) {
  const sessionId = sessionIdsOfContainer(containerId)[0];
  if (!sessionId) return null;
  const live = liveSession(sessionId);
  if (live && !live.dead) return live;
  return ensureAcpSession(sessionId);
}

async function request(sessionId: string, method: string, params: Record<string, unknown>): Promise<any> {
  if (transport) return transport(method.replace("_zu/todos/", "plan."), { ...params, sessionId }, 10000);
  const live = liveSession(sessionId);
  const session = live && !live.dead ? live : await ensureAcpSession(sessionId);
  if (!session) throw new Error("the session has no harness to read the plan from");
  return session.requestCustom(method, { ...params, sessionId: session.id });
}

/** One session's plan as last read, or null before the first answer. */
export function planFor(sessionId: string): PlanFile | null {
  return plansById()[sessionId] ?? null;
}

/** Reads one session's plan into `plansById`. Concurrent calls for the same
 * session coalesce. */
export async function loadPlanFor(sessionId: string): Promise<void> {
  if (!sessionId || loadingBy.has(sessionId)) return;
  loadingBy.add(sessionId);
  try {
    const data = await request(sessionId, "_zu/todos/list", {});
    plansById.update((plans) => ({ ...plans, [sessionId]: (data?.plan ?? EMPTY_PLAN) as PlanFile }));
    planEnabledById.update((flags) => ({ ...flags, [sessionId]: data?.enabled !== false }));
    planError.set(null);
  } catch (failure) {
    plansById.update((plans) => {
      const next = { ...plans };
      delete next[sessionId];
      return next;
    });
    planError.set(String(failure));
  } finally {
    loadingBy.delete(sessionId);
  }
}

/** Whether the plan's model-side tools are enabled. Off until the harness
 * answers: a session whose `todos` extension is disabled must not flash the
 * banner between mount and its first `_zu/todos/list`. */
export function planEnabled(sessionId: string): boolean {
  return planEnabledById()[sessionId] === true;
}

/** The plan sheet's read: its container's first session. */
export async function loadPlan(containerId?: string): Promise<void> {
  const target = containerId ?? activeContainerId();
  if (!target) return;
  const sessionId = sessionIdsOfContainer(target)[0];
  if (sessionId) await loadPlanFor(sessionId);
}

/** Applies one edit for one session and swaps in the plan the harness
 * answers with. The harness steers the model on its side (notes, wakes,
 * interrupts on removal); here the answer is just the new plan. */
export async function submitPlanOp(sessionId: string, op: PlanOp): Promise<boolean> {
  try {
    const data = await request(sessionId, "_zu/todos/write", { op });
    plansById.update((plans) => ({ ...plans, [sessionId]: (data?.plan ?? EMPTY_PLAN) as PlanFile }));
    planError.set(null);
    return true;
  } catch (failure) {
    planError.set(String(failure));
    return false;
  }
}

/** The panel's own adds carry `origin: "user"`; the model's carry `agent`. */
export function addPlanTodo(sessionId: string, title: string): Promise<boolean> {
  return submitPlanOp(sessionId, { kind: "add", title, origin: "user" });
}

/** The checkmark: done when checked, pending when cleared (reopened). */
export function togglePlanTodo(sessionId: string, id: string, done: boolean): Promise<boolean> {
  return submitPlanOp(sessionId, { kind: "update", id, status: done ? "done" : "pending" });
}

export function promotePlanTodo(sessionId: string, id: string): Promise<boolean> {
  return submitPlanOp(sessionId, { kind: "promote", id });
}

export function removePlanTodo(sessionId: string, id: string): Promise<boolean> {
  return submitPlanOp(sessionId, { kind: "remove", id });
}

/** The sheet id the plan panel of a container answers to. */
export function planSheetId(containerId: string): string {
  return `plan:${containerId}`;
}

/** The container whose captain (first session) is `sessionId`, or null. */
export function containerOfSession(sessionId: string): string | null {
  for (const container of containers()) {
    if (sessionIdsOfContainer(container.id)[0] === sessionId) return container.id;
  }
  return null;
}

/**
 * The banner's entry: splits the session's sheet to the right with its
 * container's plan sheet. A plan sheet that is already open is activated
 * instead (`splitRight` keeps one instance per sheet).
 */
export function openPlan(sessionId: string): void {
  const containerId = containerOfSession(sessionId);
  if (!containerId) return;
  const sheet = planSheetId(containerId);
  noteSheetOpened(sheet);
  setLayout(splitRight(layout(), sessionSheetId(sessionId), sheet));
}

/** The poll's period while a reader is drawn: the model writes mid-turn,
 * and a re-read is cheaper than a push channel. */
export const PLAN_POLL_MS = 1500;
