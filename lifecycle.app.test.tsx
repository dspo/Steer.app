import { expect, open, test } from "nsh/test";
import { Engine, Instance } from "zu/native";

// The claim and the engine state go to this test's own directory: the
// developer's running app holds the real `~/.pi/zu` claim.
const STATE_DIR = `/tmp/zu-m12-app-${Date.now()}`;
Engine.setStateDir(STATE_DIR);

/**
 * The real app on a desktop window model, with the real sidecar: closing
 * the window reports a close press, the shell hides it, and the engine
 * keeps running — the point of M12's "close means hide". The window comes
 * back through the application menu's Show (Mod+0), then the test stops
 * the engine through the app's own control so no sidecar or claim is left
 * behind for the next test file.
 */
test("hiding the window keeps the engine running", async () => {
  const app = await open("./App.tsx", { network: "live", platform: "macos", width: 1200, height: 800 });
  try {
    await app.waitFor("label:运行中", { timeout: 30000 });
    expect(Engine.status()).toBe("running");
    const win = app.window("main");

    await app.window("main").pressClose();
    await app.waitUntil(() => win.state()?.visible === false);
    // The engine is the sidecar process; hiding the window is not a quit
    // and does not tear down sessions. It is still running after the
    // window has been hidden for a moment.
    expect(Engine.status()).toBe("running");
    await app.wait(500);
    expect(Engine.status()).toBe("running");

    await app.keyboard.press("mod+0");
    await app.waitUntil(() => win.state()?.visible === true && app.shows("label:运行中"));

    // Stop through the shell so its watchdog knows this is intentional.
    await app.press("id:titlebar-tools");
    await app.press("id:engine-stop");
    await app.waitFor("label:未启动");
    expect(Engine.status()).toBe("stopped");
  } finally {
    Instance.release();
    await Engine.stop();
    Engine.setStateDir("");
  }
});
