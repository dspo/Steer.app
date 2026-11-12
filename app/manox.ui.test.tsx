import { expect, open, test } from "nsh/test";

/**
 * The manox conversation on the real Workbench, against the real in-proc
 * host (native/manox assembling dspo/manox v0.9.1) — headless, no engine,
 * no model credentials (the test's state root is an empty temp dir). The
 * fixture creates a thread, opens its sheet and dispatches one turn; the
 * harness's model gate refuses the dispatch and the optimistic row rolls
 * back, so the end state is the sheet's calm idle: the pack surfaces render,
 * the composer returned to its send lane, nothing hangs. The refusal's
 * reason is asserted at the wire level in manox.test.ts (`lastRejection`);
 * this test proves the sheet survives the loop whole. One open: the pump is
 * a per-process singleton and the pack's stores ride on it.
 */
test("the manox sheet runs the real host loop on the workbench", async () => {
  const app = await open("./fixtures/manox.tsx", { width: 1200, height: 800 });
  await app.waitFor("id:manox-fixture-state");
  await app.waitUntil(
    () => app.texts().some((text) => text.startsWith("ready:manox-chat:")),
    { timeout: 60000 },
  );

  // The sidebar group and the sheet are the pack's own surfaces.
  await app.waitFor("id:contributed-group-manox");
  await app.waitFor("id:manox-input");

  // The refused dispatch rolled back: the composer idles (the send is up,
  // the stop and the lanes are gone) and no phantom turn or error line
  // remains — the sheet is exactly as calm as before the dispatch.
  // The rollback is the end state, not an instant: the boot's speed decides
  // whether the refusal echo lands before or after the first look, so the
  // wait is the calm sheet itself (send up, no optimistic row left), not a
  // snapshot taken at a lucky moment.
  await app.waitUntil(
    () => app.shows("id:manox-send") && app.count("id:manox-user-message") === 0,
    { timeout: 30000 },
  );
  expect(app.shows("id:manox-stop")).toBe(false);
  expect(app.shows("id:manox-lanes")).toBe(false);
  expect(app.count("id:manox-error-line")).toBe(0);
  expect(app.count("id:manox-user-message")).toBe(0);
});
