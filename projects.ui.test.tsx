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
  // Project creation lives on the start page, not in the sidebar.
  expect(app.count("id:new-project")).toBe(0);
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
  // Enter sends; there is no Start button.
  expect(app.count("id:launcher-send")).toBe(0);
  expect(app.texts().some((text) => text.includes("Shift+Enter 换行"))).toBe(true);
  expect(app.count("id:launcher-hint")).toBe(1);
  await app.submit("id:launcher-input");
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

test("the start page's project menu creates a project from Finder-picked roots", async () => {
  const app = await open("./fixtures/projects.tsx", { width: 1200, height: 800 });
  await app.waitFor("text:alpha body");
  // Creation is reached from the Launcher's project chip, not the sidebar.
  await app.press("id:new-container");
  await app.waitFor("text:开始你的对话");
  await app.press("id:launcher-project");
  await app.press("id:launcher-new-project");
  await app.waitFor("text:新建项目");
  // No roots yet: the dialog cannot create, and there is no free-form field.
  expect(app.enabled("id:project-create")).toBe(false);
  expect(app.count("id:project-roots")).toBe(0);
  await app.type("id:project-name", "Two Roots");
  await app.press("id:project-add-root");
  await app.waitFor("id:project-root-0");
  // The first chosen folder is primary.
  expect(app.count("id:project-root-primary-0")).toBe(0);
  await app.press("id:project-add-root");
  await app.waitFor("id:project-root-1");
  // The second is not primary; setting it primary moves the badge, and
  // removing it leaves the first root primary.
  expect(app.count("id:project-root-primary-1")).toBe(1);
  await app.press("id:project-root-primary-1");
  await app.waitFor("id:project-root-primary-0");
  expect(app.count("id:project-root-primary-1")).toBe(0);
  await app.press("id:project-root-remove-1");
  expect(app.count("id:project-root-1")).toBe(0);
  expect(app.count("id:project-root-0")).toBe(1);
  await app.press("id:project-add-root");
  await app.waitFor("id:project-root-1");
  await app.press("id:project-create");
  await app.waitUntil(() => app.texts().includes("Two Roots"));
  expect(app.texts()).toContain("Two Roots");
});

test("the start page's tools are two left-aligned rows with plain labels", async () => {
  const app = await open("./fixtures/projects.tsx", { width: 1200, height: 800 });
  await app.waitFor("text:alpha body");
  await app.press("id:new-container");
  await app.waitFor("text:开始你的对话");
  for (const id of [
    "external-terminal",
    "launcher-browser",
    "external-claude",
    "external-codex",
    "external-copilot",
    "launcher-pi",
  ]) {
    expect(app.count(`id:${id}`)).toBe(1);
  }
  const texts = app.texts();
  // Row 1: terminal, browser. Row 2: the agents, with no heading or suffix.
  expect(texts.indexOf("终端")).toBeLessThan(texts.indexOf("浏览器"));
  expect(texts.indexOf("Claude Code")).toBeLessThan(texts.indexOf("Codex"));
  expect(texts.indexOf("Codex")).toBeLessThan(texts.indexOf("GitHub Copilot"));
  expect(texts.indexOf("GitHub Copilot")).toBeLessThan(texts.indexOf("Pi"));
  expect(texts).not.toContain("外部终端");
  expect(texts.some((text) => text.includes("TUI"))).toBe(false);
});

test("Enter sends, Cmd+Enter sends and an empty composer never starts", async () => {
  const app = await open("./fixtures/projects.tsx", { width: 1200, height: 800 });
  await app.waitFor("text:alpha body");
  await app.press("id:new-container");
  await app.waitFor("text:开始你的对话");
  // Return on an empty draft does nothing.
  await app.submit("id:launcher-input");
  await app.wait(100);
  expect(app.shows("text:开始你的对话")).toBe(true);
  // Cmd+Enter is the explicit lane; the focused composer binds it.
  await app.type("id:launcher-input", "sent with command return");
  await app.keyboard.press("mod+enter");
  await app.waitUntil(() => !app.texts().includes("开始你的对话"));
  expect(app.texts()).toContain("sent with command return");
});
