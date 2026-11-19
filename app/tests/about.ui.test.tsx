import { expect, open, test } from "nsh/test";

/**
 * The About dialog against the fake env (see `fixtures/about.tsx`): the
 * headline is the app's version, the axis names the stack this build
 * carries, a development run says so instead of naming an nsh version, a
 * native version of `null` leaves its row out, and the copy button's write
 * failing (a headless run has no clipboard to speak of) leaves the dialog
 * unbothered. The OS row is whatever machine runs the test, so the tests
 * only require that it is there.
 */

test("the headline and the version axis name the stack this build carries", async () => {
  const app = await open("../fixtures/about.tsx");
  await app.press("id:open-about");
  await app.waitUntil(() => app.shows("id:about-dialog"));
  expect(app.texts()).toContain("Zu 0.1.0（build 1）");
  expect(app.texts()).toContain("0.5.0"); // Native Shell
  expect(app.texts()).toContain("1.5.0"); // Pi
  expect(app.texts()).toContain("v0.12.1"); // manox
  expect(app.texts()).toContain("042b16b6"); // Ghostty
  expect(app.texts()).toContain("Native Shell");
  await app.press("id:about-close");
  await app.waitUntil(() => !app.shows("id:about-dialog"));
});

test("a development run says so instead of naming an nsh version", async () => {
  const app = await open("../fixtures/about.tsx");
  await app.press("id:open-about-dev");
  await app.waitUntil(() => app.shows("id:about-dialog"));
  expect(app.shows("id:about-development")).toBe(true);
  expect(app.texts()).toContain("开发构建");
  expect(app.texts()).not.toContain("0.5.0");
});

test("a native version of null leaves its row out", async () => {
  const app = await open("../fixtures/about.tsx");
  await app.press("id:open-about-bare");
  await app.waitUntil(() => app.shows("id:about-dialog"));
  expect(app.texts()).not.toContain("v0.12.1");
  expect(app.texts()).not.toContain("042b16b6");
  // The stack the app always knows is still there.
  expect(app.texts()).toContain("1.5.0");
});

test("the copy button copies without disturbing the dialog", async () => {
  const app = await open("../fixtures/about.tsx");
  await app.press("id:open-about");
  await app.waitUntil(() => app.shows("id:about-dialog"));
  await app.press("id:about-copy");
  await app.waitUntil(() => app.shows("id:about-dialog"));
  expect(app.shows("id:about-close")).toBe(true);
  await app.press("id:about-close");
  await app.waitUntil(() => !app.shows("id:about-dialog"));
});
