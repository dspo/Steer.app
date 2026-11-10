import { expect, open, test } from "nsh/test";

test("700 sessions keep the virtualized list small", async () => {
  const app = await open("./fixtures/many-sessions.tsx", { width: 1200, height: 800 });
  await app.waitFor("text:Session 0");
  const rendered = () => app.texts().filter((text) => /^Session \d+$/.test(text)).length;
  // The list mounts rows near the viewport only: the other ~650 do not exist.
  expect(rendered()).toBeGreaterThan(10);
  expect(rendered()).toBeLessThan(80);
  expect(app.count("id:session-list")).toBe(1);
}, 30000);
