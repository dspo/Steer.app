import { afterAll, beforeEach, expect, open, test } from "nsh/test";
import { Engine } from "zu/native";

// The shell's external-container path: the Hero's action row creates a
// real Terminal container, the canvas shows its terminal sheet with no
// composer, and archiving it closes the PTY and removes the row. The PTY's
// output is exercised by terminal.ui.test.tsx; here the concern is the shell
// wiring and the registry row.

Engine.setNoExtensions(true);

// Each case gets its own registry and a fresh sidecar: `open` runs the app in
// a VM that shares the native module's process-wide state, and another test
// file may have pointed it at the real `~/.pi/zu` since this module loaded.
beforeEach(async () => {
  await Engine.kill();
  Engine.setStateDir(`/tmp/zu-m7-ui-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
});

afterAll(async () => {
  await Engine.kill();
  Engine.setStateDir("");
  Engine.setNoExtensions(false);
});

test("the Hero opens an external terminal container without a composer", async () => {
  const app = await open("./App.tsx", { network: "live", width: 1200, height: 800 });
  await app.waitFor("label:运行中", { timeout: 20000 });
  // No containers: the canvas is the scratch canvas, whose only sheet is
  // the Hero (a tab of the tree, not a page beside it).
  await app.waitFor("id:external-terminal");
  expect(app.texts()).toContain("开始");
  await app.waitFor("id:tab-plus-home:scratch");
  await app.waitUntil(() => app.enabled("id:external-terminal"), { timeout: 20000 });
  await app.press("id:external-terminal");
  // The terminal sheet, titled by the container's kind and cwd, takes the
  // canvas over; there is no pi composer anywhere.
  await app.waitUntil(() => app.texts().some((text) => text.startsWith("终端 · ")), {
    timeout: 15000,
  });
  expect(app.count("id:session-send")).toBe(0);
  expect(app.shows("id:terminal-view")).toBe(true);
  const title = app.texts().find((text) => text.startsWith("终端 · "))!;

  // Archiving the external container closes its PTY and removes the row.
  await app.press(`label:归档容器 ${title}`);
  await app.waitUntil(() => !app.texts().some((text) => text === title), { timeout: 10000 });
  expect(app.shows("id:terminal-view")).toBe(false);
  await app.press("id:titlebar-tools");
  await app.press("id:engine-stop");
  await app.waitFor("label:未启动", { timeout: 10000 });
}, 60000);

test("a terminal's own exit takes the last sheet, and the Hero brings it back", async () => {
  const app = await open("./App.tsx", { network: "live", width: 1200, height: 800 });
  await app.waitFor("label:运行中", { timeout: 20000 });
  await app.waitFor("id:external-terminal");
  await app.waitUntil(() => app.enabled("id:external-terminal"), { timeout: 20000 });
  await app.press("id:external-terminal");
  await app.waitFor("id:terminal-view", { timeout: 20000 });
  // The shell running in the PTY ends: the sheet goes with it, leaving the
  // container with no sheet (nsh's tab × cannot close a group's last tab,
  // but a program's exit is not the tab's ×).
  await app.type("id:terminal-view", "exit");
  await app.keyboard.press("enter");
  await app.waitUntil(() => app.shows("id:empty-open-hero"), { timeout: 20000 });
  expect(app.shows("id:terminal-view")).toBe(false);
  await app.press("id:empty-open-hero");
  await app.waitFor("id:launcher-input");
  expect(app.shows("id:empty-open-hero")).toBe(false);
}, 60000);

test("an external kind keeps its kind label in the shell's language", async () => {
  const app = await open("./App.tsx", { network: "live", width: 1200, height: 800 });
  await app.waitFor("label:运行中", { timeout: 20000 });
  await app.press("id:titlebar-tools");
  await app.press("id:language");
  await app.waitFor("id:external-terminal");
  await app.waitUntil(() => app.enabled("id:external-terminal"), { timeout: 20000 });
  // English: the first tool row and the created row both use the English copy.
  expect(app.texts()).toContain("Terminal");
  await app.press("id:external-terminal");
  await app.waitUntil(() => app.texts().some((text) => text.startsWith("Terminal · ")), {
    timeout: 15000,
  });
  await app.press("id:titlebar-tools");
  await app.press("id:engine-stop");
  await app.waitFor("label:Stopped", { timeout: 10000 });
}, 60000);
