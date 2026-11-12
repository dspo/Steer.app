import { expect, test, beforeAll } from "nsh/test";
import { Manox } from "manox/native";
import {
  channels,
  connectionStatus,
  dispatchAction,
  effectiveState,
  foldCell,
  reconnect,
  request,
  startConnection,
  type ChannelCell,
} from "./harness/manox/ahp";
import {
  chatOf,
  chatResource,
  createManoxThread,
  isArchived,
  sendManoxMessage,
  sessionResource,
  sidebarRows,
} from "./harness/manox/stores";
import { sessionReducer } from "../contracts/ahp/reducers";
import { SessionStatus, SessionLifecycle } from "../contracts/ahp/channels-session/state";
import type { SessionState } from "../contracts/ahp/channels-session/state";
import type { ChatState } from "../contracts/ahp/channels-chat/state";
import type { ActionEnvelope, StateAction } from "../contracts/ahp/common/actions";
import type { Snapshot } from "../contracts/ahp/common/state";

/**
 * The manox harness's gates, against the real in-proc stub host
 * (native/manox): the §3.5 fold-convergence gate (snapshot leg vs journal
 * replay leg through the vendored reducers), the optimistic ledger's
 * rejection rollback, the archived bit's fold, the sidebar projection, and
 * the §3.4 crash-isolation gate (an injected host-half panic reads as a
 * transport error and the conversation continues on the reconnect leg).
 *
 * Driving the wire through the connection's own `request` keeps the legs
 * honest: the snapshot leg is the host's fold, the replay leg is the
 * vendored TS reducer's fold of the very same journal.
 */

let threadId = "";
let chatId = "";
let chatUri = "";
/** The chat's state at creation: the replay leg's fold base. */
let initialChatState: ChatState | null = null;
let initialServerSeq = 0;

async function waitUntil(predicate: () => boolean, timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("the stub host did not reach the expected state in time");
}

/** Confirms the parked tool call and answers the elicitation; settles. */
async function runFullTurn(text: string): Promise<void> {
  const before = chatOf(chatId)?.turns.length ?? 0;
  sendManoxMessage(threadId, chatId, text);
  await waitUntil(() =>
    chatOf(chatId)?.activeTurn?.responseParts.some(
      (part) => part.kind === "toolCall" && part.toolCall.status === "pending-confirmation",
    ) ?? false,
  );
  const active = chatOf(chatId)!.activeTurn!;
  const call = active.responseParts.find(
    (part): part is Extract<typeof part, { kind: "toolCall" }> => part.kind === "toolCall",
  )!;
  dispatchAction(chatUri, {
    type: "chat/toolCallConfirmed",
    turnId: active.id,
    toolCallId: call.toolCall.toolCallId,
    approved: true,
    confirmed: "user-action",
  } as never);
  await waitUntil(() =>
    (chatOf(chatId)?.activeTurn?.responseParts.some((part) => part.kind === "inputRequest")) ?? false,
  );
  const elicitation = chatOf(chatId)!.activeTurn!.responseParts.find(
    (part): part is Extract<typeof part, { kind: "inputRequest" }> => part.kind === "inputRequest",
  )!;
  dispatchAction(chatUri, {
    type: "chat/inputCompleted",
    requestId: elicitation.request.id,
    response: "accept",
    answers: { q1: { state: "submitted", value: { kind: "text", value: "the gate answer" } } },
  } as never);
  // Two turns per dispatch: the queued follow-up runs as its own turn.
  await waitUntil(() => {
    const state = chatOf(chatId);
    return (
      state != null &&
      state.activeTurn == null &&
      state.turns.length >= before + 2
    );
  });
}

