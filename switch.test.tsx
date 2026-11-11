import { expect, open, test } from "nsh/test";
import { Engine } from "zu/native";
import { connect, request } from "./engine";

// A state directory of this run: the user's registry is never touched.
Engine.setStateDir(`/tmp/zu-switch-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
Engine.setNoExtensions(true);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

test("pressing a container row switches the active container", async () => {
  await connect();
  const a = await request("container.create", { cwd: "/tmp/zu-switch-a" }, 120000);
  const b = await request("container.create", { cwd: "/tmp/zu-switch-b" }, 120000);

  const app = await open("./App.tsx", { network: "live", width: 1280, height: 800 });
  await app.waitUntil(() => app.texts().includes("zu-switch-a"), { timeout: 60000 });
  await app.waitUntil(() => app.texts().includes("zu-switch-b"), { timeout: 60000 });

  await app.press("Open container zu-switch-a");
  await sleep(800);
  const afterA = await request("container.list", {});
  expect(afterA.activeContainerId).toBe(a.container.id);

  await app.press("Open container zu-switch-b");
  await sleep(800);
  const afterB = await request("container.list", {});
  expect(afterB.activeContainerId).toBe(b.container.id);
}, 180000);
