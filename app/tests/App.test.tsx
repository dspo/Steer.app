import { expect, open, test } from "nsh/test";
import { copy } from "../ui/copy";

test("the shell is a Steer titlebar over the project sidebar, with no status bar", async () => {
  const app = await open("../App.tsx", { network: "live", width: 1200, height: 800 });
  expect(app.texts()).toContain(copy("会话", "Sessions"));
  expect(app.texts()).toContain(copy("新建", "New"));
  // The titlebar's own controls: sidebar toggle, centered picker, VS Code,
  // tools overflow. No second row of engine buttons lives up there.
  expect(app.count("id:sidebar-toggle")).toBe(1);
  // The centered picker is gone (§2.2-10): the titlebar keeps only the
  // left toggle and the right actions.
  expect(app.count("id:session-picker")).toBe(0);
  expect(app.count("id:open-vscode")).toBe(1);
  expect(app.count("id:titlebar-tools")).toBe(1);
  // The resting sidebar is Project → SessionContainer; the all-sessions list
  // only appears while filtering.
  expect(app.texts()).not.toContain(copy("全部会话", "All sessions"));
  expect(app.count("id:search-results")).toBe(0);
  // The sidebar toggle hides the whole left column (the titlebar stays).
  await app.press("id:sidebar-toggle");
  await app.waitUntil(() => app.count("id:new-container") === 0, { timeout: 5000 });
  expect(app.count("id:new-container")).toBe(0);
  await app.press("id:sidebar-toggle");
  await app.waitUntil(() => app.count("id:new-container") === 1, { timeout: 5000 });
  // There is no bottom status bar — and since the cutover there is no
  // engine indicator either: the ACP transport has no resident process whose
  // phase could show, quiet or otherwise. Reading the user's real ~/.pi as
  // the backing store is the boot's long-standing behavior; nothing here
  // names its contents.
  expect(app.count("id:status-bar")).toBe(0);
  expect(app.count("id:engine-state")).toBe(0);
});

test("a conversation renders history, tool lines and prose", async () => {
  const app = await open("../fixtures/session.tsx");
  const texts = app.texts();
  expect(texts).toContain("fold the extension channel");
  expect(texts).toContain("read done");
  expect(texts).toContain("the projection keys rows by message id");
  // The settled composer is one accent send; the running lane is absent.
  expect(app.count("id:session-send")).toBe(1);
  expect(app.shows("id:session-stop")).toBe(false);
});
