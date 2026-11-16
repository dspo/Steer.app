import { expect, open, test } from "nsh/test";

test("700 session search hits keep the virtualized list small", async () => {
  const app = await open("../fixtures/many-sessions.tsx", { width: 1200, height: 800 });
  // The all-sessions list is not part of the resting sidebar; it appears as
  // the session section of the filter, where it is still virtualized.
  await app.waitFor("id:sidebar-search");
  await app.press("id:sidebar-search");
  await app.type("id:sidebar-search-input", "Session");
  await app.waitFor("text:Session 0");
  const rendered = () => app.texts().filter((text) => /^Session \d+$/.test(text)).length;
  // The list mounts rows near the viewport only: the other ~650 do not exist.
  expect(rendered()).toBeGreaterThan(10);
  expect(rendered()).toBeLessThan(80);
  expect(app.count("id:search-results")).toBe(1);
}, 30000);
