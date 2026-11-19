import { expect, test, beforeAll } from "nsh/test";
import { Fs } from "zu/native";
import { Manox } from "manox/native";
import { effectiveState, setManoxHermetic, startConnection } from "../modules/manox/ahp";
import {
  createManoxThread,
  manoxModels,
  sessionResource,
  setManoxEffort,
  setManoxModel,
} from "../modules/manox/stores";
import type { SessionState } from "../../contracts/ahp/channels-session/state";

// The manox host model catalogue (issue #55), on a hermetic host seeded with
// one deterministic pi provider before boot: the boot registers it and keeps
// the same snapshot for the menu, so the model a session selects is the ref
// the catalogue lists. The model-less suite (manox.test.ts) boots a host with
// no provider on purpose; this file owns the positive path.
//
//   ZU_MANOX_GATE=1 nsh test app/tests/manox-models.test.ts

const gated = process.env?.["ZU_MANOX_GATE"] === "1";
if (gated) setManoxHermetic();
const t = gated ? test : test.skip;
const setup = gated ? beforeAll : (_: unknown) => {};

let threadId = "";

async function waitUntil(predicate: () => boolean, timeoutMs = 30000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("the real host did not reach the expected state in time");
}

setup(async () => {
  // Seed the pi catalogue before the host boots: `register_pi_providers`
  // reads `PI_CODING_AGENT_DIR` (the test points it at this fixture through
  // the native seam, not the process env). The URL is invalid on purpose:
  // registration only, no network.
  const leaf = `zu-manox-models-agent-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const agentDir = `/tmp/${leaf}`;
  try {
    await Fs.mkdir("/tmp", leaf);
  } catch {
    // A previous run in this process left it in place.
  }
  await Fs.write(
    agentDir,
    "models.json",
    JSON.stringify({
      providers: {
        gatecatalog: {
          name: "Gate Catalog",
          api: "anthropic-messages",
          baseUrl: "https://gate.invalid",
          models: [{ id: "gate-model", name: "Gate Model", contextWindow: 1000, maxTokens: 100 }],
        },
      },
    }),
    null,
    null,
  );
  await Fs.write(
    agentDir,
    "auth.json",
    JSON.stringify({ gatecatalog: { type: "api_key", key: "gate-key" } }),
    null,
    null,
  );
  Manox.setCatalogDir(agentDir);
  startConnection();
  const created = await createManoxThread();
  threadId = created.threadId;
});

t("the menu's catalogue is the boot registration snapshot", async () => {
  const catalog = await manoxModels();
  const provider = catalog.providers.find((row) => row.id === "gatecatalog");
  expect(provider?.name).toBe("Gate Catalog");
  expect(provider?.models[0].reference).toBe("gatecatalog-anthropic/gate-model");
  expect(provider?.models[0].contextWindow).toBe(1000);
  expect(provider?.models[0].efforts).toEqual(["high", "max"]);
});

t("a model and effort selection folds into the session config", async () => {
  const ref = "gatecatalog-anthropic/gate-model";
  setManoxModel(threadId, ref);
  setManoxEffort(threadId, "max");
  await waitUntil(() => {
    const values = effectiveState<SessionState>(sessionResource(threadId))?.config?.values;
    return values?.["model"] === ref && values?.["reasoningEffort"] === "max";
  });
});
