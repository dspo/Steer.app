/**
 * Unit tests for the pure pi → ACP mappings: prompt content blocks, tool
 * card shapes, streaming deltas and stop reasons. No pi, no network.
 */

import { describe, expect, test } from "bun:test";
import {
  assistantDeltaUpdate,
  describeToolCall,
  piToolKind,
  promptBlocksToText,
  stopReasonFromPi,
  toolCallEndUpdate,
  toolCallPartialUpdate,
  toolCallStartUpdate,
} from "./mapping";

describe("promptBlocksToText", () => {
  test("joins text blocks", () => {
    const result = promptBlocksToText([
      { type: "text", text: "hello " },
      { type: "text", text: "world" },
    ]);
    expect(result).toEqual({ ok: true, text: "hello world" });
  });

  test("renders resource links as markdown (baseline content)", () => {
    const result = promptBlocksToText([{ type: "resource_link", uri: "file:///tmp/a.ts", name: "a.ts" }]);
    expect(result).toEqual({ ok: true, text: "[a.ts](file:///tmp/a.ts)" });
  });

  test("resource link without a name uses the uri", () => {
    const result = promptBlocksToText([{ type: "resource_link", uri: "https://example.com" }]);
    expect(result).toEqual({ ok: true, text: "[https://example.com](https://example.com)" });
  });

  test("rejects image blocks with a coded invalid-params error", () => {
    const result = promptBlocksToText([{ type: "image", data: "aGk=", mimeType: "image/png" }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(-32602);
      expect((result.error.data as { code: string }).code).toBe("image_not_supported");
    }
  });

  test("rejects audio and embedded resources with their own codes", () => {
    const audio = promptBlocksToText([{ type: "audio", data: "aGk=", mimeType: "audio/wav" }]);
    expect(audio.ok).toBe(false);
    expect(audio.ok ? "" : (audio.error.data as { code: string }).code).toBe("audio_not_supported");
    const resource = promptBlocksToText([
      { type: "resource", resource: { uri: "file:///a", text: "x" } },
    ] as never);
    expect(resource.ok).toBe(false);
    expect(resource.ok ? "" : (resource.error.data as { code: string }).code).toBe("embedded_context_not_supported");
  });

  test("rejects an empty prompt", () => {
    expect(promptBlocksToText([]).ok).toBe(false);
    expect(promptBlocksToText([{ type: "text", text: "   " }]).ok).toBe(false);
  });
});

describe("piToolKind", () => {
  test("maps the known pi tools onto ACP kinds", () => {
    expect(piToolKind("read")).toBe("read");
    expect(piToolKind("grep")).toBe("search");
    expect(piToolKind("edit")).toBe("edit");
    expect(piToolKind("bash")).toBe("execute");
    expect(piToolKind("think")).toBe("think");
    expect(piToolKind("webfetch")).toBe("fetch");
    expect(piToolKind("mystery_tool")).toBe("other");
  });
});

describe("describeToolCall", () => {
  test("quotes the most salient string argument", () => {
    expect(describeToolCall("read", { path: "/tmp/a.ts", line: 3 })).toBe("read /tmp/a.ts");
    expect(describeToolCall("bash", { command: "bun test\nmore" })).toBe("bash bun test");
  });

  test("falls back to the bare tool name", () => {
    expect(describeToolCall("bash", undefined)).toBe("bash");
    expect(describeToolCall("bash", { nested: { a: 1 } })).toBe("bash");
  });
});

describe("tool call updates", () => {
  test("start opens an in_progress card with title, kind and rawInput", () => {
    const update = toolCallStartUpdate("tc1", "edit", { path: "/tmp/a.ts", content: "x" }) as Record<string, unknown>;
    expect(update.sessionUpdate).toBe("tool_call");
    expect(update.toolCallId).toBe("tc1");
    expect(update.status).toBe("in_progress");
    expect(update.title).toBe("edit /tmp/a.ts");
    expect(update.kind).toBe("edit");
    expect(update.locations).toEqual([{ path: "/tmp/a.ts" }]);
  });

  test("partial update carries text when the partial has any", () => {
    const update = toolCallPartialUpdate("tc1", { content: [{ type: "text", text: "partial" }] });
    expect(update).toEqual({
      sessionUpdate: "tool_call_update",
      toolCallId: "tc1",
      status: "in_progress",
      content: [{ type: "content", content: { type: "text", text: "partial" } }],
    });
    expect(toolCallPartialUpdate("tc1", { quiet: true })).toBeUndefined();
  });

  test("end settles the card failed or completed with the result text", () => {
    const failed = toolCallEndUpdate("tc1", { content: [{ type: "text", text: "boom" }] }, true) as Record<
      string,
      unknown
    >;
    expect(failed.status).toBe("failed");
    expect(failed.content).toEqual([{ type: "content", content: { type: "text", text: "boom" } }]);
    const done = toolCallEndUpdate("tc2", {}, false) as Record<string, unknown>;
    expect(done.status).toBe("completed");
    expect(done.content).toBeUndefined();
  });

  test("end carries plain object details under _meta.zu", () => {
    const details = { options: [{ id: "a", label: "A" }] };
    const update = toolCallEndUpdate("tc1", { content: [{ type: "text", text: "ok" }], details }, false) as Record<
      string,
      unknown
    >;
    expect((update._meta as { zu: { details: unknown } }).zu.details).toEqual(details);
  });

  test("end without details carries no _meta", () => {
    for (const result of [{}, { content: [] }, { details: undefined }, { details: null }]) {
      const update = toolCallEndUpdate("tc1", result, false) as Record<string, unknown>;
      expect(update._meta).toBeUndefined();
    }
  });

  test("scalar details drop — no guessing at a shape", () => {
    for (const details of ["flat text", 7, true]) {
      const update = toolCallEndUpdate("tc1", { details }, false) as Record<string, unknown>;
      expect(update._meta).toBeUndefined();
    }
  });

  test("details past the 64 KiB cap drop whole instead of truncating", () => {
    const update = toolCallEndUpdate("tc1", { details: { blob: "x".repeat(80 * 1024) } }, false) as Record<
      string,
      unknown
    >;
    expect(update._meta).toBeUndefined();
  });

  test("circular details drop instead of throwing", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const update = toolCallEndUpdate("tc1", { details: circular }, false) as Record<string, unknown>;
    expect(update._meta).toBeUndefined();
  });
});

