import { expect, open, test } from "nsh/test";

// The second instance's state is a headless UI test: the claim's file
// semantics are Rust-tested, and the real "two processes" case cannot be
// started from one test run without killing or racing the user's app.
test("the second instance explains who owns the state directory", async () => {
  const app = await open("./fixtures/lifecycle.tsx");
  expect(app.texts()).toContain("Zu 已在运行");
  expect(app.texts().some((text) => text.includes("4321"))).toBe(true);
  expect(app.texts().some((text) => text.includes("/tmp/zu-m12/instance.lock"))).toBe(true);
  expect(app.texts()).toContain("从 Dock 或菜单栏图标切回已运行的窗口。");
  // Quit is offered; pressing it is safe even where Application.quit() is
  // a no-op (this notice is the only thing in the window).
  expect(app.count("id:already-running-quit")).toBe(1);
  await app.press("id:already-running-quit");
});
