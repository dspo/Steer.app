import { expect, test } from "nsh/test";
import { connect, phase } from "./engine";
import { request } from "./engine";
import { activeId, activePath, createSession, messages, openSession, refreshSessions, send, sessions, stop, streaming } from "./sessions";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Live tests: they run the sidecar and one real model call. Set
// ZU_SKIP_LIVE=1 to skip them where no credentials exist.
const skip = process.env.ZU_SKIP_LIVE === "1";

test("engine connects and lists pi sessions", async () => {
  if (skip) return;
  await connect();
  expect(phase()).toBe("connected");
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
});

test("a closed session reopens with its history", async () => {
  if (skip) return;
  await connect();
  expect(phase()).toBe("connected");
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
