import { expect, open, test } from "nsh/test";

/**
 * The manox footer's edge states (DESIGN §3.6a): a failed model catalogue and
 * an effort outside the host's writable enum. Both are real states the fold
 * can carry; the controls must name them rather than show a spinner or drop
 * the value.
 */

test("a failed model load names the reason in the menu", async () => {
  const app = await open("./fixtures/manox-composer-edge.tsx", { width: 900, height: 600 });
  await app.waitFor("id:manox-model");
  // The trigger keeps the raw config ref when no catalogue row matches.
  expect(app.count("label:bailian-anthropic/qwen3.8-flash")).toBe(1);
  await app.press("id:manox-model");
  await app.waitUntil(
    () => app.texts().some((text) => text.includes("模型读取失败")),
    { timeout: 5000 },
  );
  expect(
    app.texts().some((text) => text.includes("模型读取失败") && text.includes("boom")),
  ).toBe(true);
});

test("an effort outside the writable enum is named, not offered", async () => {
  const app = await open("./fixtures/manox-composer-edge.tsx", { width: 900, height: 600 });
  await app.waitFor("id:manox-thinking");
  // The trigger names the current value (medium) even though the menu is the
  // writable subset (high / max).
  expect(app.texts()).toContain("中");
  expect(app.count("label:推理强度：中")).toBe(1);
  await app.press("id:manox-thinking");
  await app.waitFor("id:manox-thinking-max");
  expect(app.texts()).toContain("当前 · 中");
  // Choosing a writable value moves the trigger and keeps the menu honest.
  await app.press("id:manox-thinking-max");
  await app.waitUntil(() => app.texts().includes("最高"), { timeout: 5000 });
  expect(app.count("label:推理强度：最高")).toBe(1);
});
