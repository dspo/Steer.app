import { expect, open, test } from "nsh/test";
import { Engine } from "zu/native";
import { connect, request } from "./stores/engine";
import { createContainer, containers, loadContainers } from "./stores/containers";
import { refreshSessionInfo } from "./stores/sessions";
import { resetStateCache } from "./stores/zu-state";
import { copy, shellCopyLocale } from "./ui/copy";
import { K, t } from "./ui/i18n";


Engine.setStateDir(`/tmp/zu-hero-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
Engine.setNoExtensions(true);
resetStateCache();

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

test("switching to a container with a conversation shows its transcript, not the hero", async () => {
  // The registry is the UI's fold; the captain sessions are the engine's
  // (the default transport mints them), and the prompt goes to the captain.
  await connect();
  await loadContainers();
  const aSession = String((await createContainer("/tmp/zu-hero-a")) ?? "");
  // The user's own message is on disk as soon as the prompt is accepted, so
  // the session is non-empty without waiting for (or paying for) a reply.
  await request("session.prompt", { sessionId: aSession, text: "hello A" }, 30000);
  const bSession = String((await createContainer("/tmp/zu-hero-b")) ?? "");
  const aRow = containers().find((row) => row.sessions.some((s) => s.sessionId === aSession));
  const aId = String(aRow?.id ?? "");
  // The prompt cast the session file; the composer read (and through it the
  // registry row) learns the path.
  await refreshSessionInfo(aSession);
  await sleep(150);
  const row = containers().find((el) => el.id === aId)?.sessions[0];
  expect(row?.path).toBeTruthy();
  const opened = await request("session.open", { path: row?.path }, 120000);
  expect(String(opened.id)).toBe(aSession);

  const app = await open("./App.tsx", { network: "live", width: 1280, height: 800 });
  // Wait on the rows themselves: a container's label follows its session
  // (the folder until the view is loaded), so the folder text is not stable.
  await app.waitFor(`id:container-row-${aId}`, { timeout: 60000 });
  await app.waitFor(`id:container-row-${bContainerId()}`, { timeout: 60000 });

  await app.press(`id:container-row-${aId}`);
  await app.waitFor("id:session-transcript", { timeout: 30000 });
  expect(app.texts()).toContain("hello A");
  expect(app.texts()).not.toContain(t(K.hero.title, { locale: shellCopyLocale() }));

  await app.press(`id:container-row-${bContainerId()}`);
  await app.waitFor("id:session-hero", { timeout: 30000 });
  // B is empty: its start page is correct there.
  expect(app.texts()).toContain(t(K.hero.title, { locale: shellCopyLocale() }));

  await app.press(`id:container-row-${aId}`);
  await app.waitFor("id:session-transcript", { timeout: 30000 });
  expect(app.texts()).not.toContain(t(K.hero.title, { locale: shellCopyLocale() }));
  expect(aSession.length).toBeGreaterThan(0);
  expect(bSession.length).toBeGreaterThan(0);
}, 240000);

function bContainerId(): string {
  return containers().find((row) => row.cwd === "/tmp/zu-hero-b")?.id ?? "";
}
