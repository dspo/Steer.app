import { expect, open, test } from "nsh/test";
import { copy } from "../ui/copy";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Writes the picture when the run draws the app (`nsh test --target macos`). */
async function shot(app: { screenshot: (path?: string | null) => Promise<Uint8Array> }, name: string): Promise<void> {
  try {
    await app.screenshot(`docs/evidence/${name}.png`);
  } catch {
    // Headless: nothing is drawn, and nothing is broken.
  }
}

// The conversation surface: Steer's empty-session hero, the gallery's
// Markdown reply, and the composer's idle/streaming lanes. The fixtures seed
// a session store, so no model runs and no engine is needed.

test("an empty session is Steer's hero with one inline composer", async () => {
  const app = await open("../fixtures/chat-hero.tsx", { width: 1200, height: 800 });
  await app.waitFor("id:session-hero");
  expect(app.texts()).toContain("开始你的对话");
  expect(app.count("id:session-input")).toBe(1);
  expect(app.count("id:session-send")).toBe(1);
  // No project, access or voice rows around the start page.
  for (const word of ["项目", "访问", "语音", "外部终端"]) {
    expect(app.texts()).not.toContain(word);
  }
  // Enter sends from the hero: the user's row lands optimistically.
  await app.type("id:session-input", "hello hero");
  await app.submit("id:session-input");
  await app.waitUntil(() => app.texts().includes("hello hero"), { timeout: 5000 });
  expect(app.shows("id:session-hero")).toBe(false);
  expect(app.count("id:user-message")).toBe(1);
});

test("a session restoring its history draws the loading page, not the hero", async () => {
  const app = await open("../fixtures/chat-loading.tsx", { width: 1200, height: 800 });
  await app.waitFor("id:session-loading");
  // The loading page owns the column: no Hero and no composer while the
  // replay is in flight.
  expect(app.shows("id:session-hero")).toBe(false);
  expect(app.count("id:session-input")).toBe(0);
  expect(app.texts().some((text) => text.includes("正在加载对话") || text.includes("Loading conversation"))).toBe(true);
  await shot(app, "ui-transcript-loading");
});

test("a recycled row follows its entry's kind and body", async () => {
  const app = await open("../fixtures/entry-recycle.tsx", { width: 900, height: 600 });
  await app.waitFor("id:tool-call");
  // Tool cards carry no title bar any more: the read preview is its path.
  expect(app.texts().some((text) => text.includes("alpha.ts"))).toBe(true);
  // Tool → another tool: the same cell must re-read the new kind and body.
  await app.press("id:swap");
  await app.waitUntil(() => app.texts().some((text) => text.includes("beta.ts")), { timeout: 5000 });
  // The preview is the input's first line; the diff summary waits for the
  // expand, and must belong to this edit (not the previous read).
  expect(app.shows("id:tool-diff-summary")).toBe(false);
  await app.press("id:tool-toggle-edit");
  await app.waitFor("id:tool-diff-summary");
  expect(app.texts()).toContain("+1");
  // Tool → user: the tool card must be gone, not left behind.
  await app.press("id:swap");
  await app.waitFor("id:user-message");
  expect(app.texts()).toContain("user gamma");
  expect(app.shows("id:tool-call")).toBe(false);
  // User → assistant: Markdown, no stale user banner.
  await app.press("id:swap");
  await app.waitFor("id:assistant-markdown");
  expect(app.texts()).toContain("assistant delta");
  expect(app.shows("id:user-message")).toBe(false);
  // Reply → thinking: the folded preview belongs to this entry, and the
  // reveal waits for the expand.
  await app.press("id:swap");
  await app.waitFor("id:thinking");
  expect(app.texts().some((text) => text.includes("first line alpha"))).toBe(true);
  expect(app.shows("id:thinking-body")).toBe(false);
  await app.press("id:thinking-toggle-e");
  await app.waitFor("id:thinking-body");
  expect(app.texts().some((text) => text.includes("second line beta"))).toBe(true);
  // Thinking → another thinking: the new preview replaces the old line, and
  // the new entry starts folded even though the previous one was left open.
  await app.press("id:swap");
  await app.waitUntil(() => app.texts().some((text) => text.includes("single line gamma")), { timeout: 5000 });
  expect(app.texts().some((text) => text.includes("first line alpha"))).toBe(false);
  expect(app.shows("id:thinking-body")).toBe(false);
});

