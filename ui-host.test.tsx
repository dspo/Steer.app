import { expect, open, test } from "nsh/test";

// The dialog matrix without an engine: the fixture enqueues the same
// requests an extension makes, so this covers the shell side of
// `contracts/protocol.md`'s extension UI table.
test("extension requests become dialogs and answers", async () => {
  const app = await open("./fixtures/ui-host.tsx");

  await app.press("ask select");
  expect(app.texts()).toContain("Pick one");
  expect(app.texts()).toContain("beta");
  await app.press("id:ui-option-1");
  await app.waitUntil(() => app.texts().includes("answer: beta"));
  expect(app.texts()).toContain("answer: beta");

  await app.press("ask input");
  await app.type("id:ui-input", "Zu");
  await app.press("id:ui-save");
  await app.waitUntil(() => app.texts().includes("answer: Zu"));

  await app.press("ask editor");
  expect(app.value("id:ui-input")).toBe("line one");
  await app.clear("id:ui-input");
  await app.type("id:ui-input", "two lines");
  await app.press("id:ui-save");
  await app.waitUntil(() => app.texts().includes("answer: two lines"));

  app.onDialog(() => "确认");
  await app.press("ask confirm");
  await app.waitUntil(() => app.texts().includes("answer: true"));
  const dialog = app.dialogs()[app.dialogs().length - 1];
  expect(dialog?.title).toBe("Allow it?");
  expect(dialog?.message).toBe("A fixture asks.");

  await app.press("id:notify");
  await app.waitUntil(() => app.count("id:toast") === 1);
  // The toast is one accessible alert whose label is the message; its text
  // children are not exposed separately, so the label is the assertion.
  expect(app.count("label:probe toast")).toBe(1);
});

test("cancelling a dialog answers undefined", async () => {
  const app = await open("./fixtures/ui-host.tsx");
  await app.press("ask select");
  await app.press("id:ui-cancel");
  await app.waitUntil(() => app.texts().includes("answer: undefined"));
  expect(app.texts()).toContain("answer: undefined");
});
