import { expect, open, test } from "nsh/test";

/** Writes the picture when the run draws the app (`nsh test --target macos`). */
async function shot(app: { screenshot: (path?: string | null) => Promise<Uint8Array> }, name: string): Promise<void> {
  try {
    await app.screenshot(`docs/evidence/${name}.png`);
  } catch {
    // Headless: nothing is drawn, and nothing is broken.
  }
}

/** The frames the fixture captured, read back through the app's storage. */
function capturedFrames(app: { storage(): Record<string, string> }): Array<Record<string, any>> {
  const raw = app.storage()["manox-frames"];
  return raw ? JSON.parse(raw) : [];
}

/** The dispatchAction frames of one action type, in dispatch order. */
function framesOfType(app: { storage(): Record<string, string> }, type: string): Array<Record<string, any>> {
  return capturedFrames(app).filter(
    (frame) => frame.method === "dispatchAction" && frame.params?.action?.type === type,
  );
}

/**
 * The manox composer's ZCode card (DESIGN §3.6a, Q124), on the deterministic
 * fixture: channels seeded by hand, the kernel catalogue stood in by the
 * fixture, every dispatch captured by the frame sink. Ungated — no host, no
 * native pump, no credentials; the real-host gate stays in `manox.ui.test.tsx`.
 */

test("the idle card shows every control with its name and a disabled +", async () => {
  const app = await open("../fixtures/manox-composer.tsx", { width: 1200, height: 800 });
  await app.waitFor("id:manox-input");
  await shot(app, "ui-manox-composer-idle");
  // Every control is on the card: the disabled `+`, the access mode, the
  // ring, the model/effort pickers and the one action.
  for (const id of ["manox-attach", "manox-mode", "manox-context", "manox-model-picker", "manox-effort-picker", "manox-send"]) {
    expect(app.shows(`id:${id}`)).toBe(true);
  }
  // The `+` is a deliberate placeholder: present, named, not live.
  expect(app.enabled("id:manox-attach")).toBe(false);
  expect(app.count("label:添加附件 · 附件暂不支持。")).toBe(1);
  // The trigger names the current access mode in the shell's words.
  expect(app.texts()).toContain("完全访问");
  expect(app.count("label:权限模式：完全访问")).toBe(1);
  // The model trigger names the catalogue's provider and model id.
  expect(app.texts()).toContain("bailian · qwen3.8-flash");
  expect(app.count("label:模型")).toBe(1);
  // The effort trigger carries the fold's raw value.
  expect(app.texts()).toContain("max");
  expect(app.count("label:推理强度")).toBe(1);
  // The ring is honest about being last-turn context.
  expect(app.count("label:上下文（上一轮） · 12.3k / 1M · 1%")).toBe(1);
  // Idle with an empty draft: the send waits.
  expect(app.enabled("id:manox-send")).toBe(false);
  expect(app.count("label:发送")).toBe(1);
  expect(app.shows("id:manox-stop")).toBe(false);
  // The same card in dark: tokens flip, the geometry stays.
  await app.setColorScheme("dark");
  await shot(app, "ui-manox-composer-idle-dark");
  await app.setColorScheme("light");
});

test("submitting dispatches chat/turnStarted and swaps the action to stop", async () => {
  const app = await open("../fixtures/manox-composer.tsx", { width: 1200, height: 800 });
  await app.waitFor("id:manox-input");
  await app.type("id:manox-input", "fix the failing test");
  expect(app.enabled("id:manox-send")).toBe(true);
  await app.submit("id:manox-input");
  // The turn started optimistically: the stop is up, the send is gone.
  await app.waitFor("id:manox-stop");
  expect(app.shows("id:manox-send")).toBe(false);
  expect(app.enabled("id:manox-stop")).toBe(true);
  expect(app.count("label:停止")).toBe(1);
  // The wire saw the dispatch.
  await app.waitUntil(() => framesOfType(app, "chat/turnStarted").length === 1, { timeout: 5000 });
});

