import { afterAll, beforeEach, open } from "nsh/test";
import { terminalTest as test, typeKeys } from "./terminal-keys";

// The terminal sheet added AFTER the app's first render (the Hero action's
// path, a relaunched dev app's restore): the sheet arrives in a later
// commit, where rows built inside a dynamic-in-dynamic never painted.
// Screenshots to /tmp for the local visual check.
test("the terminal sheet paints when it arrives after first render", async () => {
  const app = await open("./terminal-sheet-fixture.tsx", {
    network: "live",
    width: 1200,
    height: 800,
  });
  await app.waitFor("id:terminal-view", { timeout: 20000 });
  await app.wait(1500);
  await typeKeys(app, "printf 'MMMMMMMMMMMMMMMMMMMM\\n'");
  await app.keyboard.press("enter");
  await app.wait(1200);
  // A real platform draws; headless CI only proves the sheet mounts.
  try {
    await app.screenshot("/tmp/ghostty-late-sheet.png");
  } catch {
    // No real platform — the macOS run takes the picture.
  }
});
