import { expect, test } from "nsh/test";
import { Acp } from "zu/native";
import { JsonrpcChannel, JsonrpcFailure } from "./modules/pi/acp/jsonrpc";
import { setAcpCommandOverride } from "./modules/pi/acp/acp";
import {
  closeAllSessions,
  closeSession,
  liveSession,
  openExistingSession,
  openNewSession,
  type AcpSession,
} from "./modules/pi/acp/host";
import { transcriptFromReplay, updateToStoreEvents } from "./modules/pi/acp/fold";
import { acpEnabled } from "./modules/pi/sessions";
import { stubCommand } from "./fixtures/stub-command";

// The ACP runtime without pi: the native `Acp` pump drives a stub agent
// (fixtures/acp-stub-agent.ts) that speaks the distro's ndjson surface.

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function until(what: string, condition: () => boolean, timeoutMs = 10000): Promise<void> {
  for (let waited = 0; waited < timeoutMs; waited += 20) {
    if (condition()) return;
    await sleep(20);
  }
  throw new Error(`timed out waiting for ${what}`);
}

function withStub(mode: Record<string, string>, run: (open: () => Promise<AcpSession>) => Promise<void>) {
  return async () => {
    setAcpCommandOverride(stubCommand(mode));
    try {
      await run(() => openNewSession("/tmp"));
    } finally {
      await closeAllSessions();
      setAcpCommandOverride(null);
    }
  };
}

test(
  "a session streams its updates live and settles",
  withStub({ STUB_PROMPT_UPDATES: "1" }, async (open) => {
    const kinds: string[] = [];
    const session = await open();
    session.setHandlers({
      onUpdate: (update) => kinds.push(String(update.sessionUpdate)),
      requestPermission: async () => ({ outcome: { outcome: "cancelled" } }),
      requestElicitation: async () => ({ action: "decline" }),
      onExit: () => {},
    });
    expect(await session.prompt("hello")).toBe("end_turn");
    expect(kinds).toContain("tool_call");
    expect(kinds).toContain("agent_message_chunk");
    expect(kinds).toContain("tool_call_update");
  }),
);

test(
  "one session serves several prompts without a new process",
  withStub({}, async (open) => {
    const session = await open();
    expect(session.id).toBe("stub-0000-0001");
    expect(await session.prompt("one")).toBe("end_turn");
    expect(await session.prompt("two")).toBe("end_turn");
    expect(session.dead).toBe(false);
  }),
);

test(
  "a held prompt is cancelled by the stop",
  withStub({ STUB_HOLD_PROMPT: "1" }, async (open) => {
    const session = await open();
    const prompt = session.prompt("slow");
    await until("the prompt to be pending", () => true);
    await sleep(50);
    session.cancel();
    expect(await prompt).toBe("cancelled");
  }),
);

test(
  "a mid-turn process death rejects the turn and marks the session dead",
  withStub({ STUB_MIDTURN_EXIT: "1" }, async (open) => {
    const session = await open();
    let died = false;
    session.setHandlers({
      onUpdate: () => {},
      requestPermission: async () => ({ outcome: { outcome: "cancelled" } }),
      requestElicitation: async () => ({ action: "decline" }),
      onExit: () => {
        died = true;
      },
    });
    await expect(session.prompt("boom")).rejects.toThrow();
    await until("the exit callback", () => died);
  }),
);

test(
  "a session/new failure carries the distro's coded error",
  withStub({ STUB_NEW_FAIL: "1" }, async (open) => {
    const failure = await open().catch((error) => error);
    expect(String(failure?.message ?? failure)).toContain("stub_refused");
  }),
);

test(
  "session/load replays the file before the response",
  withStub({ STUB_LOAD_REPLAY: "1" }, async () => {
    const { replay, session } = await openExistingSession("stub-0000-0002", "/tmp", { load: true });
    expect(replay.map((update) => update.sessionUpdate).slice(0, 2)).toEqual([
      "user_message_chunk",
      "agent_message_chunk",
    ]);
    // The distro announces its command table before the load response; it
    // is protocol state, not transcript, so the fold ignores it.
    expect(session.commands).toEqual([{ name: "compact", description: "Compact the context." }]);
    expect(session.id).toBe("stub-0000-0002");
  }),
);


test(
  "a new session adopts its config options, modes and command table",
  withStub({}, async (open) => {
    const session = await open();
    expect(session.configOptions.map((option) => option.id)).toEqual(["model"]);
    expect(session.modes.currentModeId).toBe("ask");
    await until("the command announcement", () => session.commands.length > 0);
    expect(session.commands).toEqual([{ name: "compact", description: "Compact the context." }]);
  }),
);

