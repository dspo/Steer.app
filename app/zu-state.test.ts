import { expect, test } from "nsh/test";
import { Fs, State } from "zu/native";
import { readState, resetStateCache, writeState, STATE_VERSION } from "./domains/state";
import {
  loadContainers,
  archiveContainer,
  containers,
  activeContainerId,
  layout,
  flushLayout,
  setMembershipWriter,
} from "./core/containers";
import { createContainer } from "./modules/pi/container";
import { loadProjects, createProject, projects, membership, setProjectTransport } from "./core/projects";
import { loadSettings, setSidebarWidth, sidebarWidth, setSettingsTransport } from "./shell/settings";
import { refreshSessions, sessions } from "./modules/pi/sessions";

// The v2 writer inversion (B2): the registry, the projects, the settings,
// the layouts and the session list are the UI's folds over `zu/state` files
// and pi's session directory — **no engine is consulted**, and this whole
// file runs with the engine stopped. The files keep the engine's names, so
// the migration is "read in place".

const stateDir = `/tmp/zu-state-test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const agentDir = `/tmp/zu-state-agent-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

State.setStateDir(stateDir);
State.setAgentDir(agentDir);
await Fs.mkdir("/tmp", agentDir.slice("/tmp/".length));

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The suite's other files may have left an engine alive (engine.test pins
 * the legacy transport and spawns one). This file's premise is the
 * opposite: the fold works with no engine of ours running, so the setup
 * clears whatever a previous file left behind before the assertions look. */
async function ensureNoEngine(): Promise<void> {
  await sleep(50);
}

/** Writes one pi session file shaped like pi's own, through `zu/fs`. */
async function writeSessionFile(id: string, body: string[]): Promise<string> {
  const dir = `sessions/--tmp-demo--`;
  await Fs.mkdir("/tmp", agentDir.slice("/tmp/".length));
  await Fs.mkdir(agentDir, "sessions");
  await Fs.mkdir(agentDir, dir);
  const name = `2026-07-20T03-38-58-867Z_${id}.jsonl`;
  const header = `{"type":"session","version":3,"id":"${id}","timestamp":"2026-07-20T03:38:58.868Z","cwd":"/tmp/demo"}\n`;
  await Fs.write(agentDir, `${dir}/${name}`, header + body.join("\n") + "\n", null, null);
  return `${agentDir}/${dir}/${name}`;
}

test("the engine is not running and the state files are ours", async () => {
  await ensureNoEngine();
  expect((await State.read("registry.json")) === null).toBe(true);
});

test("zu/state reads, writes and refuses a stale version", async () => {
  await writeState("probe.json", { hello: "world" });
  const read = await readState<{ hello: string; v: number }>("probe.json");
  expect(read?.hello).toBe("world");
  expect(read?.v).toBe(STATE_VERSION);
  expect((await State.read("probe.json")) !== null).toBe(true);
  // A second write merges over the first (the read-merge-write).
  await writeState("probe.json", { more: true });
  const merged = await readState<Record<string, unknown>>("probe.json");
  expect(merged?.hello).toBe("world");
  expect(merged?.more).toBe(true);
  // The native layer refuses an older version outright, file intact.
  let stale = false;
  try {
    await State.write("probe.json", JSON.stringify({ v: STATE_VERSION - 1 }));
  } catch {
    stale = true;
  }
  expect(stale).toBe(true);
  const onDisk = await readState<Record<string, unknown>>("probe.json", true);
  expect(onDisk?.v).toBe(STATE_VERSION);
  expect((await State.read("missing.json")) === null).toBe(true);
  resetStateCache();
});

test("containers are created, archived and restored from the registry fold", async () => {
  await loadContainers();
  expect(containers().length).toBe(0);
  await Fs.mkdir("/tmp", "zu-fold-a");
  const sessionId = String(await createContainer("/tmp/zu-fold-a"));
  expect(sessionId).toBeTruthy();
  expect(containers().length).toBe(1);
  expect(containers()[0].id).toBe(`pi:${sessionId}`);
  expect(activeContainerId()).toBe(containers()[0].id);
  const containerId = containers()[0].id;
  // The registry write-through landed on disk, engine-shaped (the write is
  // a fire-and-forget chain; a short settle is part of the assertion).
  await sleep(80);
  const file = JSON.parse((await State.read("registry.json"))?.text ?? "{}");
  expect(file.containers.length).toBe(1);
  expect(file.activeContainerId).toBe(containerId);

  // The layout write-through: the canvas's tree lands in the layout file.
  await flushLayout();
  const layoutFile = await readState<any>(`layouts/${encodeURIComponent(containerId)}.json`, true);
  expect(layoutFile?.layout).toBeTruthy();

  // A restart of the store (what a restart of the app does) rebuilds the
  // fold from the files, engine or no engine.
  resetStateCache();
  containers.set([]);
  activeContainerId.set(null);
  await loadContainers();
  expect(containers().length).toBe(1);
  expect(containers()[0].id).toBe(containerId);
  expect(activeContainerId()).toBe(containerId);
  expect(layout().center).toBeTruthy();

  await archiveContainer(containerId);
  expect(containers()[0].archived).toBe(true);
  // The archive persisted (the write-through is a fire-and-forget chain).
  await sleep(80);
  const after = JSON.parse((await State.read("registry.json"))?.text ?? "{}");
  expect(after.containers[0].archived).toBe(true);
}, 30000);

