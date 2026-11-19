import { expect, open, test } from "nsh/test";
import { K, t } from "../ui/i18n";

/** The card contract: filename/caption render and the buttons dispatch. */
test("visualize cards open HTML in browser, text in editor, and before in diff", async () => {
  const app = await open("../fixtures/visualize.tsx", { width: 1000, height: 800 });
  await app.waitFor("id:visualize-t1");
  await app.waitFor("id:visualize-t2");
  expect(app.texts()).toContain("mockup.html");
  expect(app.texts()).toContain("home page");

  await app.press("id:visualize-t1-open");
  await app.waitUntil(() => app.texts().some((text) => text.includes("browser.open")));
  const calls = JSON.parse(
    app.texts().find((text) => text.startsWith("calls:"))!.slice("calls:".length),
  );
  const browser = calls.find((call: any) => call.name === "browser.open");
  expect(browser.payload.containerId).toBe("cont-a");
  expect(browser.payload.direct).toBe(true);
  expect(browser.payload.url).toContain(".zu/artifacts/mockup.html");
  expect(app.texts()).toContain(t(K.visualize.open));

  await app.press("id:visualize-t2-compare");
  await app.waitUntil(() => {
    const text = app.texts().find((value) => value.startsWith("calls:")) ?? "";
    return text.includes("diff.open");
  });
  const after = JSON.parse(
    app.texts().find((text) => text.startsWith("calls:"))!.slice("calls:".length),
  );
  expect(after.find((call: any) => call.name === "diff.open").payload).toEqual({
    containerId: "cont-a",
    before: "docs/report.before.md",
    path: "docs/report.md",
  });
});
