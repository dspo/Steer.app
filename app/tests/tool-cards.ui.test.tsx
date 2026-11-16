import { expect, open, test } from "nsh/test";

// Tool result cards: a registered tool with details renders its card; a
// tool without details (a replay, or nothing registered) keeps today's
// compact line. The fixture registers one renderer and seeds both rows.

test("a registered tool with details renders its card, others stay compact", async () => {
  const app = await open("../fixtures/tool-cards.tsx", { width: 1200, height: 800 });
  await app.waitFor("id:fixture-card");
  // The card read the details it was handed.
  expect(app.texts()).toContain("plan: channel (done)");
  expect(app.count("id:tool-card")).toBe(1);
  // The unregistered tool keeps the compact line, unchanged.
  expect(app.count("id:tool-call")).toBe(1);
  expect(app.texts()).toContain("read");
  expect(app.texts()).toContain("the registry keyed the first row, the second stays compact");
});
