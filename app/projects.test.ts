import { expect, test } from "nsh/test";
import { Fs, State } from "zu/native";
import { containers, containersLoaded, loadContainers } from "./core/containers";
import {
  containerProject,
  createProject,
  loadProjects,
  projects,
  updateProject,
} from "./core/projects";
import { resetStateCache } from "./domains/state";
import { setAcpCommandOverride } from "./modules/pi/acp/acp";
import { createContainer } from "./modules/pi/container";
import { stubCommand } from "./fixtures/stub-command";

const stateDir = `/tmp/zu-m4-state-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
State.setStateDir(stateDir);
resetStateCache();
const ROOT_A = "/tmp";
const ROOT_B = "/Users/chenzhongrun/projects/dspo/nsh-pi";

// createContainer mints through the harness spawn; the stub stands in for
// `dist/pi-acp` — a developer build CI never makes — like the transport
// tests do. The id comes back unique per spawn: this file mints several
// containers, and a fixed session id would collapse their registry rows.
setAcpCommandOverride(stubCommand({ STUB_UNIQUE_SESSION: "1" }));

test("a user project has multiple roots and exactly one primary", async () => {
  const created = await createProject("", [{ path: ROOT_A, primary: true }, { path: ROOT_B }]);
  expect(created?.name).toBe("tmp");
  expect(created?.nameOverridden).toBe(false);
  expect(created?.roots.length).toBe(2);
  expect(created?.roots.filter((root) => root.primary).length).toBe(1);
  expect(created?.roots.find((root) => root.primary)?.path).toBe(ROOT_A);

  const failed = await createProject("", [
    { path: ROOT_A, primary: true },
    { path: ROOT_B, primary: true },
  ]);
  expect(failed).toBeNull();

  const fixed = await updateProject(created!.id, { name: "Zu Workspace" });
  expect(fixed?.name).toBe("Zu Workspace");
  expect(fixed?.nameOverridden).toBe(true);
});

test("a container created from a project snapshots the primary cwd", async () => {
  await loadProjects();
  const project = projects()[0]!;
  const made = await createContainer(undefined, project.id);
  expect(made).toBeTruthy();
  const container = containers().find((row) => row.id === `pi:${made}`);
  expect(container?.cwd).toBe(ROOT_A);
  expect(containerProject(container!)).toBe(project.id);

  await Fs.mkdir("/tmp", "zu-m4-chats");
  const chatted = await createContainer("/tmp/zu-m4-chats", null);
  const chats = containers().find((row) => row.id === `pi:${chatted}`);
  expect(containerProject(chats!)).toBeNull();
}, 60000);

test("a container keeps the project it was created under across a restart", async () => {
  // The mints above write the registry through a fire-and-forget chain; a
  // short settle lets the file land before this restart reads it back (the
  // stub mint is faster than a real harness, so the race needs naming).
  await new Promise<void>((resolve) => setTimeout(resolve, 120));
  await loadProjects();
  const project = projects()[0]!;
  const target = containers().find((row) => containerProject(row) === project.id);
  expect(target).toBeDefined();

  // A restart is a fresh read of the same files: drop the caches, load again.
  resetStateCache();
  await loadProjects();
  await loadContainers();
  expect(containersLoaded()).toBe(true);
  const after = containers().find((row) => row.id === target!.id);
  expect(after).toBeDefined();
  expect(containerProject(after!)).toBe(project.id);
}, 60000);

test("leaves the shared runner clean", () => {
  State.setStateDir("");
});
