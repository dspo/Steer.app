import { expect, open, test } from "nsh/test";

test("a sheet keeps its state when moved to another panel and back", async () => {
  const app = await open("./fixtures/dock-move.tsx", { width: 1200, height: 800 });
  await app.press("id:a-tap");
  await app.press("id:a-tap");
  expect(app.texts()).toContain("a taps 2");

  await app.press("id:split-b");
  await app.waitUntil(() => app.texts().includes("split"));
  expect(app.texts()).toContain("a taps 2");

  await app.press("id:merge-b");
  await app.waitUntil(() => app.texts().includes("merged"));
  // The moved tab is now displayed; selecting a again proves its state survived.
  await app.press("a");
  await app.waitFor("text:a taps 2");
  expect(app.texts()).toContain("a taps 2");
});
