import { expect, open, test } from "nsh/test";

// The ask_user_question card (A1): options with descriptions and the
// recommended hint, one custom-answer input with the "chat about this"
// toggle, the paginated multi-question flow with Back, optional answers, and
// every exit riding the structured envelope through the live resolve. The
// fixture answers print to a dump line the test reads.

test("a single-question card submits a picked option and closes", async () => {
  const app = await open("../fixtures/ask-card.tsx", { width: 900, height: 720 });
  await app.waitFor("id:ask-card");
  const texts = app.texts();
  expect(texts.some((text) => text.includes("Database"))).toBe(true);
  expect(texts.some((text) => text.includes("Which database should we use?"))).toBe(true);
  expect(texts.some((text) => text.includes("Postgres"))).toBe(true);
  expect(texts.some((text) => text.includes("Boring and proven"))).toBe(true);
  expect(texts.some((text) => text.includes("Team knows it"))).toBe(true);
  // Every question is optional: Submit is enabled before anything is picked.
  expect(app.enabled("id:ask-submit")).toBe(true);
  await app.press("id:ask-option-0");
  await app.press("id:ask-submit");
  await app.waitFor("id:ask-submitted");
  expect(app.texts().join(" ")).toContain('"labels":["Postgres"]');
  // The settled card is gone.
  expect(app.shows("id:ask-card")).toBe(false);
});

test("an unanswered question submits as an empty answer", async () => {
  const app = await open("../fixtures/ask-card.tsx", { width: 900, height: 720 });
  await app.waitFor("id:ask-card");
  await app.press("id:ask-submit");
  await app.waitFor("id:ask-submitted");
  expect(app.texts().join(" ")).toContain('"labels":[]');
  expect(app.shows("id:ask-card")).toBe(false);
});

test("clicking a picked option again clears it", async () => {
  const app = await open("../fixtures/ask-card.tsx", { width: 900, height: 720 });
  await app.waitFor("id:ask-card");
  await app.press("id:ask-option-0");
  await app.press("id:ask-option-0");
  await app.press("id:ask-submit");
  await app.waitFor("id:ask-submitted");
  expect(app.texts().join(" ")).toContain('"labels":[]');
});

test("a typed note supplements a picked option", async () => {
  const app = await open("../fixtures/ask-card.tsx", { width: 900, height: 720 });
  await app.waitFor("id:ask-card");
  await app.press("id:ask-option-0");
  await app.type("id:ask-other", "but check with the team");
  await app.press("id:ask-submit");
  await app.waitFor("id:ask-submitted");
  const dump = app.texts().join(" ");
  expect(dump).toContain('"kind":"option"');
  expect(dump).toContain('"labels":["Postgres"]');
  expect(dump).toContain('"text":"but check with the team"');
});

test("chat-about-this keeps the leaning pick next to the notes", async () => {
  const app = await open("../fixtures/ask-card.tsx", { width: 900, height: 720 });
  await app.waitFor("id:ask-card");
  await app.press("id:ask-option-0");
  await app.type("id:ask-other", "pricing first");
  await app.press("id:ask-discuss-toggle");
  await app.press("id:ask-submit");
  await app.waitFor("id:ask-submitted");
  const dump = app.texts().join(" ");
  expect(dump).toContain('"kind":"discuss"');
  expect(dump).toContain('"labels":["Postgres"]');
  expect(dump).toContain("pricing first");
});

test("chat-about-this without notes still sends a discussion", async () => {
  const app = await open("../fixtures/ask-card.tsx", { width: 900, height: 720 });
  await app.waitFor("id:ask-card");
  await app.press("id:ask-option-0");
  await app.press("id:ask-discuss-toggle");
  await app.press("id:ask-submit");
  await app.waitFor("id:ask-submitted");
  const dump = app.texts().join(" ");
  // The toggle is a mode: an empty notes field still means "do not answer".
  expect(dump).toContain('"kind":"discuss"');
  expect(dump).toContain('"labels":["Postgres"]');
  expect(dump).toContain('"notes":""');
});

test("a multi-question card pages both ways and keeps answers", async () => {
  const app = await open("../fixtures/ask-card.tsx", { width: 900, height: 720 });
  await app.waitFor("id:ask-card");
  await app.press("id:load-multi");
  await app.waitFor("id:ask-card");
  expect(app.texts().some((text) => text.includes("第 1 题，共 2 题"))).toBe(true);
  // Both nav buttons keep their spots: only the disable state changes.
  expect(app.enabled("id:ask-back")).toBe(false);
  expect(app.enabled("id:ask-next")).toBe(true);
  // Answer question one, then page forward and back: the pick survives.
  await app.press("id:ask-option-0");
  await app.press("id:ask-next");
  expect(app.texts().some((text) => text.includes("第 2 题，共 2 题"))).toBe(true);
  expect(app.texts().some((text) => text.includes("Run the tests too?"))).toBe(true);
  expect(app.enabled("id:ask-back")).toBe(true);
  expect(app.enabled("id:ask-next")).toBe(false);
  await app.press("id:ask-back");
  expect(app.texts().some((text) => text.includes("第 1 题，共 2 题"))).toBe(true);
  expect(app.texts().some((text) => text.includes("Which database should we use?"))).toBe(true);
  // multiSelect keeps both lanes open; submit carries both answers.
  await app.press("id:ask-next");
  await app.press("id:ask-option-0");
  await app.press("id:ask-option-1");
  await app.press("id:ask-submit");
  await app.waitFor("id:ask-submitted");
  const dump = app.texts().join(" ");
  expect(dump).toContain('"labels":["Postgres"]');
  expect(dump).toContain('"labels":["unit","e2e"]');
});

test("a new ask clears the page and every draft", async () => {
  const app = await open("../fixtures/ask-card.tsx", { width: 900, height: 720 });
  await app.waitFor("id:ask-card");
  // Answer question one of the multi card, type a draft, then swap in a
  // fresh single-question ask (a new toolCallId, no remount).
  await app.press("id:load-multi");
  await app.press("id:ask-option-0");
  await app.type("id:ask-other", "stale draft");
  await app.press("id:ask-discuss-toggle");
  await app.press("id:load-single");
  await app.waitFor("id:ask-card");
  // The drafts are gone: the input reads empty and the old question's
  // progress mark is not carried over.
  expect(app.value("id:ask-other")).toBe("");
  expect(app.shows("id:ask-progress")).toBe(false);
  await app.press("id:ask-submit");
  await app.waitFor("id:ask-submitted");
  const dump = app.texts().join(" ");
  expect(dump).not.toContain("stale draft");
  expect(dump).not.toContain('"kind":"discuss"');
  expect(dump).toContain('"labels":[]');
});

test("skip cancels the whole card", async () => {
  const app = await open("../fixtures/ask-card.tsx", { width: 900, height: 720 });
  await app.waitFor("id:ask-card");
  await app.press("id:ask-cancel");
  await app.waitFor("id:ask-submitted");
  expect(app.texts().join(" ")).toContain('"action":"cancel"');
  expect(app.shows("id:ask-card")).toBe(false);
});
