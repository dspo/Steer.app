import { expect, test } from "nsh/test";
import { emptyTranscript, entryText, reduceTranscript, reduceUpdates, transcriptRows } from "./transcript";

// The transcript reducer's own suite (issue #20 §8): live and replay
// sequences take one path and agree entry for entry; the settle marker
// carries the facts; the optimistic row re-keys; tool frames behave.

test("the transcript reducer keeps ACP vocabulary and identity", () => {
  // A live turn: streamed text drafts under its messageId, thoughts ride the
  // same message, tools keep their ToolCallStatus.
  let state = emptyTranscript();
  state = reduceTranscript(state, { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "hmm" }, messageId: "m1" });
  state = reduceTranscript(state, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "he" }, messageId: "m1" });
  state = reduceTranscript(state, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "llo" }, messageId: "m1" });
  expect(state.draft?.id).toBe("m1");
  expect(entryText({ kind: "assistant", id: "m1", text: state.draft!.text })).toBe("hello");
  expect(state.draft?.thoughts).toBe("hmm");
  // A tool card opens after the reply's text: the draft lands first, in
  // order, and the settle marker later adds its facts.
  state = reduceTranscript(state, {
    sessionUpdate: "tool_call",
    toolCallId: "t1",
    name: "read",
    title: "read x",
    kind: "read",
    status: "in_progress",
  });
  expect(state.draft).toBeNull();
  expect(state.entries.map((entry) => entry.kind)).toEqual(["assistant", "tool"]);
  expect(entryText(state.entries[0])).toBe("hello");
  if (state.entries[0].kind === "assistant") expect(state.entries[0].thoughts).toBe("hmm");
  expect(state.entries[1]).toMatchObject({ kind: "tool", toolCallId: "t1", status: "in_progress" });
  state = reduceTranscript(state, { sessionUpdate: "tool_call_update", toolCallId: "t1", status: "failed" });
  expect(state.entries[1]).toMatchObject({ kind: "tool", toolCallId: "t1", status: "failed" });
  // Protocol state is not transcript.
  expect(reduceTranscript(state, { sessionUpdate: "current_mode_update" })).toBe(state);
});

test("thought deltas accumulate, and a settle re-keys a reply a tool flushed", () => {
  let state = emptyTranscript();
  state = reduceTranscript(state, {
    sessionUpdate: "agent_thought_chunk",
    content: { type: "text", text: "first " },
    messageId: "m1",
  });
  state = reduceTranscript(state, {
    sessionUpdate: "agent_thought_chunk",
    content: { type: "text", text: "second" },
    messageId: "m1",
  });
  // Every delta joins the draft; a later delta must not replace the earlier.
  expect(state.draft?.thoughts).toBe("first second");
  // A tool card inside the same pi message flushes the draft under m1.
  state = reduceTranscript(state, {
    sessionUpdate: "tool_call",
    toolCallId: "t1",
    name: "bash",
    title: "bash ls",
    status: "in_progress",
  });
  expect(state.entries.map((entry) => entry.kind)).toEqual(["assistant", "tool"]);
  // The settle marker carries pi's entry id, not the live m1: the flushed
  // row re-keys in place rather than opening an empty second row.
  state = reduceTranscript(state, {
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text: "" },
    messageId: "e1",
    _meta: { pi: { settled: true, entryId: "e1", at: 3, durationMs: 700, stopReason: "end_turn" } },
  });
  expect(state.entries.map((entry) => entry.kind)).toEqual(["assistant", "tool"]);
  const reply = state.entries[0];
  expect(reply.id).toBe("e1");
  if (reply.kind === "assistant") {
    expect(reply.thoughts).toBe("first second");
    expect(reply.pi).toMatchObject({ settled: true, entryId: "e1", durationMs: 700 });
  }
});

test("a tool row missing its output lanes is normalized for rendering", () => {
  // A row can outlive a schema change (hot reload, a restored layout); the
  // card reads output/diffs, so the rows boundary fills them in.
  const state = {
    entries: [
      {
        kind: "tool",
        id: "t1",
        toolCallId: "t1",
        title: "bash ls",
        status: "completed",
      },
    ],
    draft: null,
    seq: 0,
  } as unknown as Parameters<typeof transcriptRows>[0];
  const row = transcriptRows(state)[0];
  expect(row.kind).toBe("tool");
  if (row.kind === "tool") {
    expect(row.output).toBe("");
    expect(row.diffs).toEqual([]);
  }
});

test("the settle marker folds the draft into entries under the ACP entry id", () => {
  let state = emptyTranscript();
  state = reduceTranscript(state, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hi" }, messageId: "m1" });
  state = reduceTranscript(state, {
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text: "" },
    messageId: "e1",
    _meta: { pi: { settled: true, entryId: "e1", at: 2000, durationMs: 900, stopReason: "end_turn" } },
  });
  expect(state.draft).toBeNull();
  expect(state.entries).toHaveLength(1);
  const entry = state.entries[0];
  expect(entry.kind).toBe("assistant");
  expect(entry.id).toBe("e1");
  expect(entryText(entry)).toBe("hi");
  if (entry.kind === "assistant") {
    expect(entry.pi).toMatchObject({ settled: true, entryId: "e1", at: 2000, durationMs: 900, stopReason: "end_turn" });
  }
});