describe("assistantDeltaUpdate", () => {
  test("maps text and thinking deltas onto the chunk updates", () => {
    expect(assistantDeltaUpdate({ type: "text_delta", delta: "hi" }, "m1")).toEqual({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "hi" },
      messageId: "m1",
    });
    expect(assistantDeltaUpdate({ type: "thinking_delta", delta: "hmm" }, "m2")).toEqual({
      sessionUpdate: "agent_thought_chunk",
      content: { type: "text", text: "hmm" },
      messageId: "m2",
    });
  });

  test("ignores non-chunk deltas and empty ones", () => {
    expect(assistantDeltaUpdate({ type: "toolcall_delta", delta: "{}" }, "m1")).toBeUndefined();
    expect(assistantDeltaUpdate({ type: "text_delta", delta: "" }, "m1")).toBeUndefined();
    expect(assistantDeltaUpdate(undefined, "m1")).toBeUndefined();
  });
});

describe("stopReasonFromPi", () => {
  test("maps the settled pi stop reasons", () => {
    expect(stopReasonFromPi("stop")).toBe("end_turn");
    expect(stopReasonFromPi("length")).toBe("max_tokens");
    expect(stopReasonFromPi("aborted")).toBe("cancelled");
  });

  test("maps the shapeless ones to end_turn", () => {
    for (const reason of ["error", "toolUse", "pending", "deferred", undefined, "something_new"]) {
      expect(stopReasonFromPi(reason as string | undefined)).toBe("end_turn");
    }
  });
});
