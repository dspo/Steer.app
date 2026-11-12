import { expect, open, test } from "nsh/test";

/**
 * The desktop window behavior headless, on the real macOS window model:
 * the main window reports a close press, `LifecycleHost` hides it instead
 * of closing it (the app and its work stay alive), and the show/hide
 * functions the tray and menu use restore it as often as they are called.
 *
 * The tray icon and its menu, the app menu's quit, and a real system
 * notification have no headless model; they are listed as unverified in
 * docs/evidence/m12-lifecycle.md.
 */
test("closing the window hides it and show/hide repeat", async () => {
  const app = await open("./fixtures/lifecycle-window.tsx", { platform: "macos", width: 900, height: 600 });
  const win = app.window("main");
  expect(win.state()?.visible).toBe(true);
  expect(app.texts()).toContain("window visible");

  await app.window("main").pressClose();
  await app.waitUntil(() => win.state()?.visible === false);
  // The window is still open (hidden, not closed): showing it restores the
  // same window, not a new one.
  expect(win.state()).not.toBeNull();

  // The application menu's Show item (Mod+0, the same `showMain` the
  // tray's Show uses) restores the same window; its content comes back.
  await app.keyboard.press("mod+0");
  await app.waitUntil(() => win.state()?.visible === true && app.texts().includes("window visible"));

  await app.press("id:hide-main");
  await app.waitUntil(() => win.state()?.visible === false);
  await app.keyboard.press("mod+0");
  await app.waitUntil(() => win.state()?.visible === true && app.texts().includes("window visible"));

  // A second close press after a restore still hides it.
  await app.window("main").pressClose();
  await app.waitUntil(() => win.state()?.visible === false);
  expect(win.state()).not.toBeNull();
});
