import { expect, test } from "nsh/test";
import { Fs, State } from "zu/native";
import { containers } from "../core/containers";
import { createContainer, knownSessionIds } from "../modules/pi/container";
import {
  beginNewSession,
  chooseSessionModel,
  createSession,
  ensureLiveSession,
  mintSessionId,
  releaseSession,
  retrySessionStart,
  setThinkingLevel,
  startNewSession,
  viewFor,
} from "../modules/pi/sessions";
import { liveSession } from "../modules/pi/acp/host";
import { setAcpCommandOverride } from "../modules/pi/acp/acp";
import { stubCommand } from "../fixtures/stub-command";
import { resetStateCache } from "../domains/state";

// Issue #56: the press lands on the session page at once — the id is minted
// client-side, the container/sheet/view are built from it, and the harness
// bind runs behind the visible starting face. The assertions read the
// store, the registry and the live-session table; the stub harness answers
// `session/new` (honoring `_meta.sessionId` like the real distro).

const stateDir = `/tmp/zu-start-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
State.setStateDir(stateDir);
State.setAgentDir(`/tmp/zu-start-agent-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
resetStateCache();

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function until(what: string, condition: () => boolean, timeoutMs = 15000): Promise<void> {
  for (let waited = 0; waited < timeoutMs; waited += 25) {
    if (condition()) return;
    await sleep(25);
  }
  throw new Error(`timed out waiting for ${what}`);
}

