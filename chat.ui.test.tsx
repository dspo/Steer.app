import { expect, open, test } from "nsh/test";

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
  const app = await open("./fixtures/chat-hero.tsx", { width: 1200, height: 800 });
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

test("an assistant reply is selectable Markdown with a streaming caret", async () => {
  const app = await open("./fixtures/chat-stream.tsx", { width: 1200, height: 800 });
  await app.waitFor("id:assistant-markdown");
  const texts = app.texts();
  expect(texts).toContain("Composer");
  expect(texts.some((text) => text.includes("footer carries"))).toBe(true);
  expect(app.count("id:assistant-markdown")).toBe(1);
  expect(app.count("id:streaming-caret")).toBe(1);
});

test("the streaming composer names the model and context, and queues on Enter", async () => {
  const app = await open("./fixtures/chat-stream.tsx", { width: 1200, height: 800 });
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
  const idle = await open("./fixtures/chat-idle.tsx", { width: 1200, height: 800 });
  await idle.waitFor("id:session-send");
  await shot(idle, "ui-s22-11-idle");
  expect(idle.enabled("id:session-send")).toBe(false);
  expect(idle.shows("id:session-stop")).toBe(false);
  expect(idle.shows("id:session-more")).toBe(false);
  await idle.type("id:session-input", "send this");
  await idle.submit("id:session-input");
  await idle.waitUntil(() => idle.texts().includes("send this"), { timeout: 5000 });
});

test("an interrupted or failed turn is a quiet line, not a banner", async () => {
  const app = await open("./fixtures/chat-idle.tsx", { width: 1200, height: 800 });
  await app.type("id:session-input", "this request will fail without an engine");
  await app.submit("id:session-input");
  await app.waitFor("id:session-error");
  expect(app.shows("id:session-error")).toBe(true);
  // The error is inline in the transcript, with no warning/offline strip.
  expect(app.texts().some((text) => text.includes("引擎错误"))).toBe(true);
  expect(app.texts().some((text) => text.includes("引擎已断开"))).toBe(false);
});

test("a long transcript renders only the rows near the viewport", async () => {
  const app = await open("./fixtures/chat-long.tsx", { width: 1200, height: 800 });
  await app.waitFor("text:row 1999");
  // 2000 messages, but a virtualized list holds a viewport's worth.
  const rows = app.texts().filter((text) => /^row \d+$/.test(text));
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.length).toBeLessThan(200);
});
