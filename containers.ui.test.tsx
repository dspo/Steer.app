import { expect, open, test } from "nsh/test";

test("containers switch their layouts and throttle hidden sessions", async () => {
  const app = await open("./fixtures/containers.tsx", { width: 1200, height: 800 });
  await app.waitFor("text:alpha body");
  // The first container holds Alpha (shown) and Gamma (hidden).
  expect(app.texts()).toContain("Alpha");
  expect(app.texts()).toContain("Gamma");
  expect(app.texts()).toContain("alpha body");
  expect(app.texts()).not.toContain("gamma body");

  // Switching to the second container restores its own layout only.
  await app.press("Open container Beta");
  await app.waitFor("text:beta body");
  expect(app.texts()).toContain("beta body");
  expect(app.texts()).not.toContain("alpha body");
  expect(app.texts()).not.toContain("gamma body");

  // Back to the first: both tabs and the displayed session survive.
  await app.press("Open container Alpha");
  await app.waitFor("text:alpha body");
  expect(app.texts()).toContain("Gamma");
  expect(app.texts()).not.toContain("gamma body");

  await app.press("Gamma >> nth=1");
  await app.waitFor("text:gamma body");
  expect(app.texts()).toContain("gamma body");
  expect(app.texts()).not.toContain("alpha body");
});

test("a saved zoom is restored with its container", async () => {
  const app = await open("./fixtures/containers.tsx", { width: 1200, height: 800 });
  await app.waitFor("text:alpha body");
  // c3 is a split with Gamma zoomed: only the zoomed group shows.
  await app.press("Open container Gamma");
  await app.waitFor("text:gamma body");
  expect(app.texts()).toContain("gamma body");
  expect(app.texts()).not.toContain("alpha body");
});

test("archiving removes a container from the sidebar but keeps the data", async () => {
  const app = await open("./fixtures/containers.tsx", { width: 1200, height: 800 });
  await app.waitFor("text:alpha body");
  expect(app.shows("Open container Beta")).toBe(true);
  expect(app.count("id:archive-c2")).toBe(1);
  await app.press("id:archive-c2");
  await app.waitUntil(() => !app.shows("Open container Beta"));
  expect(app.shows("Open container Beta")).toBe(false);
  // The live container is untouched.
  expect(app.shows("Open container Alpha")).toBe(true);
  expect(app.texts()).toContain("alpha body");
});
