import { afterAll, beforeEach, expect, open, test } from "nsh/test";
import { Engine } from "zu/native";
import { connect, request } from "./engine";
import { copy } from "./copy";


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

/**
 * The Hero's tools that mint a workspace need a project (DESIGN §4.1), so
 * each case gives the scratch canvas one and picks it from the chip.
 */
async function pickProject(app: any): Promise<void> {
  await connect();
  const made = await request("project.create", { name: "M7", roots: [{ path: "/tmp", primary: true }] }, 20000);
  await app.waitFor("id:launcher-input", { timeout: 20000 });
  await app.press("id:launcher-project");
  await app.waitFor(`id:launcher-project-${made.project.id}`, { timeout: 20000 });
  await app.press(`id:launcher-project-${made.project.id}`);
}

test("the Hero opens an external terminal container without a composer", async () => {
  const app = await open("./App.tsx", { network: "live", width: 1200, height: 800 });
  await app.waitFor(`label:${copy("运行中", "Running")}`, { timeout: 20000 });
  // No containers: the canvas is the scratch canvas, whose only sheet is
  // the Hero (a tab of the tree, not a page beside it).
  await app.waitFor("id:external-terminal");
  expect(app.texts()).toContain(copy("开始", "Home"));
  await app.waitFor("id:tab-plus-home:scratch");
  await pickProject(app);
  await app.waitUntil(() => app.enabled("id:external-terminal"), { timeout: 20000 });
  await app.press("id:external-terminal");
  // The terminal sheet, titled by the container's kind and cwd, takes the
  // canvas over; there is no pi composer anywhere.
  await app.waitUntil(() => app.texts().some((text) => text.startsWith(copy("终端 · ", "Terminal · "))), {
    timeout: 15000,
  });
  expect(app.count("id:session-send")).toBe(0);
  expect(app.shows("id:terminal-view")).toBe(true);
  const title = app.texts().find((text) => text.startsWith(copy("终端 · ", "Terminal · ")))!;

  // Archiving the external container closes its PTY and removes the row.
  await app.press(`label:${copy("归档容器", "Archive container")} ${title}`);
  await app.waitUntil(() => !app.texts().some((text) => text === title), { timeout: 10000 });
  expect(app.shows("id:terminal-view")).toBe(false);
  await app.press("id:titlebar-tools");
  await app.press("id:engine-stop");
  await app.waitFor(`label:${copy("未启动", "Stopped")}`, { timeout: 10000 });
}, 60000);

test("a terminal's own exit archives its container", async () => {
  const app = await open("./App.tsx", { network: "live", width: 1200, height: 800 });
  await app.waitFor(`label:${copy("运行中", "Running")}`, { timeout: 20000 });
  await app.waitFor("id:external-terminal");
  await pickProject(app);
  await app.waitUntil(() => app.enabled("id:external-terminal"), { timeout: 20000 });
  await app.press("id:external-terminal");
  await app.waitFor("id:terminal-view", { timeout: 20000 });
  // The shell running in the PTY ends: the sheet goes with it, and a
  // container with no sheet left is not a place anymore (Q69) — the external
  // container archives itself and the canvas lands on the scratch Hero.
  await app.type("id:terminal-view", "exit");
  await app.keyboard.press("enter");
  await app.waitUntil(() => !app.shows("id:terminal-view"), { timeout: 20000 });
  await app.waitFor("id:launcher-input", { timeout: 20000 });
  expect(app.shows("id:terminal-view")).toBe(false);
}, 60000);

