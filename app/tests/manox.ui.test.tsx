import { expect, open, test } from "nsh/test";

/** Whole-file gate: the manox host boots hermetic (throwaway state roots
 * via a process env redirect), which only a dedicated invocation may do —
 * a shared suite runner also runs engine/lsp tests that need the real
 * HOME. Run with: ZU_MANOX_GATE=1 nsh test <this file>. The fixture calls
 * setManoxHermetic itself; this gate only keeps the suite inert. */
const gated = process.env?.["ZU_MANOX_GATE"] === "1";
const t = gated ? test : test.skip;

/**
 * The manox conversation on the real Workbench, against the real in-proc
 * host (native/manox assembling dspo/manox v0.12.0) — headless, no engine,
 * no model credentials (the test's state root is an empty temp dir). The
 * fixture creates a thread, opens its sheet and dispatches one turn; the
 * harness's model gate refuses the dispatch and the optimistic row rolls
 * back, so the end state is the sheet's calm idle: the pack surfaces render,
 * the composer returned to its send lane, nothing hangs. The refusal's
 * reason is asserted at the wire level in manox.test.ts (`lastRejection`);
 * this test proves the sheet survives the loop whole. One open: the pump is
 * a per-process singleton and the pack's stores ride on it.
 */
t("the manox sheet runs the real host loop on the workbench", async () => {
  const app = await open("../fixtures/manox.tsx", { width: 1200, height: 800 });
  await app.waitFor("id:manox-fixture-state");
  await app.waitUntil(
    () => app.texts().some((text) => text.startsWith("ready:manox-chat:")),
    { timeout: 60000 },
  );

  // The sheet is the pack's own surface (the sidebar group was removed
  // with its seam — the Hero's harness segment is the manox entry).
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
  // The composer is the ZCode card (DESIGN §3.6a): the `+` placeholder sits
  // on the footer, disabled, and the idle action is the send.
  expect(app.shows("id:manox-attach")).toBe(true);
  expect(app.enabled("id:manox-attach")).toBe(false);
  expect(app.shows("id:manox-stop")).toBe(false);
  expect(app.shows("id:manox-lanes")).toBe(false);
  expect(app.count("id:manox-error-line")).toBe(0);
  expect(app.count("id:manox-user-message")).toBe(0);

  // The model picker is live in the footer: a hermetic host has no callable
  // catalogue, so opening it must explain the empty state and offer retry
  // rather than rendering a blank menu or a fake model.
  await app.press("id:manox-model-picker");
  await app.waitFor("id:manox-models-empty");
  expect(app.shows("id:manox-model-retry")).toBe(true);
  expect(app.shows("id:manox-effort-picker")).toBe(true);
});
