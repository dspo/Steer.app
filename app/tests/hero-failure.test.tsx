import { expect, open, test } from "nsh/test";

// A start that fails says why, in the shell's error line, and keeps what the
// user wrote. Before, the rejection had nobody to catch it: the draft was
// cleared and the screen said nothing (an unhandled rejection in the console).

test("a Hero start that cannot make a session says so and keeps the draft", async () => {
  const app = await open("../fixtures/hero-failure.tsx", { width: 1200, height: 800 });
  await app.waitFor("id:hero-input");
  await app.type("id:hero-input", "hello failure");
  await app.submit("id:hero-input");
  await app.waitUntil(() => app.texts().some((text) => text.includes("the pi harness was not found")), {
    timeout: 10000,
  });
  expect(app.texts().some((text) => text.includes("the pi harness was not found"))).toBe(true);
  // The message is what the bar carries, not a session that opened.
  expect(app.value("id:hero-input")).toBe("hello failure");
  expect(app.shows("id:hero-input")).toBe(true);
});
