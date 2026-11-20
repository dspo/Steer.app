import { afterAll, beforeEach, expect, open, test } from "nsh/test";
import { Fs, State } from "zu/native";
import { readState, setWorkspaceDir } from "../domains/state";
import { copy } from "../ui/copy";

// The shell's external-container path: the start page's tool tile creates a
// real Terminal container (Chats, its own scratch workspace), the canvas
// shows its terminal sheet, and archiving it closes the PTY and removes the
// row. The PTY's output is exercised by terminal.ui.test.tsx; here the
// concern is the shell wiring and the registry row.

// Each case gets its own registry and a fresh sidecar: `open` runs the app in
// a VM that shares the native module's process-wide state, and another test
// file may have pointed it at the real `~/.steer` since this module loaded.
let workspaceDir = "";
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

beforeEach(async () => {
  State.setStateDir(`/tmp/zu-m7-ui-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  workspaceDir = `/tmp/zu-m7-ws-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  setWorkspaceDir(workspaceDir);
});

afterAll(async () => {
  State.setStateDir("");
  setWorkspaceDir("");
});

test("the start page opens an external terminal container without a composer", async () => {
  const app = await open("../App.tsx", { network: "live", width: 1200, height: 800 });
  // The ACP boot mounts the folds at once; no phase label exists to wait on.
  // No containers: the canvas is the scratch canvas, whose only sheet is the
  // start page (a tab of the tree, not a page beside it).
  await app.waitFor("id:launch-terminal");
  expect(app.texts()).toContain(copy("新建", "New"));
  await app.waitFor("id:tab-plus-home:scratch");
  // A tool needs no project: outside one it lands in Chats with a scratch
  // folder of its own.
  expect(app.enabled("id:launch-terminal")).toBe(true);
  await app.press("id:launch-terminal");
  // The terminal sheet takes the canvas over; there is no pi composer
  // anywhere. Its scratch workspace has no useful folder name, so the sheet
  // and the row are titled by the kind alone.
  await app.waitFor("id:terminal-view", { timeout: 15000 });
  expect(app.count("id:session-send")).toBe(0);
  // The tab is titled by the kind alone only until the shell names itself
  // (OSC 0/2): Ubuntu's stock prompt titles every shell `user@host: cwd`,
  // so the program title may replace "Terminal" at any moment. The row is
  // found by its stable testID instead — the container id comes from the
  // registry fold this test pointed State at.
  const externalId = async (): Promise<string> => {
    const registry = await readState<{ containers?: { id: string }[] }>("registry.json", true);
    return registry?.containers?.[0]?.id ?? "";
  };
  let containerId = "";
  for (let waited = 0; waited < 10000 && (containerId = await externalId()) === ""; waited += 100) await sleep(100);
  expect(containerId).not.toBe("");
  // Its workspace is a folder of the test's own workspace, not the home
  // folder and not /tmp.
  const scratchEntries = async (): Promise<string[]> => {
    try {
      return (await Fs.list(workspaceDir, "scratch")).map((entry) => entry.name);
    } catch {
      return [];
    }
  };
  expect((await scratchEntries()).length).toBe(1);

  // Archiving the external container closes its PTY, removes the row, and
  // deletes its scratch workspace with it.
  await app.press(`id:archive-${containerId}`);
  await app.waitUntil(() => !app.shows("id:terminal-view"), { timeout: 10000 });
  expect(app.shows("id:terminal-view")).toBe(false);
  for (let waited = 0; waited < 5000 && (await scratchEntries()).length > 0; waited += 100) await sleep(100);
  expect(await scratchEntries()).toEqual([]);
}, 60000);
