import { expect, open, test } from "nsh/test";

// The composer's model picker: `session.models` supplies the two levels and
// `session.setModel` replies with `session.info`. The fixture answers both
// without an engine; the real commands are covered by `models.test.ts`.

test("the hero composer's model menu lists providers and switches a model", async () => {
  const app = await open("../fixtures/chat-models.tsx", { width: 1200, height: 800 });
  await app.waitFor("id:model-picker");
  // The trigger is `provider · id · thinking`, one segment per text run.
  const before = app.texts();
  expect(before).toContain("bailian");
  expect(before).toContain("qwen3.8-flash");
  expect(before).toContain("high");

  await app.press("id:model-picker");
  // The provider opens its own level; the model rows carry their ids.
  await app.waitFor("id:model-provider-anthropic");
  await app.waitFor("id:model-provider-bailian");
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
  const app = await open("../fixtures/chat-models-thread.tsx", { width: 1200, height: 800 });
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

test("the effort chip switches the session's thinking level", async () => {
  const app = await open("../fixtures/chat-models.tsx", { width: 1200, height: 800 });
  await app.waitFor("id:effort-picker");
  // The chip's label is the session's current level.
  expect(app.texts()).toContain("high");
  await app.press("id:effort-picker");
  await app.waitFor("id:effort-low");
  await app.press("id:effort-low");
  // Success closes the menu and the chip carries the new level.
  await app.waitUntil(() => !app.shows("id:effort-low"), { timeout: 5000 });
  expect(app.texts()).toContain("low");

  // The model menu's provider rows name the credential source, so "why is
  // this provider listed" is answered in place (issue #54).
  await app.press("id:model-picker");
  await app.waitFor("id:model-provider-anthropic");
  expect(app.texts().some((text) => text.includes("已存登录"))).toBe(true);
  expect(app.texts().some((text) => text.includes("环境变量 DASHSCOPE_API_KEY"))).toBe(true);
  await app.keyboard.press("escape");
});

test("no models is an explained composer, not a dead one", async () => {
  const app = await open("../fixtures/chat-no-model.tsx", { width: 1200, height: 800 });
  // The composer names the cause and keeps its input; the send waits.
  await app.waitFor("id:session-no-model");
  expect(app.texts()).toContain("pi 里没有已登录的 provider。先运行 `pi` 登录（或在 ~/.pi/agent/models.json 里添加 provider），然后重试。");
  expect(app.count("id:session-input")).toBe(1);
  await app.type("id:session-input", "hold this thought");
  expect(app.enabled("id:session-send")).toBe(false);

  // The dialog shows the same reason instead of an empty list.
  await app.press("id:model-picker");
  await app.waitFor("id:model-reason");
  expect(app.texts().some((text) => text.includes("没有已登录的 provider"))).toBe(true);
  expect(app.count("id:model-provider-bailian")).toBe(0);
  await app.keyboard.press("escape");

  // Retrying after the provider is configured recovers without a restart:
  // the hint goes, the dialog lists the provider, and a pick reaches the row.
  await app.press("id:session-no-model-retry");
  await app.waitUntil(() => !app.shows("id:session-no-model"), { timeout: 5000 });
  expect(app.shows("id:session-input")).toBe(true);
  await app.press("id:model-picker");
  await app.waitFor("id:model-provider-bailian");
  await app.press("id:model-provider-bailian");
  await app.waitFor("id:model-bailian-qwen3.8-flash");
  await app.press("id:model-bailian-qwen3.8-flash");
  await app.waitUntil(() => app.texts().includes("qwen3.8-flash"), { timeout: 5000 });
  expect(app.texts()).toContain("qwen3.8-flash");
});