test("a replay builds the same entries: chunks merge, the marker settles", () => {
  const state = reduceUpdates([
    { sessionUpdate: "user_message_chunk", content: { type: "text", text: "q" }, messageId: "e0", _meta: { pi: { at: 1, entryId: "e0" } } },
    { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "h" }, messageId: "e1", _meta: { pi: { at: 2, entryId: "e1" } } },
    { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "a" }, messageId: "e1", _meta: { pi: { at: 2, entryId: "e1" } } },
    { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "b" }, messageId: "e1", _meta: { pi: { at: 2, entryId: "e1" } } },
    { sessionUpdate: "tool_call", toolCallId: "t9", name: "bash", title: "bash ls", status: "in_progress" },
    { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "" }, messageId: "e1", _meta: { pi: { settled: true, entryId: "e1", stopReason: "end_turn" } } },
    { sessionUpdate: "tool_call_update", toolCallId: "t9", status: "completed" },
  ]);
  expect(state.entries.map((entry) => entry.kind)).toEqual(["user", "assistant", "tool"]);
  expect(state.entries[0].id).toBe("e0");
  const reply = state.entries[1];
  expect(reply.id).toBe("e1");
  expect(entryText(reply)).toBe("ab");
  if (reply.kind === "assistant") expect(reply.thoughts).toBe("h");
  expect(state.entries[2]).toMatchObject({ kind: "tool", toolCallId: "t9", status: "completed" });
  expect(state.draft).toBeNull();
});

test("the optimistic row re-keys onto the real chunk in place", () => {
  let state = emptyTranscript();
  state = {
    ...state,
    seq: 1,
    entries: [{ kind: "user", id: "pending:1", text: "count slowly" }],
  };
  state = reduceTranscript(state, {
    sessionUpdate: "user_message_chunk",
    content: { type: "text", text: "count slowly" },
    messageId: "e7",
    _meta: { pi: { at: 42, entryId: "e7" } },
  });
  expect(state.entries).toHaveLength(1);
  expect(state.entries[0].id).toBe("e7");
  if (state.entries[0].kind === "user") expect(state.entries[0].pi?.at).toBe(42);
});

test("a tool partial replaces its snapshot; the end frame adds diffs and stats", () => {
  let state = emptyTranscript();
  state = reduceTranscript(state, { sessionUpdate: "tool_call", toolCallId: "t1", name: "bash", title: "bash bun test", kind: "execute", status: "in_progress", rawInput: { command: "bun test" } });
  state = reduceTranscript(state, { sessionUpdate: "tool_call_update", toolCallId: "t1", status: "in_progress", content: [{ type: "content", content: { type: "text", text: "one" } }] });
  state = reduceTranscript(state, { sessionUpdate: "tool_call_update", toolCallId: "t1", status: "in_progress", content: [{ type: "content", content: { type: "text", text: "onetwo" } }] });
  expect(state.entries[0]).toMatchObject({ kind: "tool", output: "onetwo" });
  state = reduceTranscript(state, {
    sessionUpdate: "tool_call_update",
    toolCallId: "t1",
    status: "failed",
    content: [
      { type: "content", content: { type: "text", text: "onetwo three" } },
      { type: "diff", path: "/a.ts", oldText: "x", newText: "y" },
    ],
    _meta: { zu: { durationMs: 1800, exitCode: 1, truncated: true, totalLines: 36 } },
  });
  expect(state.entries[0]).toMatchObject({
    kind: "tool",
    status: "failed",
    output: "onetwo three",
    diffs: [{ path: "/a.ts", oldText: "x", newText: "y" }],
    meta: { durationMs: 1800, exitCode: 1, truncated: true, totalLines: 36 },
  });
});


test("a live turn and its replay land the same entries", () => {
  // Live: text drafts under m1, the settle marker lands it as e1.
  const live = reduceUpdates([
    { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "he" }, messageId: "m1", _meta: { pi: { at: 1, model: { provider: "p", id: "m" } } } },
    { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "llo" }, messageId: "m1", _meta: { pi: { at: 1 } } },
    { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "" }, messageId: "e1", _meta: { pi: { settled: true, entryId: "e1", at: 2, durationMs: 900, stopReason: "end_turn" } } },
  ]);
  // Replay: chunks are born under the entry's id; the marker closes it.
  const replay = reduceUpdates([
    { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "he" }, messageId: "e1", _meta: { pi: { at: 1, entryId: "e1", model: { provider: "p", id: "m" } } } },
    { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "llo" }, messageId: "e1", _meta: { pi: { at: 1, entryId: "e1" } } },
    { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "" }, messageId: "e1", _meta: { pi: { settled: true, entryId: "e1", at: 2, durationMs: 900, stopReason: "end_turn" } } },
  ]);
  expect(transcriptRows(live)).toEqual(transcriptRows(replay));
  expect(transcriptRows(replay).map((entry) => entry.id)).toEqual(["e1"]);
  const entry = transcriptRows(replay)[0];
  if (entry.kind === "assistant") {
    expect(entry.text).toBe("hello");
    expect(entry.pi?.stopReason).toBe("end_turn");
    expect(entry.pi?.durationMs).toBe(900);
  }
});

test("a provider error settles as the entry's error, not a text chunk", () => {
  const state = reduceUpdates([
    { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "" }, messageId: "e9", _meta: { pi: { settled: true, entryId: "e9", at: 5, stopReason: "end_turn", error: "rate limited" } } },
  ]);
  expect(state.entries).toHaveLength(1);
  const entry = state.entries[0];
  expect(entry.kind).toBe("assistant");
  if (entry.kind === "assistant") expect(entry.pi?.error).toBe("rate limited");
  expect(entryText(entry)).toBe("");
});
