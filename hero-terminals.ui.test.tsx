import { expect, open, test } from "nsh/test";

// §2.1.1 F2's acceptance: a Pi container's Hero opens the shell and an agent
// TUI as terminal resources of that container — two new tabs, still one
// sidebar row — and archiving the container ends both PTYs. The fixture
// reads the store, so the assertions are sheet ids and live PTYs.

/** The fixture's one-line store probe, split into its fields. */
function stateOf(app: { texts: () => string[] }): { panels: string; containers: number; pty: number } {
  const line = app.texts().find((text) => text.startsWith("panels=")) ?? "";
  const containers = Number(/containers=(\d+)/.exec(line)?.[1] ?? "-1");
  const pty = Number(/pty=(\d+)/.exec(line)?.[1] ?? "-1");
  return { panels: /panels=([^ ]*)/.exec(line)?.[1] ?? "", containers, pty };
}

test("a container's Hero opens its terminals inside that container", async () => {
  const app = await open("./fixtures/hero-terminals.tsx", { width: 1200, height: 800 });
  await app.waitFor("id:launcher-input", { timeout: 20000 });
  expect(stateOf(app).panels).toBe("home:c1");

  // Terminal: a shell in c1. The Hero's tab becomes the terminal's.
  await app.press("id:external-terminal");
  await app.waitUntil(() => stateOf(app).panels === "terminal:c1:1", { timeout: 20000 });
  expect(app.shows("id:terminal-view")).toBe(true);
  expect(app.shows("id:launcher-input")).toBe(false);
  expect(stateOf(app).containers).toBe(1);

  // The Hero is gone from the tree; `+` on the tab bar brings it back.
  await app.press("id:tab-plus-terminal:c1:1");
  await app.waitFor("id:launcher-input", { timeout: 10000 });
  await app.press("id:external-claude");
  await app.waitUntil(() => stateOf(app).panels.includes("terminal:c1:2"), { timeout: 20000 });
  // Two terminal resources of one container; the sidebar still has one row.
  expect(stateOf(app).containers).toBe(1);
  expect(stateOf(app).panels.split(",").filter((panel) => panel.startsWith("terminal:c1:")).length).toBe(2);
  expect(stateOf(app).pty).toBe(2);
  expect(app.texts().some((text) => text.startsWith("Claude Code · "))).toBe(true);

  // Archiving the container takes both PTYs with it. The row is named by its
  // earliest sheet (S2): the shell terminal that replaced the Hero.
  await app.press("label:归档容器 终端 · tmp");
  await app.waitUntil(() => stateOf(app).pty === 0, { timeout: 20000 });
  expect(stateOf(app).containers).toBe(0);
  expect(app.shows("id:terminal-view")).toBe(false);
}, 120000);

// F3: the Hero's Pi action is the native `pi` CLI as a terminal resource of
// the container; the Zu session is only ever reached through the composer.
test("the Hero's Pi opens the native TUI, and the composer owns the Zu session", async () => {
  const app = await open("./fixtures/hero-terminals.tsx", { width: 1200, height: 800 });
  await app.waitFor("id:launcher-input", { timeout: 20000 });
  expect(stateOf(app).panels).toBe("home:c1");

  await app.press("id:launcher-pi");
  await app.waitUntil(() => stateOf(app).panels === "terminal:c1:1", { timeout: 20000 });
  expect(app.texts().some((text) => text.startsWith("Pi · "))).toBe(true);
  // The Zu session sheet did not come up: Pi as an action is the CLI.
  expect(stateOf(app).panels.includes("session:s1")).toBe(false);
  expect(stateOf(app).pty).toBe(1);

  // The composer is the Zu session's lane: its submit puts the session sheet
  // on the canvas (the prompt itself needs an engine this fixture has none of).
  await app.press("id:tab-plus-terminal:c1:1");
  await app.waitFor("id:launcher-input", { timeout: 10000 });
  await app.type("id:launcher-input", "start the conversation");
  await app.submit("id:launcher-input");
  await app.waitUntil(() => stateOf(app).panels.includes("session:s1"), { timeout: 20000 });
  expect(app.shows("id:session-input")).toBe(true);

  // Pi again, this time with a Zu session open: the TUI joins the canvas as
  // its own tab and leaves the session sheet where it was.
  await app.press("id:tab-plus-terminal:c1:1");
  await app.waitFor("id:launcher-input", { timeout: 10000 });
  await app.press("id:launcher-pi");
  await app.waitUntil(() => stateOf(app).panels.includes("terminal:c1:2"), { timeout: 20000 });
  expect(stateOf(app).panels.includes("session:s1")).toBe(true);
  expect(stateOf(app).pty).toBe(2);
}, 120000);
