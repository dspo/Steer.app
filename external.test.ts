import { expect, test } from "nsh/test";
import { Engine } from "zu/native";
import { connect, disconnect, phase, request } from "./engine";

// External containers are registry records without a pi session: the PTY is
// the shell's (native module) member and is deliberately not part of the
// engine. This file drives the data plane: creation, persistence, archive and
// restore, plus the rule that a pi session cannot be attached to one.

const stateDir = `/tmp/zu-m7-external-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
Engine.setStateDir(stateDir);
Engine.setNoExtensions(true);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function waitConnected(): Promise<void> {
  for (let i = 0; i < 100 && phase() !== "connected"; i++) await sleep(50);
  expect(phase()).toBe("connected");
}

test("external containers are created without a pi session", async () => {
  await disconnect();
  await connect();
  await waitConnected();

  const terminal = await request("container.create", { kind: "Terminal", cwd: "/tmp" }, 30000);
  expect(terminal.container.kind).toBe("Terminal");
  expect(terminal.container.id.startsWith("external:terminal:")).toBe(true);
  expect(terminal.container.id.length).toBeGreaterThan("external:terminal:".length);
  expect(terminal.container.sessions).toEqual([]);
  expect(terminal.session).toBeUndefined();
  expect(terminal.container.cwd).toBe("/tmp");

  const claude = await request("container.create", { kind: "Claude", cwd: "/tmp" }, 30000);
  expect(claude.container.kind).toBe("Claude");
  expect(claude.container.id.startsWith("external:claude:")).toBe(true);
  expect(claude.container.id).not.toBe(terminal.container.id);

  const list = await request("container.list", {}, 10000);
  expect(list.containers.length).toBe(2);
  expect(list.activeContainerId).toBe(claude.container.id);
  expect(list.containers.every((row: any) => row.sessions.length === 0)).toBe(true);

  // A pi container keeps its captain session and id.
  const pi = await request("container.create", { cwd: "/tmp" }, 30000);
  expect(pi.container.kind).toBe("Pi");
  expect(pi.container.id.startsWith("pi:")).toBe(true);
  expect(pi.container.sessions.length).toBe(1);
  expect(pi.session).toBeDefined();

  let refused = false;
  try {
    await request("container.attachSession", { containerId: terminal.container.id, path: "/tmp/nope.jsonl" });
  } catch (failure) {
    refused = true;
    expect(String(failure)).toContain("external container");
  }
  expect(refused).toBe(true);
}, 60000);

test("an external container's layout and project membership persist across a restart", async () => {
  const projects = await request(
    "project.create",
    { name: "M7", roots: [{ path: "/tmp", primary: true }] },
    10000,
  );
  const external = await request(
    "container.create",
    { kind: "Codex", projectId: projects.project.id },
    30000,
  );
  expect(external.container.cwd).toBe("/tmp");
  expect(external.container.projectId).toBe(projects.project.id);

  const layout = { center: { type: "tabs", panels: [`terminal:${external.container.id}`], activeIndex: 0 } };
  await request("layout.put", { containerId: external.container.id, layout, zoom: null }, 10000);

  // A second external kind is a different container even in the same project
  // and cwd; ids are uuids, not positions.
  const copilot = await request("container.create", { kind: "Copilot", projectId: projects.project.id }, 30000);
  expect(copilot.container.id).not.toBe(external.container.id);

  await disconnect();
  await connect();
  await waitConnected();

  const after = await request("container.list", {}, 10000);
  const row = after.containers.find((container: any) => container.id === external.container.id);
  expect(row?.kind).toBe("Codex");
  expect(row?.sessions).toEqual([]);
  expect(row?.projectId).toBe(projects.project.id);
  const stashed = await request("layout.get", { containerId: external.container.id }, 10000);
  expect(stashed.layout).toEqual(layout);
}, 60000);

test("archiving an external container keeps its record and restores it", async () => {
  const list = await request("container.list", {}, 10000);
  const target = list.containers.find((row: any) => row.kind === "Terminal");
  const layout = { center: { type: "tabs", panels: [`terminal:${target.id}`], activeIndex: 0 } };
  await request("layout.put", { containerId: target.id, layout, zoom: null }, 10000);
  const archived = await request("container.archive", { containerId: target.id }, 30000);
  expect(archived.containers.find((row: any) => row.id === target.id)?.archived).toBe(true);
  expect(archived.activeContainerId).not.toBe(target.id);

  let shown = false;
  try {
    await request("container.show", { containerId: target.id });
  } catch {
    shown = true;
  }
  expect(shown).toBe(true);

  const restored = await request("container.unarchive", { containerId: target.id }, 10000);
  expect(restored.containers.find((row: any) => row.id === target.id)?.archived).toBe(false);
  const stashed = await request("layout.get", { containerId: target.id }, 10000);
  expect(stashed.layout).toEqual(layout);
}, 60000);

test("leaves the shared runner clean", async () => {
  await disconnect();
  Engine.setStateDir("");
  Engine.setNoExtensions(false);
});
