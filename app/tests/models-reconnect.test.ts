import { expect, test } from "nsh/test";
import { Fs, State } from "zu/native";
import { setAcpCommandOverride } from "../modules/pi/acp/acp";
import { liveSession } from "../modules/pi/acp/host";
import { hydrateSession } from "../modules/pi/container";
import {
  chooseSessionModel,
  ensureAcpSession,
  ensureSessionModels,
  loadSessionModels,
  openSession,
  refreshSessions,
  releaseSession,
  seedSession,
  sessionModels,
  setThinkingLevel,
  viewFor,
} from "../modules/pi/sessions";
import { resetStateCache } from "../domains/state";
import { stubCommand, stubPath } from "../fixtures/stub-command";

// Issue #54: a session's process is released with its sheet, but the view
// and its protocol state stay in memory — and every action that needs the
// live session (reopen, model pick, effort pick, menu open) must resume the
// process first and say so when it cannot. The stub plays the distro: two
// models with `_meta` facts and a two-step thought ladder.

const stateDir = `/tmp/zu-reconnect-state-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const agentDir = `/tmp/zu-reconnect-agent-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const SESSION_ID = "3fff8888-0000-0000-0000-000000005401";
const SESSION_PATH = `${agentDir}/sessions/--tmp-zu-reconnect--/2026-11-18T08-00-00-000Z_${SESSION_ID}.jsonl`;

State.setStateDir(stateDir);
State.setAgentDir(agentDir);
resetStateCache();

async function writeFixtureSession(): Promise<void> {
  await Fs.mkdir("/tmp", "zu-reconnect");
  await Fs.mkdir("/tmp", agentDir.slice("/tmp/".length));
  await Fs.mkdir(agentDir, "sessions");
  await Fs.mkdir(agentDir, "sessions/--tmp-zu-reconnect--");
  const header = `{"type":"session","version":3,"id":"${SESSION_ID}","timestamp":"2026-11-18T08:00:00.001Z","cwd":"/tmp/zu-reconnect"}\n`;
  const user = `{"type":"message","id":"m1","parentId":null,"timestamp":"2026-11-18T08:00:05.000Z","message":{"role":"user","content":[{"type":"text","text":"hello reconnect"}]}}\n`;
  await Fs.write(
    agentDir,
    `sessions/--tmp-zu-reconnect--/2026-11-18T08-00-00-000Z_${SESSION_ID}.jsonl`,
    `${header}${user}`,
    null,
    null,
  );
}

const STUB = stubPath();

test("a released session resumes for every action that needs it", async () => {
  await writeFixtureSession();
  setAcpCommandOverride(stubCommand());
  // The fold learns the file; the open rides it (cwd must match).
  await refreshSessions();
  const view = await openSession(SESSION_PATH);
  expect(view?.loaded).toBe(true);
  expect(liveSession(SESSION_ID)).toBeTruthy();
  await releaseSession(SESSION_ID);
  expect(liveSession(SESSION_ID)).toBeUndefined();

  // The model pick resumes first, then rides the fresh process.
  expect(await chooseSessionModel(SESSION_ID, "p", "other")).toBe(true);
  expect(liveSession(SESSION_ID)).toBeTruthy();
  expect(viewFor(SESSION_ID)?.model?.id).toBe("other");
  await releaseSession(SESSION_ID);

  // The effort pick too: the stub's ladder has off/high only.
  expect(await setThinkingLevel(SESSION_ID, "high")).toBe(true);
  expect(viewFor(SESSION_ID)?.thinkingLevel).toBe("high");
  await releaseSession(SESSION_ID);

  // The menu open resumes as well, and its list comes from the live
  // selector's `_meta`: the provider's display name, credential source and
  // the model's context window.
  expect(liveSession(SESSION_ID)).toBeUndefined();
  await ensureSessionModels(SESSION_ID);
  expect(liveSession(SESSION_ID)).toBeTruthy();
  const models = sessionModels()[SESSION_ID];
  expect(models?.status).toBe("ready");
  const provider = models?.data?.providers[0];
  expect(provider?.id).toBe("p");
  expect(provider?.name).toBe("P");
  expect(provider?.authSource).toBe("stored");
  expect(provider?.models[0].contextWindow).toBe(1_000_000);
  await releaseSession(SESSION_ID);

  // Reopen through the container leg: hydrateSession reconnects before it
  // returns (the early-return used to strand the released view).
  await hydrateSession(SESSION_ID);
  expect(liveSession(SESSION_ID)).toBeTruthy();
  await releaseSession(SESSION_ID);

  // A plain read is not an intent: a released session stays released, its
  // menu data drawn from the stale view copy (the composer's mount ask).
  await loadSessionModels(SESSION_ID);
  expect(liveSession(SESSION_ID)).toBeUndefined();
}, 120000);

