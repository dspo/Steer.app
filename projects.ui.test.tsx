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
  // Two "聊天" labels exist (the group header and the menu item); choose the item.
  await app.press("聊天 >> nth=1");
  await app.waitUntil(() => {
    const texts = app.texts();
    return texts.indexOf("Beta") > texts.indexOf("聊天");
  });
  expect(app.texts()).toContain("Beta");
});

test("the Launcher starts a conversation and then shows its container", async () => {
  const app = await open("./fixtures/projects.tsx", { width: 1200, height: 800 });
  await app.waitFor("text:alpha body");
  await app.press("id:new-container");
  await app.waitFor("text:开始一个对话");
  await app.type("id:launcher-input", "hello from launcher");
  await app.press("id:launcher-send");
  await app.waitUntil(() => !app.texts().includes("开始一个对话"));
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
