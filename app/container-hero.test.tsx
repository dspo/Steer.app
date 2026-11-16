import { expect, open, test } from "nsh/test";
import { Fs, State } from "zu/native";
import { containers, loadContainers } from "./core/containers";
import { createContainer, openPath, sessionIdsOfContainer } from "./modules/pi/container";
import { setAcpCommandOverride } from "./modules/pi/acp/acp";
import { error as sessionStoreError, messages, refreshSessions, viewFor } from "./modules/pi/sessions";
import { resetStateCache } from "./domains/state";
import { copy, shellCopyLocale } from "./ui/copy";
import { K, t } from "./ui/i18n";
import { stubCommand, stubPath } from "./fixtures/stub-command";

// S2's acceptance, post-cutover: a container whose session has a
// conversation shows the transcript when its row is pressed; an empty one
// shows its start page. Everything is the UI's fold plus ACP loads — the
// conversation is a fixture session file (no model, no sidecar), and the
// transcript is read by a harness process that loads and exits.

const stateDir = `/tmp/zu-hero-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const agentDir = `/tmp/zu-hero-agent-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const SESSION_ID = "ffff5555-0000-0000-0000-000000000005";
const SESSION_PATH = `${agentDir}/sessions/--tmp-zu-hero-a--/2026-07-20T03-38-58-867Z_${SESSION_ID}.jsonl`;

State.setStateDir(stateDir);
State.setAgentDir(agentDir);
resetStateCache();

// The transcript load runs on the stub: the real `dist/pi-acp` is a developer
// build CI never makes, and `STUB_FILE_REPLAY` streams the fixture file's own
// rows — what the real distro does — so the "hello A"/"answer A" assertions
// read the file, not canned text.
const STUB = stubPath();
setAcpCommandOverride(stubCommand({ STUB_FILE_REPLAY: "1" }));

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function writeFixtureSession(): Promise<void> {
  await Fs.mkdir("/tmp", "zu-hero-a");
  await Fs.mkdir("/tmp", "zu-hero-b");
  await Fs.mkdir("/tmp", agentDir.slice("/tmp/".length));
  await Fs.mkdir(agentDir, "sessions");
  await Fs.mkdir(agentDir, "sessions/--tmp-zu-hero-a--");
  const header = `{"type":"session","version":3,"id":"${SESSION_ID}","timestamp":"2026-07-20T03:38:58.868Z","cwd":"/tmp/zu-hero-a"}\n`;
  const user = `{"type":"message","id":"m1","parentId":null,"timestamp":"2026-07-20T03:43:26.310Z","message":{"role":"user","content":[{"type":"text","text":"hello A"}]}}\n`;
  const assistant = `{"type":"message","id":"m2","parentId":"m1","timestamp":"2026-07-20T03:43:30.000Z","message":{"role":"assistant","content":[{"type":"text","text":"answer A"}]}}\n`;
  await Fs.write(agentDir, `sessions/--tmp-zu-hero-a--/2026-07-20T03-38-58-867Z_${SESSION_ID}.jsonl`, `${header}${user}${assistant}`, null, null);
}

test("switching to a container with a conversation shows its transcript, not the hero", async () => {
  await writeFixtureSession();
  // The fold learns the file; openPath mints the container around it and
  // makes it active — the whole write is UI-side.
  await refreshSessions();
  await openPath(SESSION_PATH);
  const row = containers().find((container) => sessionIdsOfContainer(container.id).length > 0);
  expect(row).toBeTruthy();
  const aId = String(row?.id ?? "");
  // The transcript over ACP: the fold feeds the load's cwd, the harness
  // process loads and exits, the view holds the file's rows.
  const reopened = viewFor(SESSION_ID);
  expect(reopened?.loaded).toBe(true);
  expect(messages().some((message) => message.text === "hello A")).toBe(true);
  expect(sessionStoreError()).toBe(null);
  // B exists before the app mounts: the app folds the registry file once.
  const b = await createEmptyContainer("/tmp/zu-hero-b");
  await sleep(150);

  const app = await open("./app-stub-acp.tsx", { network: "live", width: 1280, height: 800, host: { params: { acpStub: STUB } } });
  await app.waitFor(`id:container-row-${aId}`, { timeout: 60000 });

  // The row's own pressable carries the id; the colon in `pi:<id>` is fine
  // for `shows`, but the press goes through the row's accessibility label.
  await app.press(`Open container hello A`);
  await app.waitFor("id:session-transcript", { timeout: 60000 });
  expect(app.texts()).toContain("hello A");
  expect(app.texts()).toContain("answer A");
  expect(app.shows("id:hero-input")).toBe(false);

  // An empty container's start page is its composer, not a transcript.
  await app.press(`Open container ${bContainerTitle(b)}`);
  await app.waitFor("id:session-hero", { timeout: 30000 });
  expect(app.texts()).toContain(t(K.hero.title, { locale: shellCopyLocale() }));

  await app.press(`Open container hello A`);
  await app.waitFor("id:session-transcript", { timeout: 30000 });
  expect(app.texts()).not.toContain(t(K.hero.title, { locale: shellCopyLocale() }));
}, 240000);

async function createEmptyContainer(cwd: string): Promise<string> {
  const key = String((await createContainer(cwd)) ?? "");
  return containers().find((row) => row.id === `pi:${key}`)?.id ?? "";
}

/** B's row label: an untouched captain's folder. */
function bContainerTitle(id: string): string {
  const row = containers().find((entry) => entry.id === id);
  return row ? row.cwd.split("/").filter(Boolean).pop() ?? row.cwd : id;
}

test("leaves the runner clean", () => {
  State.setStateDir("");
  State.setAgentDir("");
  resetStateCache();
});
