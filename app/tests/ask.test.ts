import { expect, test } from "nsh/test";
import { Fs, State } from "zu/native";
import { liveSession } from "../modules/pi/acp/host";
import {
  answerAsk,
  createSession,
  openSession,
  pendingAsks,
  refreshSessions,
  send,
  viewFor,
} from "../modules/pi/sessions";
import { setAcpCommandOverride } from "../modules/pi/acp/acp";
import { stubCommand } from "../fixtures/stub-command";
import { resetStateCache } from "../domains/state";

// The interactive-tool mailbox's app side (B2): question cards survive a
// restart as `pendingAsks` (seeded from `_zu/ask/pending`), answers ride the
// live resolve or the `_zu/ask/answer` request, and the user's own send
// supersedes the cards. The stub agent answers the mailbox methods, like it
// answers everything else.

const stateDir = `/tmp/zu-ask-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const agentDir = `/tmp/zu-ask-agent-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

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

const ARGS = { questions: [{ question: "Which database?", header: "Database", multiSelect: false, options: [{ label: "Postgres", description: "relational" }] }] };

test("a restarted session re-seeds its question cards and waits for the user", async () => {
  setAcpCommandOverride(stubCommand({ STUB_PENDING_ASKS: "1", STUB_ASK_ANSWER: "1" }));
  try {
    // A session file pi could have written, under the scan's root.
    await Fs.mkdir("/tmp", "zu-ask-a");
    await Fs.mkdir(agentDir, "sessions");
    await Fs.mkdir(agentDir, "sessions/--tmp-ask--");
    const id = "bbbb1111-0000-0000-0000-000000000001";
    const name = `2026-07-21T09-00-00-000Z_${id}.jsonl`;
    const header = `{"type":"session","version":3,"id":"${id}","timestamp":"2026-07-21T09:00:00.000Z","cwd":"/tmp/zu-ask-a"}\n`;
    await Fs.write(agentDir, `sessions/--tmp-ask--/${name}`, `${header}{}\n`, null, null);
    const path = `${agentDir}/sessions/--tmp-ask--/${name}`;

    await refreshSessions();
    const view = await openSession(path);
    expect(view?.loaded).toBe(true);
    await until("the seeded ask", () => Object.keys(pendingAsks()).length > 0);
    const entry = pendingAsks()[`${id}:tc-pending`];
    expect(entry?.sessionId).toBe(id);
    expect(entry?.toolCallId).toBe("tc-pending");
    expect(entry?.args).toEqual(ARGS);
    expect(entry?.resolve).toBeUndefined();
    // A card waiting for the user holds the session in waiting_user.
    expect(viewFor(id)?.sessionState).toBe("waiting_user");

    // A brand-new session pulls nothing: seeding happens on open, not create.
    setAcpCommandOverride(stubCommand({ STUB_PENDING_ASKS: "1", STUB_UNIQUE_SESSION: "1" }));
    const freshKey = await createSession("/tmp/zu-ask-a");
    expect(Object.keys(pendingAsks()).some((key) => key.startsWith(`${freshKey}:`))).toBe(false);
  } finally {
    setAcpCommandOverride(null);
  }
});

test("answering a seeded card rides the _zu/ask/answer request", async () => {
  const id = "bbbb1111-0000-0000-0000-000000000001";
  expect(pendingAsks()[`${id}:tc-pending`]).toBeTruthy();
  expect(liveSession(id)?.dead).toBe(false);
  await answerAsk(id, "tc-pending", { kind: "option", labels: ["Postgres"] });
  expect(pendingAsks()[`${id}:tc-pending`]).toBeUndefined();
  // No cards left: the session stops waiting on the user.
  expect(viewFor(id)?.sessionState).toBe("ready");
});

test("answering a live card resolves it in-process without the wire", async () => {
  const resolved: unknown[] = [];
  pendingAsks.set({
    "live-session:tc-live": {
      sessionId: "live-session",
      toolCallId: "tc-live",
      args: ARGS,
      resolve: (response) => resolved.push(response),
    },
  });
  await answerAsk("live-session", "tc-live", { kind: "custom", text: "sqlite please" });
  expect(resolved).toEqual([{ kind: "custom", text: "sqlite please" }]);
  expect(pendingAsks()["live-session:tc-live"]).toBeUndefined();
});

test("the user's own send supersedes the waiting cards", async () => {
  setAcpCommandOverride(stubCommand({ STUB_UNIQUE_SESSION: "1" }));
  try {
    const key = String(await createSession("/tmp/zu-ask-a"));
    pendingAsks.set({
      [`${key}:tc-live`]: { sessionId: key, toolCallId: "tc-live", args: ARGS },
    });
    await send("never mind, I picked for you", key);
    await until("the card to drop", () => pendingAsks()[`${key}:tc-live`] === undefined);
    // Other sessions' cards survive the supersede.
    pendingAsks.set({ "other-session:tc-x": { sessionId: "other-session", toolCallId: "tc-x", args: ARGS } });
    await send("again", key);
    expect(pendingAsks()["other-session:tc-x"]).toBeTruthy();
  } finally {
    setAcpCommandOverride(null);
    pendingAsks.set({});
  }
});

test("leaves the runner clean", () => {
  State.setStateDir("");
  State.setAgentDir("");
  resetStateCache();
});
