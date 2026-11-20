import { expect, open, test } from "nsh/test";
import { Fs, State } from "zu/native";
import { containers } from "../core/containers";
import { createContainer } from "../modules/pi/container";
import { setAcpCommandOverride } from "../modules/pi/acp/acp";
import { stubCommand, stubPath } from "../fixtures/stub-command";
import { resetStateCache } from "../domains/state";

// Issue #56, the UI face: a restored empty sheet — a session released
// before its first message, so pi never cast a file — rebuilds in place and
// the composer comes up live: the model and effort menus act on the rebuilt
// session. The app window hydrates through its own boot path; the registry
// row is all the test process leaves behind.

const stateDir = `/tmp/zu-start-ui-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
State.setStateDir(stateDir);
State.setAgentDir(`/tmp/zu-start-ui-agent-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
resetStateCache();

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

test("a restored empty sheet rebuilds, then model and effort switching work", async () => {
  setAcpCommandOverride(stubCommand());
  try {
    await Fs.mkdir("/tmp", "zu-start-ui");
    const id = String(await createContainer("/tmp/zu-start-ui"));
    expect(id).toMatch(/^[0-9a-f]{8}-/);
    // The registry row is the app's whole inheritance: a container holding
    // one session sheet, no view and no session file anywhere.
    for (let waited = 0; waited < 15000; waited += 100) {
      const file = JSON.parse((await State.read("registry.json"))?.text ?? "{}");
      if (JSON.stringify(file.containers ?? []).includes(id)) break;
      await sleep(100);
    }
    expect(containers().some((row) => row.id === `pi:${id}`)).toBe(true);

    const app = await open("./app-stub-acp.tsx", { width: 1280, height: 800, host: { params: { acpStub: stubPath() } } });
    // The boot hydrates the sheet, finds neither view nor file, and rebuilds
    // the session in place — the composer arrives live, not dead.
    await app.waitFor("id:model-picker", { timeout: 60000 });

    // The model dialog acts on the rebuilt session: pick p/other, the
    // trigger carries it, the dialog closes on success.
    await app.press("id:model-picker");
    await app.waitFor("id:model-p-other");
    await app.press("id:model-p-other");
    await app.waitUntil(() => app.texts().includes("other"), { timeout: 10000 });
    expect(app.shows("id:model-p-other")).toBe(false);

    // The effort chip likewise: off is one of the stub's two levels.
    await app.press("id:effort-picker");
    await app.waitFor("id:effort-off");
    await app.press("id:effort-off");
    await app.waitUntil(() => !app.shows("id:effort-off"), { timeout: 10000 });
    expect(app.texts()).toContain("off");
  } finally {
    setAcpCommandOverride(null);
  }
}, 180000);
