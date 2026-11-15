import { expect, open, test } from "nsh/test";

// The probe is the one test that boots the **real** pi harness
// (`pi-harness/dist/pi-acp`): a developer build artifact (README「Run it」)
// that a fresh checkout never has and CI never makes — the compile target
// pins darwin-arm64, so the Linux pipeline only runs check-version + bun
// test. `ZU_SKIP_LIVE=1`, the CI 口径 that already skips the live model and
// LSP, skips the probe too; with a harness built, the plain `nsh test app`
// runs it.
const t = process.env?.["ZU_SKIP_LIVE"] === "1" ? test.skip : test;

t("the app VM completes an ACP transcript load", async () => {
  const app = await open("./fixtures/acp-load-probe.tsx", { width: 800, height: 600 });
  await app.waitUntil(() => app.texts().some((text) => text.startsWith("rows=") || text.startsWith("thrown:")), { timeout: 60000 });
  // The store's own openSession, inside the app VM, folded the file's rows.
  expect(app.texts().some((text) => text.startsWith("rows=") && text.includes('view=["user"'))).toBe(true);
}, 90000);
