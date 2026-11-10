import { afterAll, beforeEach, expect, open, test } from "nsh/test";
import { Engine } from "zu/native";

// The shell's external-container path: the Launcher's action row creates a
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

test("the Launcher opens an external terminal container without a composer", async () => {
  const app = await open("./App.tsx", { network: "live", width: 1200, height: 800 });
  await app.waitUntil(() => app.texts().includes("运行中"), { timeout: 20000 });
  // No containers: the empty canvas is the Launcher.
  await app.waitFor("id:external-terminal");
  await app.waitUntil(() => app.enabled("id:external-terminal"), { timeout: 20000 });
  await app.press("id:external-terminal");
  // The terminal sheet, titled by the container's kind and cwd, replaces the
  // Launcher; there is no pi composer anywhere.
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
  await app.press("id:engine-stop");
  await app.waitUntil(() => app.texts().includes("未启动"), { timeout: 10000 });
}, 60000);

test("an external kind keeps its kind label in the shell's language", async () => {
  const app = await open("./App.tsx", { network: "live", width: 1200, height: 800 });
  await app.waitUntil(() => app.texts().includes("运行中"), { timeout: 20000 });
  await app.press("id:language");
  await app.waitFor("id:external-terminal");
  await app.waitUntil(() => app.enabled("id:external-terminal"), { timeout: 20000 });
  // English: the action row and the created row both use the English copy.
  expect(app.texts()).toContain("External");
  await app.press("id:external-terminal");
  await app.waitUntil(() => app.texts().some((text) => text.startsWith("Terminal · ")), {
    timeout: 15000,
  });
  await app.press("id:engine-stop");
  await app.waitUntil(() => app.texts().includes("Stopped"), { timeout: 10000 });
}, 60000);