test("the access-mode switch dispatches session/configChanged", async () => {
  const app = await open("../fixtures/manox-composer.tsx", { width: 1200, height: 800 });
  await app.waitFor("id:manox-mode");
  await app.press("id:manox-mode");
  await app.waitFor("id:manox-mode-sandbox");
  await shot(app, "ui-manox-composer-mode");
  await app.press("id:manox-mode-sandbox");
  // Choosing closes the menu, and the optimistic fold moves the trigger.
  await app.waitUntil(() => !app.shows("id:manox-mode-sandbox"), { timeout: 5000 });
  expect(app.texts()).toContain("沙盒");
  expect(app.count("label:权限模式：沙盒")).toBe(1);
  await app.waitUntil(() => framesOfType(app, "session/configChanged").length === 1, { timeout: 5000 });
  const frame = framesOfType(app, "session/configChanged")[0];
  expect(frame.params.channel).toBe("ahp-session:/thread");
  expect(frame.params.action.config.accessMode).toBe("sandbox");
});

test("the model menu lists the catalogue's models and dispatches the ref", async () => {
  const app = await open("../fixtures/manox-composer.tsx", { width: 1200, height: 800 });
  await app.waitFor("id:manox-model-picker");
  await app.press("id:manox-model-picker");
  await app.waitFor("id:manox-model-bailian-bailian-anthropic/qwen3.8-plus");
  await shot(app, "ui-manox-composer-model");
  // The rows are the catalogue's: the model's name over its id and window.
  expect(app.texts()).toContain("Qwen3.8 Plus");
  expect(app.texts()).toContain("qwen3.8-plus · 1M");
  await app.press("id:manox-model-bailian-bailian-anthropic/qwen3.8-plus");
  await app.waitUntil(() => !app.shows("id:manox-model-bailian-bailian-anthropic/qwen3.8-plus"), { timeout: 5000 });
  // The trigger follows the optimistic fold: provider · id of the new ref.
  await app.waitUntil(() => app.texts().includes("bailian · qwen3.8-plus"), { timeout: 5000 });
  await app.waitUntil(() => framesOfType(app, "session/configChanged").length === 1, { timeout: 5000 });
  const frame = framesOfType(app, "session/configChanged")[0];
  expect(frame.params.action.config.model).toBe("bailian-anthropic/qwen3.8-plus");
});

test("the effort picker dispatches the writable value", async () => {
  const app = await open("../fixtures/manox-composer.tsx", { width: 1200, height: 800 });
  await app.waitFor("id:manox-effort-picker");
  await app.press("id:manox-effort-picker");
  await app.waitFor("id:manox-effort-high");
  await shot(app, "ui-manox-composer-effort");
  await app.press("id:manox-effort-high");
  await app.waitUntil(() => !app.shows("id:manox-effort-high"), { timeout: 5000 });
  // The trigger follows the fold to the picked raw value.
  await app.waitUntil(() => app.texts().includes("high"), { timeout: 5000 });
  expect(app.count("label:推理强度")).toBe(1);
  await app.waitUntil(() => framesOfType(app, "session/configChanged").length === 1, { timeout: 5000 });
  const frame = framesOfType(app, "session/configChanged")[0];
  expect(frame.params.action.config.reasoningEffort).toBe("high");
});

test("the card holds at the minimum window", async () => {
  const app = await open("../fixtures/manox-composer.tsx", { width: 900, height: 600 });
  await app.waitFor("id:manox-input");
  // The footer's two clusters share the card at 900pt: nothing folds away
  // and the model name gives way before the action does.
  for (const id of ["manox-attach", "manox-mode", "manox-context", "manox-model-picker", "manox-effort-picker", "manox-send"]) {
    expect(app.shows(`id:${id}`)).toBe(true);
  }
  await shot(app, "ui-manox-composer-narrow");
});