test("an assistant reply is selectable Markdown with a streaming caret", async () => {
  const app = await open("../fixtures/chat-stream.tsx", { width: 1200, height: 800 });
  await app.waitFor("id:assistant-markdown");
  const texts = app.texts();
  expect(texts).toContain("Composer");
  expect(texts.some((text) => text.includes("footer carries"))).toBe(true);
  expect(app.count("id:assistant-markdown")).toBe(1);
  expect(app.count("id:streaming-caret")).toBe(1);
});

test("the streaming composer names the model and context, and queues on Enter", async () => {
  const app = await open("../fixtures/chat-stream.tsx", { width: 1200, height: 800 });
  await app.waitFor("id:session-stop");
  await shot(app, "ui-s22-11-streaming");
  const texts = app.texts();
  expect(texts).toContain("bailian");
  expect(texts).toContain("qwen3.8-flash");
  expect(texts).toContain("high");
  expect(texts).toContain("12.3k / 1M · 1%");
  // Running: stop is always live, the send is gone, and the other lanes
  // fold into the ⋯ menu (visual-only, §2.2-11).
  expect(app.enabled("id:session-stop")).toBe(true);
  expect(app.shows("id:session-send")).toBe(false);
  expect(app.shows("id:session-more")).toBe(true);
  await app.press("id:session-more");
  await app.waitFor("id:session-queue");
  await shot(app, "ui-s22-11-menu");
  await app.waitFor("id:session-steer");
  await app.waitFor("id:session-interrupt");
  const before = app.count("id:user-message");
  await app.press("id:session-interrupt");
  await app.waitUntil(() => !app.shows("id:session-interrupt"), { timeout: 5000 });
  // Clicked without acting: the transcript is untouched.
  expect(app.count("id:user-message")).toBe(before);
  await app.press("id:session-more");
  // Enter while streaming is still the queue lane.
  await app.type("id:session-input", "queue this");
  await app.submit("id:session-input");
  await app.waitUntil(() => app.texts().includes("queue this"), { timeout: 5000 });
  expect(app.count("id:user-message")).toBe(2);
});

test("the idle composer is one accent send with no stop and no lanes", async () => {
  const idle = await open("../fixtures/chat-idle.tsx", { width: 1200, height: 800 });
  await idle.waitFor("id:session-send");
  await shot(idle, "ui-s22-11-idle");
  await shot(idle, "ui-s23-16-geist");
  expect(idle.enabled("id:session-send")).toBe(false);
  expect(idle.shows("id:session-stop")).toBe(false);
  expect(idle.shows("id:session-more")).toBe(false);
  await idle.type("id:session-input", "send this");
  await idle.submit("id:session-input");
  await idle.waitUntil(() => idle.texts().includes("send this"), { timeout: 5000 });
});

test("an interrupted or failed turn is a quiet line, not a banner", async () => {
  const app = await open("../fixtures/chat-idle.tsx", { width: 1200, height: 800 });
  await app.type("id:session-input", "this request will fail without an engine");
  await app.submit("id:session-input");
  await app.waitFor("id:session-error");
  expect(app.shows("id:session-error")).toBe(true);
  // The error is inline in the transcript, with no warning/offline strip.
  expect(app.texts().some((text) => text.includes("引擎错误"))).toBe(true);
  expect(app.texts().some((text) => text.includes("引擎已断开"))).toBe(false);
});

test("a long transcript renders only the rows near the viewport", async () => {
  const app = await open("../fixtures/chat-long.tsx", { width: 1200, height: 800 });
  await app.waitFor("text:row 1999");
  // 2000 messages, but a virtualized list holds a viewport's worth.
  const rows = app.texts().filter((text) => /^row \d+$/.test(text));
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.length).toBeLessThan(200);
});

// The transcript language (issue #20 §8): the banner as the list's header,
// the user's words as an integral banner, the folded thinking, the tool
// cards per kind. The transcript fixture seeds all of it; no engine.

