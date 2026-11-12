import { expect, test } from "nsh/test";
import { Engine } from "zu/native";
import { connect, disconnect, onEngineEvent, phase, request } from "./stores/engine";

const stateDir = `/tmp/zu-m5-state-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
Engine.setStateDir(stateDir);
Engine.setNoExtensions(true);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
let captainId = "";
async function waitConnected(): Promise<void> {
  for (let i = 0; i < 100 && phase() !== "connected"; i++) await sleep(50);
  expect(phase()).toBe("connected");
}

test("a captain registers dispatch tools and runs a subagent", async () => {
  await disconnect();
  await connect();
  await waitConnected();
  const captain = await request("session.create", { cwd: "/tmp/zu-m5" }, 30000);
  captainId = captain.id;
  const notes: string[] = [];
  onEngineEvent((event) => {
    if (event.type === "subagent.note") notes.push(String((event.data as any)?.text ?? ""));
  });
  const tools = await request("session.tools", { sessionId: captain.id }, 10000);
  expect(tools.tools).toContain("dispatch");
  expect(tools.tools).toContain("list_agents");

  const dispatched = await request(
    "subagent.dispatch",
    { captainId: captain.id, agent: "worker", task: "Reply with exactly: sub-ok" },
    30000,
  );
  expect(dispatched.run.status).toBe("running");
  expect(dispatched.run.runId.length).toBeGreaterThan(0);

  // Poll through the roster command, as the shell does.
  for (let waited = 0; waited < 120000; waited += 200) {
    const list = await request("subagent.list", { captainId: captain.id }, 10000);
    const run = list.runs.find((row: any) => row.runId === dispatched.run.runId);
    if (run && run.status !== "running") {
      expect(["settled", "failed"]).toContain(run.status);
      expect(run.status).toBe("settled");
      const transcript = await request("subagent.transcript", { runId: run.runId }, 10000);
      expect(transcript.run.runId).toBe(run.runId);
      expect(transcript.messages.some((message: any) => message.role === "assistant")).toBe(true);
      expect(String(run.output ?? "")).toContain("sub-ok");
      // The captain got both dispatch and delivery notes, and the entries
      // are pi custom entries a CLI loader reads.
      expect(notes.some((text) => text.startsWith("Dispatched worker"))).toBe(true);
      expect(notes.some((text) => text.includes("settled"))).toBe(true);
      const info = await request("session.info", { sessionId: captain.id }, 10000);
      expect(info.customTypes).toContain("zu.dispatch");
      expect(info.customTypes).toContain("zu.delivery");
      break;
    }
    await sleep(200);
  }
}, 150000);

test("a settled subagent can be resumed, and a subagent cannot dispatch", async () => {
  expect(captainId.length).toBeGreaterThan(0);
  const runs = await request("subagent.list", { captainId }, 10000);
  const settled = runs.runs.find((run: any) => run.status === "settled");
  expect(settled).toBeTruthy();

  const resumed = await request(
    "subagent.dispatch",
    { captainId, runId: settled.runId, task: "Reply with exactly: sub-again" },
    30000,
  );
  expect(resumed.run.runId).toBe(settled.runId);
  for (let waited = 0; waited < 120000; waited += 200) {
    const list = await request("subagent.list", { captainId }, 10000);
    const run = list.runs.find((row: any) => row.runId === settled.runId);
    if (run?.status !== "running") {
      expect(run?.status).toBe("settled");
      expect(String(run?.output ?? "")).toContain("sub-again");
      break;
    }
    await sleep(200);
  }

  // Settled runs and their files survive an engine restart; the roster reads
  // them back without the captain session being open.
  await disconnect();
  await connect();
  await waitConnected();
  const afterRestart = await request("subagent.list", { captainId }, 10000);
  const persisted = afterRestart.runs.find((run: any) => run.runId === settled.runId);
  expect(persisted?.status).toBe("settled");
  expect(persisted?.sessionPath).toContain("/subagents/");
  const stored = await request("subagent.transcript", { runId: settled.runId }, 10000);
  expect(stored.messages.some((message: any) => message.role === "assistant")).toBe(true);

  let rejected = false;
  try {
    await request("subagent.dispatch", { captainId: settled.runId, agent: "worker", task: "nope" }, 10000);
  } catch {
    rejected = true;
  }
  expect(rejected).toBe(true);
}, 180000);

test("archiving a captain interrupts live runs and keeps settled ones", async () => {
  const made = await request("container.create", { cwd: "/tmp/zu-m5" }, 30000);
  const madeCaptain = made.container.sessions[0].sessionId;
  const dispatched = await request(
    "subagent.dispatch",
    { captainId: madeCaptain, agent: "worker", task: "Count from 1 to 300, one number per line." },
    30000,
  );
  // The run is live as soon as dispatch acks.
  let list = await request("subagent.list", { containerId: made.container.id }, 10000);
  expect(list.runs.find((run: any) => run.runId === dispatched.run.runId)?.status).toBe("running");

  await request("container.archive", { containerId: made.container.id }, 60000);
  list = await request("subagent.list", { containerId: made.container.id }, 10000);
  const interrupted = list.runs.find((run: any) => run.runId === dispatched.run.runId);
  expect(interrupted?.status).toBe("interrupted");
  expect(interrupted?.settledAt).toBeDefined();

  // The settled record survives unarchive (Q34: data stays).
  await request("container.unarchive", { containerId: made.container.id }, 10000);
  list = await request("subagent.list", { containerId: made.container.id }, 10000);
  expect(list.runs.find((run: any) => run.runId === dispatched.run.runId)?.status).toBe("interrupted");
}, 120000);

test("leaves the shared runner clean", async () => {
  await disconnect();
  Engine.setStateDir("");
  Engine.setNoExtensions(false);
});
