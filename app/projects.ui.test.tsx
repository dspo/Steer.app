import { expect, open, test } from "nsh/test";

/** Writes the picture when the run draws the app (`nsh test --target macos`). */
async function shot(app: { screenshot: (path?: string | null) => Promise<Uint8Array> }, name: string): Promise<void> {
  try {
    await app.screenshot(`docs/evidence/${name}.png`);
  } catch {
    // Headless: nothing is drawn, and nothing is broken.
  }
}

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

test("a project header's + opens the Hero without collapsing the group", async () => {
  const app = await open("./fixtures/projects.tsx", { width: 1200, height: 800 });
  await app.waitFor("text:alpha body");
  await app.press("id:new-container-p1");
  await app.waitFor("text:开始你的对话");
  await app.waitFor("id:tab-plus-home:scratch");
  expect(app.texts()).toContain("开始");
  // Alpha is p1's only container; a collapsed group would hide it.
  expect(app.shows("text:Alpha")).toBe(true);
});

test("the Hero starts a conversation and then shows its container", async () => {
  const app = await open("./fixtures/projects.tsx", { width: 1200, height: 800 });
  await app.waitFor("text:alpha body");
  await app.press("id:new-container");
  await app.waitFor("text:开始你的对话");
  // New is the scratch canvas, and its Hero is a tab of that canvas (the
  // tab bar's own `+` is the proof the tree is there, not a page).
  await app.waitFor("id:tab-plus-home:scratch");
  expect(app.texts()).toContain("开始");
  await app.type("id:hero-input", "hello from launcher");
  // Enter sends; there is no Start button.
  expect(app.count("id:hero-send")).toBe(0);
  // The 2026-11-13 Hero redesign removed the shortcut hint line and its
  // text with it; the harness segment and the model picker took its place.
  expect(app.count("id:hero-hint")).toBe(0);
  expect(app.texts().some((text) => text.includes("Shift+Enter 换行"))).toBe(false);
  expect(app.count("id:hero-harness-pi")).toBe(1);
  expect(app.count("id:hero-model")).toBe(1);
  await app.submit("id:hero-input");
  await app.waitUntil(() => !app.texts().includes("开始你的对话"));
  // The minted container belongs to Chats (the shell's default locale is the
  // fixture bundle's source language).
  expect(app.texts().some((text) => text === "聊天" || text === "Chats")).toBe(true);
  expect(app.texts()).toContain("hello from launcher");
});

test("New reaches the scratch canvas from a container, by button and by Cmd+N", async () => {
  const app = await open("./fixtures/projects.tsx", { width: 1200, height: 800 });
  await app.waitFor("text:alpha body");
  await app.press("id:new-container");
  await app.waitFor("id:hero-input");
  await app.waitFor("id:tab-plus-home:scratch");
  // Asking again keeps one Hero sheet on the canvas.
  await app.press("id:new-container");
  expect(app.count("id:hero-input")).toBe(1);
  // Leaving scratch and coming back keeps the same scratch canvas.
  await app.press("id:container-row-c1");
  await app.waitFor("text:alpha body");
  await app.keyboard.press("mod+n");
  await app.waitFor("id:hero-input");
  await app.waitFor("id:tab-plus-home:scratch");
  await shot(app, "ui-s2-scratch-hero");
});


