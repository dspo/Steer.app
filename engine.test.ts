import { expect, test } from "nsh/test";
import { connect, disconnect, phase, request } from "./engine";
import { activeId, activePath, createSession, messages, openSession, refreshSessions, send, sessions, stop, streaming } from "./sessions";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Live tests: they run the sidecar and one real model call. Set
// ZU_SKIP_LIVE=1 to skip them where no credentials exist.
const skip = process.env.ZU_SKIP_LIVE === "1";

/** A sidecar process of this build: leftovers from a failed case would
 * answer with their own (old) command set. */
async function freshEngine(): Promise<void> {
  await disconnect();
  await connect();
  expect(phase()).toBe("connected");
}

test("engine connects and lists pi sessions", async () => {
  if (skip) return;
  await freshEngine();
  await refreshSessions();
  // The developer's ~/.pi holds sessions; a fresh machine may have none.
  expect(Array.isArray(sessions())).toBe(true);
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
  await createSession("/Users/chenzhongrun/projects/dspo/nsh-pi");
  await send("Read the file README.md with the read tool, then reply with its first line only.");
  for (let waited = 0; waited < 180000 && streaming(); waited += 200) await sleep(200);
  const tool = messages().find((message) => message.role === "tool");
  expect(tool).toBeDefined();
  expect(typeof tool?.tool?.name).toBe("string");
  expect(["done", "failed"]).toContain(tool?.tool?.state ?? "");
});

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
  const info = await request("session.info", { sessionId: id });
  const path = String(info.path ?? "");
  expect(path.length).toBeGreaterThan(0);

  // The turn's end is a custom entry the pi loader reads and the model never
  // sees (Q10); a CLI opening the file finds it.
  expect(info.customTypes).toContain("zu.turn");
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
