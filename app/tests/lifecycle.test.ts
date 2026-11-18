import { expect, open, test } from "nsh/test";
import { Instance, State } from "zu/native";

// A headless app must not take the single-instance lock: the test runner
// opens many apps, and a fixture that claimed would make the next one look
// like a duplicate (and could block a desktop run on the same state
// directory). The claim's file semantics are in `src/instance.rs`'s tests.
//
// The state directory is this test's own: the developer's running app holds
// the real `~/.steer` claim, which is exactly the behavior under test, not a
// reason for a test to fail.
const STATE_DIR = `/tmp/zu-m12-lifecycle-${Date.now()}`;
State.setStateDir(STATE_DIR);

test("a headless run claims no instance lock", async () => {
  const app = await open("../App.tsx", { network: "live", width: 1200, height: 800 });
  try {
    // The app booted (or is booting the engine) in headless mode.
    await app.waitUntil(() => app.texts().length > 0);
    const claim = Instance.claim();
    expect(claim.acquired).toBe(true);
    expect(claim.already).toBe(false);
    expect(String(claim.path).endsWith("instance.lock")).toBe(true);
    expect(String(claim.path).startsWith(STATE_DIR)).toBe(true);
  } finally {
    Instance.release();
    // Stop the sidecar this app started, as the shell's Stop does, so the
    // next file is not handed an engine it did not ask for.
    if (app.shows("id:titlebar-tools")) {
      await app.press("id:titlebar-tools");
      if (app.shows("id:engine-stop")) await app.press("id:engine-stop");
    }
    State.setStateDir("");
  }
});
