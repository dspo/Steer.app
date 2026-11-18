import { expect, open, test } from "nsh/test";

/** Writes the picture when the run draws the app (`nsh test --target macos`). */
async function shot(app: { screenshot: (path?: string | null) => Promise<Uint8Array> }, name: string): Promise<void> {
  try {
    await app.screenshot(`docs/evidence/${name}.png`);
  } catch {
    // Headless: nothing is drawn, and nothing is broken.
  }
}

// The gallery shapes over a seeded AHP chat: the thinking collapse, the tool
// card (a terminal result's preview and exit code), the day line, an error
// line, the reply's copy action, and the list's follow behavior.

test("the thinking block folds and unfolds its reasoning", async () => {
  const app = await open("../fixtures/manox-conversation.tsx", { width: 1200, height: 800 });
  await app.waitFor("id:chat-thinking");
  expect(app.shows("id:chat-thinking-text")).toBe(false);
  // The settled labels quote the run's timing where the metrics face has a
  // row (`r1`, 3s) and stay durationless where it does not (`r2`).
  expect(app.texts()).toContain("思考了 3s");
  expect(app.texts()).toContain("思考了");
  await app.press("id:chat-thinking >> nth=0");
  await app.waitFor("id:chat-thinking-text");
  expect(app.texts()).toContain("The suite is the fastest signal; run it before reading anything.");
  await app.press("id:chat-thinking >> nth=0");
  expect(app.shows("id:chat-thinking-text")).toBe(false);
  await shot(app, "ui-manox-chat-widgets");
});

test("the tool card carries its title, status, terminal preview and exit code", async () => {
  const app = await open("../fixtures/manox-conversation.tsx", { width: 1200, height: 800 });
  await app.waitFor("id:chat-tool-call");
  const texts = app.texts();
  // The gallery's identity row: the avatar tile and the model's name.
  expect(app.count("id:chat-assistant-header")).toBeGreaterThan(0);
  expect(texts).toContain("qwen3.8-flash");
  expect(texts).toContain("Run tests");
  expect(texts).toContain("已完成");
  expect(texts).toContain("52 pass, 0 fail");
  expect(texts.some((line) => line.includes("exit 0"))).toBe(true);
  // The pending call shows its approval actions.
  expect(app.count("id:manox-approve")).toBe(1);
  expect(app.count("id:manox-deny")).toBe(1);
});

test("the timeline inserts a day line and the error stays a quiet line", async () => {
  const app = await open("../fixtures/manox-conversation.tsx", { width: 1200, height: 800 });
  await app.waitFor("id:chat-day");
  // The settled turns cross midnight: the visible day line is the second day's.
  expect(app.texts()).toContain("2026/11/16");
  expect(app.texts()).toContain("the provider refused the second request");
});

test("a reply's copy action reports the copy", async () => {
  const app = await open("../fixtures/manox-conversation.tsx", { width: 1200, height: 800 });
  await app.waitFor("id:chat-actions:t1-copy");
  await app.press("id:chat-actions:t1-copy");
  // The action is an icon target: its name lives in the accessibility label.
  await app.waitUntil(
    () => app.shows("label:已复制") || app.shows("label:Copied"),
    { timeout: 5000 },
  );
  await shot(app, "ui-manox-chat-actions");
});

test("a reader scrolled up stays put when the chat grows", async () => {
  const app = await open("../fixtures/manox-conversation.tsx", { width: 1200, height: 800 });
  await app.waitFor("id:manox-transcript");
  await app.waitFor("text:filler-40");
  // Scroll up into the history, then grow the chat from the fixture.
  await app.scroll("id:manox-transcript", -1200);
  await app.waitFor("id:chat-jump-latest");
  await app.press("id:fixture-append");
  await app.wait(300);
  // The reader was not dragged to the new bottom: the jump control is still
  // up (it only hides when the view follows the stream again).
  expect(app.shows("id:chat-jump-latest")).toBe(true);
  await app.press("id:chat-jump-latest");
  await app.waitUntil(() => !app.shows("id:chat-jump-latest"), { timeout: 10000 });
});

test("the thinking block opens while it thinks and folds when the turn settles", async () => {
  const app = await open("../fixtures/manox-conversation-live.tsx", { width: 1200, height: 800 });
  await app.waitFor("id:chat-thinking");
  // Live: open by default, streaming label, text visible without a press.
  expect(app.shows("id:chat-thinking-text")).toBe(true);
  expect(app.texts()).toContain("思考中…");
  // Settled: folded to its completion label; the run's timing rode the
  // metrics face at the close, and a sub-millisecond settle (`durationMs`
  // 0, the wire's edge) says "<1s", never "0s".
  await app.press("id:fixture-settle");
  await app.waitUntil(() => !app.shows("id:chat-thinking-text"), { timeout: 5000 });
  expect(app.texts()).toContain("思考了 <1s");
  expect(app.texts()).toContain("It is /tmp.");
  await app.press("id:chat-thinking");
  await app.waitFor("id:chat-thinking-text");
});
