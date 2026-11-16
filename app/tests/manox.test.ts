import { expect, test, beforeAll } from "nsh/test";
// `beforeAll` is used through the `setup` shim below (whole-file gate).
import { Manox } from "manox/native";
import {
  channels,
  connectionStatus,
  createSessionOn,
  dispatchAction,
  effectiveState,
  lastRejection,
  reconnect,
  request,
  setManoxHermetic,
  startConnection,
} from "../modules/manox/ahp";
import {
  chatOf,
  chatResource,
  createManoxThread,
  isArchived,
  sendManoxMessage,
  sessionResource,
} from "../modules/manox/stores";
import { sessionReducer } from "../../contracts/ahp/reducers";
import { SessionStatus, SessionLifecycle } from "../../contracts/ahp/channels-session/state";
import type { SessionState } from "../../contracts/ahp/channels-session/state";
import type { ChatState } from "../../contracts/ahp/channels-chat/state";
import type { Snapshot } from "../../contracts/ahp/common/state";

/** Whether this run opted into the live-model turn (real credentials). */
const live =
  typeof process !== "undefined" && process.env?.["MANOX_RUN_LIVE"] === "1";

/** Whole-file gate: the manox host boots hermetic (throwaway state roots
 * via a process env redirect), which only a dedicated invocation may do —
 * a shared suite runner also runs engine/lsp tests that need the real
 * HOME. Run with: ZU_MANOX_GATE=1 nsh test <this file>. */
const gated = process.env?.["ZU_MANOX_GATE"] === "1";
// Hermetic unless this is the live-model run: the live turn wants the
// process's own credentials, the hermetic redirect would hide them.
if (gated && !live) setManoxHermetic();
const t = gated ? test : test.skip;
const setup = gated ? beforeAll : (_: unknown) => {};

/**
 * The manox harness's gates, against the REAL in-proc host (native/manox
 * assembling dspo/manox v0.9.1): the §3.5 fold-convergence gate — the
 * client's vendored-reducer fold of the envelope stream (the host's journal
 * projection, every envelope stamped from it) vs the host's own snapshot
 * fold — plus the optimistic ledger's rejection rollback, the no-credential
 * turn's visible error, and the §3.4 crash-isolation gate (an injected
 * host-half panic reads as a transport error and the conversation continues
 * on the reconnect leg).
 *
 * No model credentials are assumed: the deterministic turn here is the
 * kernel's model-less path (no provider config in the test's MANOX_HOME), a
 * turn that settles into a visible `chat/error` fold. The live-model turn
 * runs behind MANOX_RUN_LIVE=1 (the last test, skipped by default).
 */


let threadId = "";
let chatId = "";
let chatUri = "";

async function waitUntil(predicate: () => boolean, timeoutMs = 30000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("the real host did not reach the expected state in time");
}

