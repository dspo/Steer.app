import { expect, open, test } from "nsh/test";

/** Writes the picture when the run draws the app (`nsh test --target macos`). */
async function shot(app: { screenshot: (path?: string | null) => Promise<Uint8Array> }, name: string): Promise<void> {
  try {
    await app.screenshot(`docs/evidence/${name}.png`);
  } catch {
    // Headless: nothing is drawn, and nothing is broken.
  }
}

// The composer's model picker: `session.models` supplies the two levels and
// `session.setModel` replies with `session.info`. The fixture answers both
// without an engine; the real commands are covered by `models.test.ts`.

test("the hero composer's model menu lists providers and switches a model", async () => {
  const app = await open("./fixtures/chat-models.tsx", { width: 1200, height: 800 });
  await app.waitFor("id:model-picker");
  // The trigger shows the model's display name; the provider and the effort
  // stay in the tooltip and the effort picker, not the trigger.
  const before = app.texts();
  expect(before).toContain("Qwen3.8 Flash");
  expect(before).not.toContain("bailian");
  expect(before).not.toContain("high");

  await app.press("id:model-picker");
  await app.waitFor("id:model-provider-anthropic");
  await app.waitFor("id:model-provider-bailian");
  // A provider opens its own level; the model rows carry their ids.
  await app.press("id:model-provider-anthropic");
  await app.waitFor("id:model-anthropic-claude-sonnet-4");
  await shot(app, "ui-s22-11-model");
  await app.press("id:model-anthropic-claude-sonnet-4");

  // The reply's display name lands in the trigger, and the menu closed on success.
  await app.waitUntil(() => app.texts().includes("Claude Sonnet 4"), { timeout: 5000 });
  expect(app.shows("id:model-provider-anthropic")).toBe(false);
  expect(app.texts()).toContain("Claude Sonnet 4");
});

test("the conversation composer carries the same model menu", async () => {
  const app = await open("./fixtures/chat-models-thread.tsx", { width: 1200, height: 800 });
  await app.waitFor("id:session-transcript");
  expect(app.count("id:model-picker")).toBe(1);
  expect(app.texts()).toContain("Qwen3.8 Flash");
  await app.press("id:model-picker");
  await app.waitFor("id:model-provider-bailian");
  await app.press("id:model-provider-bailian");
  await app.waitFor("id:model-bailian-qwen3.8-plus");
  await app.press("id:model-bailian-qwen3.8-plus");
  await app.waitUntil(() => app.texts().includes("Qwen3.8 Plus"), { timeout: 5000 });
  expect(app.shows("id:session-transcript")).toBe(true);
});

test("no models is an explained composer, not a dead one", async () => {
  const app = await open("./fixtures/chat-no-model.tsx", { width: 1200, height: 800 });
  // The composer names the cause and keeps its input; the send waits.
  await app.waitFor("id:session-no-model");
  expect(app.texts()).toContain("pi 里没有已登录的 provider。先运行 `pi` 登录（或在 ~/.pi/agent/models.json 里添加 provider），然后重试。");
  expect(app.count("id:session-input")).toBe(1);
  await app.type("id:session-input", "hold this thought");
  expect(app.enabled("id:session-send")).toBe(false);

  // The menu shows the same reason instead of an empty list.
  await app.press("id:model-picker");
  await app.waitFor("id:model-reason");
  expect(app.texts().some((text) => text.includes("没有已登录的 provider"))).toBe(true);
  expect(app.count("id:model-provider-bailian")).toBe(0);
  await app.press("id:model-picker");

  // Retrying after the provider is configured recovers without a restart:
  // the hint goes, the menu lists the provider, and a pick reaches the row.
  await app.press("id:session-no-model-retry");
  await app.waitUntil(() => !app.shows("id:session-no-model"), { timeout: 5000 });
  expect(app.shows("id:session-input")).toBe(true);
  await app.press("id:model-picker");
  await app.waitFor("id:model-provider-bailian");
  await app.press("id:model-provider-bailian");
  await app.waitFor("id:model-bailian-qwen3.8-flash");
  await app.press("id:model-bailian-qwen3.8-flash");
  // The reply's display name lands in the trigger once the menu closes.
  await app.waitUntil(() => !app.shows("id:model-bailian-qwen3.8-flash"), { timeout: 5000 });
  expect(app.texts()).toContain("Qwen3.8 Flash");
});
