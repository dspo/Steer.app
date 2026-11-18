import { expect, open, test } from "nsh/test";

// A start that fails says why, in the start page's error line (and the
// shell's status line). Before the object model, the rejection had nobody to
// catch it: the screen said nothing (an unhandled rejection in the console).

test("a start page whose conversation cannot be made says so and stays put", async () => {
  const app = await open("../fixtures/hero-failure.tsx", { width: 1200, height: 800 });
  await app.waitFor("id:launch-zu");
  await app.press("id:launch-zu");
  await app.waitUntil(() => app.texts().some((text) => text.includes("the pi harness was not found")), {
    timeout: 10000,
  });
  expect(app.texts().some((text) => text.includes("the pi harness was not found"))).toBe(true);
  // The failure opened no session: the start page is still the canvas.
  expect(app.shows("id:launch-zu")).toBe(true);
  expect(app.count("id:session-input")).toBe(0);
});
