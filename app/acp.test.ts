import { expect, test } from "nsh/test";
import { Acp } from "zu/native";
import { JsonrpcChannel, JsonrpcFailure } from "./modules/pi/acp/jsonrpc";
import {
  activeTurn,
  isTurnActive,
  loadTranscript,
  startTurn,
} from "./modules/pi/acp/acp";
import { transcriptFromReplay, updateToStoreEvents } from "./modules/pi/acp/fold";
import { acpEnabled } from "./modules/pi/sessions";

// The ACP transport without pi: the native `Acp` pump is driven against a
// stub agent (fixtures/acp-stub-agent.sh) that speaks the same ndjson method
// surface dist/pi-acp does, so the tests are deterministic and offline. The
// distro's own surface has its own smoke (pi-harness/scripts/acp-smoke.ts).

const STUB = new URL("./fixtures/acp-stub-agent.sh", import.meta.url).pathname;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function until(what: string, condition: () => boolean, timeoutMs = 10000): Promise<void> {
  for (let waited = 0; waited < timeoutMs; waited += 20) {
    if (condition()) return;
    await sleep(20);
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** Starts a turn against the stub in `mode` (the stub's env switches), with
 * an optional pre-bound session id (a load). */
function stubTurn(mode: Record<string, string> = {}, sessionId?: string) {
  return startTurn({
    cwd: "/tmp",
    text: "hello",
    ...(sessionId ? { sessionId } : {}),
    command: "/bin/sh",
    args: [STUB],
    env: mode,
    hooks: { onUpdate: () => {}, onNotice: () => {} },
  });
}

test("a turn streams its updates live", async () => {
  const kinds: string[] = [];
  const handle = startTurn({
    cwd: "/tmp",
    text: "hello",
    command: "/bin/sh",
    args: [STUB],
    env: { STUB_PROMPT_UPDATES: "1" },
    hooks: { onUpdate: (update) => kinds.push(String(update.sessionUpdate)), onNotice: () => {} },
  });
  const result = await handle.done;
  expect(result.stopReason).toBe("end_turn");
  expect(kinds).toContain("tool_call");
  expect(kinds).toContain("agent_message_chunk");
  expect(kinds).toContain("tool_call_update");
});

test("the native pump frames ndjson lines both ways", async () => {
  // `cat` is the echo harness: every line in comes back out, framed.
  const frames: string[] = [];
  const acp = Acp.start({ cwd: "/tmp", command: "/bin/sh", args: ["-c", "cat"] }, (line) => frames.push(line), () => {});
  acp.send('{"id":1}');
  acp.send('{"id":2,"method":"probe"}');
  await until("the echoed frames", () => frames.length >= 2);
  expect(frames[0]).toBe('{"id":1}');
  expect(frames[1]).toBe('{"id":2,"method":"probe"}');
  expect(acp.alive()).toBe(true);
  expect(acp.pid).toBeGreaterThan(0);
  // The graceful exit: stdin to EOF, the process flushes and leaves.
  acp.finish();
  await until("the process to exit", () => !acp.alive());
  expect(acp.exitCode).toBe(0);
  expect(acp.exitSignal).toBeNull();
  acp.dispose();
});

test("a spawn of a missing harness is a coded error, not a hang", () => {
  let error: any;
  try {
    Acp.start({ cwd: "/tmp", command: "/definitely/not/a/harness" }, () => {}, () => {});
  } catch (failure) {
    error = failure;
  }
  expect(String(error?.message ?? error)).toContain("/definitely/not/a/harness");
});

test("jsonrpc pairs pipelined ids and routes notifications", async () => {
  const out: string[] = [];
  const channel = new JsonrpcChannel((line) => out.push(line));
  const first = channel.request("initialize", {}, 5000);
  const second = channel.request("probe/missing", undefined, 5000);
  // The echo drain pairs every request id back as its own reply.
  for (const line of out.splice(0, out.length)) {
    const request = JSON.parse(line);
    channel.handleLine(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { echoed: request.method } }));
  }
  expect((await first).echoed).toBe("initialize");
  await expect(second).resolves.toEqual({ echoed: "probe/missing" });
  // A notification without an id is dispatched, never paired.
  const notes: string[] = [];
  channel.onMessage((message) => notes.push(message.method));
  channel.handleLine('{"jsonrpc":"2.0","method":"session/update","params":{}}');
  expect(notes).toEqual(["session/update"]);
  // A reply for an unknown id is dropped (logged), not mispaired.
  channel.handleLine('{"jsonrpc":"2.0","id":999,"result":{}}');
  expect(channel.hasPending).toBe(false);
  // An error reply rejects with the code and the distro's data.code.
  const failing = channel.request("session/load", {}, 5000);
  channel.handleLine(JSON.stringify({
    jsonrpc: "2.0",
    id: JSON.parse(out[out.length - 1]).id,
    error: { code: -32002, message: "no session file", data: { code: "session_not_found" } },
  }));
  const failure = await failing.catch((error) => error);
  expect(failure instanceof JsonrpcFailure).toBe(true);
  expect((failure as JsonrpcFailure).dataCode).toBe("session_not_found");
});

test("a request after the transport died fails instead of hanging", async () => {
  const channel = new JsonrpcChannel(() => {});
  const pending = channel.request("session/prompt", {}, 5000);
  channel.failAll("the harness exited mid-turn");
  await expect(pending).rejects.toThrow("exited mid-turn");
  await expect(channel.request("initialize", {}, 5000)).rejects.toThrow("closed");
});

test("a turn mints a session, settles end_turn and clears the busy state", async () => {
  const turn = stubTurn({});
  await until("a session id", () => turn.sessionId !== null);
  expect(turn.sessionId).toBe("stub-0000-0001");
  const result = await turn.done;
  expect(result.stopReason).toBe("end_turn");
  expect(result.sessionId).toBe("stub-0000-0001");
  expect(isTurnActive(result.sessionId)).toBe(false);
});

test("a held prompt is cancelled by the stop", async () => {
  const turn = stubTurn({ STUB_HOLD_PROMPT: "1" });
  await until("the turn to register as active", () => turn.sessionId !== null && isTurnActive(turn.sessionId!));
  expect(activeTurn(turn.sessionId!)).not.toBeNull();
  turn.cancel();
  const result = await turn.done;
  expect(result.stopReason).toBe("cancelled");
  expect(isTurnActive(result.sessionId)).toBe(false);
});

test("a loaded turn replays before its turn streams", async () => {
  const replay: string[] = [];
  const kinds: string[] = [];
  const handle = startTurn({
    cwd: "/tmp",
    text: "again",
    sessionId: "stub-0000-0002",
    command: "/bin/sh",
    args: [STUB],
    env: { STUB_LOAD_REPLAY: "1" },
    onReplay: (rows) => {
      for (const row of rows) replay.push(String(row.sessionUpdate));
    },
    hooks: { onUpdate: (update) => kinds.push(String(update.sessionUpdate)), onNotice: () => {} },
  });
  const result = await handle.done;
  expect(result.sessionId).toBe("stub-0000-0002");
  expect(result.stopReason).toBe("end_turn");
  // The replay precedes the turn; the stub's prompt branch adds no updates.
  expect(replay).toEqual(["user_message_chunk", "agent_message_chunk"]);
  expect(kinds).toEqual([]);
});

test("a mid-turn process death fails the turn", async () => {
  const turn = stubTurn({ STUB_MIDTURN_EXIT: "1" });
  await expect(turn.done).rejects.toThrow(/exited mid-turn/);
});

test("a session/new failure carries the distro's coded error", async () => {
  const turn = stubTurn({ STUB_NEW_FAIL: "1" });
  const failure = await turn.done.catch((error) => error);
  expect(String(failure?.message ?? failure)).toContain("stub_refused");
});

test("loadTranscript returns the replay without a turn", async () => {
  const { updates } = await loadTranscript({
    cwd: "/tmp",
    sessionId: "stub-0000-0002",
    command: "/bin/sh",
    args: [STUB],
    env: { STUB_LOAD_REPLAY: "1" },
  });
  expect(updates.map((update) => update.sessionUpdate)).toEqual(["user_message_chunk", "agent_message_chunk"]);
  const rows = transcriptFromReplay(updates);
  expect(rows.map((row) => row.role)).toEqual(["user", "assistant"]);
  expect(rows[0].text).toBe("earlier question");
  expect(rows[1].text).toBe("earlier answer");
});

test("the fold translates ACP updates into store events", () => {
  const delta = updateToStoreEvents({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hi" } });
  expect(delta).toEqual([{ type: "message.delta", data: { delta: "hi" } }]);
  const start = updateToStoreEvents({
    sessionUpdate: "tool_call",
    toolCallId: "t1",
    name: "read",
    title: "read x",
    status: "in_progress",
  });
  expect(start).toEqual([{ type: "tool.start", data: { toolName: "read", toolCallId: "t1" } }]);
  const end = updateToStoreEvents({ sessionUpdate: "tool_call_update", toolCallId: "t1", status: "failed" });
  expect(end).toEqual([{ type: "tool.end", data: { toolName: undefined, toolCallId: "t1", isError: true } }]);
  // Thinking chunks have no lane yet; mode/model updates are not folded.
  expect(updateToStoreEvents({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "hmm" } })).toEqual([]);
  expect(updateToStoreEvents({ sessionUpdate: "current_mode_update" })).toEqual([]);
});

test("the replay fold groups chunked messages and settles tool cards", () => {
  const rows = transcriptFromReplay([
    { sessionUpdate: "user_message_chunk", content: { type: "text", text: "q" } },
    { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "a" }, messageId: "m1" },
    { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "b" }, messageId: "m1" },
    { sessionUpdate: "tool_call", toolCallId: "t9", name: "bash", title: "bash ls" },
    { sessionUpdate: "tool_call_update", toolCallId: "t9", status: "completed" },
  ]);
  expect(rows.map((row) => row.role)).toEqual(["user", "assistant", "tool"]);
  expect(rows[1].text).toBe("ab");
  expect(rows[2].tool?.state).toBe("done");
});

test("the store-level ACP branch is the only transport", () => {
  expect(acpEnabled()).toBe(true);
});

test("leaves the transport unpinned", () => {
  expect(activeTurn("nothing")).toBeNull();
});

test("a held prompt on a loaded session is cancelled too", async () => {
  const handle = startTurn({
    cwd: "/tmp",
    text: "count slowly",
    sessionId: "stub-0000-0002",
    command: "/bin/sh",
    args: [STUB],
    env: { STUB_HOLD_PROMPT: "1" },
    hooks: { onUpdate: () => {}, onNotice: () => {} },
  });
  await until("the turn to register", () => handle.sessionId !== null && isTurnActive(handle.sessionId!));
  handle.cancel();
  const result = await handle.done;
  expect(result.stopReason).toBe("cancelled");
  expect(isTurnActive(result.sessionId)).toBe(false);
});
