import { afterAll, beforeEach, expect, open, test } from "nsh/test";
import { Fs, State } from "zu/native";
import { activeContainerId, containers, loadContainers } from "../core/containers";
import { openPath, sessionIdsOfContainer } from "../modules/pi/container";
import { setAcpCommandOverride } from "../modules/pi/acp/acp";
import { entries, refreshSessions } from "../modules/pi/sessions";
import { entryText } from "../modules/pi/transcript";
import { stubCommand, stubPath } from "../fixtures/stub-command";
import { resetStateCache, setWorkspaceDir } from "../domains/state";

// §2.1-2's acceptance, in the post-cutover world: the app opens on the
// registry's active container and draws its conversation without a click —
// with **no engine at all**. The registry is the UI's fold (zu/state), the
// transcript is the session file (read by an ACP harness process that loads
// and exits), and the scratch Hero's project action lands on the matching
// sheet.

const agentDir = `/tmp/zu-s21-agent-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
let stateDir = `/tmp/zu-s21-2-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

// The openPath load runs on the stub: the real `dist/pi-acp` is a developer
// build CI never makes, and `STUB_FILE_REPLAY` streams the fixture file's
// own rows — what the real distro does — so the "startup marker alpha"
// assertions read the file, not canned text.
const STUB = stubPath();
setAcpCommandOverride(stubCommand({ STUB_FILE_REPLAY: "1" }));

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const SESSION_ID = "dddd3333-0000-0000-0000-000000000003";
const SESSION_PATH = `${agentDir}/sessions/--tmp-startup--/2026-07-20T03-38-58-867Z_${SESSION_ID}.jsonl`;

/** One pi session file, shaped like pi's own, with the user's marker. */
async function writeStartupSession(): Promise<void> {
  const root = agentDir;
  try {
    await Fs.mkdir("/tmp", root.slice("/tmp/".length));
  } catch (error) {
    console.error("STARTUP mkdir root failed:", String(error));
  }
  await Fs.mkdir(root, "sessions");
  await Fs.mkdir(root, "sessions/--tmp-startup--");
  const header = `{"type":"session","version":3,"id":"${SESSION_ID}","timestamp":"2026-07-20T03:38:58.868Z","cwd":"/tmp"}\n`;
  const row = `{"type":"message","id":"m1","parentId":null,"timestamp":"2026-07-20T03:43:26.310Z","message":{"role":"user","content":[{"type":"text","text":"startup marker alpha"}]}}\n`;
  await Fs.write(agentDir, `sessions/--tmp-startup--/2026-07-20T03-38-58-867Z_${SESSION_ID}.jsonl`, `${header}${row}`, null, null);
}

// Each case gets its own registry: `open` runs the app in a VM that shares
// the native module's process-wide state.
beforeEach(async () => {
  // A fresh registry per case: the second case starts on the scratch canvas.
  stateDir = `/tmp/zu-s21-2-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  State.setStateDir(stateDir);
  setWorkspaceDir(`/tmp/zu-s21-ws-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  State.setAgentDir(agentDir);
  resetStateCache();
  await loadContainers();
});

afterAll(async () => {
  State.setStateDir("");
  State.setAgentDir("");
  resetStateCache();
});

test("startup shows the registry's active container and hydrates its conversation with no engine", async () => {
  await writeStartupSession();
  // The session list fold learns the file; openPath attaches it to a fresh
  // container and makes it active — the whole registry write is UI-side.
  await refreshSessions();
  await openPath(SESSION_PATH);
  const row = containers().find((container) => sessionIdsOfContainer(container.id).length > 0);
  expect(row).toBeTruthy();
  await sleep(150); // the write-through settle

  const app = await open("./app-stub-acp.tsx", { network: "live", width: 1280, height: 800, host: { params: { acpStub: STUB } } });
  // No clicks: the startup switch draws the container's sheet and hydrates
  // its visible session — through an ACP load of the file, with no engine
  // process anywhere.
  // The app opens on the container's sheet: its tab carries the session's
  // own text (the fold's preview), and no engine exists anywhere. The
  // transcript's own drawing is covered at the store level (cutover.test's
  // reopen leg), which is where its truth lives.
  await app.waitUntil(() => app.texts().includes("startup marker alpha"), { timeout: 60000 });
  // The canvas is this container's sheet, not a page and not the Hero.
  expect(app.shows("id:launch-zu")).toBe(false);
  expect(activeContainerId() !== null || containers().length === 1).toBe(true);
  expect(entries().some((entry) => entry.kind === "user" && entryText(entry) === "startup marker alpha")).toBe(true);
}, 240000);

// The start page's terminal agents spawn real CLIs (`pi`, `claude`,
// `codex`, `copilot`) in a real terminal — the machine's own tooling, nothing
// the repo ships. A bare CI image has none of them, which ZU_SKIP_LIVE (the CI
// 口径) skips; the sheets themselves are exercised everywhere by projects.ui's
// start-page cases.
const t = process.env?.["ZU_SKIP_LIVE"] === "1" ? test.skip : test;

t("a terminal agent's tile opens its sheet in a container of its own", async () => {
  const app = await open("./app-stub-acp.tsx", { network: "live", width: 1280, height: 800, host: { params: { acpStub: STUB } } });
  await app.waitFor("id:launch-pi", { timeout: 20000 });

  // Pi: the native `pi` CLI, in a container minted for the process (Chats,
  // its own scratch workspace).
  await app.press("id:launch-pi");
  await app.waitUntil(() => app.shows("id:terminal-view"), { timeout: 60000 });
  expect(app.texts()).toContain("Pi");
  expect(app.shows("id:launch-pi")).toBe(false);

  // Each TUI tile leaves the scratch canvas for its terminal sheet. New
  // starts on Chats again, and the tool needs no project.
  for (const [tool, label] of [
    ["launch-claude", "Claude Code"],
    ["launch-codex", "Codex"],
    ["launch-copilot", "GitHub Copilot"],
  ] as const) {
    await app.press("id:new-container");
    await app.waitFor("id:launch-claude", { timeout: 20000 });
    await app.press(`id:${tool}`);
    await app.waitUntil(() => app.shows("id:terminal-view"), { timeout: 30000 });
    expect(app.shows("id:launch-claude")).toBe(false);
    // The container's kind is its label: in the tab and the sidebar row.
    expect(app.texts().some((text) => text.includes(label))).toBe(true);
  }
}, 240000);