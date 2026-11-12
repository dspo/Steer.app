/**
 * Unit tests for the session/load replay: pi projection messages in,
 * `session/update` payloads out, with the skips registered in replay.ts.
 */

import { describe, expect, test } from "bun:test";
import { replayUpdates, type ReplayEntry } from "./replay";

const entry = (sourceId: string, messages: ReplayEntry["messages"]): ReplayEntry => ({ sourceId, messages });

describe("replayUpdates", () => {
  test("replays user, assistant text, thinking and tool pairs in order", () => {
    const updates = replayUpdates([
      entry("e1", [{ role: "user", content: "fix the bug" }]),
      entry("e2", [
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "look at the parser" },
            { type: "text", text: "On it." },
            { type: "toolCall", id: "tc1", name: "read", arguments: { path: "/a.ts" } },
          ],
        },
      ]),
      entry("e3", [
        { role: "toolResult", toolCallId: "tc1", toolName: "read", isError: false, content: [{ type: "text", text: "…" }] },
      ]),
    ]);
    expect(updates.map((update) => update.sessionUpdate)).toEqual([
      "user_message_chunk",
      "agent_thought_chunk",
      "agent_message_chunk",
      "tool_call",
      "tool_call_update",
    ]);
    const toolCall = updates[3] as Record<string, unknown>;
    expect(toolCall.toolCallId).toBe("tc1");
    expect(toolCall.status).toBe("in_progress");
    // ToolCall has no messageId in the schema; grouping is by toolCallId.
    expect(toolCall.messageId).toBeUndefined();
    const result = updates[4] as Record<string, unknown>;
    expect(result.status).toBe("completed");
    expect(result.messageId).toBeUndefined();
  });

  test("skips system messages, image blocks and empty thinking", () => {
    const updates = replayUpdates([
      entry("e1", [
        { role: "system", content: "pi prompt line" },
        { role: "user", content: [{ type: "image", data: "aGk=", mimeType: "image/png" }, { type: "text", text: "see this" }] },
      ]),
      entry("e2", [{ role: "assistant", content: [{ type: "thinking", thinking: "" }, { type: "text", text: "ok" }] }]),
    ]);
    expect(updates.map((update) => update.sessionUpdate)).toEqual(["user_message_chunk", "agent_message_chunk"]);
    const chunk = updates[0] as Record<string, unknown>;
    expect(chunk.content).toEqual({ type: "text", text: "see this" });
  });

  test("marks a tool result with isError failed", () => {
    const updates = replayUpdates([
      entry("e1", [{ role: "toolResult", toolCallId: "tc9", isError: true, content: [{ type: "text", text: "no" }] }]),
    ]);
    const update = updates[0] as Record<string, unknown>;
    expect(update.status).toBe("failed");
  });

  test("replays string user content and unknown roles as registered skips", () => {
    const updates = replayUpdates([
      entry("e1", [{ role: "user", content: "plain" }]),
      entry("e2", [{ role: "custom_message", content: "nope" }]),
    ]);
    expect(updates).toHaveLength(1);
    expect((updates[0] as Record<string, unknown>).messageId).toBe("e1");
  });
});
