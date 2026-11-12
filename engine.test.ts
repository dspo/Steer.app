import { expect, test } from "nsh/test";
import { Engine } from "zu/native";
import { PROTOCOL_VERSION } from "./contracts/protocol";
import { connect, disconnect, info, lastError, onEngineEvent, phase, recovered, request, snapshot } from "./stores/engine";
import {
  activeId,
  activePath,
  createSession,
  error as sessionError,
  interrupted,
  messages,
  openSession,
  refreshSessions,
  viewFor,
  send,
  sessions,
  stop,
  streaming,
} from "./stores/sessions";

// A previous test file may have pointed the shared runner at an isolated
// state directory and skipped extensions; M2's live cases want the real
// user registry and the real extension set.
Engine.setStateDir("");
Engine.setNoExtensions(false);

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

test("the shell dials the port the sidecar published", async () => {
  if (skip) return;
  await freshEngine();
  const port = Engine.port();
  expect(port).toBeGreaterThan(0);
  // An explicit ZU_PORT (tests, a deliberate fixed port) is honored; with
  // ZU_PORT unset the port is the system-chosen one, never the old constant.
  const requested = Number(process.env.ZU_PORT ?? 0);
  if (requested > 0) expect(port).toBe(requested);
  else expect(port).not.toBe(47823);
  // The published port is the only port worth dialing: a raw handshake on it
  // reports the same pid as the native process manager.
  const welcome = await new Promise<any>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const timer = setTimeout(() => reject(new Error("no welcome on the published port")), 5000);
    ws.onopen = () => ws.send(JSON.stringify({ v: PROTOCOL_VERSION, type: "hello", token: Engine.token() }));
    ws.onmessage = (event) => {
      clearTimeout(timer);
      const message = JSON.parse(String(event.data));
      ws.close();
      resolve(message);
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error("the published port refused the socket"));
    };
  });
  expect(welcome.type).toBe("welcome");
  expect(welcome.payload.pid).toBe(Engine.pid());
});

test("a request issued while starting waits for the connection", async () => {
  if (skip) return;
  await disconnect();
  expect(phase()).toBe("stopped");
  // `connect` sets the phase synchronously before its first await, so this
  // command is issued while the engine is still starting.
  const connecting = connect();
  expect(phase()).toBe("starting");
  const [health] = await Promise.all([request("engine.health", {}, 30000), connecting]);
  expect(phase()).toBe("connected");
  expect(typeof health.generation).toBe("number");
});

test("a request issued during a reconnect waits for the engine", async () => {
  if (skip) return;
  await freshEngine();
  const generation = info()?.generation ?? 0;
  await Engine.kill();
  await until("the supervisor to notice the dead engine", () => phase() !== "connected", 5000);
  // No immediate "engine is not connected": the command queues until the
  // supervised restart has connected again.
  const health = await request("engine.health", {}, 45000);
  expect(typeof health.generation).toBe("number");
  expect(health.generation).toBeGreaterThan(generation);
  expect(phase()).toBe("connected");
});

test("session.info carries the model, thinking level and context usage", async () => {
  if (skip) return;
  await freshEngine();
  const created = await request("session.create", { cwd: "/tmp/zu-test" });
  const data = await request("session.info", { sessionId: created.id });
  expect(typeof data.model?.provider).toBe("string");
  expect(String(data.model?.provider).length).toBeGreaterThan(0);
  expect(String(data.model?.id).length).toBeGreaterThan(0);
  expect(String(data.model?.name).length).toBeGreaterThan(0);
  expect(typeof data.model?.contextWindow).toBe("number");
  expect(data.model?.contextWindow).toBeGreaterThan(0);
  expect(typeof data.thinkingLevel).toBe("string");
  expect(data.contextUsage).toBeDefined();
  expect(data.contextUsage.contextWindow).toBeGreaterThan(0);
  const tokens = data.contextUsage.tokens;
  const percent = data.contextUsage.percent;
  expect(tokens === null || typeof tokens === "number").toBe(true);
  expect(percent === null || typeof percent === "number").toBe(true);
  if (typeof tokens === "number" && typeof percent === "number") {
    expect(percent).toBeGreaterThanOrEqual(0);
    expect(percent).toBeLessThanOrEqual(100);
  }
  await request("session.close", { sessionId: created.id });
});

