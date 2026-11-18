import { expect, test } from "nsh/test";
import {
  emptyTranscript,
  entryText,
  reduceTranscript,
  reduceUpdates,
  transcriptRows,
  type Entry,
  type TranscriptState,
} from "./transcript";

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

test("a follow-up queued mid-turn reads after the reply it interrupted", () => {
  // The turn is streaming; the user's next message is added optimistically
  // while it runs (sessions.ts `optimisticUser`), so the row sits in entries
  // before the reply — which is still the draft.
  let state: TranscriptState = {
    ...emptyTranscript(),
    entries: [{ kind: "user", id: "e0", text: "first" } as Entry],
    draft: { id: "m1", text: "answering the first" },
    activeId: "m1",
    seq: 1,
  };
  state = { ...state, entries: [...state.entries, { kind: "user", id: "pending:1", text: "follow up" }] };
  // While the reply streams, the draft renders ahead of the follow-up.
  expect(transcriptRows(state).map((row) => row.id)).toEqual(["e0", "m1", "pending:1"]);
  // The reply settles: it must land ahead of the queued row, not after it.
  state = reduceTranscript(state, {
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text: "" },
    messageId: "e1",
    _meta: { pi: { settled: true, entryId: "e1", stopReason: "end_turn" } },
  });
  expect(state.entries.map((entry) => entry.id)).toEqual(["e0", "e1", "pending:1"]);
  expect(state.draft).toBeNull();
  // The queued text's own entry chunk re-keys that row in place, though a
  // reply sits between it and the tail.
  state = reduceTranscript(state, {
    sessionUpdate: "user_message_chunk",
    content: { type: "text", text: "follow up" },
    messageId: "e2",
    _meta: { pi: { at: 43, entryId: "e2" } },
  });
  expect(state.entries.map((entry) => entry.id)).toEqual(["e0", "e1", "e2"]);
  expect(transcriptRows(state).map((row) => row.id)).toEqual(["e0", "e1", "e2"]);
});

test("a tool card inside a streaming reply lands ahead of a queued row", () => {
  let state: TranscriptState = {
    ...emptyTranscript(),
    entries: [
      { kind: "user", id: "e0", text: "first" } as Entry,
      { kind: "user", id: "pending:1", text: "queued" } as Entry,
    ],
    draft: { id: "m1", text: "thinking" },
    activeId: "m1",
    seq: 1,
  };
  state = reduceTranscript(state, {
    sessionUpdate: "tool_call",
    toolCallId: "t1",
    name: "bash",
    title: "bash ls",
    status: "in_progress",
  });
  expect(state.entries.map((entry) => entry.id)).toEqual(["e0", "m1", "t1", "pending:1"]);
});

test("an expanded slash input adopts the entry's text, never a second row", () => {
  // pi expands `/` input before persisting (a skill becomes a <skill …>
  // block), so the entry's text is not the typed words. The optimistic row
  // is still that message: one row, the entry's text, the entry's id.
  let state: TranscriptState = {
    ...emptyTranscript(),
    entries: [{ kind: "user", id: "pending:1", text: "/skill:review" } as Entry],
    seq: 1,
  };
  state = reduceTranscript(state, {
    sessionUpdate: "user_message_chunk",
    content: { type: "text", text: "<skill name=\"review\">…</skill>\ncheck the diff" },
    messageId: "e9",
    _meta: { pi: { at: 44, entryId: "e9" } },
  });
  expect(state.entries).toHaveLength(1);
  expect(state.entries[0].kind).toBe("user");
  expect(state.entries[0].id).toBe("e9");
  expect(entryText(state.entries[0])).toContain("<skill name=\"review\">");
  // The same chunk again (a repeated frame) changes nothing.
  state = reduceTranscript(state, {
    sessionUpdate: "user_message_chunk",
    content: { type: "text", text: "<skill name=\"review\">…</skill>\ncheck the diff" },
    messageId: "e9",
    _meta: { pi: { at: 44, entryId: "e9" } },
  });
  expect(state.entries).toHaveLength(1);
});

test("queued messages keep their order as each expanded entry lands", () => {
  let state: TranscriptState = {
    ...emptyTranscript(),
    entries: [
      { kind: "user", id: "e0", text: "first" } as Entry,
      { kind: "user", id: "pending:1", text: "/skill:a" } as Entry,
      { kind: "user", id: "pending:2", text: "/skill:b" } as Entry,
    ],
    seq: 2,
  };
  state = reduceTranscript(state, {
    sessionUpdate: "user_message_chunk",
    content: { type: "text", text: "expanded a" },
    messageId: "e1",
    _meta: { pi: { at: 1, entryId: "e1" } },
  });
  state = reduceTranscript(state, {
    sessionUpdate: "user_message_chunk",
    content: { type: "text", text: "expanded b" },
    messageId: "e2",
    _meta: { pi: { at: 2, entryId: "e2" } },
  });
  expect(state.entries.map((entry) => [entry.id, entryText(entry)])).toEqual([
    ["e0", "first"],
    ["e1", "expanded a"],
    ["e2", "expanded b"],
  ]);
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
