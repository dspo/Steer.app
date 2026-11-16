import { expect, open, test } from "nsh/test";
import { containers, loadContainers } from "./core/containers";
import { createContainer } from "./modules/pi/container";
import { setAcpCommandOverride } from "./modules/pi/acp/acp";
import { stubCommand, stubPath } from "./fixtures/stub-command";
import { resetStateCache } from "./domains/state";
import { Fs, State } from "zu/native";


// A state directory of this run: the user's registry is never touched.
// Since the writer inversion the registry is the UI's fold over `zu/state`,
// so the containers are minted through the store — no process is needed.
const stateDir = `/tmp/zu-switch-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
State.setStateDir(stateDir);
resetStateCache();

// The mint rides the stub: CI never builds `dist/pi-acp` for the spawn to
// resolve, and the assertions are registry-side, not transcript-side. The
// id comes back unique per spawn: the file mints a and b, and a fixed
// session id would collapse both into one `pi:<sessionId>` registry row.
const STUB = stubPath();
setAcpCommandOverride(stubCommand({ STUB_UNIQUE_SESSION: "1" }));

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The registry's active container on disk, once the shell's press has
 * reached it (the app's fold persists its own active id). */
async function untilActive(id: string, timeoutMs = 15000): Promise<boolean> {
  for (let waited = 0; waited < timeoutMs; waited += 100) {
    const file = JSON.parse((await State.read("registry.json"))?.text ?? "{}");
    if (file.activeContainerId === id) return true;
    await sleep(100);
  }
  return false;
}

test("pressing a container row switches the active container", async () => {
  await loadContainers();
  await Fs.mkdir("/tmp", "zu-switch-a");
  await Fs.mkdir("/tmp", "zu-switch-b");
  const a = await createContainer("/tmp/zu-switch-a");
  const b = await createContainer("/tmp/zu-switch-b");
  const aId = String(a ? `pi:${a}` : "");
  const bId = String(b ? `pi:${b}` : "");
  expect(aId).toBeTruthy();
  expect(bId).toBeTruthy();

  const app = await open("./app-stub-acp.tsx", { network: "live", width: 1280, height: 800, host: { params: { acpStub: STUB } } });
  await app.waitUntil(() => app.texts().includes("zu-switch-a"), { timeout: 60000 });
  await app.waitUntil(() => app.texts().includes("zu-switch-b"), { timeout: 60000 });

  // The press reaches the store: the active id flips (and persists).
  await app.press("Open container zu-switch-a");
  expect(await untilActive(aId)).toBe(true);
  // And the canvas stays on it: a late reply must not put back the
  // container the press just left (the tab title is the session's prefix).
  const aTab = String(a).slice(0, 8);
  await app.waitUntil(() => app.texts().includes(aTab), { timeout: 10000 });

  await app.press("Open container zu-switch-b");
  expect(await untilActive(bId)).toBe(true);
}, 180000);