test("the transcript opens on the session banner; the hero draws none", async () => {
  const app = await open("../fixtures/transcript.tsx", { width: 1200, height: 800 });
  await app.waitFor("id:session-banner");
  const texts = app.texts();
  // First line: pi version · live model · thinking, then the counts. The
  // live view wins over the banner's old qwen snapshot.
  expect(texts.some((text) => text.includes("glm-5.3-flash"))).toBe(true);
  expect(texts.some((text) => text.includes("qwen3.8-flash"))).toBe(false);
  expect(texts.some((text) => text.includes("thinking high"))).toBe(true);
  expect(texts.some((text) => text.includes("2 个技能") || text.includes("2 skills"))).toBe(true);
  expect(texts.some((text) => text.includes("1 个扩展") || text.includes("1 extension"))).toBe(true);
  // Warnings are visible even folded.
  expect(app.shows("id:session-banner-warnings")).toBe(true);
  // Expanding names the resources and the warning.
  await app.press("id:session-banner-toggle");
  await app.waitFor("id:session-banner-skills");
  expect(app.texts().some((text) => text.includes("cnb-api"))).toBe(true);
  expect(app.texts().some((text) => text.includes("invalid characters"))).toBe(true);
  await shot(app, "ui-transcript-light");
  // The hero keeps its empty-session shape: no banner facts exist there.
  // The dark scheme, on the same fixture.
  await app.setColorScheme("dark");
  await sleep(150);
  await shot(app, "ui-transcript-dark");
  const hero = await open("../fixtures/chat-hero.tsx", { width: 1200, height: 800 });
  await hero.waitFor("id:session-hero");
  expect(hero.shows("id:session-banner")).toBe(false);
});

test("a user message is a full-width banner with a working copy", async () => {
  const app = await open("../fixtures/transcript.tsx", { width: 1200, height: 800 });
  await app.waitFor("id:user-message");
  expect(app.count("id:user-message")).toBe(1);
  expect(app.texts().some((text) => text.includes("修一下 login 的 500"))).toBe(true);
  // Both copy actions exist (the banner's own and the reply's) as icons:
  // no 复制/Copy word on the row, its words stay in the tooltip.
  await app.waitFor("id:user-copy");
  await app.waitFor("id:entry-copy");
  expect(app.texts()).not.toContain(copy("复制", "Copy"));
  // A settled transcript writes nothing: no blinking caret in the footer.
  expect(app.shows("id:streaming-caret")).toBe(false);
});

test("thinking collapses to its first line and expands when clicked", async () => {
  const app = await open("../fixtures/transcript.tsx", { width: 1200, height: 800 });
  await app.waitFor("id:thinking");
  // Settled: the first thinking line (ellipsized only by the layout), no
  // header/control; the second line waits for the expand.
  expect(app.texts().some((text) => text.includes("login 500"))).toBe(true);
  expect(app.texts().some((text) => text.includes("Set-Cookie"))).toBe(false);
  await app.press("id:thinking-toggle-fx-a1");
  await app.waitUntil(() => app.texts().some((text) => text.includes("Set-Cookie")), { timeout: 5000 });
  // Clicking the first line again folds the revealed body.
  await app.press("id:thinking-toggle-fx-a1");
  await app.waitUntil(() => !app.shows("id:thinking-body"), { timeout: 5000 });

});

test("a single-line thinking preview folds and expands, and keeps its line", async () => {
  const app = await open("../fixtures/transcript.tsx", { width: 1200, height: 800 });
  await app.waitFor("id:thinking");
  // fx-a3's thought is one paragraph on one line (pi's usual shape). The
  // text tree keeps the whole line for reading and accessibility; the fold
  // to one ellipsized row is the layout's job, pinned by the macos-target
  // evidence shots below.
  expect(
    app.texts().some((text) => text.startsWith("The app side already carries") && text.includes("ZU-CLIP-TAIL")),
  ).toBe(true);
  await shot(app, "ui-transcript-thinking-folded");
  // Expanding reveals the body region…
  await app.press("id:thinking-toggle-fx-a3");
  await app.waitFor("id:thinking-body");
  await shot(app, "ui-transcript-thinking-open");
  // …and folding back must draw the preview again (a Text whose
  // `numberOfLines` flipped in place used to keep only the blank line box).
  await app.press("id:thinking-toggle-fx-a3");
  await app.waitUntil(() => !app.shows("id:thinking-body"), { timeout: 5000 });
  expect(
    app.texts().some((text) => text.startsWith("The app side already carries") && text.includes("ZU-CLIP-TAIL")),
  ).toBe(true);
  await shot(app, "ui-transcript-thinking-refolded");
});

