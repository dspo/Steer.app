import { expect, open, test } from "nsh/test";
test("the shell shows the session list and engine controls", async () => {
  const app = await open("./App.tsx", { network: "live", width: 1200, height: 800 });
  expect(app.texts()).toContain("会话");
  expect(app.texts()).toContain("刷新");
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
  expect(app.texts()).toContain("Sessions");
  expect(app.texts()).toContain("Refresh");
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
});