/** JSON round trip: the reducer's `undefined` values drop on both legs. */
function normalized(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

setup(async () => {
  startConnection();
  const created = await createManoxThread();
  threadId = created.threadId;
  chatId = created.chatId;
  chatUri = chatResource(chatId);
});

t("the real host answers the create flow and the chat snapshot carries the channel", async () => {
  // The client minted the session uuid; createSession is idempotent by uri —
  // a second create lands on the same channel (the host already holding the
  // channel is the client's "created" answer). One journal per session: the
  // chat channel needs no create leg, it is the session's default chat.
  await createSessionOn(sessionResource(threadId));
  const snapshot = await request<{ snapshot: Snapshot }>("subscribe", { channel: chatUri });
  expect(snapshot.snapshot.resource).toBe(chatUri);
  expect(snapshot.snapshot.fromSeq).toBeGreaterThan(0);
  // The subscriptions carry the session and chat channels the client created.
  expect(channels()[sessionResource(threadId)]).toBeTruthy();
  expect(channels()[chatUri]).toBeTruthy();
});

// Credential-sensitive: its premise is the no-model state the runner
// isolation provides. A live run (MANOX_RUN_LIVE=1) opts out of that
// isolation, so this gate would dispatch a real turn instead — skip it there.
((!live && gated) ? t : test.skip)("a model-less dispatch is refused with a visible reason, not a hang", async () => {
  // No provider exists in the test's state root: the harness's guard refuses
  // the submit before the kernel boots an engine that would die silently.
  // The host echoes the refusal on the channel (a rejection envelope on the
  // chat's numbered stream), the optimistic ledger rolls back, and the
  // reason stays readable — the failure is bounded and named, never a hang.
  lastRejection.set(null);
  const before = chatOf(chatId)?.turns.length ?? 0;
  sendManoxMessage(threadId, chatId, "no model here");
  await waitUntil(() => (channels()[chatUri]?.pending.length ?? 0) === 0);
  expect(lastRejection()).toBeTruthy();
  expect(lastRejection()!.uri).toBe(chatUri);
  expect(lastRejection()!.actionType).toBe("chat/turnStarted");
  expect(lastRejection()!.reason).toContain("no model");
  // The refused write never became a turn: the fold is exactly as before.
  expect(chatOf(chatId)?.activeTurn).toBeFalsy();
  expect(chatOf(chatId)?.turns.length).toBe(before);
});

t("the fold gate: the envelope-stream leg equals the host's snapshot fold", async () => {
  // Plant a refused dispatch first: a rejection travels on the wire like any
  // other envelope, and both legs skip it — the stream leg by the fold's
  // refusal rule, the snapshot by never having folded it. The equality below
  // means nothing unless the refusal is on record in the ledger's past.
  dispatchAction(chatUri, { type: "chat/notARealAction" } as never);
  await waitUntil(() => (channels()[chatUri]?.pending.length ?? 1) === 0);
  // Stream leg: the client's fold — the creation-time snapshot plus every
  // envelope since (each one stamped from the host's journal projection),
  // through the vendored reducers, refusals skipped. `effectiveState` is
  // exactly that fold.
  const streamed = effectiveState<ChatState>(chatUri)!;
  // Snapshot leg: the host's own authoritative fold, right now.
  const snapshot = await request<{ snapshot: Snapshot }>("subscribe", { channel: chatUri });
  expect(normalized(streamed)).toEqual(normalized(snapshot.snapshot.state));
});

t("a refused dispatch rolls the optimistic state back", async () => {
  // The ledger folds the bad dispatch optimistically, before any echo.
  dispatchAction(chatUri, { type: "chat/notARealAction" } as never);
  expect(channels()[chatUri]!.pending.length).toBe(1);
  // The host refuses (the action is not dispatchable): the echo carries
  // `rejectionReason`, the ledger drops the entry, and the fold returns to
  // the server's truth — the refused action never existed.
  await waitUntil(() => chatOf(chatId) != null && (channels()[chatUri]?.pending.length ?? 1) === 0);
  const snapshot = await request<{ snapshot: Snapshot }>("subscribe", { channel: chatUri });
  expect(normalized(effectiveState<ChatState>(chatUri))).toEqual(
    normalized(snapshot.snapshot.state),
  );
});

t("the archived bit is the folded IsArchived flag", () => {
  const base: SessionState = {
    provider: "",
    title: "thread",
    status: SessionStatus.Idle,
    lifecycle: SessionLifecycle.Ready,
    activeClients: [],
    chats: [],
  };
  const archived = sessionReducer(base, {
    type: "session/isArchivedChanged",
    isArchived: true,
  } as never);
  expect((archived.status ?? 0) & SessionStatus.IsArchived).toBeTruthy();
  const lifted = sessionReducer(archived, {
    type: "session/isArchivedChanged",
    isArchived: false,
  } as never);
  expect((lifted.status ?? 0) & SessionStatus.IsArchived).toBeFalsy();
  // The projection reads the fold, so a live thread reads not-archived.
  expect(isArchived(threadId)).toBe(false);
});

// Credential-sensitive by order: a live run's earlier accepted turn holds
// the activeTurn this drill's sends assume idle. Skip under MANOX_RUN_LIVE=1.
((!live && gated) ? t : test.skip)("an injected host-half panic reads as a transport error and the conversation continues", async () => {
  expect(Manox.status()).toBe("running");
  Manox.injectPanic();
  await waitUntil(() => connectionStatus() === "error");
  // The shell survived; the pump is alive, only the host session ended.
  expect(Manox.status()).toBe("running");
  // The recovery path: rebuild the transport, reconnect, keep talking —
  // a full turn after the panic proves the loop is whole (the real host
  // singleton persists, so the reconnect leg reconciles against the same
  // journal).
  await reconnect();
  expect(connectionStatus()).toBe("ready");
  // The conversation continues: a dispatch after the panic runs the whole
  // loop again on the rebuilt connection — the host answers, the echo
  // carries a reason, the ledger rolls back. The dispatch is the bogus
  // action on purpose: its refusal is deterministic in ANY environment
  // (model credentials change what a turn does, never what a bogus action
  // does), so this gate proves the wire is whole, nothing more.
  lastRejection.set(null);
  dispatchAction(chatUri, { type: "chat/notARealAction" } as never);
  await waitUntil(() => lastRejection() != null, 20000);
  expect(lastRejection()!.uri).toBe(chatUri);
  expect(lastRejection()!.actionType).toBe("chat/notARealAction");
  expect(lastRejection()!.reason.length).toBeGreaterThan(0);
  expect(chatOf(chatId)?.activeTurn).toBeFalsy();
});

/**
 * The live-model turn, behind MANOX_RUN_LIVE=1: dispatches a real prompt
 * against the credentials in the process's own state root (do NOT set
 * MANOX_HOME for this run) and waits for the turn to settle complete.
 * Skipped by default — every other gate here is credential-free.
 *
 *   MANOX_RUN_LIVE=1 nsh test app/manox.test.ts
 */
((live && gated) ? t : test.skip)("a live model turn streams a response and settles", async () => {
  dispatchAction(chatUri, {
    type: "chat/turnStarted",
    turnId: `live-${Date.now()}`,
    startedAt: new Date().toISOString(),
    message: { text: "Reply with the single word: ready.", origin: { kind: "user" } },
  } as never);
  await waitUntil(() => chatOf(chatId)?.activeTurn != null, 20000);
  try {
    // A real turn can park on approvals; give it a generous window.
    await waitUntil(() => chatOf(chatId)?.activeTurn == null, 180000);
  } catch {
    const active = chatOf(chatId)?.activeTurn;
    if (active != null) {
      dispatchAction(chatUri, {
        type: "chat/turnCancelled",
        turnId: active.id,
        duration: 100,
      } as never);
    }
    throw new Error("the live turn did not settle within 180s (cancelled)");
  }
  const settled = chatOf(chatId)?.turns.at(-1);
  expect(settled?.state).toBe("complete");
});
