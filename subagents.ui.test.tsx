import { expect, open, test } from "nsh/test";

test("the roster lists runs and opens a read-only transcript", async () => {
  const app = await open("./fixtures/subagents.tsx", { width: 1200, height: 800 });
  await app.waitFor("text:captain body");
  await app.press("id:open-subagents");
  await app.waitFor("text:worker");
  expect(app.texts()).toContain("scout");
  expect(app.texts()).toContain("已交付");
  expect(app.texts()).toContain("运行中");

  await app.press("id:subagent-run-r1");
  await app.waitFor("text:sub output");
  expect(app.texts()).toContain("sub output");
  expect(app.texts()).toContain("implement the thing");
});
