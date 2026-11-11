import { expect, test } from "nsh/test";
import { Engine } from "zu/native";
import { connect, disconnect, phase, request, snapshot } from "./engine";
import { closeSheet, createContainer, layout } from "./containers";
import { panelIds, sessionSheetId } from "./dock";

// A state directory of this run: the user's registry and layouts are never
// touched by a test. Extensions are skipped too; this file exercises the
// container data plane, not pi's extension host.
const stateDir = `/tmp/zu-m3-state-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
Engine.setStateDir(stateDir);
Engine.setNoExtensions(true);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function waitConnected(): Promise<void> {
  for (let i = 0; i < 100 && phase() !== "connected"; i++) await sleep(50);
  expect(phase()).toBe("connected");
}

test("containers are created, switched and listed from the registry", async () => {
  await disconnect();
  await connect();
  await waitConnected();

  const a = await request("container.create", { cwd: "/tmp/zu-m3-a" }, 30000);
  const b = await request("container.create", { cwd: "/tmp/zu-m3-b" }, 30000);
  expect(a.container.id.startsWith("pi:")).toBe(true);
  expect(a.container.sessions[0].sessionId).toBe(a.session.id);
  expect(b.container.id).not.toBe(a.container.id);

  let list = await request("container.list", {}, 10000);
  expect(list.containers.length).toBe(2);
  expect(list.activeContainerId).toBe(b.container.id);

  const shown = await request("container.show", { containerId: a.container.id }, 10000);
  expect(shown.container.id).toBe(a.container.id);
  list = await request("container.list", {}, 10000);
  expect(list.activeContainerId).toBe(a.container.id);

  const snap = await request("state.snapshot", {}, 10000);
  expect(snap.containers.length).toBe(2);
  expect(snap.activeContainerId).toBe(a.container.id);
}, 60000);

test("each container's layout and zoom are independent", async () => {
  const list = await request("container.list", {}, 10000);
  const [a, b] = list.containers;
  const alpha = {
    center: { type: "tabs", panels: [`session:${a.sessions[0].sessionId}`, "subagents:1"], activeIndex: 1 },
  };
  const beta = { center: { type: "tabs", panels: [`session:${b.sessions[0].sessionId}`], activeIndex: 0 } };
  await request("layout.put", { containerId: a.id, layout: alpha, zoom: "subagents:1" }, 10000);
  await request("layout.put", { containerId: b.id, layout: beta, zoom: null }, 10000);

  await request("container.show", { containerId: a.id }, 10000);
  const readA = await request("layout.get", { containerId: a.id }, 10000);
  expect(readA.layout).toEqual(alpha);
  expect(readA.zoom).toBe("subagents:1");

  const readB = await request("layout.get", { containerId: b.id }, 10000);
  expect(readB.layout).toEqual(beta);
  expect(readB.zoom).toBeNull();
  expect(readA.layout).not.toEqual(readB.layout);
});

test("the registry, active container and layouts survive an engine restart", async () => {
  const before = await request("container.list", {}, 10000);
  const active = before.containers[0];
  const layoutBefore = await request("layout.get", { containerId: active.id }, 10000);

  await disconnect();
  await connect();
  await waitConnected();

  const after = await request("container.list", {}, 10000);
  expect(after.containers.map((row: any) => row.id)).toEqual(before.containers.map((row: any) => row.id));
  expect(after.activeContainerId).toBe(active.id);
  const layoutAfter = await request("layout.get", { containerId: active.id }, 10000);
  expect(layoutAfter.layout).toEqual(layoutBefore.layout);
  // The session id is the container's identity across the restart; its file
  // path is filled in by the first message.
  expect(after.containers[0].sessions[0].sessionId).toBe(before.containers[0].sessions[0].sessionId);
}, 60000);

test("archive removes a container from the live set and tears its sessions down", async () => {
  const list = await request("container.list", {}, 10000);
  const target = list.containers[1];
  const archived = await request("container.archive", { containerId: target.id }, 30000);
  const row = archived.containers.find((row: any) => row.id === target.id);
  expect(row?.archived).toBe(true);
  expect(archived.activeContainerId).toBe(list.containers[0].id);
  const snapAfter = await request("state.snapshot", {}, 10000);
  expect(snapAfter.containers.find((row: any) => row.id === target.id)?.archived).toBe(true);

  // The container's engine session is gone; a prompt cannot find it.
  let sessionGone = false;
  try {
    await request("session.info", { sessionId: target.sessions[0].sessionId });
  } catch {
    sessionGone = true;
  }
  expect(sessionGone).toBe(true);
  let showFailed = false;
  try {
    await request("container.show", { containerId: target.id });
  } catch {
    showFailed = true;
  }
  expect(showFailed).toBe(true);

  const restored = await request("container.unarchive", { containerId: target.id }, 10000);
  expect(restored.containers.find((row: any) => row.id === target.id)?.archived).toBe(false);
  const layout = await request("layout.get", { containerId: target.id }, 10000);
  expect(layout.layout).not.toBeNull();
}, 60000);

test("closing a container's last sheet archives it on the engine", async () => {
  await disconnect();
  await connect();
  await waitConnected();
  // A fresh Pi container through the shell: its canvas is the captain
  // session's sheet alone.
  const sessionId = await createContainer("/tmp/zu-m3-archive");
  expect(sessionId).toBeTruthy();
  const list0 = await request("container.list", {}, 10000);
  const id = String(list0.containers.find((row: any) => row.sessions.some((s: any) => s.sessionId === sessionId)).id);
  expect(panelIds(layout())).toEqual([sessionSheetId(String(sessionId))]);

  // The shell's close path (the tab's ×) empties the canvas, and Q69's
  // auto-archive answers to the engine without a second command.
  closeSheet(sessionSheetId(String(sessionId)));
  // The archive is one await chain behind the close; poll for it.
  let archived = false;
  for (let waited = 0; waited < 10000 && !archived; waited += 100) {
    await sleep(100);
    const list = await request("container.list", {}, 10000);
    archived = !!list.containers.find((row: any) => row.id === id)?.archived;
  }
  expect(archived).toBe(true);
  const list = await request("container.list", {}, 10000);
  expect(list.activeContainerId).not.toBe(id);
}, 60000);

test("leaves the shared runner clean", async () => {
  await disconnect();
  Engine.setStateDir("");
  Engine.setNoExtensions(false);
});