test("the VS Code action opens the active project's primary root", async () => {
  const app = await open("./fixtures/projects.tsx", { width: 1200, height: 800 });
  await app.waitFor("text:alpha body");
  await app.press("id:open-vscode");
  await app.waitUntil(() => app.openedUrls().length > 0, { timeout: 5000 });
  expect(app.openedUrls()[0]).toBe("vscode://file/tmp?windowId=_blank");
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

test("the Hero's project menu creates a project from Finder-picked roots", async () => {
  const app = await open("./fixtures/projects.tsx", { width: 1200, height: 800 });
  await app.waitFor("text:alpha body");
  // Creation is reached from the Hero's project chip, not the sidebar.
  await app.press("id:new-container");
  await app.waitFor("text:开始你的对话");
  await app.press("id:hero-project");
  await app.press("id:hero-new-project");
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

test("the Hero's tools are two left-aligned rows with plain labels", async () => {
  const app = await open("./fixtures/projects.tsx", { width: 1200, height: 800 });
  await app.waitFor("text:alpha body");
  await app.press("id:new-container");
  await app.waitFor("text:开始你的对话");
  await shot(app, "ui-s23-14-brand-icons");
  for (const id of [
    "external-terminal",
    "hero-browser",
    "external-claude",
    "external-codex",
    "external-copilot",
    "hero-pi",
  ]) {
    expect(app.count(`id:${id}`)).toBe(1);
  }
  const texts = app.texts();
  // The 2026-11-13 redesign: one wrapped row of generous pills behind an
  // or-open divider, order unchanged, still no heading or suffix.
  expect(texts).toContain("或直接打开");
  expect(texts.indexOf("终端")).toBeLessThan(texts.indexOf("浏览器"));
  expect(texts.indexOf("Claude Code")).toBeLessThan(texts.indexOf("Codex"));
  expect(texts.indexOf("Codex")).toBeLessThan(texts.indexOf("GitHub Copilot"));
  // No ordering assert against "Pi" text: the harness segment carries its
  // own "Pi" label above the pills (hero-pi presence is counted earlier).
  expect(texts).not.toContain("外部终端");
  expect(texts.some((text) => text.includes("TUI"))).toBe(false);
});

test("Enter sends, Cmd+Enter sends and an empty composer never starts", async () => {
  const app = await open("./fixtures/projects.tsx", { width: 1200, height: 800 });
  await app.waitFor("text:alpha body");
  await app.press("id:new-container");
  await app.waitFor("text:开始你的对话");
  // Return on an empty draft does nothing.
  await app.submit("id:hero-input");
  await app.wait(100);
  expect(app.shows("text:开始你的对话")).toBe(true);
  // Cmd+Enter is the explicit lane; the focused composer binds it.
  await app.type("id:hero-input", "sent with command return");
  await app.keyboard.press("mod+enter");
  await app.waitUntil(() => !app.texts().includes("开始你的对话"));
  expect(app.texts()).toContain("sent with command return");
});

/** The projects fixture's probe line, split into its fields. */
function scratchState(app: { texts: () => string[] }): {
  panels: string;
  active: string;
  project: string;
  pages: string;
} {
  const line = app.texts().find((text) => text.startsWith("panels=")) ?? "";
  const field = (name: string) => new RegExp(`${name}=([^ ]*)`).exec(line)?.[1] ?? "";
  return {
    panels: field("panels"),
    active: field("active"),
    project: field("project"),
    pages: field("pages"),
  };
}

test("the scratch canvas holds a browser page and moves it into the container it mints", async () => {
  const app = await open("./fixtures/projects.tsx", { width: 1200, height: 800 });
  await app.waitFor("text:alpha body");

  // New → the scratch canvas's Hero; the project chip picks the target.
  await app.press("id:new-container");
  await app.waitFor("id:hero-input");
  await app.press("id:hero-project");
  await app.waitFor("id:hero-project-p2");
  await app.press("id:hero-project-p2");

  // The browser works before a container exists: its page is staged on the
  // scratch canvas (and the Hero's tab, being consumed, is gone).
  await app.press("id:hero-browser");
  await app.waitFor("id:browser-address");
  await app.type("id:browser-address", "example.org");
  await app.submit("id:browser-address");
  await app.waitUntil(() => scratchState(app).pages.includes("webview:scratch:1=https://example.org"), {
    timeout: 10000,
  });

  // Leave scratch and come back: an unsubmitted page is still there.
  await app.press("id:container-row-c1");
  await app.waitFor("text:alpha body");
  await app.press("id:new-container");
  await app.waitFor("id:hero-input");
  expect(scratchState(app).panels).toContain("webview:scratch:1");
  expect(scratchState(app).active).toBe("scratch");

  // Submit: the Hero mints a container in the chosen project, and the page
  // moves with it — re-keyed to the container, address intact.
  await app.press("id:hero-project");
  await app.waitFor("id:hero-project-p2");
  await app.press("id:hero-project-p2");
  await app.type("id:hero-input", "mint from scratch");
  await app.submit("id:hero-input");
  await app.waitUntil(() => scratchState(app).active.startsWith("pi:"), { timeout: 10000 });
  const state = scratchState(app);
  const minted = state.active;
  expect(state.panels).toContain(`webview:${minted}:1`);
  expect(state.panels).not.toContain("webview:scratch:");
  expect(state.pages).toContain(`webview:${minted}:1=https://example.org`);
  // The container belongs to Project Two: the picked chip is the mint's target.
  expect(state.project).toBe("p2");
}, 60000);

// DESIGN §4.1's action availability matrix, one case per canvas context. The
// Hero's tools and the titlebar's ⋯ menu are the two action surfaces; a
// disabled row stays in place (it is not hidden), so its label is readable.

type Pressable = { press: (selector: string) => Promise<void>; waitFor: (selector: string, options?: { timeout?: number }) => Promise<void> };

async function titlebarTools(app: Pressable): Promise<void> {
  await app.press("id:titlebar-tools");
  await app.waitFor("id:open-files");
}

test("a container's Hero and titlebar offer every action", async () => {
  const app = await open("./fixtures/projects.tsx", { width: 1200, height: 800 });
  await app.waitFor("text:alpha body");
  // The container's Hero (the tab bar's `+`): every tool is live, and so are
  // the workspace sheets in the titlebar.
  await app.press("id:tab-plus-session:s1");
  await app.waitFor("id:hero-input");
  for (const id of ["external-terminal", "hero-browser", "external-claude", "hero-pi"]) {
    expect(app.enabled(`id:${id}`)).toBe(true);
  }
  await titlebarTools(app);
  for (const id of ["open-files", "open-changes", "open-history", "open-problems", "open-browser"]) {
    expect(app.enabled(`id:${id}`)).toBe(true);
  }
});

test("a scratch canvas with a project offers the actions but not the workspace sheets", async () => {
  const app = await open("./fixtures/projects.tsx", { width: 1200, height: 800 });
  await app.waitFor("text:alpha body");
  await app.press("id:new-container");
  await app.waitFor("id:hero-input");
  await app.press("id:hero-project");
  await app.waitFor("id:hero-project-p1");
  await app.press("id:hero-project-p1");
  for (const id of ["external-terminal", "hero-browser", "hero-pi"]) {
    expect(app.enabled(`id:${id}`)).toBe(true);
  }
  await titlebarTools(app);
  for (const id of ["open-files", "open-changes", "open-history", "open-problems"]) {
    expect(app.enabled(`id:${id}`)).toBe(false);
  }
  expect(app.enabled("id:open-browser")).toBe(true);
});

test("a scratch canvas without a project keeps the browser and the chip", async () => {
  const app = await open("./fixtures/projects.tsx", { width: 1200, height: 800 });
  await app.waitFor("text:alpha body");
  // New starts on Chats: no workspace target, so the minting tools wait for
  // a project; the browser and the chip still work.
  await app.press("id:new-container");
  await app.waitFor("id:hero-input");
  expect(app.enabled("id:hero-browser")).toBe(true);
  expect(app.enabled("id:hero-project")).toBe(true);
  for (const id of ["external-terminal", "external-claude", "hero-pi"]) {
    expect(app.enabled(`id:${id}`)).toBe(false);
  }
  await titlebarTools(app);
  expect(app.enabled("id:open-files")).toBe(false);
  expect(app.enabled("id:open-browser")).toBe(true);
});
