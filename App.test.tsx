import { expect, open, test } from "nsh/test";
import { Engine } from "zu/native";

test("the shell shows the session list and engine controls", async () => {
  const app = await open("./App.tsx");
  expect(app.texts()).toContain("Sessions");
  expect(app.texts()).toContain("刷新");
  // The engine starts in the background; either phase is valid here.
  const texts = app.texts();
  const showsPhase = texts.some((text) => ["未启动", "启动中", "运行中", "错误"].includes(text));
  expect(showsPhase).toBe(true);
  await Engine.stop();
});
