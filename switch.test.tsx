import { expect, open, test } from "nsh/test";
import { Engine } from "zu/native";
import { connect, request } from "./engine";

// A state directory of this run: the user's registry is never touched.
Engine.setStateDir(`/tmp/zu-switch-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
Engine.setNoExtensions(true);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The engine's active container, once the shell's switch has reached it. */
async function untilActive(id: string, timeoutMs = 15000): Promise<boolean> {
  for (let waited = 0; waited < timeoutMs; waited += 100) {
    const list = await request("container.list", {});
    if (list.activeContainerId === id) return true;
    await sleep(100);
  }
  return false;
}

test("pressing a container row switches the active container", async () => {
  await connect();
  const a = await request("container.create", { cwd: "/tmp/zu-switch-a" }, 120000);
  const b = await request("container.create", { cwd: "/tmp/zu-switch-b" }, 120000);

  const app = await open("./App.tsx", { network: "live", width: 1280, height: 800 });
  await app.waitUntil(() => app.texts().includes("zu-switch-a"), { timeout: 60000 });
  await app.waitUntil(() => app.texts().includes("zu-switch-b"), { timeout: 60000 });

  // The press must reach the engine; the shell flushes the current layout
  // first, and during startup that write can queue behind session hydration.
  await app.press("Open container zu-switch-a");
  expect(await untilActive(a.container.id)).toBe(true);
  // And the canvas stays on it: a late startup reply must not put back the
  // container the press just left (the tab title is the session's prefix).
  const aTab = String(a.container.sessions[0].sessionId).slice(0, 8);
  await app.waitUntil(() => app.texts().includes(aTab), { timeout: 10000 });

  await app.press("Open container zu-switch-b");
  expect(await untilActive(b.container.id)).toBe(true);
}, 180000);


test("the titlebar picker switches the container and its tab content", async () => {
  // A second app against the same engine state; the first test's containers
  // are still there, so pick by explicit id from the engine list.
  const before = await request("container.list", {});
  expect(before.containers.length).toBeGreaterThanOrEqual(2);
  const target = before.containers.find((row: any) => row.cwd.endsWith("/zu-switch-a"));
  expect(target).toBeDefined();
  const firstSession = target.sessions[0].sessionId;

  const app = await open("./App.tsx", { network: "live", width: 1280, height: 800 });
  await app.waitUntil(() => app.texts().includes("zu-switch-a"), { timeout: 60000 });
  await app.press("id:session-picker");
  await app.waitUntil(() => app.shows(`id:picker-container-${target.id}`), { timeout: 10000 });
  await app.press(`id:picker-container-${target.id}`);
  let active = "";
  for (let waited = 0; waited < 10000; waited += 100) {
    const list = await request("container.list", {});
    active = list.activeContainerId;
    if (active === target.id) break;
    await sleep(100);
  }
  expect(active).toBe(target.id);
  // The canvas is the target container's session, not the previously active
  // one: its tab title (the unnamed session's short id) must be present.
  await app.waitUntil(() => app.texts().some((text) => text.includes(firstSession.slice(0, 8))), {
    timeout: 10000,
  });
}, 180000);
