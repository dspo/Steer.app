import { expect, open, test } from "nsh/test";

test("the sidebar groups containers by explicit project membership", async () => {
  const app = await open("./fixtures/projects.tsx", { width: 1200, height: 800 });
  await app.waitFor("text:alpha body");
  const texts = app.texts();
  const one = texts.indexOf("Project One");
  const two = texts.indexOf("Project Two");
  const chats = texts.indexOf("聊天");
  expect(one).toBeGreaterThanOrEqual(0);
  expect(two).toBeGreaterThan(one);
  expect(chats).toBeGreaterThan(two);
  expect(texts).toContain("Alpha");
  expect(texts).toContain("Beta");
});

test("a container moves to another project through its menu", async () => {
  const app = await open("./fixtures/projects.tsx", { width: 1200, height: 800 });
  await app.waitFor("text:alpha body");
  await app.press("id:container-menu-c2");
  await app.press("id:move-to-chats");
  await app.waitUntil(() => {
    const texts = app.texts();
    return texts.indexOf("Beta") > texts.indexOf("聊天");
  });
  expect(app.texts()).toContain("Beta");
});

test("the sidebar filter reports no matches and clears", async () => {
  const app = await open("./fixtures/projects.tsx", { width: 1200, height: 800 });
  await app.waitFor("text:Project One");
  await app.press("id:sidebar-search");
  await app.type("id:sidebar-search-input", "zzz-no-such-thing");
  await app.waitFor("text:没有匹配结果。");
  expect(app.texts()).toContain("没有匹配结果。");
  await app.press("id:sidebar-search-clear");
  await app.waitFor("text:Project One");
  expect(app.texts()).toContain("Project One");
});

test("a project header's + opens the launcher without collapsing the group", async () => {
  const app = await open("./fixtures/projects.tsx", { width: 1200, height: 800 });
  await app.waitFor("text:alpha body");
  await app.press("id:new-container-p1");
  await app.waitFor("text:开始你的对话");
  // Alpha is p1's only container; a collapsed group would hide it.
  expect(app.shows("text:Alpha")).toBe(true);
});

test("the Launcher starts a conversation and then shows its container", async () => {
  const app = await open("./fixtures/projects.tsx", { width: 1200, height: 800 });
  await app.waitFor("text:alpha body");
  await app.press("id:new-container");
  await app.waitFor("text:开始你的对话");
  await app.type("id:launcher-input", "hello from launcher");
  await app.press("id:launcher-send");
  await app.waitUntil(() => !app.texts().includes("开始你的对话"));
  expect(app.texts()).toContain("Chat");
  expect(app.texts()).toContain("hello from launcher");
});

test("dragging a container row onto a project moves its membership", async () => {
  const app = await open("./fixtures/projects.tsx", { width: 1200, height: 800 });
  await app.waitFor("text:alpha body");
  const before = app.texts();
  expect(before.indexOf("Beta")).toBeGreaterThan(before.indexOf("Project Two"));
  await app.drag("text:Beta", { x: 0, y: -70 });
  await app.waitUntil(() => {
    const texts = app.texts();
    return texts.indexOf("Beta") < texts.indexOf("Project Two");
  }, { timeout: 5000 });
  expect(app.texts().indexOf("Beta")).toBeGreaterThan(app.texts().indexOf("Project One"));
});

test("the centered picker filters containers and switches the canvas", async () => {
  const app = await open("./fixtures/containers.tsx", { width: 1200, height: 800 });
  await app.waitFor("text:alpha body");
  await app.press("id:session-picker");
  await app.waitFor("id:session-picker-input");
  await app.type("id:session-picker-input", "Beta");
  await app.waitFor("id:picker-container-c2");
  await app.press("id:picker-container-c2");
  await app.waitFor("text:beta body");
  expect(app.texts()).toContain("beta body");
  expect(app.texts()).not.toContain("alpha body");
});

test("the VS Code action opens the active project's primary root", async () => {
  const app = await open("./fixtures/projects.tsx", { width: 1200, height: 800 });
  await app.waitFor("text:alpha body");
  await app.press("id:open-vscode");
  await app.waitUntil(() => app.openedUrls().length > 0, { timeout: 5000 });
  expect(app.openedUrls()[0]).toBe("vscode://file/tmp");
});

test("the sidebar toggles between project and recent grouping", async () => {
  const app = await open("./fixtures/projects.tsx", { width: 1200, height: 800 });
  await app.waitFor("text:alpha body");
  expect(app.texts()).toContain("Project One");
  await app.press("id:sidebar-grouping");
  await app.waitFor("text:最近");
  expect(app.texts()).toContain("最近");
  await app.press("id:sidebar-grouping");
  await app.waitFor("text:Project One");
  expect(app.texts()).toContain("Project One");
});

test("the project dialog creates a two-root project", async () => {
  const app = await open("./fixtures/projects.tsx", { width: 1200, height: 800 });
  await app.waitFor("text:alpha body");
  await app.press("id:new-project");
  await app.waitFor("text:新建项目");
  await app.type("id:project-name", "Two Roots");
  await app.clear("id:project-roots");
  await app.type("id:project-roots", "/tmp\n* /Users/chenzhongrun/projects/dspo/nsh-pi");
  await app.press("id:project-create");
  await app.waitUntil(() => app.texts().includes("Two Roots"));
  expect(app.texts()).toContain("Two Roots");
});
