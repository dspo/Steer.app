import { expect, test } from "nsh/test";
import { Engine } from "zu/native";
import { connect, disconnect, phase, request } from "./engine";

const stateDir = `/tmp/zu-m4-state-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
Engine.setStateDir(stateDir);
Engine.setNoExtensions(true);
const ROOT_A = "/tmp";
const ROOT_B = "/Users/chenzhongrun/projects/dspo/nsh-pi";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
async function waitConnected(): Promise<void> {
  for (let i = 0; i < 100 && phase() !== "connected"; i++) await sleep(50);
  expect(phase()).toBe("connected");
}

test("a user project has multiple roots and exactly one primary", async () => {
  await disconnect();
  await connect();
  await waitConnected();

  const created = await request(
    "project.create",
    { roots: [{ path: ROOT_A, primary: true }, { path: ROOT_B }] },
    10000,
  );
  expect(created.project.name).toBe("tmp");
  expect(created.project.nameOverridden).toBe(false);
  expect(created.project.roots.length).toBe(2);
  expect(created.project.roots.filter((root: any) => root.primary).length).toBe(1);
  expect(created.project.roots.find((root: any) => root.primary).path).toBe(ROOT_A);

  let failed = false;
  try {
    await request(
      "project.create",
      { roots: [{ path: ROOT_A, primary: true }, { path: ROOT_B, primary: true }] },
      10000,
    );
  } catch {
    failed = true;
  }
  expect(failed).toBe(true);

  const fixed = await request("project.update", { projectId: created.project.id, name: "Zu Workspace" }, 10000);
  expect(fixed.project.name).toBe("Zu Workspace");
  expect(fixed.project.nameOverridden).toBe(true);
});

test("a container created from a project snapshots the primary cwd", async () => {
  const list = await request("project.list", {}, 10000);
  const project = list.projects[0];
  const made = await request("container.create", { projectId: project.id }, 30000);
  expect(made.container.cwd).toBe(ROOT_A);
  expect(made.container.projectId).toBe(project.id);

  const chatted = await request("container.create", { cwd: "/tmp/zu-m4-chats" }, 30000);
  expect(chatted.container.projectId ?? null).toBeNull();

  const containers = await request("container.list", {}, 10000);
  expect(containers.containers.find((row: any) => row.id === made.container.id)?.projectId).toBe(project.id);
  expect(containers.containers.find((row: any) => row.id === chatted.container.id)?.projectId ?? null).toBeNull();
}, 60000);

test("a container keeps the project it was created under across a restart", async () => {
  const first = await request("project.list", {}, 10000);
  const project = first.projects[0];
  const containers = await request("container.list", {}, 10000);
  const target = containers.containers.find((row: any) => row.projectId === project.id);
  expect(target).toBeDefined();

  await disconnect();
  await connect();
  await waitConnected();
  const after = await request("container.list", {}, 10000);
  expect(after.containers.find((row: any) => row.id === target.id)?.projectId).toBe(project.id);
  // A container's project is a property fixed at creation: the wire has no
  // command that changes it, and the sidebar has no gesture (see shell.tsx).
  expect(after.containers.find((row: any) => row.id === target.id)?.projectId).toBe(project.id);
}, 60000);

test("leaves the shared runner clean", async () => {
  await disconnect();
  Engine.setStateDir("");
  Engine.setNoExtensions(false);
});
