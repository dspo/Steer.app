import { expect, open, test } from "nsh/test";

// §2.1-6's acceptance: a Chinese system draws Chinese, anything else draws
// English, and there is no in-app switch to disagree with it (the language
// button is gone). The fixture plays the system through `setLocale`, which
// is exactly what `locale()` reports to the app's startup read.

function expectLocale(app: { texts: () => string[] }, chinese: boolean): void {
  const texts = app.texts();
  if (chinese) {
    expect(texts).toContain("开始你的对话");
    expect(texts).not.toContain("Start a conversation");
  } else {
    expect(texts).toContain("Start a conversation");
    expect(texts).not.toContain("开始你的对话");
  }
}

test("a Chinese system draws the shell in Chinese", async () => {
  const app = await open("./fixtures/locale-zh.tsx", { width: 1200, height: 800 });
  await app.waitFor("id:new-container");
  expect(app.texts().some((text) => text.includes("shell=zh-CN"))).toBe(true);
  expectLocale(app, true);
});

test("any other system language draws English, and no switch exists", async () => {
  const app = await open("./fixtures/locale-en.tsx", { width: 1200, height: 800 });
  await app.waitFor("id:new-container");
  expect(app.texts().some((text) => text.includes("shell=en"))).toBe(true);
  expectLocale(app, false);
  // The titlebar's ⋯ menu has no language row any more.
  await app.press("id:titlebar-tools");
  expect(app.count("id:language")).toBe(0);
});