test("the minted id is a UUID before anything exists", () => {
  expect(mintSessionId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});

test("the press builds container and page at once, and the bind settles in place", async () => {
  setAcpCommandOverride(stubCommand());
  try {
    await Fs.mkdir("/tmp", "zu-start-a");
    const id = String(await createContainer("/tmp/zu-start-a"));
    // The view exists before any bind: the page's starting face is up while
    // the harness comes up in the background.
    const view = viewFor(id);
    expect(view?.sessionState).toBe("starting");
    expect(view?.startingPhase).toBeTruthy();
    expect(view?.loaded).toBe(false);
    expect(view?.cwd).toBe("/tmp/zu-start-a");
    // The container row is `pi:<minted id>` and names the session.
    const row = containers().find((entry) => entry.id === `pi:${id}`);
    expect(row?.cwd).toBe("/tmp/zu-start-a");
    expect(knownSessionIds(row?.id ?? "")).toContain(id);

    await until("the bind to settle", () => viewFor(id)?.sessionState === "ready");
    expect(viewFor(id)?.loaded).toBe(true);
    expect(viewFor(id)?.startingPhase).toBeUndefined();
    // The stub honored the minted id: the live session IS the view key.
    expect(liveSession(id)?.dead).toBe(false);
  } finally {
    setAcpCommandOverride(null);
  }
});

test("a failed bind keeps the page with its reason; the retry succeeds", async () => {
  // The first bind of each process fails (STUB_NEW_FAIL_ONCE); a retry
  // spawns a fresh harness and passes — the in-page retry path.
  setAcpCommandOverride(stubCommand({ STUB_NEW_FAIL_ONCE: "1" }));
  try {
    await Fs.mkdir("/tmp", "zu-start-b");
    const id = String(await createContainer("/tmp/zu-start-b"));
    await until("the failure to land", () => !!viewFor(id)?.startingError);
    expect(viewFor(id)?.sessionState).toBe("starting");
    expect(viewFor(id)?.loaded).toBe(false);
    const reason = viewFor(id)?.startingError ?? "";

    setAcpCommandOverride(stubCommand());
    await retrySessionStart(id);
    await until("the retry to settle", () => viewFor(id)?.sessionState === "ready");
    expect(viewFor(id)?.startingError).toBeUndefined();
    expect(liveSession(id)?.dead).toBe(false);
    expect(reason).toContain("session_new_failed");
  } finally {
    setAcpCommandOverride(null);
  }
});

test("closing the sheet mid-start hangs the bind up and drops the view", async () => {
  // A bind that never answers: the sheet's close is what kills it.
  setAcpCommandOverride(stubCommand({ STUB_NEW_DELAY: "30000" }));
  try {
    await Fs.mkdir("/tmp", "zu-start-c");
    const id = String(await createContainer("/tmp/zu-start-c"));
    await until("the starting face", () => viewFor(id)?.startingPhase !== undefined);
    await releaseSession(id);
    // No view remnant and no session remnant: the container's last sheet
    // closed, so nothing is left to project and no harness survives.
    expect(viewFor(id)).toBeUndefined();
    expect(liveSession(id)).toBeUndefined();
  } finally {
    setAcpCommandOverride(null);
  }
});

test("closing the sheet during the handshake leaves nothing behind", async () => {
  // The handshake window (issue #56 review): the cancel handle exists
  // before the spawn, so a close that lands while `initialize` is still in
  // flight — the `handshake` phase is exactly that — kills the harness
  // before any session exists. STUB_INIT_DELAY keeps the window open; had
  // the kill missed, the bind would adopt at ~1.5 s and the session would
  // appear. It must not.
  setAcpCommandOverride(stubCommand({ STUB_INIT_DELAY: "1500" }));
  try {
    await Fs.mkdir("/tmp", "zu-start-h");
    const id = String(await createContainer("/tmp/zu-start-h"));
    await until("the handshake to be in flight", () => viewFor(id)?.startingPhase === "handshake");
    await releaseSession(id);
    expect(viewFor(id)).toBeUndefined();
    expect(liveSession(id)).toBeUndefined();
    // Past the delayed initialize: no late adoption, no phantom view.
    await sleep(2500);
    expect(liveSession(id)).toBeUndefined();
    expect(viewFor(id)).toBeUndefined();
  } finally {
    setAcpCommandOverride(null);
  }
});

test("a release before the start runs spawns nothing at all", async () => {
  // The begin → container-record → start gap (issue #56 review): the
  // release lands before `startNewSession` is invoked — the store-level
  // cancel mark is what stops the spawn.
  setAcpCommandOverride(stubCommand());
  try {
    await Fs.mkdir("/tmp", "zu-start-i");
    const id = mintSessionId();
    beginNewSession(id, "/tmp/zu-start-i");
    // The begin cleared any earlier mark; release now, before the start.
    await releaseSession(id);
    expect(await startNewSession(id, "/tmp/zu-start-i")).toBeUndefined();
    await sleep(200);
    expect(liveSession(id)).toBeUndefined();
    expect(viewFor(id)).toBeUndefined();
  } finally {
    setAcpCommandOverride(null);
  }
});

test("a released empty session rebuilds over session_not_found and keeps its menus", async () => {
  // pi casts the session file on the first message, so a released empty
  // session has nothing to resume: the resume answers `session_not_found`
  // and the SAME id is re-minted via `session/new` (issue #56 follow-up).
  setAcpCommandOverride(stubCommand({ STUB_RESUME_NOT_FOUND: "1" }));
  try {
    await Fs.mkdir("/tmp", "zu-start-d");
    const id = String(await createContainer("/tmp/zu-start-d"));
    await until("the first bind to settle", () => viewFor(id)?.sessionState === "ready");
    await releaseSession(id);
    expect(liveSession(id)).toBeUndefined();

    // The reopen: a resume that cannot find the file rebuilds in place.
    await ensureLiveSession(id);
    await until("the rebuilt session", () => !!liveSession(id) && !liveSession(id)!.dead);
    expect(viewFor(id)?.sessionState).toBe("ready");

    // The model and effort menus act on the rebuilt session.
    expect(await chooseSessionModel(id, "p", "other")).toBe(true);
    expect(await setThinkingLevel(id, "off")).toBe(true);
    expect(viewFor(id)?.model?.id).toBe("other");
    expect(viewFor(id)?.thinkingLevel).toBe("off");
  } finally {
    setAcpCommandOverride(null);
  }
});

test("a taken minted id surfaces the harness refusal on the starting face", async () => {
  // The harness's occupancy check refuses a second bind with the same id
  // (session_id_taken): an empty rebuild can never shadow a real session's
  // history. The page keeps the reason; the retry is the way out.
  setAcpCommandOverride(stubCommand({ STUB_NEW_TAKEN: "1" }));
  try {
    await Fs.mkdir("/tmp", "zu-start-e");
    const id = mintSessionId();
    beginNewSession(id, "/tmp/zu-start-e");
    await startNewSession(id, "/tmp/zu-start-e");
    expect(viewFor(id)?.startingError).toContain("session_id_taken");
    expect(viewFor(id)?.sessionState).toBe("starting");
  } finally {
    setAcpCommandOverride(null);
  }
});

test("startNewSession shares one bind for a double start", async () => {
  setAcpCommandOverride(stubCommand());
  try {
    await Fs.mkdir("/tmp", "zu-start-f");
    const id = mintSessionId();
    beginNewSession(id, "/tmp/zu-start-f");
    expect(viewFor(id)?.sessionState).toBe("starting");
    const first = startNewSession(id, "/tmp/zu-start-f");
    const second = startNewSession(id, "/tmp/zu-start-f");
    expect(second).toBe(first);
    await second;
    await until("the bind to settle", () => viewFor(id)?.sessionState === "ready");
    expect(liveSession(id)?.dead).toBe(false);
  } finally {
    setAcpCommandOverride(null);
  }
});