test(
  "setConfig and setMode update the session's protocol state",
  withStub({}, async (open) => {
    const session = await open();
    await session.setConfig("model", "p/other");
    expect(session.configOptions[0]?.currentValue).toBe("p/other");
    await session.setMode("auto");
    expect(session.modes.currentModeId).toBe("auto");
  }),
);

test(
  "an extension method reaches the distro through the session's connection",
  withStub({}, async (open) => {
    const session = await open();
    const reply = await session.requestCustom("_zu/subagents/list", { sessionId: session.id });
    expect(reply.runs).toEqual([{ id: "run-stub", agent: "worker", status: "done" }]);
  }),
);

test(
  "a permission request reaches the session's client bridge",
  withStub({ STUB_ASK: "1" }, async (open) => {
    const session = await open();
    const asked: any[] = [];
    session.setHandlers({
      onUpdate: () => {},
      requestPermission: async (request) => {
        asked.push(request);
        return { outcome: { outcome: "selected", optionId: "allow_once" } };
      },
      requestElicitation: async () => ({ action: "decline" }),
      onExit: () => {},
    });
    expect(await session.prompt("delete it")).toBe("end_turn");
    expect(asked[0].toolCall.title).toBe("run the dangerous thing");
    expect(asked[0].options.map((option: any) => option.optionId)).toEqual(["allow_once", "reject"]);
  }),
);

test(
  "an elicitation reaches the session's client bridge",
  withStub({ STUB_ELICIT: "1" }, async (open) => {
    const session = await open();
    const asked: any[] = [];
    session.setHandlers({
      onUpdate: () => {},
      requestPermission: async () => ({ outcome: { outcome: "cancelled" } }),
      requestElicitation: async (request) => {
        asked.push(request);
        return { action: "accept", content: { environment: "staging" } };
      },
      onExit: () => {},
    });
    expect(await session.prompt("deploy")).toBe("end_turn");
    expect(asked[0].message).toBe("Which environment?");
  }),
);

test(
  "resume reattaches without replaying the transcript",
  withStub({}, async () => {
    const { session, replay } = await openExistingSession("stub-0000-0002", "/tmp");
    expect(replay).toEqual([]);
    expect(session.id).toBe("stub-0000-0002");
    expect(await session.prompt("again")).toBe("end_turn");
  }),
);

test(
  "closing a session frees its process and the registry entry",
  withStub({}, async (open) => {
    const session = await open();
    await closeSession(session.id);
    expect(session.dead).toBe(true);
    expect(liveSession(session.id)).toBeUndefined();
    await expect(session.prompt("late")).rejects.toThrow("gone");
  }),
);


test(
  "after a crash, the same session resumes in a new process",
  withStub({ STUB_MIDTURN_EXIT: "1" }, async (open) => {
    const session = await open();
    let died = false;
    session.setHandlers({
      onUpdate: () => {},
      requestPermission: async () => ({ outcome: { outcome: "cancelled" } }),
      requestElicitation: async () => ({ action: "decline" }),
      onExit: () => {
        died = true;
      },
    });
    await expect(session.prompt("boom")).rejects.toThrow();
    await until("the crash callback", () => died);
    const { session: resumed } = await openExistingSession(session.id, "/tmp");
    expect(resumed.dead).toBe(false);
    expect(await resumed.prompt("again")).toBe("end_turn");
  }),
);

test("the native pump frames ndjson lines both ways", async () => {
  const frames: string[] = [];
  const acp = Acp.start({ cwd: "/tmp", command: "/bin/sh", args: ["-c", "cat"] }, (line) => frames.push(line), () => {});
  acp.send('{"id":1}');
  acp.send('{"id":2,"method":"probe"}');
  await until("the echoed frames", () => frames.length >= 2);
  expect(frames[0]).toBe('{"id":1}');
  expect(frames[1]).toBe('{"id":2,"method":"probe"}');
  expect(acp.alive()).toBe(true);
  expect(acp.pid).toBeGreaterThan(0);
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
  for (const line of out.splice(0, out.length)) {
    const request = JSON.parse(line);
    channel.handleLine(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { echoed: request.method } }));
  }
  expect((await first).echoed).toBe("initialize");
  await expect(second).resolves.toEqual({ echoed: "probe/missing" });
  const notes: string[] = [];
  channel.onMessage((message) => notes.push(message.method));
  channel.handleLine('{"jsonrpc":"2.0","method":"session/update","params":{}}');
  expect(notes).toEqual(["session/update"]);
  channel.handleLine('{"jsonrpc":"2.0","id":999,"result":{}}');
  expect(channel.hasPending).toBe(false);
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
