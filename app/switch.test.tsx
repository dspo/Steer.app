import { expect, open, test } from "nsh/test";
import { Engine } from "zu/native";
import { connect } from "./stores/engine";
import { createContainer, containers, loadContainers } from "./stores/containers";
import { resetStateCache } from "./stores/zu-state";
import { State } from "zu/native";
import { setPiTransport } from "./harness/pi-acp/acp";


// A state directory of this run: the user's registry is never touched.
// Since the writer inversion the registry is the UI's fold over `zu/state`,
// so the containers are minted through the store — with the ACP transport
// pinned, no captain process or sidecar is needed at all.
const stateDir = `/tmp/zu-switch-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
Engine.setStateDir(stateDir);
Engine.setNoExtensions(true);
setPiTransport("acp");
resetStateCache();

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
  // The shell's boot still waits for the engine (B3 removes that); the
  // registry itself is already the UI's fold.
  await connect();
  await loadContainers();
  const a = await createContainer("/tmp/zu-switch-a");
  const b = await createContainer("/tmp/zu-switch-b");
  const aId = containers().find((row) => row.sessions.some((s) => s.sessionId === a))?.id ?? "";
  const bId = containers().find((row) => row.sessions.some((s) => s.sessionId === b))?.id ?? "";
  expect(aId).toBeTruthy();
  expect(bId).toBeTruthy();

  const app = await open("./App.tsx", { network: "live", width: 1280, height: 800 });
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
