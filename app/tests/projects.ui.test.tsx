import { expect, open, test } from "nsh/test";
import { stubPath } from "../fixtures/stub-command";

// The three cases that mint a conversation hand the fixture the stub's path
// over `host.params` (an app VM cannot locate repo files): CI never builds
// `dist/pi-acp` for the mint's spawn to resolve.
const acpStubHost = { host: { params: { acpStub: stubPath() } } };

/** Writes the picture when the run draws the app (`nsh test --target macos`). */
async function shot(app: { screenshot: (path?: string | null) => Promise<Uint8Array> }, name: string): Promise<void> {
  try {
    await app.screenshot(`docs/evidence/${name}.png`);
  } catch {
    // Headless: nothing is drawn, and nothing is broken.
  }
}

test("the sidebar groups containers by explicit project membership", async () => {
  const app = await open("../fixtures/projects.tsx", { width: 1200, height: 800 });
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
  const app = await open("../fixtures/projects.tsx", { width: 1200, height: 800 });
  await app.waitFor("text:Project One");
  await app.press("id:sidebar-search");
  await app.type("id:sidebar-search-input", "zzz-no-such-thing");
  await app.waitFor("text:没有匹配结果。");
  expect(app.texts()).toContain("没有匹配结果。");
  await app.press("id:sidebar-search-clear");
  await app.waitFor("text:Project One");
  expect(app.texts()).toContain("Project One");
});

test("a project header's + opens the same start page without collapsing the group", async () => {
  const app = await open("../fixtures/projects.tsx", { width: 1200, height: 800 });
  await app.waitFor("text:alpha body");
  await app.press("id:new-container-p1");
  await app.waitFor("id:launch-zu");
  await app.waitFor("id:tab-plus-home:scratch");
  // The page looks the same everywhere; the project is the context behind it.
  expect(app.texts()).toContain("新建");
  expect(app.count("id:launch-terminal")).toBe(1);
  // Alpha is p1's only container; a collapsed group would hide it.
  expect(app.shows("text:Alpha")).toBe(true);
});

test("New reaches the scratch canvas from a container, by button and by Cmd+N", async () => {
  const app = await open("../fixtures/projects.tsx", { width: 1200, height: 800 });
  await app.waitFor("text:alpha body");
  await app.press("id:new-container");
  await app.waitFor("id:launch-zu");
  await app.waitFor("id:tab-plus-home:scratch");
  // Asking again keeps one start-page sheet on the canvas.
  await app.press("id:new-container");
  expect(app.count("id:launch-zu")).toBe(1);
  // Leaving scratch and coming back keeps the same scratch canvas.
  await app.press("id:container-row-c1");
  await app.waitFor("text:alpha body");
  await app.keyboard.press("mod+n");
  await app.waitFor("id:launch-zu");
  await app.waitFor("id:tab-plus-home:scratch");
  await shot(app, "ui-s2-scratch-hero");
});

test("a conversation tile asks where it goes, and the pick mints that container", async () => {
  const app = await open("../fixtures/projects.tsx", { width: 1200, height: 800, ...acpStubHost });
  await app.waitFor("text:alpha body");
  await app.press("id:new-container");
  await app.waitFor("id:launch-zu");
  // A conversation without a project context asks: Chats, a project, or a
  // new one. A tool never asks (it defaults to Chats).
  await app.press("id:launch-zu");
  await app.waitFor("id:launch-zu-chats");
  await app.waitFor("id:launch-zu-project-p1");
  await app.waitFor("id:launch-zu-project-p2");
  await app.waitFor("id:launch-zu-new-project");
  await app.press("id:launch-zu-project-p2");
  // The new conversation is its own container, in the project the pick named.
  await app.waitUntil(() => scratchState(app).active.startsWith("pi:"), { timeout: 20000 });
  expect(scratchState(app).project).toBe("p2");
  expect(scratchState(app).panels).toContain("session:");
  expect(app.shows("id:launch-zu")).toBe(false);
}, 60000);

