import { expect, test } from "nsh/test";
import { emptyTranscript, reduceTranscript, reduceUpdates, type TranscriptState, type ToolEntry } from "../modules/pi/transcript";

// The structured tool-result channel (main's B4): a live update's
// `_meta.zu.details` lands on the tool entry's meta; a result without them
// leaves the entry without the field, and a `session/load` replay (pi does
// not persist details) never grows one, so cards must tolerate their absence.

const DETAILS = { options: [{ id: "a", label: "Option A" }] };

function toolOf(state: TranscriptState): ToolEntry | undefined {
  return state.entries.find((entry): entry is ToolEntry => entry.kind === "tool");
}

test("a tool end with _meta.zu.details saves them on the entry", () => {
  let state = emptyTranscript();
  state = reduceTranscript(state, {
    sessionUpdate: "tool_call",
    toolCallId: "t1",
    name: "ask",
    status: "in_progress",
  });
  state = reduceTranscript(state, {
    sessionUpdate: "tool_call_update",
    toolCallId: "t1",
    status: "completed",
    _meta: { zu: { details: DETAILS } },
  });
  const tool = toolOf(state);
  expect(tool?.name).toBe("ask");
  expect(tool?.status).toBe("completed");
  expect(tool?.meta?.details).toEqual(DETAILS);
});

test("details ride alongside the render stats in the same _meta.zu", () => {
  let state = emptyTranscript();
  state = reduceTranscript(state, { sessionUpdate: "tool_call", toolCallId: "t1", name: "ask" });
  state = reduceTranscript(state, {
    sessionUpdate: "tool_call_update",
    toolCallId: "t1",
    status: "completed",
    _meta: { zu: { durationMs: 12, details: DETAILS } },
  });
  expect(toolOf(state)?.meta).toMatchObject({ durationMs: 12, details: DETAILS });
});

test("a tool start never carries details", () => {
  let state = emptyTranscript();
  state = reduceTranscript(state, {
    sessionUpdate: "tool_call",
    toolCallId: "t0",
    name: "bash",
    status: "in_progress",
  });
  expect(toolOf(state)?.meta).toBeUndefined();
});

test("a tool end without details leaves the field absent", () => {
  let state = emptyTranscript();
  state = reduceTranscript(state, {
    sessionUpdate: "tool_call_update",
    toolCallId: "t2",
    status: "failed",
  });
  const tool = toolOf(state);
  expect(tool?.status).toBe("failed");
  expect(tool?.meta?.details).toBeUndefined();
});

test("a replayed result has no details envelope", () => {
  const state = reduceUpdates([
    { sessionUpdate: "tool_call", toolCallId: "t3", name: "ask", title: "ask" },
    { sessionUpdate: "tool_call_update", toolCallId: "t3", status: "completed" },
  ]);
  const tool = toolOf(state);
  expect(tool?.status).toBe("completed");
  expect(tool?.meta?.details).toBeUndefined();
});
