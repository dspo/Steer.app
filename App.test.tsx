import { expect, open, test } from "nsh/test";
test("the shell is a Steer titlebar over the project sidebar, with the engine in the status bar", async () => {
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
  // The engine starts in the background; any phase label is valid here.
  const texts = app.texts();
  const showsPhase = texts.some((text) =>
    ["未启动", "启动中", "运行中", "重连中", "协议不兼容", "错误"].includes(text),
  );
  expect(showsPhase).toBe(true);
  await app.waitUntil(() => app.texts().includes("运行中"), { timeout: 20000 });
  await app.press("id:engine-stop");
  await app.waitUntil(() => app.texts().includes("未启动"), { timeout: 10000 });
});

test("the shell speaks English when the user prefers it", async () => {
  const app = await open("./App.tsx", { network: "live", width: 1200, height: 800 });
  await app.press("id:language");
  // The locale is a signal: the shell redraws on the next frame.
  await app.waitUntil(() => app.texts().includes("Sessions"), { timeout: 5000 });
  expect(app.texts()).toContain("Sessions");
  expect(app.texts()).toContain("New");
  expect(app.texts()).not.toContain("All sessions");
  await app.waitUntil(() => app.texts().includes("Running"), { timeout: 20000 });
  await app.press("id:engine-stop");
  await app.waitUntil(() => app.texts().includes("Stopped"), { timeout: 10000 });
});

test("a conversation renders history, tool lines and prose", async () => {
  const app = await open("./fixtures/session.tsx");
  const texts = app.texts();
  expect(texts).toContain("fold the extension channel");
  expect(texts).toContain("read done");
  expect(texts).toContain("the projection keys rows by message id");
  // The composer keeps its calm footer hint and its circular send.
  expect(texts).toContain("Return 发送 · Shift+Return 换行");
  expect(app.count("id:session-send")).toBe(1);
});