test("a start with an unusable state directory fails cleanly", async () => {
  if (skip) return;
  await disconnect();
  expect(Engine.status()).toBe("stopped");
  // `/dev/null/zu` cannot be created: the native start returns an error
  // before spawning, so the shell keeps no zombie, port or stale state.
  Engine.setStateDir("/dev/null/zu");
  try {
    let message = "";
    try {
      await Engine.start();
    } catch (error) {
      message = String(error);
    }
    expect(message.length).toBeGreaterThan(0);
    expect(Engine.status()).toBe("stopped");
    expect(Engine.port()).toBe(0);
    expect(Engine.pid()).toBe(0);
  } finally {
    Engine.setStateDir("");
  }
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
  expect(Array.isArray(snap.containers)).toBe(true);
  expect(snap.activeContainerId === null || typeof snap.activeContainerId === "string").toBe(true);
});

test("a session lists its models and can switch one", async () => {
  if (skip) return;
  await freshEngine();
  const data = await request("session.create", { cwd: "/tmp" }, 120000);
  const info = await request("session.info", { sessionId: data.id }, 30000);
  const models = await request("session.models", { sessionId: data.id }, 60000);
  expect(Array.isArray(models.providers)).toBe(true);
  // The regression this guards: an engine whose registry never loaded
  // answered with an empty list and no reason.
  expect(models.providers.length).toBeGreaterThan(0);
  expect(models.reason).toBeUndefined();
  let listed = 0;
  for (const provider of models.providers) {
    expect(typeof provider.id).toBe("string");
    expect(typeof provider.name).toBe("string");
    expect(provider.models.length).toBeGreaterThan(0);
    listed += provider.models.length;
    for (const model of provider.models) {
      expect(model.provider).toBe(provider.id);
      expect(typeof model.id).toBe("string");
      expect(typeof model.reasoning).toBe("boolean");
    }
  }
  expect(listed).toBeGreaterThan(0);
  // A retry asks pi's auth checks again and finds the same catalog.
  const refreshed = await request("session.models", { sessionId: data.id, refresh: true }, 60000);
  expect(refreshed.providers.length).toBe(models.providers.length);
  // A switch to the model the session already has is a real, accepted set,
  // and the model the composer names is one of the list's rows.
  const current = info.model ?? models.current;
  if (current) {
    const named = models.providers as Array<{ models: Array<{ provider: string; id: string }> }>;
    expect(
      named.some((provider) =>
        provider.models.some((model) => model.provider === current.provider && model.id === current.id),
      ),
    ).toBe(true);
    const changed = await request(
      "session.setModel",
      { sessionId: data.id, provider: current.provider, id: current.id },
      60000,
    );
    expect(changed.model.provider).toBe(current.provider);
    expect(changed.model.id).toBe(current.id);
    expect(typeof changed.running).toBe("boolean");
  }
  // An unknown model is refused rather than guessed.
  await expect(
    request("session.setModel", { sessionId: data.id, provider: "no-such-provider", id: "no-such-model" }, 30000),
  ).rejects.toThrow("unknown model");
  await request("session.close", { sessionId: data.id }, 30000);
});

