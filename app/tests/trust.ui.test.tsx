import { expect, open, test } from "nsh/test";

// The trust question arrives while session/new is in flight; the dialog lives
// at the app root, so it must answer with no session sheet behind it.
test("the project-trust dialog answers before a session exists", async () => {
  const app = await open("../fixtures/trust.tsx", { width: 900, height: 600 });
  await app.waitFor("id:project-trust");
  expect(app.texts()).toContain("信任这个项目？");
  await app.press("id:trust-accept");
  await app.waitUntil(() => app.texts().includes("trusted"), { timeout: 5000 });
});

test("declining the project trust is a real answer", async () => {
  const app = await open("../fixtures/trust.tsx", { width: 900, height: 600 });
  await app.waitFor("id:project-trust");
  await app.press("id:trust-decline");
  await app.waitUntil(() => app.texts().includes("declined"), { timeout: 5000 });
});
