import { afterAll, beforeEach, expect, open, test } from "nsh/test";
import { Engine } from "zu/native";
import { createProject } from "./stores/projects";
import { copy } from "./ui/copy";


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
  // The projects file is the UI's fold (zu/state): the store writes it, the
  // app's own fold reads it — no sidecar anywhere.
  const made = await createProject("M7", [{ path: "/tmp", primary: true }]);
  await app.waitFor("id:hero-input", { timeout: 20000 });
  await app.press("id:hero-project");
  await app.waitFor(`id:hero-project-${made?.id}`, { timeout: 20000 });
  await app.press(`id:hero-project-${made?.id}`);
}

test("the Hero opens an external terminal container without a composer", async () => {
  const app = await open("./App.tsx", { network: "live", width: 1200, height: 800 });
  // The ACP boot mounts the folds at once; no phase label exists to wait on.
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
  // No engine-stop tail: the cutover's boot starts no engine, and the
  // titlebar carries no engine controls in the ACP transport.
}, 60000);

test("a terminal's own exit archives its container", async () => {
  const app = await open("./App.tsx", { network: "live", width: 1200, height: 800 });
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
  await app.waitFor("id:hero-input", { timeout: 20000 });
  expect(app.shows("id:terminal-view")).toBe(false);
}, 60000);