test("with no credentials the model list says why it is empty", async () => {
  if (skip) return;
  // An empty pi home: pi's own provider catalog is there, its credentials
  // are not. The picker must get a reason, not a silent empty list.
  const agentDir = `/tmp/zu-no-models-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  Engine.setAgentDir(agentDir);
  try {
    await freshEngine();
    const data = await request("session.create", { cwd: "/tmp" }, 120000);
    const models = await request("session.models", { sessionId: data.id }, 60000);
    expect(models.providers).toEqual([]);
    expect(models.reason?.code).toBe("no_credentials");
    // pi keeps a placeholder model when nothing is available; the composer
    // reads its absence, not a model named "unknown".
    const info = await request("session.info", { sessionId: data.id }, 30000);
    expect(info.model).toBeUndefined();
    await request("session.close", { sessionId: data.id }, 30000);
  } finally {
    Engine.setAgentDir("");
    // The user's own registry is what the rest of the suite expects.
    await freshEngine();
  }
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

test("a steer reaches the running turn and the queue reports it", async () => {
  if (skip) return;
  await freshEngine();
  const id = await createSession("/tmp/zu-test");
  const queues: any[] = [];
  const failures: any[] = [];
  const stopListening = onEngineEvent((event) => {
    if (event.type === "queue.update" && event.sessionId === id) queues.push(event);
    if (event.sessionId === id && (event.type === "error" || event.type === "retry.end" || event.type === "compaction.end")) {
      failures.push(event);
    }
  });
  try {
    // A fresh sidecar picks the default model by auth-resolution order (Q24's
    // last-used), and the race can land on a provider whose credentials are
    // broken on this machine — every turn then ends in an instant error
    // (run 4 of 2026-11-12: two attempts, `stop: error`, no output). The
    // test's subject is steering: pin a model the catalog offers, as a user
    // would from the composer's menu (C5).
    const catalog = await request("session.models", { sessionId: id }, 60000);
    const providers = catalog.providers as Array<{ id: string; models: Array<{ id: string }> }>;
    const pick = providers.find((provider) => provider.models.some((model) => model.id === "qwen3.8-flash"));
    if (pick) {
      await request("session.setModel", { sessionId: id, provider: pick.id, id: "qwen3.8-flash" }, 30000);
    }
    // A live model's first token is the one wait this suite cannot make
    // deterministic: under the full suite's parallel live turns the provider
    // has silently ended a turn with no output — three of four full runs on
    // 2026-11-12 (18 s alone every time). The test's subject is steering,
    // not provider latency, so a stalled turn is retried once (C5).
    let streaming_ = false;
    for (let attempt = 0; attempt < 2 && !streaming_; attempt++) {
      // 100 lines: long enough that the steer always lands while streaming,
      // cheap enough that a rate-limited provider key still starts it (C5).
      await send("Count from 1 to 100, one number per line.");
      const budget = attempt === 0 ? 180000 : 120000;
      let waited = 0;
      for (; waited < budget; waited += 50) {
        streaming_ = streaming() && messages().some((message) => message.role === "assistant" && message.text.length > 0);
        if (streaming_) break;
        await sleep(50);
      }
      if (!streaming_ && attempt === 0) {
        // Abandon the stalled turn (stop it if it still holds the session)
        // so the retry starts from idle.
        await request("session.stop", { sessionId: id }, 30000).catch(() => {});
        for (let calm = 0; calm < 30000 && streaming(); calm += 100) await sleep(100);
      }
    }
    if (!streaming_) {
      // A turn that ended before its first token is a model/provider failure,
      // not a steering result: say which one instead of "false !== true".
      const rows = messages().map((message) => `${message.role}:${message.text.length}`).join(" ");
      throw new Error(
        `no first token after two attempts; error=${sessionError() ?? lastError() ?? "none"} view=${viewFor(id)?.error ?? "none"} rows=[${rows}] interrupted=${interrupted()} events=${JSON.stringify(failures).slice(0, 400)}`,
      );
    }
    expect(streaming()).toBe(true);
    const reply = await request("session.steer", { sessionId: id, text: "Stop counting and reply with exactly: STEERED" });
    expect(reply.accepted).toBe(true);
    for (let waited = 0; waited < 150000 && streaming(); waited += 200) await sleep(200);
    expect(streaming()).toBe(false);
    // Steering is delivered into the running turn: the transcript grows.
    expect(messages().filter((message) => message.role === "assistant").length).toBeGreaterThan(0);
    // An idle session refuses a steer rather than guessing.
    const idle = await request("session.steer", { sessionId: id, text: "too late" }).catch((failure) => String(failure));
    expect(String(idle)).toContain("session is idle");
  } finally {
    stopListening();
    await stop();
  }
}, 600000);
