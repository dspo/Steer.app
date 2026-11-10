import { expect, test } from "nsh/test";
import { Engine } from "zu/native";
import { PROTOCOL_VERSION } from "./contracts/protocol";
import { connect, disconnect, info, lastError, phase, recovered, request, snapshot } from "./engine";
import {
  activeId,
  activePath,
  createSession,
  interrupted,
  messages,
  openSession,
  refreshSessions,
  send,
  sessions,
  stop,
  streaming,
} from "./sessions";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Live tests: they run the sidecar and real model calls. Set
// ZU_SKIP_LIVE=1 to skip them where no credentials exist.
const skip = process.env.ZU_SKIP_LIVE === "1";

/** A sidecar process of this build: leftovers from a failed case would
 * answer with their own (old) command set. */
async function freshEngine(): Promise<void> {
  await disconnect();
  await connect();
  expect(phase()).toBe("connected");
}

/** Waits for a predicate, failing with the phase and last error. */
async function until(what: string, condition: () => boolean, timeoutMs = 60000): Promise<void> {
  for (let waited = 0; waited < timeoutMs; waited += 100) {
    if (condition()) return;
    await sleep(100);
  }
  throw new Error(`timed out waiting for ${what} (phase ${phase()}, error ${lastError()})`);
}

test("engine connects and lists pi sessions", async () => {
  if (skip) return;
  await freshEngine();
  await refreshSessions();
  // The developer's ~/.pi holds sessions; a fresh machine may have none.
  expect(Array.isArray(sessions())).toBe(true);
});

test("the welcome and snapshot carry the protocol and generation", async () => {
  if (skip) return;
  await freshEngine();
  const id = await createSession("/tmp/zu-test");
  const snap = await request("state.snapshot", {}, 10000);
  expect(snap.protocol).toBe(PROTOCOL_VERSION);
  expect(snap.generation).toBe(info()?.generation);
  expect(snap.openSessions.some((row: any) => row.sessionId === id)).toBe(true);
  expect(snapshot()?.generation).toBe(snap.generation);
  expect(snap.containers).toEqual([]);
});

test("a prompt streams into the transcript", async () => {
  if (skip) return;
  await connect();
  expect(phase()).toBe("connected");
  const id = await createSession("/tmp/zu-test");
  expect(id.length).toBeGreaterThan(0);
  expect(activeId()).toBe(id);
  await send("Reply with exactly: ok");
  for (let waited = 0; waited < 120000 && streaming(); waited += 200) await sleep(200);
  const list = messages();
  expect(list.some((message) => message.role === "user")).toBe(true);
  expect(list.some((message) => message.role === "assistant" && message.text.length > 0)).toBe(true);
  await stop();
}, 90000);

test("a closed session reopens with its history", async () => {
  if (skip) return;
  await freshEngine();
  const id = await createSession("/tmp/zu-test");
  await send("Reply with exactly: kept");
  for (let waited = 0; waited < 120000 && streaming(); waited += 200) await sleep(200);
  const before = messages().length;
  expect(before).toBeGreaterThan(1);
  const path = activePath();
  expect(path.length).toBeGreaterThan(0);

  // Close the engine-side session (a restart would drop it the same way),
  // then reopen the same file: pi's session file is the authority.
  await request("session.close", { sessionId: id });
  await openSession(path);
  const after = messages();
  expect(after.length).toBeGreaterThan(1);
  expect(after.some((message) => message.role === "assistant")).toBe(true);
});

test("a tool call shows a card in the transcript", async () => {
  if (skip) return;
  await freshEngine();
  await createSession("/tmp/zu-test");
  await send(
    "Read the file /Users/chenzhongrun/projects/dspo/nsh-pi/README.md with the read tool, then reply with its first line only.",
  );
  for (let waited = 0; waited < 180000 && streaming(); waited += 200) await sleep(200);
  const tool = messages().find((message) => message.role === "tool");
  expect(tool).toBeDefined();
  expect(typeof tool?.tool?.name).toBe("string");
  expect(["done", "failed"]).toContain(tool?.tool?.state ?? "");
}, 120000);

