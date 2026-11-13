import { expect, open, test } from "nsh/test";
import { Instance, State } from "zu/native";
import { copy } from "./ui/copy";


// The claim and the engine state go to this test's own directory: the
// developer's running app holds the real `~/.pi/zu` claim.
const STATE_DIR = `/tmp/zu-m12-app-${Date.now()}`;
State.setStateDir(STATE_DIR);

/**
 * The real app on a desktop window model, post-cutover: closing the window
 * reports a close press, the shell hides it, and the app keeps running —
 * M12's "close means hide". There is no separate sidecar to keep alive: the
 * shell owns its state files, and each open conversation's `pi-acp` process is
 * owned by its sheet (hiding the window tears nothing down). The window comes
 * back through the application menu's Show (Mod+0).
 */
test("hiding the window keeps the app alive with no sidecar", async () => {
  const app = await open("./App.tsx", { network: "live", platform: "macos", width: 1200, height: 800 });
  try {
    await app.waitFor("id:hero-input", { timeout: 30000 });
    const win = app.window("main");

    await app.window("main").pressClose();
    await app.waitUntil(() => win.state()?.visible === false);
    // Hiding is not a quit: the app is alive, and there is no resident
    // process of ours anywhere — not before, not after.
    await app.wait(500);

    await app.keyboard.press("mod+0");
    await app.waitUntil(() => win.state()?.visible === true);
  } finally {
    Instance.release();
    State.setStateDir("");
  }
});
