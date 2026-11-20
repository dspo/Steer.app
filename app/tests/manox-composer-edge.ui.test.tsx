import { expect, open, test } from "nsh/test";

/**
 * The manox card's edge states (DESIGN §3.6a): a failed kernel catalogue and
 * an effort outside the host's writable subset. Both are real states the fold
 * can carry; the footer must name them rather than show a spinner or drop
 * the value.
 */

test("a failed model load names the reason in the menu", async () => {
  const app = await open("../fixtures/manox-composer-edge.tsx", { width: 900, height: 600 });
  await app.waitFor("id:manox-model-picker");
  // The trigger keeps the raw config ref when no catalogue row matches.
  expect(app.texts().some((text) => text.includes("bailian-anthropic/qwen3.8-flash"))).toBe(true);
  await app.press("id:manox-model-picker");
  await app.waitFor("id:manox-models-empty");
  expect(
    app.texts().some((text) => text.includes("boom")),
  ).toBe(true);
  // The failure is recoverable in place: the menu offers the retry.
  expect(app.shows("id:manox-model-retry")).toBe(true);
});

test("an effort outside the writable subset is named, not offered", async () => {
  const app = await open("../fixtures/manox-composer-edge.tsx", { width: 900, height: 600 });
  await app.waitFor("id:manox-effort-picker");
  // The trigger names the current value (medium) even though the menu is the
  // writable subset (high / max).
  expect(app.texts()).toContain("medium");
  expect(app.count("label:推理强度")).toBe(1);
  await app.press("id:manox-effort-picker");
  await app.waitFor("id:manox-effort-high");
  // The menu lists exactly the writable values; medium is not offered.
  expect(app.shows("id:manox-effort-max")).toBe(true);
  expect(app.shows("id:manox-effort-medium")).toBe(false);
  await app.press("id:manox-effort-max");
  // Choosing a writable value moves the trigger.
  await app.waitUntil(() => app.texts().includes("max"), { timeout: 5000 });
  expect(app.texts()).not.toContain("medium");
});