test("stopping mid-stream keeps the transcript", async () => {
  if (skip) return;
  await freshEngine();
  await createSession("/tmp/zu-test");
  // A task the model starts writing at once, so the abort lands mid-stream.
  await send("Count from 1 to 300, one number per line.");
  // Wait for the stream to start producing text, then abort it. A slow or
  // throttled provider gets up to 45 s before the case is given up.
  for (let waited = 0; waited < 45000; waited += 50) {
    if (streaming() && messages().some((message) => message.role === "assistant" && message.text.length > 0)) break;
    await sleep(50);
  }
  expect(streaming()).toBe(true);
  const before = messages().length;
  const partial = messages().find((message) => message.role === "assistant")?.text.length ?? 0;
  expect(partial).toBeGreaterThan(0);
  await stop();
  for (let waited = 0; waited < 10000 && streaming(); waited += 100) await sleep(100);
  expect(streaming()).toBe(false);
  // The part that streamed stays; nothing is rolled back.
  expect(messages().length).toBeGreaterThanOrEqual(before);
  expect(messages().some((message) => message.role === "assistant")).toBe(true);
}, 90000);

test("an engine restart keeps the session and writes a durable zu entry", async () => {
  if (skip) return;
  await freshEngine();
  const id = await createSession("/tmp/zu-test");
  await send("Reply with exactly: durable");
  for (let waited = 0; waited < 120000 && streaming(); waited += 200) await sleep(200);
  // A session's file appears only once it has a message, so ask the engine
  // for the path after the turn, not at creation.
  const sessionInfo = await request("session.info", { sessionId: id });
  const path = String(sessionInfo.path ?? "");
  expect(path.length).toBeGreaterThan(0);

  // The turn's end is a custom entry the pi loader reads and the model never
  // sees (Q10); a CLI opening the file finds it.
  expect(sessionInfo.customTypes).toContain("zu.turn");
  const reopened = await request("session.open", { path });
  expect(reopened.customTypes).toContain("zu.turn");

  // A restart: the sidecar process goes away, a new one starts, the file stays.
  await disconnect();
  await freshEngine();
  await refreshSessions();
  await openSession(path);
  expect(messages().length).toBeGreaterThan(1);
  await send("Reply with exactly: after-restart");
  for (let waited = 0; waited < 120000 && streaming(); waited += 200) await sleep(200);
  const replies = messages().filter((message) => message.role === "assistant");
  expect(replies.length).toBeGreaterThanOrEqual(2);
  expect(replies.some((message) => message.text.includes("after-restart"))).toBe(true);
}, 120000);

test("a killed engine restarts, reconnects and marks the turn interrupted", async () => {
  if (skip) return;
  await freshEngine();
  await createSession("/tmp/zu-test");
  await send("Count from 1 to 300, one number per line.");
  await until(
    "a streaming assistant chunk",
    () => streaming() && messages().some((message) => message.role === "assistant" && message.text.length > 0),
    45000,
  );
  const generation = info()?.generation ?? 0;
  expect(generation).toBeGreaterThan(0);

  // Kill the sidecar the way a crash would. The client's supervisor owns the
  // restart from here; no test action reconnects it.
  await Engine.kill();
  await until(
    "the supervised restart",
    () => phase() === "connected" && (info()?.generation ?? 0) > generation,
    90000,
  );
  expect(phase()).toBe("connected");
  expect(info()?.generation).toBeGreaterThan(generation);
  // The snapshot is the rebuilt truth, and the in-flight turn is named as
  // interrupted rather than left streaming forever.
  expect(snapshot()?.generation).toBe(info()?.generation);
  expect(recovered()?.to).toBe(info()?.generation);
  expect(interrupted()).toBe(true);
  expect(streaming()).toBe(false);
  expect(messages().length).toBeGreaterThan(0);
  expect(activeId()?.length).toBeGreaterThan(0);
  await stop();
}, 150000);

