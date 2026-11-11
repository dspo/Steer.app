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
  // The user's own message is on disk as soon as the prompt is accepted, so
  // the session is non-empty without waiting for (or paying for) a reply.
  await request("session.prompt", { sessionId: aSession, text: "hello A" }, 30000);
  await sleep(2000);
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
  // Wait on the rows themselves: a container's label follows its session
  // (the folder until the view is loaded), so the folder text is not stable.
  await app.waitFor(`id:container-row-${a.container.id}`, { timeout: 60000 });
  await app.waitFor(`id:container-row-${b.container.id}`, { timeout: 60000 });

  await app.press(`id:container-row-${a.container.id}`);
  await app.waitFor("id:session-transcript", { timeout: 30000 });
  expect(app.texts()).toContain("hello A");
  expect(app.texts()).not.toContain(zhCN[K.launcher.title]);

  await app.press(`id:container-row-${b.container.id}`);
  await app.waitFor("id:session-hero", { timeout: 30000 });
  // B is empty: its start page is correct there.
  expect(app.texts()).toContain(zhCN[K.launcher.title]);

  await app.press(`id:container-row-${a.container.id}`);
  await app.waitFor("id:session-transcript", { timeout: 30000 });
  expect(app.texts()).not.toContain(zhCN[K.launcher.title]);
  expect(aSession.length).toBeGreaterThan(0);
  expect(bSession.length).toBeGreaterThan(0);
}, 240000);