test("Chats makes a conversation container without a project", async () => {
  const app = await open("../fixtures/projects.tsx", { width: 1200, height: 800, ...acpStubHost });
  await app.waitFor("text:alpha body");
  await app.press("id:new-container");
  await app.waitFor("id:launch-zu");
  await app.press("id:launch-zu");
  await app.waitFor("id:launch-zu-chats");
  await app.press("id:launch-zu-chats");
  await app.waitUntil(() => scratchState(app).active.startsWith("pi:"), { timeout: 20000 });
  expect(scratchState(app).project).toBe("null");
  expect(app.shows("id:launch-zu")).toBe(false);
}, 60000);

test("the conversation menu creates a project from Finder-picked roots", async () => {
  const app = await open("../fixtures/projects.tsx", { width: 1200, height: 800, ...acpStubHost });
  await app.waitFor("text:alpha body");
  await app.press("id:new-container");
  await app.waitFor("id:launch-zu");
  await app.press("id:launch-zu");
  await app.waitFor("id:launch-zu-new-project");
  await app.press("id:launch-zu-new-project");
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
}, 60000);

test("the start page's objects are three rows with plain labels", async () => {
  const app = await open("../fixtures/projects.tsx", { width: 1200, height: 800 });
  await app.waitFor("text:alpha body");
  await app.press("id:new-container");
  await app.waitFor("id:launch-zu");
  await shot(app, "ui-s23-14-brand-icons");
  for (const id of [
    "launch-zu",
    "launch-manox",
    "launch-terminal",
    "launch-browser",
    "launch-claude",
    "launch-codex",
    "launch-copilot",
    "launch-pi",
  ]) {
    expect(app.count(`id:${id}`)).toBe(1);
  }
  const texts = app.texts();
  // Conversations, tools, terminal agents — no heading, no suffix, no
  // composer and no project chip.
  expect(texts.indexOf("Zu")).toBeLessThan(texts.indexOf("Manox"));
  expect(texts.indexOf("终端")).toBeLessThan(texts.indexOf("浏览器"));
  expect(texts.indexOf("Claude Code")).toBeLessThan(texts.indexOf("Codex"));
  expect(texts.indexOf("Codex")).toBeLessThan(texts.indexOf("GitHub Copilot"));
  expect(texts).not.toContain("外部终端");
  expect(texts.some((text) => text.includes("TUI"))).toBe(false);
  expect(app.count("id:hero-input")).toBe(0);
  expect(app.count("id:hero-project")).toBe(0);
});

/** The projects fixture's probe line, split into its fields. */
function scratchState(app: { texts: () => string[] }): {
  panels: string;
  active: string;
  project: string;
  cwd: string;
  pages: string;
} {
  const line = app.texts().find((text) => text.startsWith("panels=")) ?? "";
  const field = (name: string) => new RegExp(`${name}=([^ ]*)`).exec(line)?.[1] ?? "";
  return {
    panels: field("panels"),
    active: field("active"),
    project: field("project"),
    cwd: field("cwd"),
    pages: field("pages"),
  };
}

test("a browser opened outside a container mints its own tool container", async () => {
  const app = await open("../fixtures/projects.tsx", { width: 1200, height: 800 });
  await app.waitFor("text:alpha body");
  await app.press("id:new-container");
  await app.waitFor("id:launch-browser");
  // The browser needs no project and no first message: the page is a
  // resource of a real container from the first frame (Chats, scratch cwd).
  await app.press("id:launch-browser");
  await app.waitFor("id:browser-address");
  await app.waitUntil(() => scratchState(app).active.startsWith("external:browser:"), { timeout: 10000 });
  const state = scratchState(app);
  expect(state.project).toBe("null");
  expect(state.cwd.startsWith("/tmp/zu-projects-ws/scratch/")).toBe(true);
  expect(state.pages).toContain(`webview:${state.active}:1=`);
  expect(app.shows("id:launch-browser")).toBe(false);
}, 60000);

// The context matrix: the page is identical, the attributes differ. A tool
// outside a project gets its container's scratch folder; a project context
// pins the project root; a container's own cwd wins.

