import { expect, open, test } from "nsh/test";

test("the app VM completes an ACP transcript load", async () => {
  const app = await open("./fixtures/acp-load-probe.tsx", { width: 800, height: 600 });
  await app.waitUntil(() => app.texts().some((text) => text.startsWith("rows=") || text.startsWith("thrown:")), { timeout: 60000 });
  // The store's own openSession, inside the app VM, folded the file's rows.
  expect(app.texts().some((text) => text.startsWith("rows=") && text.includes('view=["user"'))).toBe(true);
}, 90000);
