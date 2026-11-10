import { expect, open, test } from "nsh/test";
import { Engine, Instance } from "zu/native";

// The Quit path a desktop app menu takes. `Application.quit()` is a no-op
// in a headless run, so the observable half is the claim: the app took it
// at startup, and choosing Quit releases it before asking the app to end.
// That the OS process then exits is verified natively (and the evidence
// labels it as such).
//
// The lock lives in this test's own state directory: the developer's
// running app owns the real one.
const STATE_DIR = `/tmp/zu-m12-quit-${Date.now()}`;
Engine.setStateDir(STATE_DIR);

test("the app menu's Quit releases the single-instance claim", async () => {
  const app = await open("./fixtures/lifecycle-quit.tsx", { platform: "macos", width: 900, height: 600 });
  expect(app.texts()).toContain("claimed true already false");

  try {
    await app.keyboard.press("mod+q");
    await app.waitUntil(() => app.texts().includes("quit hits 1"));

    // The claim was given back: a fresh claim acquires it rather than
    // finding this process already holding it.
    const claim = Instance.claim();
    expect(claim.acquired).toBe(true);
    expect(claim.already).toBe(false);
    expect(claim.stale).toBe(false);
    expect(String(claim.path).startsWith(STATE_DIR)).toBe(true);
  } finally {
    Instance.release();
    Engine.setStateDir("");
  }
});
