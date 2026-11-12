import { expect, open, test } from "nsh/test";

/**
 * The manox conversation on the real Workbench, against the real in-proc
 * stub host (native/manox) — headless, no engine, no model. The fixture
 * creates a thread, opens its sheet and starts the scripted turn; this test
 * drives the full minimal loop (R2, DESIGN §3.4): streaming rows, the parked
 * approval card, the elicitation card's answer, the queued lane, and the
 * composer's streaming lane. One open: the pump is a per-process singleton
 * and the pack's stores ride on it.
 */
test("the manox sheet runs the scripted loop on the real workbench", async () => {
  const app = await open("./fixtures/manox.tsx", { width: 1200, height: 800 });
  await app.waitFor("id:manox-fixture-state");
  await app.waitUntil(
    () => app.texts().some((text) => text.startsWith("ready:manox-chat:")),
    { timeout: 20000 },
  );

  // The sidebar group and the sheet are the pack's own surfaces. The fixture
  // lands mid-script, so the composer is in its streaming lane: the stop is
  // up, the send is not.
  await app.waitFor("id:contributed-group-manox");
  await app.waitFor("id:manox-user-message");
  expect(app.count("id:manox-user-message")).toBe(1);
  await app.waitFor("id:manox-input");
  expect(app.shows("id:manox-send")).toBe(false);
  await app.waitFor("id:manox-stop");

  // Queue a message while the first turn streams: the lane line appears with
  // it (the script's own follow-up only joins the lane at the turn's end).
  await app.type("id:manox-input", "queue me");
  await app.submit("id:manox-input");
  await app.waitFor("id:manox-lanes");
  await app.waitUntil(
    () => app.texts().some((text) => text.includes("排队 1 条") || text.includes("1 queued")),
    { timeout: 10000 },
  );
  expect(app.shows("id:manox-send")).toBe(false);

  // The tool call parks at pending-confirmation: the minimal approval card.
  await app.waitFor("id:manox-tool-call");
  await app.waitUntil(() => app.shows("id:manox-approve"), { timeout: 10000 });
  await app.press("id:manox-approve");
  // The tool completes; the elicitation card asks its one question.
  await app.waitFor("id:manox-input-request");
  await app.type("id:manox-ask-input", "the ui answer");
  await app.press("id:manox-ask-accept");
  await app.waitUntil(
    () => app.texts().some((text) => text.includes("已回答") || text.includes("Answered")),
    { timeout: 15000 },
  );
  expect(app.shows("id:manox-ask-accept")).toBe(false);

  // The lane drains one entry per turnComplete — the queued message runs as
  // its own turn (the script's follow-up behind it) — and the composer
  // returns to its idle lane (the send is back, the queue line is gone).
  await app.waitUntil(
    () => app.texts().some((text) => text.includes("queue me")),
    { timeout: 15000 },
  );
  await app.waitUntil(() => app.shows("id:manox-send"), { timeout: 15000 });
  expect(app.shows("id:manox-stop")).toBe(false);
  expect(app.shows("id:manox-lanes")).toBe(false);
});