test("an execute card shows the command, the tail, exit and duration; expands", async () => {
  const app = await open("../fixtures/transcript.tsx", { width: 1200, height: 800 });
  await app.waitFor("id:tool-preview");
  const texts = app.texts();
  // Collapsed: the input's first line only; output waits for the expand.
  expect(texts.some((text) => text.includes("$ bun test login"))).toBe(true);
  expect(texts.some((text) => text.includes("✗ rejects an expired session"))).toBe(false);
  expect(texts.some((text) => text.includes("exit 1"))).toBe(true);
  expect(texts.some((text) => text.includes("1.8s"))).toBe(true);
  // pi truncated the output: the fact and the full-output entry are shown.
  expect(app.shows("id:tool-total-lines")).toBe(true);
  expect(app.shows("id:tool-full-output")).toBe(false);
  // The toggle row is the execute card's own; expansion brings everything.
  await app.press("id:tool-toggle");
  await app.waitFor("id:tool-full-output");
  expect(app.texts().some((text) => text.includes("✗ rejects an expired session"))).toBe(true);
  await shot(app, "ui-transcript-tools");
  // Copy the output through the clipboard: the icon lives inside the
  // clickable block, and pressing it must not fold the card.
  await app.press("id:tool-copy-output >> nth=0");
  expect(app.shows("id:tool-full-output")).toBe(true);
});

test("clicking the preview text itself toggles the block", async () => {
  const app = await open("../fixtures/transcript.tsx", { width: 1200, height: 800 });
  await app.waitFor("id:tool-preview");
  await app.press("id:tool-preview >> nth=0");
  await app.waitFor("id:tool-command");
  expect(app.shows("id:tool-full-output")).toBe(true);
});

test("collapsed tools preview their input; expanding shows input and output", async () => {
  const app = await open("../fixtures/transcript.tsx", { width: 1200, height: 800 });
  await app.waitFor("id:tool-preview");
  const texts = app.texts();
  // Read: the tool name + path/range preview only, no content until expanded.
  expect(texts.some((text) => text.includes("read app/routes/login.ts:1-80"))).toBe(true);
  expect(app.shows("id:tool-diff")).toBe(false);
  // Edit: the +/− summary waits for the expand.
  expect(texts.some((text) => text.includes("+1"))).toBe(false);
  await app.press("id:tool-toggle-edit");
  await app.waitFor("id:tool-diff");
  expect(app.texts().some((text) => text.includes("+1"))).toBe(true);
  expect(app.texts().some((text) => text.includes("−1"))).toBe(true);
  expect(app.texts().some((text) => text.includes('+  if (!session) return redirect("/login?expired=1");'))).toBe(true);
});

test("a running tool uses the Braille spinner", async () => {
  const app = await open("../fixtures/tool-running.tsx", { width: 900, height: 600 });
  await app.waitFor("id:tool-running");
  expect(app.texts().some((text) => /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/.test(text))).toBe(true);
});

test("write shows its name + path as input and its result as output", async () => {
  const app = await open("../fixtures/write-tool.tsx", { width: 1200, height: 800 });
  await app.waitFor("id:tool-preview");
  expect(app.texts().some((text) => text.includes("write /tmp/demo.rs"))).toBe(true);
  expect(app.shows("id:tool-output")).toBe(false);
  await app.press("id:tool-toggle-edit");
  await app.waitFor("id:tool-output");
  expect(app.texts().some((text) => text.includes("write /tmp/demo.rs"))).toBe(true);
  expect(app.texts().some((text) => text.includes("Successfully wrote to /tmp/demo.rs"))).toBe(true);
});
