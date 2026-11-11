import { expect, open, test } from "nsh/test";
test("the shell is a Steer titlebar over the project sidebar, with no status bar", async () => {
  const app = await open("./App.tsx", { network: "live", width: 1200, height: 800 });
  expect(app.texts()).toContain("会话");
  expect(app.texts()).toContain("新建");
  // The titlebar's own controls: sidebar toggle, centered picker, VS Code,
  // tools overflow. No second row of engine buttons lives up there.
  expect(app.count("id:sidebar-toggle")).toBe(1);
  expect(app.count("id:session-picker")).toBe(1);
  expect(app.count("id:open-vscode")).toBe(1);
  expect(app.count("id:titlebar-tools")).toBe(1);
  // The resting sidebar is Project → SessionContainer; the all-sessions list
  // only appears while filtering.
  expect(app.texts()).not.toContain("全部会话");
  expect(app.count("id:session-list")).toBe(0);
  // The sidebar toggle hides the whole left column (the titlebar stays).
  await app.press("id:sidebar-toggle");
  await app.waitUntil(() => app.count("id:new-container") === 0, { timeout: 5000 });
  expect(app.count("id:new-container")).toBe(0);
  await app.press("id:sidebar-toggle");
  await app.waitUntil(() => app.count("id:new-container") === 1, { timeout: 5000 });
  // There is no bottom status bar, and the engine's normal connected state
  // is a quiet dot: the phase words appear only while it is not connected.
  expect(app.count("id:status-bar")).toBe(0);
  expect(app.count("id:engine-state")).toBe(1);
  await app.waitFor("label:运行中", { timeout: 20000 });
  await app.press("id:titlebar-tools");
  await app.press("id:engine-stop");
  await app.waitFor("label:未启动", { timeout: 10000 });
});

test("the shell speaks English when the user prefers it", async () => {
  const app = await open("./App.tsx", { network: "live", width: 1200, height: 800 });
  // The language switch lives in the titlebar overflow now. Let the engine
  // settle first: its phase label is part of the menu's item list.
  await app.waitFor("label:运行中", { timeout: 20000 });
  await app.press("id:titlebar-tools");
  await app.press("id:language");
  // The locale is a signal: the shell redraws on the next frame.
  await app.waitUntil(() => app.texts().includes("Sessions"), { timeout: 5000 });
  expect(app.texts()).toContain("Sessions");
  expect(app.texts()).toContain("New");
  expect(app.texts()).not.toContain("All sessions");
  await app.press("id:titlebar-tools");
  await app.press("id:engine-stop");
  await app.waitFor("label:Stopped", { timeout: 10000 });
});

test("a conversation renders history, tool lines and prose", async () => {
  const app = await open("./fixtures/session.tsx");
  const texts = app.texts();
  expect(texts).toContain("fold the extension channel");
  expect(texts).toContain("read done");
  expect(texts).toContain("the projection keys rows by message id");
  // The settled composer is one accent send; the running lane is absent.
  expect(app.count("id:session-send")).toBe(1);
  expect(app.shows("id:session-stop")).toBe(false);
});
