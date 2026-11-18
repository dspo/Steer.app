import { expect, open, test } from "nsh/test";
import { terminalTest, typeKeys } from "./terminal-keys";

// §2.1.1 F2's acceptance: a container's start page opens the shell and an
// agent TUI as terminal resources of that container — two new tabs, still one
// sidebar row — and archiving the container ends both PTYs. The fixture reads
// the store, so the assertions are sheet ids and live PTYs.

/** The fixture's one-line store probe, split into its fields. */
function stateOf(app: { texts: () => string[] }): { panels: string; containers: number; pty: number } {
  const line = app.texts().find((text) => text.startsWith("panels=")) ?? "";
  const containers = Number(/containers=(\d+)/.exec(line)?.[1] ?? "-1");
  const pty = Number(/pty=(\d+)/.exec(line)?.[1] ?? "-1");
  return { panels: /panels=([^ ]*)/.exec(line)?.[1] ?? "", containers, pty };
}

test("a container's start page opens its terminals inside that container", async () => {
  const app = await open("../fixtures/hero-terminals.tsx", { width: 1200, height: 800 });
  await app.waitFor("id:launch-terminal", { timeout: 20000 });
  expect(stateOf(app).panels).toBe("home:c1");

  // Terminal: a shell in c1. The start page stays as a tab (the palette is
  // reusable), so the terminal joins beside it.
  await app.press("id:launch-terminal");
  await app.waitUntil(() => stateOf(app).panels === "home:c1,terminal:c1:1", { timeout: 20000 });
  expect(app.shows("id:terminal-view")).toBe(true);
  expect(stateOf(app).containers).toBe(1);

  // Back to the palette's tab; Claude is the second resource of c1.
  await app.press("id:tab-home:c1");
  await app.waitFor("id:launch-claude", { timeout: 10000 });
  await app.press("id:launch-claude");
  await app.waitUntil(() => stateOf(app).panels.includes("terminal:c1:2"), { timeout: 20000 });
  // Two terminal resources of one container; the sidebar still has one row.
  expect(stateOf(app).containers).toBe(1);
  expect(stateOf(app).panels.split(",").filter((panel) => panel.startsWith("terminal:c1:")).length).toBe(2);
  expect(stateOf(app).pty).toBe(2);
  // The seeded `Claude Code · tmp`, or the title Claude Code sets itself as
  // soon as it starts (the session reports it with no view attached).
  expect(app.texts().some((text) => text.includes("Claude Code"))).toBe(true);

  // Archiving the container takes both PTYs with it. The row is named by its
  // earliest sheet (S2): the shell terminal that replaced the start page.
  // The fixture mounts the shell without the app's startup, so its copy
  // is the source language (zh-CN) on every machine.
  await app.press("label:归档容器 终端 · tmp");
  await app.waitUntil(() => stateOf(app).pty === 0, { timeout: 20000 });
  expect(stateOf(app).containers).toBe(0);
  expect(app.shows("id:terminal-view")).toBe(false);
}, 120000);

// F3: the start page's Pi tile is the native `pi` CLI as a terminal resource
// of the container; the Zu tile is the conversation.
test("the start page's Pi opens the native TUI, and Zu adds a conversation sheet", async () => {
  const app = await open("../fixtures/hero-terminals.tsx", { width: 1200, height: 800 });
  await app.waitFor("id:launch-pi", { timeout: 20000 });
  expect(stateOf(app).panels).toBe("home:c1");

  await app.press("id:launch-pi");
  await app.waitUntil(() => stateOf(app).panels === "home:c1,terminal:c1:1", { timeout: 20000 });
  // Its title is the seed (`Pi · tmp`) or the title the TUI sets itself.
  expect(app.texts().some((text) => /Pi|π/.test(text))).toBe(true);
  // The Zu session sheet did not come up: Pi as an object is the CLI.
  expect(stateOf(app).panels.includes("session:s1")).toBe(false);
  expect(stateOf(app).pty).toBe(1);

  // Zu mints a *new* session in this container: a session sheet joins the
  // canvas beside the palette (no new container, no new sidebar row).
  await app.press("id:tab-home:c1");
  await app.waitFor("id:launch-zu", { timeout: 10000 });
  await app.press("id:launch-zu");
  await app.waitUntil(() => stateOf(app).panels.includes("session:new1"), { timeout: 20000 });
  expect(stateOf(app).containers).toBe(1);
  expect(app.shows("id:session-input")).toBe(true);

  // Pi again, this time with a Zu session open: the TUI joins the canvas as
  // its own tab and leaves the session sheet where it was.
  await app.press("id:tab-home:c1");
  await app.waitFor("id:launch-pi", { timeout: 10000 });
  await app.press("id:launch-pi");
  await app.waitUntil(() => stateOf(app).panels.includes("terminal:c1:2"), { timeout: 20000 });
  expect(stateOf(app).panels.includes("session:new1")).toBe(true);
  expect(stateOf(app).pty).toBe(2);
}, 120000);

// A program's own exit takes its sheet. The start page is a sheet too (the
// palette), so the container is not empty until the palette is closed; then
// Q69's last-sheet rule archives it. The shell ends because the user typed
// `exit` into the terminal surface (`--target macos`).
terminalTest("a terminal's own exit closes its sheet; the palette's close archives", async () => {
  const app = await open("../fixtures/hero-terminals.tsx", { width: 1200, height: 800 });
  await app.waitFor("id:launch-terminal", { timeout: 20000 });
  await app.press("id:launch-terminal");
  await app.waitUntil(() => stateOf(app).panels === "home:c1,terminal:c1:1", { timeout: 20000 });
  await app.waitUntil(() => stateOf(app).pty === 1, { timeout: 20000 });
  await app.wait(1500);
  await typeKeys(app, "exit");
  await app.keyboard.press("enter");
  await app.waitUntil(() => !app.shows("id:terminal-view"), { timeout: 20000 });
  await app.waitUntil(() => stateOf(app).panels === "home:c1" && stateOf(app).pty === 0, { timeout: 20000 });
  expect(stateOf(app).containers).toBe(1);
  // The palette is a sheet like any other: closing it empties the container.
  await app.press("id:tab-close-home:c1");
  await app.waitUntil(() => stateOf(app).containers === 0, { timeout: 20000 });
}, 60000);
