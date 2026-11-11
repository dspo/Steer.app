import { expect, open, test } from "nsh/test";

// The composer's model picker: `session.models` supplies the two levels and
// `session.setModel` replies with `session.info`. The fixture answers both
// without an engine; the real commands are covered by `models.test.ts`.

test("the hero composer's model menu lists providers and switches a model", async () => {
  const app = await open("./fixtures/chat-models.tsx", { width: 1200, height: 800 });
  await app.waitFor("id:model-picker");
  // The trigger is `provider · id · thinking`, one segment per text run.
  const before = app.texts();
  expect(before).toContain("bailian");
  expect(before).toContain("qwen3.8-flash");
  expect(before).toContain("high");

  await app.press("id:model-picker");
  await app.waitFor("id:model-provider-anthropic");
  await app.waitFor("id:model-provider-bailian");
  // A provider opens its own level; the model rows carry their ids.
  await app.press("id:model-provider-anthropic");
  await app.waitFor("id:model-anthropic-claude-sonnet-4");
  await app.press("id:model-anthropic-claude-sonnet-4");

  // The reply's model lands in the trigger, and the menu closed on success.
  await app.waitUntil(() => app.texts().includes("claude-sonnet-4"), { timeout: 5000 });
  const after = app.texts();
  expect(after).toContain("anthropic");
  expect(after).toContain("high");
  expect(app.shows("id:model-provider-anthropic")).toBe(false);
});

test("the conversation composer carries the same model menu", async () => {
  const app = await open("./fixtures/chat-models-thread.tsx", { width: 1200, height: 800 });
  await app.waitFor("id:session-transcript");
  expect(app.count("id:model-picker")).toBe(1);
  expect(app.texts()).toContain("bailian");
  await app.press("id:model-picker");
  await app.waitFor("id:model-provider-bailian");
  await app.press("id:model-provider-bailian");
  await app.waitFor("id:model-bailian-qwen3.8-plus");
  await app.press("id:model-bailian-qwen3.8-plus");
  await app.waitUntil(() => app.texts().includes("qwen3.8-plus"), { timeout: 5000 });
  expect(app.texts()).toContain("qwen3.8-plus");
  expect(app.shows("id:session-transcript")).toBe(true);
});
