import { expect, open, test } from "nsh/test";
import { Engine } from "zu/native";
import { connect, request } from "./engine";
import { K } from "./i18n";
import { zhCN } from "./locales/zh-CN";

Engine.setStateDir(`/tmp/zu-hero-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
Engine.setNoExtensions(true);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

test("switching to a container with a conversation shows its transcript, not the hero", async () => {
  await connect();
  const a = await request("container.create", { cwd: "/tmp/zu-hero-a" }, 120000);
  const aSession = String(a.session?.sessionId ?? a.container.sessions[0].sessionId);
  await request("session.prompt", { sessionId: aSession, text: "Reply with exactly: hello A" }, 30000);
  for (let waited = 0; waited < 120000; waited += 200) {
    const snapshot = await request("state.snapshot", {}, 10000);
    const open = (snapshot.openSessions ?? []).find((row: any) => row.sessionId === aSession);
    if (open && !open.running) break;
    await sleep(200);
  }
  const b = await request("container.create", { cwd: "/tmp/zu-hero-b" }, 120000);
  const bSession = String(b.session?.sessionId ?? b.container.sessions[0].sessionId);

  // The canvas looks a session up by the id the container records; the file
  // open must answer with that same id or the view lands under another key.
  const show = await request("container.show", { containerId: a.container.id }, 10000);
  const row = show.container.sessions[0];
  expect(row.path).toBeTruthy();
  const opened = await request("session.open", { path: row.path }, 10000);
  expect(opened.id).toBe(row.sessionId);

  const app = await open("./App.tsx", { network: "live", width: 1280, height: 800 });
  await app.waitUntil(() => app.texts().includes("zu-hero-a"), { timeout: 60000 });
  await app.waitUntil(() => app.texts().includes("zu-hero-b"), { timeout: 60000 });

  await app.press(`id:container-row-${a.container.id}`);
  await app.waitUntil(() => app.texts().includes("hello A"), { timeout: 60000 });
  expect(app.texts()).not.toContain(zhCN[K.launcher.title]);

  await app.press(`id:container-row-${b.container.id}`);
  await sleep(1500);
  // B is empty: its start page is correct there.
  expect(app.texts()).toContain(zhCN[K.launcher.title]);

  await app.press(`id:container-row-${a.container.id}`);
  await app.waitUntil(() => app.texts().includes("hello A"), { timeout: 60000 });
  expect(app.texts()).not.toContain(zhCN[K.launcher.title]);
  expect(aSession.length).toBeGreaterThan(0);
  expect(bSession.length).toBeGreaterThan(0);
}, 240000);