test("a failed resume is a visible error, not a silent no", async () => {
  await writeFixtureSession();
  setAcpCommandOverride(stubCommand({ STUB_RESUME_FAIL: "1" }));
  // Self-contained view: the failure case must not inherit state from the
  // earlier open test (issue #64 review, P3).
  seedSession(SESSION_ID, [], { path: SESSION_PATH, cwd: "/tmp/zu-reconnect", loaded: true });
  expect(viewFor(SESSION_ID)?.loaded).toBe(true);
  expect(await chooseSessionModel(SESSION_ID, "p", "m")).toBe(false);
  const error = viewFor(SESSION_ID)?.error ?? "";
  expect(error.length).toBeGreaterThan(0);
  expect(error).toContain("stub_refused");
  // The view stays usable: the transcript is still the projection it was.
  expect(viewFor(SESSION_ID)?.loaded).toBe(true);
  expect(sessionModels()[SESSION_ID]?.status).toBe("error");
  expect(sessionModels()[SESSION_ID]?.error).toContain("stub_refused");

  // The menu's own resume keeps its last list but shows the same reason —
  // never an untranslated `%{error}` placeholder (PR #64 review).
  await ensureSessionModels(SESSION_ID);
  expect(sessionModels()[SESSION_ID]?.status).toBe("error");
  expect(sessionModels()[SESSION_ID]?.error).toContain("stub_refused");
  expect(sessionModels()[SESSION_ID]?.error).not.toContain("%{error}");

  // Once the process can start again, a successful retry clears only the
  // reconnect error; the view stays live and the menu turns ready.
  setAcpCommandOverride(stubCommand());
  expect(await chooseSessionModel(SESSION_ID, "p", "other")).toBe(true);
  expect(viewFor(SESSION_ID)?.error ?? "").toBe("");
  await ensureSessionModels(SESSION_ID, true);
  expect(sessionModels()[SESSION_ID]?.status).toBe("ready");
  await releaseSession(SESSION_ID);
  setAcpCommandOverride(null);
});

test("releasing a session during an in-flight resume closes the late process", async () => {
  await writeFixtureSession();
  setAcpCommandOverride(stubCommand({ STUB_RESUME_DELAY: "600" }));
  await refreshSessions();
  const view = await openSession(SESSION_PATH);
  expect(view?.loaded).toBe(true);
  await releaseSession(SESSION_ID);
  expect(liveSession(SESSION_ID)).toBeUndefined();

  // The resume is deliberately still in flight when the sheet closes.
  const pending = ensureAcpSession(SESSION_ID);
  await new Promise((done) => setTimeout(done, 20));
  await releaseSession(SESSION_ID);
  // The caller may receive the late session, but it must never stay live.
  await pending;
  expect(liveSession(SESSION_ID)).toBeUndefined();
  // Give the late harness a moment to land; it must be closed, not adopted.
  await new Promise((done) => setTimeout(done, 700));
  expect(liveSession(SESSION_ID)).toBeUndefined();
  setAcpCommandOverride(null);
});

test("a cancelled resume's late exit never unregisters the newer session", async () => {
  await writeFixtureSession();
  // A slow exit lets the cancelled resume's process outlive the retry that
  // adopts a fresh session for the same id — the ordering the identity guard
  // in the host's exit handler exists for.
  setAcpCommandOverride(stubCommand({ STUB_RESUME_DELAY: "150", STUB_EXIT_DELAY: "500" }));
  await refreshSessions();
  const loaded = await openSession(SESSION_PATH);
  expect(loaded?.loaded).toBe(true);
  await releaseSession(SESSION_ID);
  expect(liveSession(SESSION_ID)).toBeUndefined();

  // Cancel a resume while it is still starting: its process is never adopted.
  const cancelled = ensureAcpSession(SESSION_ID);
  await new Promise((done) => setTimeout(done, 20));
  await releaseSession(SESSION_ID);
  await cancelled;
  expect(liveSession(SESSION_ID)).toBeUndefined();

  // A new intent adopts a fresh session for the same id before the cancelled
  // process exits. That late exit must not remove this one by id.
  const resumed = await ensureAcpSession(SESSION_ID);
  expect(resumed).toBeTruthy();
  const live = liveSession(SESSION_ID);
  expect(live).toBeTruthy();
  expect(live?.dead).toBe(false);
  await new Promise((done) => setTimeout(done, 900));
  expect(liveSession(SESSION_ID)).toBe(live);
  expect(liveSession(SESSION_ID)?.dead).toBe(false);

  await releaseSession(SESSION_ID);
  setAcpCommandOverride(null);
}, 120000);

test("leaves the runner clean", () => {
  setAcpCommandOverride(null);
  State.setStateDir("");
  State.setAgentDir("");
  resetStateCache();
});
