import { expect, open, test } from "nsh/test";

/**
 * The plan's surface (A2): the composer banner shows the item the plan is
 * on and is the panel's entry — pressing it splits the session's sheet to
 * the right with the plan sheet; an all-done plan shows no banner. The
 * panel itself keeps its rows and edits.
 */

const WAIT = { timeout: 30000 };

async function openChatWithPlan() {
  const app = await open("../fixtures/plan.tsx", { width: 1400, height: 800 });
  await app.waitFor("text:captain body", WAIT);
  // The banner loads with the chat (its own poll on mount).
  await app.waitFor("text:Write the module", WAIT);
  return app;
}

test("the banner shows the plan's current item above the composer", async () => {
  const app = await openChatWithPlan();
  // t-3 is the in_progress step: the banner names it, spinner on the left.
  expect(app.texts()).toContain("Write the module");
});

test("pressing the banner splits the plan sheet to the right", async () => {
  const app = await openChatWithPlan();
  await app.press("id:plan-banner");
  // Both surfaces now: the session on the left, the plan on the right.
  await app.waitFor("text:Ship the exporter", WAIT);
  expect(app.texts()).toContain("captain body"); // the session sheet stayed
  expect(app.texts()).toContain("Sketch the exporter");
  expect(app.texts()).toContain("user note");
  expect(app.texts()).toContain("进行中");
  expect(app.texts()).toContain("计划 · plan-demo");
});

test("the panel keeps its edits: toggle, remove, promote, add", async () => {
  const app = await openChatWithPlan();
  await app.press("id:plan-banner");
  await app.waitFor("text:草稿", WAIT);
  // Checking both steps completes the group (t-3 was in_progress).
  await app.press("id:plan-toggle-t-3");
  await app.press("id:plan-toggle-t-4");
  await app.waitFor("text:已完成", WAIT);
  await app.press("id:plan-toggle-t-4");
  await app.waitFor("text:待开始", WAIT);
  await app.press("id:plan-remove-t-2");
  await app.waitFor("text:Ship the exporter", WAIT);
  expect(app.texts()).not.toContain("user note");
  // Promoting the last draft empties the loose lane.
  await app.press("id:plan-promote-t-1");
  await app.waitFor("text:Ship the exporter", WAIT);
  expect(app.texts()).not.toContain("草稿");
  // The panel's own add lands back in the lane as a user item.
  await app.type("id:plan-add-input", "先跑测试");
  await app.press("id:plan-add");
  await app.waitFor("text:先跑测试", WAIT);
  expect(app.texts()).toContain("草稿");
});

test("the poll picks up an agent-side rewrite without a user action", async () => {
  const app = await openChatWithPlan();
  // The fixture swaps its plan for one only a re-read can see: the draft
  // lane empties and a new in_progress step appears.
  await app.press("id:fixture-flip-plan");
  await app.waitFor("text:Deployed from the agent", WAIT);
  expect(app.texts()).not.toContain("user note");
});

test("an all-done plan shows no banner — the entry goes with it", async () => {
  const app = await openChatWithPlan();
  expect(app.texts()).toContain("Write the module"); // banner is up
  await app.press("id:fixture-finish-plan");
  // The next poll finds nothing left to do; the banner goes away.
  await new Promise<void>((resolve) => setTimeout(resolve, 1800));
  expect(app.texts()).not.toContain("Write the module");
});