type Pressable = { press: (selector: string) => Promise<void>; waitFor: (selector: string, options?: { timeout?: number }) => Promise<void> };

async function titlebarTools(app: Pressable): Promise<void> {
  await app.press("id:titlebar-tools");
  await app.waitFor("id:open-files");
}

test("a container's start page and titlebar offer every action", async () => {
  const app = await open("../fixtures/projects.tsx", { width: 1200, height: 800 });
  await app.waitFor("text:alpha body");
  await app.press("id:tab-plus-session:s1");
  await app.waitFor("id:launch-zu");
  for (const id of ["launch-zu", "launch-manox", "launch-terminal", "launch-browser", "launch-pi"]) {
    expect(app.enabled(`id:${id}`)).toBe(true);
  }
  await titlebarTools(app);
  for (const id of ["open-files", "open-changes", "open-history", "open-problems", "open-browser"]) {
    expect(app.enabled(`id:${id}`)).toBe(true);
  }
});

test("a project context pins the tool's cwd, without changing the page", async () => {
  const app = await open("../fixtures/projects.tsx", { width: 1200, height: 800 });
  await app.waitFor("text:alpha body");
  // The project row's + opens the same page with p1 as the context.
  await app.press("id:new-container-p1");
  await app.waitFor("id:launch-terminal");
  expect(app.count("id:launch-zu")).toBe(1);
  await app.press("id:launch-terminal");
  await app.waitUntil(() => scratchState(app).active.startsWith("external:shell:"), { timeout: 10000 });
  expect(scratchState(app).project).toBe("p1");
  expect(scratchState(app).cwd).toBe("/tmp");
  // Workspace sheets need a container; the tool's own container has one now.
  await app.press("id:titlebar-tools");
  await app.waitFor("id:open-files");
  expect(app.enabled("id:open-files")).toBe(true);
  // Archive it: the shell's PTY ends with the container, not with the test
  // file (the native module outlives a fixture's VM).
  await app.press(`id:archive-${scratchState(app).active}`);
  await app.waitUntil(() => !app.shows("id:terminal-view"), { timeout: 10000 });
}, 60000);

test("outside a project every tool is live and lands in Chats with a scratch cwd", async () => {
  const app = await open("../fixtures/projects.tsx", { width: 1200, height: 800 });
  await app.waitFor("text:alpha body");
  await app.press("id:new-container");
  await app.waitFor("id:launch-terminal");
  // No project chip, no disabled tool: Chats is a legitimate tool target.
  expect(app.count("id:hero-project")).toBe(0);
  for (const id of ["launch-terminal", "launch-claude", "launch-pi"]) {
    expect(app.enabled(`id:${id}`)).toBe(true);
  }
  await app.press("id:launch-terminal");
  await app.waitUntil(() => scratchState(app).active.startsWith("external:shell:"), { timeout: 10000 });
  expect(scratchState(app).project).toBe("null");
  expect(scratchState(app).cwd.startsWith("/tmp/zu-projects-ws/scratch/")).toBe(true);
  await app.press(`id:archive-${scratchState(app).active}`);
  await app.waitUntil(() => !app.shows("id:terminal-view"), { timeout: 10000 });
}, 60000);

test("the VS Code action opens the active project's primary root", async () => {
  const app = await open("../fixtures/projects.tsx", { width: 1200, height: 800 });
  await app.waitFor("text:alpha body");
  await app.press("id:open-vscode");
  await app.waitUntil(() => app.openedUrls().length > 0, { timeout: 5000 });
  expect(app.openedUrls()[0]).toBe("vscode://file/tmp?windowId=_blank");
});

test("the sidebar toggles between project and recent grouping", async () => {
  const app = await open("../fixtures/projects.tsx", { width: 1200, height: 800 });
  await app.waitFor("text:alpha body");
  expect(app.texts()).toContain("Project One");
  await app.press("id:sidebar-grouping");
  await app.waitFor("text:最近");
  expect(app.texts()).toContain("最近");
  await app.press("id:sidebar-grouping");
  await app.waitFor("text:Project One");
  expect(app.texts()).toContain("Project One");
});
