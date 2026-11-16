import { expect, open, test } from "nsh/test";
import { Fs, Git } from "zu/native";
import { fileRowTestId } from "../modules/files/file-tree";

// M9's acceptance, through the real Workbench: the top bar opens Changes,
// a real changed file is staged and committed there, and the test reads the
// result back with `zu/git` (which shells out to git — nothing is mocked);
// then the same app draws the worktree hunk in the real `DiffView`, and the
// History sheet checks out a branch while the Changes sheet and an open
// editor follow.

const TAG = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
/** This run's repository: a fresh root, so no earlier run's files appear. */
const ROOT = `/tmp/zu-m9-git-fixture-${TAG}`;
const OPEN = { storage: { "zu-m9-root": ROOT }, width: 1200, height: 800 };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function until(what: string, condition: () => Promise<boolean> | boolean, timeoutMs = 15000): Promise<void> {
  for (let waited = 0; waited < timeoutMs; waited += 25) {
    if (await condition()) return;
    await sleep(25);
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function makeRepo(): Promise<void> {
  await Fs.mkdir("/tmp", `zu-m9-git-fixture-${TAG}`);
  await Git.init(ROOT);
  await Git.setIdentity(ROOT, "Zu Test", "zu@example.test");
  // The fixture root outlives a run (`/tmp`), and every run adds files. A
  // clean start keeps the Changes sheet to this run's file, so a row is
  // never pushed under the commit line by an earlier run's leftovers.
  const before = await Git.status(ROOT);
  if (!before.clean) {
    await Git.stage(ROOT, []);
    await Git.commit(ROOT, `fixture reset ${TAG}`);
  }
}

test("the top bar opens Changes; staging and committing are real git", async () => {
  await makeRepo();
  const file = `ui-${TAG}.txt`;
  const message = `ui commit ${TAG}`;
  await Fs.write(ROOT, file, "UI_BEFORE\n", null, null);

  const app = await open("../fixtures/git.tsx", OPEN);
  await app.waitFor("id:titlebar-tools");
  await app.press("id:titlebar-tools");
  await app.press("id:open-changes");
  // The sheet lists the real untracked file.
  const unstaged = `id:git-change-unstaged-${file}`;
  await app.waitFor(unstaged);
  await app.waitFor(`id:git-stage-${file}`);

  // Stage: the row moves into the staged group (git's status again).
  await app.press(`id:git-stage-${file}`);
  await app.waitFor(`id:git-change-staged-${file}`);
  await app.waitUntil(
    () => app.texts().some((text) => text.includes("已暂存 1 个文件")),
    { timeout: 10000 },
  );
  expect((await Git.status(ROOT)).staged.map((row) => row.path)).toContain(file);

  // The staged patch is `git diff --cached`, drawn by the same DiffView.
  await app.press(`id:git-change-staged-${file}`);
  await app.waitFor("id:git-diff-view");
  await app.waitUntil(() => app.texts().some((text) => text.includes("UI_BEFORE")), {
    timeout: 10000,
  });

  // Commit through the sheet's own line.
  await app.type("id:git-message", message);
  await app.press("id:git-commit");
  await until("the commit to appear in git log", async () =>
    (await Git.log(ROOT, 5)).some((commit) => commit.subject === message),
  );

  // git's answer is the authority: the commit names the test's author, the
  // file is no longer staged, and the log row appears in the History sheet.
  const log = await Git.log(ROOT, 5);
  const committed = log.find((commit) => commit.subject === message);
  expect(committed).toBeDefined();
  expect(committed?.author).toBe("Zu Test");
  const status = await Git.status(ROOT);
  expect(status.staged.map((row) => row.path)).not.toContain(file);
  expect(status.unstaged.map((row) => row.path)).not.toContain(file);

  await app.press("id:titlebar-tools");
  await app.press("id:open-history");
  await app.waitFor("id:history-list");
  await app.waitUntil(() => app.texts().some((text) => text === message), { timeout: 10000 });
});

test("the worktree hunk is drawn by the real DiffView", async () => {
  await makeRepo();
  const file = `hunk-${TAG}.txt`;
  await Fs.write(ROOT, file, "alpha\nbeta\ngamma\n", null, null);
  await Git.stage(ROOT, [file]);
  await Git.commit(ROOT, `baseline ${TAG}`);
  await Fs.write(ROOT, file, "alpha\nBETA\ngamma\ndelta\n", null, null);

  const app = await open("../fixtures/git.tsx", OPEN);
  await app.waitFor("id:titlebar-tools");
  await app.press("id:titlebar-tools");
  await app.press("id:open-changes");
  await app.waitFor(`id:git-change-unstaged-${file}`);
  await app.press(`id:git-change-unstaged-${file}`);
  await app.waitFor("id:git-diff-view");

  // The patch's own lines and counts: one changed line, one added line.
  await app.waitUntil(
    () => app.texts().some((text) => text.includes("BETA")),
    { timeout: 10000 },
  );
  expect(app.texts().some((text) => text.includes("delta"))).toBe(true);
  await app.waitUntil(
    () => app.texts().some((text) => text.includes("+2") && text.includes("−1")),
    { timeout: 10000 },
  );

  // The unified layout draws the same hunk.
  await app.press("id:git-diff-unified");
  await app.waitFor("id:git-diff-view");
  expect(app.shows("id:git-diff-view")).toBe(true);
});

test("the branch menu checks out; Changes, History and the open editor follow", async () => {
  await makeRepo();
  const file = `branch-${TAG}.txt`;
  const feature = `feature-${TAG}`;
  await Fs.write(ROOT, file, "BASE\n", null, null);
  await Git.stage(ROOT, [file]);
  await Git.commit(ROOT, `base ${TAG}`);
  const base = (await Git.status(ROOT)).branch;
  await Git.createBranch(ROOT, feature);
  await Fs.write(ROOT, file, "FEATURE\n", null, null);
  await Git.stage(ROOT, [file]);
  await Git.commit(ROOT, `feature ${TAG}`);
  await Git.checkout(ROOT, base);
  expect((await Fs.read(ROOT, file)).text).toBe("BASE\n");

  const app = await open("../fixtures/git.tsx", OPEN);
  // The editor opens the base branch's version.
  await app.waitFor(`id:${fileRowTestId(file)}`);
  await app.press(`id:${fileRowTestId(file)}`);
  await app.waitFor("id:editor-view");
  await app.waitUntil(
    () => app.texts().some((text) => text.includes(`${file}:ready:BASE`)),
    { timeout: 10000 },
  );

  // History: the branch menu checks out the feature branch.
  await app.press("id:titlebar-tools");
  await app.press("id:open-history");
  await app.waitFor("id:history-branch");
  await app.press("id:history-branch");
  await app.waitFor(`id:history-checkout-${feature}`);
  await app.press(`id:history-checkout-${feature}`);
  await until("the checkout to reach git", async () => (await Git.status(ROOT)).branch === feature);

  // The clean editor reloaded the checked-out file from disk.
  await app.waitUntil(
    () => app.texts().some((text) => text.includes(`${file}:ready:FEATURE`)),
    { timeout: 10000 },
  );

  // Changes follows the checkout too: its header names the new branch and
  // the file is clean against it.
  await app.press("id:titlebar-tools");
  await app.press("id:open-changes");
  await app.waitFor("id:git-branch");
  await app.waitUntil(() => app.texts().filter((text) => text === feature).length > 0, {
    timeout: 10000,
  });
  expect(app.shows(`id:git-change-staged-${file}`)).toBe(false);
  expect(app.shows(`id:git-change-unstaged-${file}`)).toBe(false);
});
