import { describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { PermissionGate } from "./pi-session";

/**
 * A1 review: the approval gate treats `ask_user_question` as read-only —
 * it opens no approval card in ask mode and survives read-only's write
 * block. Both paths go through the `tool_call` handler the gate registers,
 * the way pi drives it.
 */

const noop = () => {};

/** Registers the gate's extension on a fake pi and returns its `tool_call` handler. */
function handlerFor(mode: string): (event: unknown) => Promise<unknown> {
  const gate = new PermissionGate(noop);
  gate.mode = mode;
  let handler: ((...args: unknown[]) => unknown) | undefined;
  gate.extension()({
    on(event: string, fn: (...args: unknown[]) => unknown) {
      if (event === "tool_call") handler = fn;
      return () => {};
    },
  } as unknown as ExtensionAPI);
  return handler as (event: unknown) => Promise<unknown>;
}

describe("the approval gate and ask_user_question", () => {
  test("ask mode: the question tool runs without an approval card", async () => {
    const handler = handlerFor("ask");
    // No bridge attached: a workspace tool would demand approval and be
    // blocked; the question tool must simply pass.
    expect(await handler({ toolName: "ask_user_question" })).toBeUndefined();
    expect(await handler({ toolName: "edit" })).toEqual({
      block: true,
      reason: "no approval channel is attached",
    });
  });

  test("read-only mode: the question tool survives the write block", async () => {
    const handler = handlerFor("read-only");
    expect(await handler({ toolName: "ask_user_question" })).toBeUndefined();
    expect(await handler({ toolName: "bash" })).toEqual({
      block: true,
      reason: expect.stringContaining("read-only mode"),
    });
  });

  test("auto mode: everything passes, questions included", async () => {
    const handler = handlerFor("auto");
    expect(await handler({ toolName: "ask_user_question" })).toBeUndefined();
    expect(await handler({ toolName: "bash" })).toBeUndefined();
  });
});
