import { expect, test } from "nsh/test";
import { transcriptFromReplay, updateToStoreEvents } from "../modules/pi/acp/fold";
import { foldStoreEvent, seedSession, viewFor } from "../modules/pi/sessions";

// The structured tool-result channel: a live update's `_meta.zu.details`
// lands on the tool row; a result without them leaves the row shape alone,
// and a `session/load` replay never grows a details field (pi does not
// persist details), so cards must tolerate their absence.

const DETAILS = { options: [{ id: "a", label: "Option A" }] };

/** Drives one update through the store's real fold. */
function fold(key: string, update: Record<string, unknown>): void {
  for (const event of updateToStoreEvents(update as never)) {
    foldStoreEvent(key, event.type, event.data);
  }
}

test("a tool end with _meta.zu.details saves them on the tool row", () => {
  seedSession("details-live", [{ role: "user", text: "which option?" }]);
  fold("details-live", {
    sessionUpdate: "tool_call",
    toolCallId: "t1",
    name: "ask",
    status: "in_progress",
  });
  fold("details-live", {
    sessionUpdate: "tool_call_update",
    toolCallId: "t1",
    name: "ask",
    status: "completed",
    _meta: { zu: { details: DETAILS } },
  });
  const row = viewFor("details-live")?.messages.find((message) => message.role === "tool");
  expect(row?.tool?.name).toBe("ask");
  expect(row?.tool?.state).toBe("done");
  expect(row?.tool?.details).toEqual(DETAILS);
});

test("a tool start row never carries details", () => {
  seedSession("details-start", []);
  fold("details-start", {
    sessionUpdate: "tool_call",
    toolCallId: "t0",
    name: "bash",
    status: "in_progress",
  });
  const row = viewFor("details-start")?.messages.find((message) => message.role === "tool");
  expect(row?.tool && "details" in row.tool).toBe(false);
});

test("a tool end without details leaves the row without the field", () => {
  seedSession("details-absent", [{ role: "user", text: "run it" }]);
  fold("details-absent", {
    sessionUpdate: "tool_call_update",
    toolCallId: "t2",
    status: "failed",
  });
  const row = viewFor("details-absent")?.messages.find((message) => message.role === "tool");
  expect(row?.tool?.state).toBe("failed");
  expect(row?.tool && "details" in row.tool).toBe(false);
});

test("a session/load replay drops _meta details with the rest of the envelope", () => {
  const rows = transcriptFromReplay([
    { sessionUpdate: "tool_call", toolCallId: "t3", name: "ask", title: "ask" },
    {
      sessionUpdate: "tool_call_update",
      toolCallId: "t3",
      status: "completed",
      _meta: { zu: { details: DETAILS } },
    },
  ]);
  expect(rows).toHaveLength(1);
  expect(rows[0].tool?.state).toBe("done");
  expect(rows[0].tool && "details" in rows[0].tool).toBe(false);
});