/** JSON round trip: the reducer's `undefined` values drop on both legs. */
function normalized(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

beforeAll(async () => {
  startConnection();
  const created = await createManoxThread();
  threadId = created.threadId;
  chatId = created.chatId;
  chatUri = chatResource(chatId);
  // The replay leg's base: the chat state as created, before any dispatch.
  const snapshot = await request<{ snapshot: Snapshot }>("subscribe", { channel: chatUri });
  initialChatState = snapshot.snapshot.state as ChatState;
  initialServerSeq = snapshot.snapshot.fromSeq;
});

test("the scripted turn runs to two settled turns with tool and elicitation", async () => {
  await runFullTurn("gate run");
  const chat = chatOf(chatId)!;
  expect(chat.turns.length).toBe(2);
  expect(chat.turns[0].state).toBe("complete");
  expect(chat.turns[1].state).toBe("complete");
  const parts = chat.turns[0].responseParts;
  expect(
    parts.some(
      (part) => part.kind === "toolCall" && part.toolCall.status === "completed",
    ) ?? false,
  ).toBe(true);
  const elicitation = parts.find((part) => part.kind === "inputRequest");
  expect(elicitation?.response).toBe("accept");
});

test("the fold gate: the journal-replay leg equals the snapshot leg", async () => {
  // Plant a refused dispatch first: a rejection is journaled like any other
  // envelope, so the replay must carry it — and both legs must skip it
  // identically — for the equality below to mean anything.
  dispatchAction(chatUri, { type: "chat/notARealAction" } as never);
  await waitUntil(() => (channels()[chatUri]?.pending.length ?? 1) === 0);
  // Snapshot leg: the host's fold, right now.
  const snapshot = await request<{ snapshot: Snapshot }>("subscribe", { channel: chatUri });
  // Replay leg: every envelope after the creation seq, folded through the
  // vendored reducer, skipping refusals exactly as the client does.
  const result = await request<{ type: string; actions: ActionEnvelope[] }>("reconnect", {
    channel: "ahp-root://",
    clientId: "gate-client",
    lastSeenServerSeq: initialServerSeq,
    subscriptions: [chatUri],
  });
  expect(result.type).toBe("replay");
  let folded: ChatState = JSON.parse(JSON.stringify(initialChatState));
  const cell: ChannelCell = { uri: chatUri, serverSeq: initialServerSeq, state: folded, pending: [] };
  let refusals = 0;
  for (const envelope of result.actions) {
    if (envelope.channel !== chatUri) continue; // the client routes by channel
    if (envelope.rejectionReason) {
      refusals += 1;
      continue;
    }
    const next = foldCell(cell, envelope.action as StateAction);
    folded = next.state as ChatState;
    cell.state = folded;
  }
  expect(normalized(folded)).toEqual(normalized(snapshot.snapshot.state));
  // The planted bad action travels on the replay as a refusal.
  expect(refusals).toBe(1);
});

test("a refused dispatch rolls the optimistic state back", async () => {
  // A turn runs; the dispatch of a second one is optimistically folded on
  // top until the host's refusal echo drops it from the ledger.
  sendManoxMessage(threadId, chatId, "the refusal run");
  await waitUntil(() => chatOf(chatId)?.activeTurn != null);
  const active = chatOf(chatId)!.activeTurn!;
  // The real turn's echo lands first (the optimistic fold ran before it);
  // the ledger drains, and only the bad dispatch is in flight after that.
  await waitUntil(() => (channels()[chatUri]?.pending.length ?? 1) === 0);
  dispatchAction(chatUri, {
    type: "chat/turnStarted",
    turnId: "rejected-turn",
    startedAt: new Date().toISOString(),
    message: { text: "should refuse", origin: { kind: "user" } },
  } as never);
  // The ledger folded it optimistically, before any echo.
  expect(chatOf(chatId)!.activeTurn?.id).toBe("rejected-turn");
  expect(channels()[chatUri]!.pending.length).toBe(1);
  // The host refuses (a turn is already active): the echo carries
  // `rejectionReason`, the ledger drops the entry, and the fold returns to
  // the server's truth — the refused turn never existed.
  await waitUntil(() => chatOf(chatId)?.activeTurn?.id === active.id);
  expect(channels()[chatUri]!.pending.length).toBe(0);
  // Settle the real turn (cancel), then at the quiet moment both legs must
  // agree exactly: the client's fold vs a fresh host snapshot — the refused
  // action appears in neither.
  dispatchAction(chatUri, {
    type: "chat/turnCancelled",
    turnId: active.id,
    duration: 20,
  } as never);
  await waitUntil(() => chatOf(chatId)?.activeTurn == null);
  const snapshot = await request<{ snapshot: Snapshot }>("subscribe", { channel: chatUri });
  expect(normalized(effectiveState<ChatState>(chatUri))).toEqual(
    normalized(snapshot.snapshot.state),
  );
});

test("the archived bit is the folded IsArchived flag", () => {
  const base: SessionState = {
    provider: "stub",
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

test("the sidebar projection names the container and keeps the default chat", () => {
  const rows = sidebarRows(null);
  const mine = rows.find((row) => row.threadId === threadId);
  expect(mine).toBeTruthy();
  expect(mine!.id).toBe(`manox:${threadId}`);
  expect(mine!.chatId).toBe(chatId);
});

test("an injected host-half panic reads as a transport error and the conversation continues", async () => {
  expect(Manox.status()).toBe("running");
  Manox.injectPanic();
  await waitUntil(() => connectionStatus() === "error");
  // The shell survived; the pump is alive, only the host session ended.
  expect(Manox.status()).toBe("running");
  // The recovery path: rebuild the transport, reconnect, keep talking —
  // a full turn (the script parks at its approval, so the whole loop has
  // to work again) proves the conversation truly continues.
  await reconnect();
  expect(connectionStatus()).toBe("ready");
  const before = chatOf(chatId)?.turns.length ?? 0;
  await runFullTurn("after the panic");
  // The turn after the panic carries the new message, and the script's
  // queued follow-up ran behind it — the loop is whole again, in shape.
  const chat = chatOf(chatId)!;
  expect(chat.turns[before].message.text).toBe("after the panic");
  expect(chat.turns[before].state).toBe("complete");
  expect(chat.turns[before + 1].message.text).toBe("follow-up to: after the panic");
  expect(chat.turns[before + 1].state).toBe("complete");
});
