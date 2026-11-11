import { afterAll, beforeEach, expect, open, test } from "nsh/test";
import { Engine } from "zu/native";
import { connect, request } from "./engine";

// §2.1-2's acceptance: the app opens on the registry's active container and
// draws its conversation without a click, and the scratch Hero's actions
// land on the matching sheet. Both ride the same sheet tree S1 introduced;
// these tests are the proof the two old mismatches stay gone.

Engine.setNoExtensions(true);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Each case gets its own registry and sidecar: `open` runs the app in a VM
// that shares the native module's process-wide state.
beforeEach(async () => {
  await Engine.kill();
  Engine.setStateDir(`/tmp/zu-s21-2-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
});

afterAll(async () => {
  await Engine.kill();
  Engine.setStateDir("");
  Engine.setNoExtensions(false);
});

test("startup shows the registry's active container and hydrates its conversation", async () => {
  await connect();
  const a = await request("container.create", { cwd: "/tmp/zu-startup-a" }, 120000);
  const aId = a.container.id;
  const aSession = String(a.session?.sessionId ?? a.container.sessions[0].sessionId);
  // The user's own message is on disk as soon as the prompt is accepted, so
  // the conversation is non-empty without waiting for (or paying for) a reply.
  await request("session.prompt", { sessionId: aSession, text: "startup marker alpha" }, 30000);
  await sleep(1500);
  // Another container is created (and becomes the engine's active one), then
  // A is made active again: A is the registry's starting container.
  const b = await request("container.create", { cwd: "/tmp/zu-startup-b" }, 120000);
  await request("container.show", { containerId: aId }, 10000);

  const app = await open("./App.tsx", { network: "live", width: 1280, height: 800 });
  // No clicks: the startup switch draws the container's sheet and hydrates
  // its visible session. The sidebar's row carries the same preview text, so
  // the assertion is the transcript's own user row, not `texts()`.
  await app.waitUntil(() => app.shows("id:session-transcript"), { timeout: 60000 });
  await app.waitUntil(() => app.count("id:user-message") > 0, { timeout: 30000 });
  expect(app.texts()).toContain("startup marker alpha");
  // The canvas is A's sheet, not B's and not a page.
  expect(app.shows("id:launcher-input")).toBe(false);
  expect(b.container.id).not.toBe(aId);
}, 240000);

test("the scratch Hero's Pi and agent actions open their sheets", async () => {
  // The Hero's minting tools need a project (DESIGN §4.1); this case is
  // about the sheets they produce, so give the scratch canvas one.
  await connect();
  const made = await request("project.create", { name: "S21", roots: [{ path: "/tmp", primary: true }] }, 20000);
  const app = await open("./App.tsx", { network: "live", width: 1280, height: 800 });
  await app.waitFor("label:运行中", { timeout: 20000 });
  await app.waitFor("id:launcher-pi", { timeout: 20000 });
  await app.press("id:launcher-project");
  await app.waitFor(`id:launcher-project-${made.project.id}`, { timeout: 20000 });
  await app.press(`id:launcher-project-${made.project.id}`);
  await app.waitUntil(() => app.enabled("id:launcher-pi"), { timeout: 20000 });

  // Pi: the native `pi` CLI, opened as a terminal of the container the
  // scratch Hero mints (§2.1.1 F3). The Zu session is the composer's lane.
  await app.press("id:launcher-pi");
  await app.waitUntil(() => app.shows("id:terminal-view"), { timeout: 60000 });
  expect(app.texts().some((text) => text.startsWith("Pi · "))).toBe(true);
  expect(app.shows("id:launcher-input")).toBe(false);

  // Each TUI action leaves the scratch canvas for its terminal sheet. New
  // starts on Chats (no project), so each pass picks the project again.
  for (const [tool, label] of [
    ["external-claude", "Claude Code"],
    ["external-codex", "Codex"],
    ["external-copilot", "GitHub Copilot"],
  ] as const) {
    await app.press("id:new-container");
    await app.waitFor("id:launcher-input", { timeout: 20000 });
    await app.press("id:launcher-project");
    await app.waitFor(`id:launcher-project-${made.project.id}`, { timeout: 20000 });
    await app.press(`id:launcher-project-${made.project.id}`);
    await app.press(`id:${tool}`);
    await app.waitUntil(() => app.shows("id:terminal-view"), { timeout: 30000 });
    expect(app.shows("id:launcher-input")).toBe(false);
    // The container's kind is its label: in the tab and the sidebar row.
    expect(app.texts().some((text) => text.includes(label))).toBe(true);
  }
}, 240000);
