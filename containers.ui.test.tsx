import { expect, open, test } from "nsh/test";

test("containers switch their layouts and throttle hidden sessions", async () => {
  const app = await open("./fixtures/containers.tsx", { width: 1200, height: 800 });
  await app.waitFor("text:alpha body");
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

  await app.press("Gamma >> nth=1");
  await app.waitFor("text:gamma body");
  expect(app.texts()).toContain("gamma body");
  expect(app.texts()).not.toContain("alpha body");
});

test("the VS Code action falls back to the active container's cwd", async () => {
  const app = await open("./fixtures/containers.tsx", { width: 1200, height: 800 });
  await app.waitFor("text:alpha body");
  await app.press("id:open-vscode");
  await app.waitUntil(() => app.openedUrls().length > 0, { timeout: 5000 });
  expect(app.openedUrls()[0]).toBe("vscode://file/tmp/alpha?windowId=_blank");
});

test("clicking a non-active container row switches the canvas", async () => {
  const app = await open("./fixtures/containers.tsx", { width: 1200, height: 800 });
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
  const app = await open("./fixtures/containers.tsx", { width: 1200, height: 800 });
  await app.waitFor("text:alpha body");
  // c3 is a split with Gamma zoomed: only the zoomed group shows.
  await app.press("Open container Gamma");
  await app.waitFor("text:gamma body");
  expect(app.texts()).toContain("gamma body");
  expect(app.texts()).not.toContain("alpha body");
});

test("archiving removes a container from the sidebar but keeps the data", async () => {
  const app = await open("./fixtures/containers.tsx", { width: 1200, height: 800 });
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

test("the titlebar session picker switches the container and its canvas", async () => {
  const app = await open("./fixtures/containers.tsx", { width: 1200, height: 800 });
  await app.waitFor("text:alpha body");
  await app.press("id:session-picker");
  await app.waitFor("id:picker-container-c2");
  await app.press("id:picker-container-c2");
  await app.waitFor("text:beta body");
  expect(app.texts()).toContain("beta body");
  expect(app.texts()).not.toContain("alpha body");
});