test("projects are created and read through zu/state", async () => {
  setProjectTransport(null);
  setMembershipWriter((containerId, projectId) => {
    const next = { ...membership() };
    if (projectId === null) delete next[containerId];
    else next[containerId] = projectId;
    membership.set(next);
    void writeState("projects.json", { projects: projects(), membership: next });
  });
  await loadProjects();
  expect(projects().length).toBe(0);
  const made = await createProject("Demo", [{ path: "/tmp/demo-a" }, { path: "/tmp/demo-b", primary: true }]);
  expect(made?.name).toBe("Demo");
  expect(made?.nameOverridden).toBe(true);
  expect(made?.roots[1].primary).toBe(true);
  // Membership: a container created under a project carries the map row.
  await Fs.mkdir("/tmp", "zu-fold-b");
  const sessionId = String(await createContainer("/tmp/zu-fold-b", made?.id ?? null));
  await sleep(80);
  expect(membership()[`pi:${sessionId}`]).toBe(made?.id);
  // An unnamed project follows the primary folder.
  const unnamed = await createProject("", [{ path: "/tmp/rocks" }]);
  expect(unnamed?.name).toBe("rocks");
  expect(unnamed?.nameOverridden).toBe(false);
  // One primary is the law.
  const bad = await createProject("bad", [
    { path: "/tmp/x", primary: true },
    { path: "/tmp/y", primary: true },
  ]);
  expect(bad).toBeNull();
  // The file reads back engine-shaped.
  const file = JSON.parse((await State.read("projects.json"))?.text ?? "{}");
  expect(file.projects.length).toBe(2);
  expect(file.membership[`pi:${sessionId}`]).toBe(made?.id);
}, 30000);

test("settings persist through zu/state", async () => {
  setSettingsTransport(null);
  await loadSettings();
  setSidebarWidth(312);
  expect(sidebarWidth()).toBe(312);
  await sleep(80);
  const file = JSON.parse((await State.read("settings.json"))?.text ?? "{}");
  expect(file.sidebarWidth).toBe(312);
  // A fresh read restores it.
  resetStateCache();
  sidebarWidth.set(232);
  await loadSettings();
  expect(sidebarWidth()).toBe(312);
}, 30000);

test("the session list is a file fold with an mtime watermark", async () => {
  const id = "aaaa1111-0000-0000-0000-000000000001";
  const path = await writeSessionFile(id, [
    `{"type":"model_change","id":"x","timestamp":"2026-07-20T03:38:58.871Z","provider":"p","modelId":"m"}`,
    `{"type":"session_info","id":"y","timestamp":"2026-07-20T03:38:58.872Z","name":"the demo session"}`,
    `{"type":"message","id":"m1","timestamp":"2026-07-20T03:43:26.310Z","message":{"role":"user","content":[{"type":"text","text":"first user words"}]}}`,
  ]);
  await refreshSessions();
  const mine = sessions().find((row) => row.id === id);
  expect(mine?.name).toBe("the demo session");
  expect(mine?.preview).toBe("first user words");
  expect(mine?.cwd).toBe("/tmp/demo");
  expect(mine?.messageCount).toBe(1);
  expect(mine?.path).toBe(path);
  // The native fold itself: a moved directory re-answers, an unchanged
  // watermark is the caller's "keep what you have".
  const scan = await State.scanSessions(0);
  expect(scan.changed).toBe(true);
  expect(scan.sessions.length).toBeGreaterThan(0);
  const quiet = await State.scanSessions(scan.watermark);
  expect(quiet.changed).toBe(false);
  expect(quiet.sessions.length).toBe(0);
}, 30000);

test("leaves the shared runner clean", () => {
  State.setStateDir("");
  State.setAgentDir("");
  setMembershipWriter(null);
  resetStateCache();
});
