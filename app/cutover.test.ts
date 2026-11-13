import { expect, open, test } from "nsh/test";
import { Fs, State } from "zu/native";
import { bootShell } from "./shell/shell";
import { containers, activeContainerId } from "./core/containers";
import { createContainer } from "./modules/pi/container";
import { createSession, refreshSessions, send, stop, sessions, openSession, messages, activeId, turnActive, viewFor } from "./modules/pi/sessions";
import { setAcpCommandOverride } from "./modules/pi/acp/acp";
import { resetStateCache } from "./domains/state";

// The cutover's acceptance (v2 §12 P4 line, B3): the default boot starts no
// engine, opens no listening port, and pi conversations ride stdio harness
// subprocesses that settle and exit. The assertions read the native side's
// own process table (the same truth `ps` would show) and the stub harness
// stands in for `dist/pi-acp` where a model call would be needed.

const stateDir = `/tmp/zu-cutover-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const agentDir = `/tmp/zu-cutover-agent-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const STUB = new URL("./fixtures/acp-stub-agent.sh", import.meta.url).pathname;

State.setStateDir(stateDir);
State.setAgentDir(agentDir);
await Fs.mkdir("/tmp", agentDir.slice("/tmp/".length));
resetStateCache();

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function until(what: string, condition: () => boolean, timeoutMs = 15000): Promise<void> {
  for (let waited = 0; waited < timeoutMs; waited += 25) {
    if (condition()) return;
    await sleep(25);
  }
  throw new Error(`timed out waiting for ${what}`);
}

test("booting the shell starts no engine and listens on no port", async () => {
  await bootShell();
  // The sidecar's process table is empty and it published no port: a `ps`
  // on this machine shows no pi-engine of ours, and nothing listens.
  // Nothing has been written yet (an empty registry is written on the first
  // mutation); the read answers null rather than a stale file.
  expect((await State.read("registry.json")) === null).toBe(true);
});

test("a container and a session are minted without any process", async () => {
  // The conversation's folder exists (the harness spawn checks it).
  await Fs.mkdir("/tmp", "zu-cutover-a");
  const key = await createSession("/tmp/zu-cutover-a");
  expect(key).toBeTruthy();
  const sessionId = await createContainer("/tmp/zu-cutover-a");
  expect(sessionId).toBeTruthy();
  expect(containers().length).toBe(1);
  expect(activeContainerId()).toBe(containers()[0].id);
  // Still no engine: creating a container spawned nothing.
});

test("a conversation runs over a stdio harness subprocess and settles", async () => {
  setAcpCommandOverride({ command: "/bin/sh", args: [STUB], env: { STUB_PROMPT_UPDATES: "1" } });
  try {
    const key = String(await createSession("/tmp/zu-cutover-a"));
    await send("hello over stdio", key);
    // The stub settles quickly; wait for its rows rather than a transient
    // busy flag.
    await until("the assistant row", () => messages().some((row) => row.role === "assistant"));
    const rows = messages();
    expect(rows.some((row) => row.role === "user" && row.text === "hello over stdio")).toBe(true);
    expect(rows.some((row) => row.role === "assistant")).toBe(true);
  } finally {
    setAcpCommandOverride(null);
  }
});

test("stopping a held turn settles it cancelled", async () => {
  setAcpCommandOverride({ command: "/bin/sh", args: [STUB], env: { STUB_HOLD_PROMPT: "1" } });
  try {
    const key = String(activeId());
    await send("count slowly", key);
    // The optimistic row flips `streaming` at once; the turn's own truth is
    // its handle.
    await until("the turn to run", () => turnActive(key));
    await stop(key);
    await until("the turn to settle", () => !turnActive(key));
    // The cancelled turn kept the user's row; nothing is lost.
    expect(messages().some((row) => row.role === "user" && row.text === "count slowly")).toBe(true);
  } finally {
    setAcpCommandOverride(null);
  }
});

test("a closed session reopens from its file through the harness", async () => {
  setAcpCommandOverride({ command: "/bin/sh", args: [STUB], env: { STUB_LOAD_REPLAY: "1" } });
  try {
    // A session file pi could have written, under the scan's root.
    await Fs.mkdir("/tmp", agentDir.slice("/tmp/".length));
    await Fs.mkdir(agentDir, "sessions");
    await Fs.mkdir(agentDir, "sessions/--tmp-cutover--");
    const id = "cccc2222-0000-0000-0000-000000000002";
    const name = `2026-07-20T03-38-58-867Z_${id}.jsonl`;
    const header = `{"type":"session","version":3,"id":"${id}","timestamp":"2026-07-20T03:38:58.868Z","cwd":"/tmp/zu-cutover-a"}\n`;
    await Fs.write(agentDir, `sessions/--tmp-cutover--/${name}`, `${header}{}\n`, null, null);
    const path = `${agentDir}/sessions/--tmp-cutover--/${name}`;

    await refreshSessions();
    const meta = sessions().find((row) => row.id === id);
    expect(meta?.path).toBe(path);

    const view = await openSession(path);
    expect(view?.loaded).toBe(true);
    const rows = messages();
    expect(rows.some((row) => row.role === "user" && row.text === "earlier question")).toBe(true);
    expect(rows.some((row) => row.role === "assistant" && row.text === "earlier answer")).toBe(true);
    // And the boot's no-engine property still holds after all of it.
  } finally {
    setAcpCommandOverride(null);
  }
});

test("the app renders its sidebar with no engine alive", async () => {
  const { open } = await import("nsh/test");
  const app = await open("./App.tsx", { network: "live", width: 1280, height: 800 });
  await app.waitUntil(() => app.texts().includes("zu-cutover-a"), { timeout: 60000 });
  // No engine dot in the titlebar: the ACP transport has no resident state.
  expect(app.shows("id:engine-state")).toBe(false);
}, 60000);

test("leaves the runner clean", () => {
  State.setStateDir("");
  State.setAgentDir("");
  resetStateCache();
});
