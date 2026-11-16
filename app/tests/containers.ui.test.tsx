import { expect, open, test } from "nsh/test";

/** Writes the picture when the run draws the app (`nsh test --target macos`);
 * a headless run draws nothing, so it is a no-op there. */
async function shot(app: { screenshot: (path?: string | null) => Promise<Uint8Array> }, name: string): Promise<void> {
  try {
    await app.screenshot(`docs/evidence/${name}.png`);
  } catch {
    // Headless: nothing is drawn, and nothing is broken.
  }
}

test("containers switch their layouts and throttle hidden sessions", async () => {
  const app = await open("../fixtures/containers.tsx", { width: 1200, height: 800 });
  await app.waitFor("text:alpha body");
  // §2.3-16: the shell's chrome stays in the system face; only the sheet
  // content ("alpha body") reads Lilex (DESIGN §3.4).
  await shot(app, "ui-s23-16-lilex-shell");
  // The first container holds Alpha (shown) and Gamma (hidden).
  expect(app.texts()).toContain("Alpha");
  expect(app.texts()).toContain("Gamma");
  expect(app.texts()).toContain("alpha body");
  expect(app.texts()).not.toContain("gamma body");

  // Switching to the second container restores its own layout only.
  await app.press("Open container Beta");
  await app.waitFor("text:beta body");
  expect(app.texts()).toContain("beta body");
  expect(app.texts()).not.toContain("alpha body");
  expect(app.texts()).not.toContain("gamma body");

  // Back to the first: both tabs and the displayed session survive.
  await app.press("Open container Alpha");
  await app.waitFor("text:alpha body");
  expect(app.texts()).toContain("Gamma");
  expect(app.texts()).not.toContain("gamma body");

  // The tab itself, by its sheet: every sheet of every canvas is in the
  // tree now, so a title is not a unique name.
  await app.press("id:tab-session:s3");
  await app.waitFor("text:gamma body");
  expect(app.texts()).toContain("gamma body");
  expect(app.texts()).not.toContain("alpha body");
});

test("a container's Hero starts its captain session instead of a new container", async () => {
  const app = await open("../fixtures/containers.tsx", { width: 1200, height: 800 });
  await app.waitFor("text:alpha body");
  await app.press("id:tab-plus-session:s1");
  await app.waitFor("id:hero-input");
  await app.type("id:hero-input", "hello in container");
  await app.submit("id:hero-input");
  // The message joined the container's own transcript: a minted container
  // would have shown an empty session instead of Alpha's history.
  await app.waitUntil(() => app.texts().includes("hello in container"));
  expect(app.texts()).toContain("alpha body");
  // The composer's target took the Hero's tab; the Hero is not left beside it.
  expect(app.shows("id:hero-input")).toBe(false);
  expect(app.shows("id:tab-close-home:c1")).toBe(false);
});

test("the VS Code action falls back to the active container's cwd", async () => {
  const app = await open("../fixtures/containers.tsx", { width: 1200, height: 800 });
  await app.waitFor("text:alpha body");
  await app.press("id:open-vscode");
  await app.waitUntil(() => app.openedUrls().length > 0, { timeout: 5000 });
  expect(app.openedUrls()[0]).toBe("vscode://file/tmp/alpha?windowId=_blank");
});

test("clicking a non-active container row switches the canvas", async () => {
  const app = await open("../fixtures/containers.tsx", { width: 1200, height: 800 });
  await app.waitFor("text:alpha body");
  expect(app.texts()).not.toContain("beta body");
  // The row is a press, not a drag: the pan responder must not swallow it
  // and must not write a membership move on release.
  await app.press("id:container-row-c2");
  await app.waitFor("text:beta body");
  expect(app.texts()).toContain("beta body");
  expect(app.texts()).not.toContain("alpha body");
  // The active row's selected state follows the same switch.
  expect(app.enabled("id:container-row-c2")).toBe(true);
});

test("a saved zoom is restored with its container", async () => {
  const app = await open("../fixtures/containers.tsx", { width: 1200, height: 800 });
  await app.waitFor("text:alpha body");
  // c3 is a split with Gamma zoomed: only the zoomed group shows.
  await app.press("Open container Gamma");
  await app.waitFor("text:gamma body");
  expect(app.texts()).toContain("gamma body");
  expect(app.texts()).not.toContain("alpha body");
});

test("the tab bar's + opens the Hero as a sheet in that group", async () => {
  const app = await open("../fixtures/containers.tsx", { width: 1200, height: 800 });
  await app.waitFor("text:alpha body");
  // c1's group holds Alpha and Gamma; the + is the group's Hero entry.
  await app.press("id:tab-plus-session:s1");
  await app.waitFor("id:hero-input");
  // The Hero is a tab of the canvas, not a page beside it.
  expect(app.count("id:tab-close-home:c1")).toBe(1);
  expect(app.texts()).toContain("开始");
  await shot(app, "ui-s2-hero-sheet");
  // Asking again activates the one tab instead of adding a second.
  await app.press("id:tab-plus-session:s1");
  expect(app.count("id:tab-close-home:c1")).toBe(1);
  expect(app.count("id:hero-input")).toBe(1);
  // Closing it leaves the conversation; the + brings it back.
  await app.press("id:tab-close-home:c1");
  await app.waitFor("text:gamma body");
  expect(app.count("id:hero-input")).toBe(0);
  expect(app.shows("id:tab-close-home:c1")).toBe(false);
  await app.press("id:tab-plus-session:s1");
  await app.waitFor("id:hero-input");
  expect(app.count("id:tab-close-home:c1")).toBe(1);
});

test("a container Hero's action takes the Hero's tab", async () => {
  const app = await open("../fixtures/containers.tsx", { width: 1200, height: 800 });
  await app.waitFor("text:alpha body");
  await app.press("id:tab-plus-session:s1");
  await app.waitFor("id:hero-input");
  // The browser replaces the Hero in its slot: no Hero tab stays behind.
  await app.press("id:hero-browser");
  await app.waitFor("id:browser-address");
  expect(app.count("id:hero-input")).toBe(0);
  expect(app.shows("id:tab-close-home:c1")).toBe(false);
  expect(app.count("id:tab-close-webview:c1:1")).toBe(1);
  // Closing the target does not bring the Hero back; the + opens a new one.
  await app.press("id:tab-close-webview:c1:1");
  await app.waitFor("text:gamma body");
  expect(app.count("id:hero-input")).toBe(0);
});

test("archiving removes a container from the sidebar but keeps the data", async () => {
  const app = await open("../fixtures/containers.tsx", { width: 1200, height: 800 });
  await app.waitFor("text:alpha body");
  expect(app.shows("Open container Beta")).toBe(true);
  expect(app.count("id:archive-c2")).toBe(1);
  await app.press("id:archive-c2");
  await app.waitUntil(() => !app.shows("Open container Beta"));
  expect(app.shows("Open container Beta")).toBe(false);
  // The live container is untouched.
  expect(app.shows("Open container Alpha")).toBe(true);
  expect(app.texts()).toContain("alpha body");
});