test("a protocol mismatch is rejected, not guessed at", async () => {
  if (skip) return;
  await freshEngine();
  const answer = await new Promise<any>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${Engine.port()}`);
    const timer = setTimeout(() => reject(new Error("no answer to a mismatched hello")), 5000);
    ws.onopen = () => {
      ws.send(JSON.stringify({ v: PROTOCOL_VERSION + 1, type: "hello", token: Engine.token() }));
    };
    ws.onmessage = (event) => {
      clearTimeout(timer);
      const message = JSON.parse(String(event.data));
      ws.close();
      resolve(message);
    };
    ws.onerror = () => reject(new Error("socket error"));
  });
  expect(answer.type).toBe("error");
  expect(answer.payload.code).toBe("protocol_mismatch");
  expect(phase()).toBe("connected");
});

/** A raw client for the extension-host case: it answers UI requests itself. */
async function rawClient(): Promise<{
  request: (type: string, payload: Record<string, unknown>) => Promise<any>;
  events: any[];
  close: () => void;
}> {
  let lastError = "";
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      return await dialRawClient();
    } catch (failure) {
      lastError = String(failure);
      await sleep(250);
    }
  }
  throw new Error(`raw client could not connect: ${lastError}`);
}

function dialRawClient(): Promise<{
  request: (type: string, payload: Record<string, unknown>) => Promise<any>;
  events: any[];
  close: () => void;
}> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${Engine.port()}`);
    const pending = new Map<string, { resolve: (data: any) => void; reject: (message: string) => void }>();
    const events: any[] = [];
    let next = 0;
    let welcomed = false;
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("raw client handshake timed out"));
    }, 5000);
    ws.onopen = () => ws.send(JSON.stringify({ v: PROTOCOL_VERSION, type: "hello", token: Engine.token() }));
    ws.onerror = () => {
      if (welcomed) return;
      clearTimeout(timer);
      ws.close();
      reject(new Error("raw client socket error"));
    };
    ws.onmessage = (event) => {
      const message = JSON.parse(String(event.data));
      if (message.type === "welcome") {
        welcomed = true;
        clearTimeout(timer);
        ws.send(JSON.stringify({ v: PROTOCOL_VERSION, id: "sub", type: "state.subscribe", payload: {} }));
        resolve({
          events,
          close: () => ws.close(),
          request: (type, payload) =>
            new Promise((res, rej) => {
              const id = `raw${++next}`;
              pending.set(id, { resolve: res, reject: rej });
              ws.send(JSON.stringify({ v: PROTOCOL_VERSION, id, type, payload }));
            }),
        });
        return;
      }
      if (message.type === "reply") {
        const entry = pending.get(message.id);
        if (!entry) return;
        pending.delete(message.id);
        if (message.payload.ok) entry.resolve(message.payload.data);
        else entry.reject(String(message.payload.error));
        return;
      }
      events.push(message);
      if (message.type === "ui.request") {
        const selected = message.data.method === "confirm" ? true : "beta";
        ws.send(
          JSON.stringify({
            v: PROTOCOL_VERSION,
            id: message.id,
            type: "ui.response",
            payload: { ok: true, result: selected },
          }),
        );
      }
    };
  });
}

test("a real extension's confirm and notify reach the shell", async () => {
  if (skip) return;
  await disconnect();
  const probe = "/Users/chenzhongrun/projects/dspo/nsh-pi/fixtures/extensions/ui-probe.ts";
  Engine.setExtensionPaths(probe);
  try {
    await Engine.start();
    const client = await rawClient();
    const created = await client.request("session.create", { cwd: "/tmp/zu-test" });
    await until(
      "the probe's UI calls",
      () => client.events.filter((event) => event.type === "ui.notify").length >= 3,
      60000,
    );
    const notices = client.events
      .filter((event) => event.type === "ui.notify")
      .map((event) => String(event.data.message));
    expect(notices).toContain("probe mode rpc");
    expect(notices).toContain("probe confirm: true");
    expect(notices).toContain("probe select: beta");
    const status = client.events.find((event) => event.type === "ui.status");
    expect(status?.data.key).toBe("probe");
    expect(status?.data.text).toBe("ready");

    const extensions = await client.request("session.extensions", { sessionId: created.id });
    const paths = extensions.extensions.map((extension: any) => String(extension.path));
    expect(paths.some((path: string) => path.endsWith("ui-probe.ts"))).toBe(true);
    // The two extensions on this machine load too: the host is not a fixture-only path.
    expect(paths.some((path: string) => path.endsWith("ghostex-session.ts"))).toBe(true);
    expect(paths.some((path: string) => path.endsWith("otty-integration.ts"))).toBe(true);
    client.close();
  } finally {
    Engine.setExtensionPaths("");
    await disconnect();
  }
}, 120000);
