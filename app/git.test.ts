import { expect, test } from "nsh/test";
import { Fs } from "zu/native";
import { Git } from "zu/native";

// `zu/git` against a real repository the test itself makes under /tmp: every
// call shells out to the machine's git, and every assertion reads git's own
// answer back (status, log, branches, patch). No output is mocked, so a
// change in git's porcelain or patch format breaks this file.
//
// The repository is made with `Git.init` and its author with
// `Git.setIdentity` (repository-local only), so the test does not depend on
// the machine's git configuration and never writes the global one.

const TAG = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
const name = (kind: string) => `${kind}-${TAG}.txt`;

/** The repository the current test uses; each test gets its own. */
let ROOT = "";
let repos = 0;

async function makeRepo(): Promise<void> {
  const folder = `zu-m9-git-${TAG}-${repos++}`;
  ROOT = `/tmp/${folder}`;
  await Fs.mkdir("/tmp", folder);
  await Git.init(ROOT);
  // Repository-local only: the test never reads or writes the global config.
  await Git.setIdentity(ROOT, "Zu Test", "zu@example.test");
}

test("status, stage, commit and log are git's own answers", async () => {
  await makeRepo();
  const file = name("log");
  await Fs.write(ROOT, file, "first line\n", null, null);

  const untracked = await Git.status(ROOT);
  expect(untracked.unborn).toBe(true);
  expect(untracked.clean).toBe(false);
  expect(untracked.untracked.map((row) => row.path)).toEqual([file]);

  const staged = await Git.stage(ROOT, [file]);
  expect(staged.untracked).toEqual([]);
  expect(staged.staged.map((row) => row.path)).toEqual([file]);
  expect(staged.staged[0].status).toBe("added");

  // The staged patch is git's diff, not a file comparison.
  const patch = await Git.diff(ROOT, file, true);
  expect(patch.patch).toContain("@@ -0,0 +1 @@");
  expect(patch.patch).toContain("+first line");
  expect(patch.added).toBe(1);
  expect(patch.deleted).toBe(0);

  const commit = await Git.commit(ROOT, "the first commit");
  expect(commit.subject).toBe("the first commit");
  expect(commit.author).toBe("Zu Test");
  expect(commit.hash.length).toBeGreaterThan(7);
  expect(commit.short.length).toBeGreaterThanOrEqual(7);

  // `git log` (through the module) agrees with the commit it reported.
  const log = await Git.log(ROOT, 10);
  expect(log.length).toBe(1);
  expect(log[0].hash).toBe(commit.hash);
  expect(log[0].subject).toBe("the first commit");
  expect(log[0].email).toBe("zu@example.test");
  expect(log[0].date.startsWith("20")).toBe(true);

  const clean = await Git.status(ROOT);
  expect(clean.clean).toBe(true);
  expect(clean.unborn).toBe(false);
  expect(clean.branch.length).toBeGreaterThan(0);
  expect(clean.oid).toBe(commit.hash);
});

test("an empty commit message is refused with its code", async () => {
  await makeRepo();
  await expect(Git.commit(ROOT, "   ")).rejects.toMatchObject({
    code: "ERR_GIT_MESSAGE",
  });
});

test("a worktree change diffs into hunks, and an untracked file has one too", async () => {
  await makeRepo();
  const file = name("hunk");
  await Fs.write(ROOT, file, "alpha\nbeta\ngamma\n", null, null);
  await Git.stage(ROOT, [file]);
  await Git.commit(ROOT, "baseline");

  await Fs.write(ROOT, file, "alpha\nBETA\ngamma\ndelta\n", null, null);
  const status = await Git.status(ROOT);
  expect(status.staged).toEqual([]);
  expect(status.unstaged.map((row) => row.path)).toEqual([file]);
  expect(status.unstaged[0].status).toBe("modified");

  const diff = await Git.diff(ROOT, file, false);
  expect(diff.patch).toContain("@@ -1,3 +1,4 @@");
  expect(diff.patch).toContain("+BETA");
  expect(diff.patch).toContain("-beta");
  expect(diff.added).toBe(2);
  expect(diff.deleted).toBe(1);

  // The whole worktree diff names the file as well.
  const all = await Git.diff(ROOT, null, false);
  expect(all.patch).toContain(file);

  // Untracked files are compared with /dev/null by git itself.
  const fresh = name("untracked");
  await Fs.write(ROOT, fresh, "new one\nnew two\n", null, null);
  const untrackedDiff = await Git.diff(ROOT, fresh, false);
  expect(untrackedDiff.patch).toContain("new file mode");
  expect(untrackedDiff.patch).toContain("+new one");
  expect(untrackedDiff.added).toBe(2);

  // Staging and unstaging move the change between the two sides.
  await Git.stage(ROOT, [file]);
  const staged = await Git.status(ROOT);
  expect(staged.staged.map((row) => row.path)).toContain(file);
  expect(staged.unstaged).toEqual([]);
  const unstaged = await Git.unstage(ROOT, [file]);
  expect(unstaged.staged).toEqual([]);
  expect(unstaged.unstaged.map((row) => row.path)).toContain(file);
});

test("branches list, create and check out, and the working tree follows", async () => {
  await makeRepo();
  const file = name("branch");
  await Fs.write(ROOT, file, "base\n", null, null);
  await Git.stage(ROOT, [file]);
  await Git.commit(ROOT, "base");
  const base = (await Git.status(ROOT)).branch;

  const branches = await Git.branches(ROOT);
  expect(branches.current).toBe(base);
  expect(branches.local.some((branch) => branch.name === base && branch.current)).toBe(true);

  const feature = `feature-${TAG}`;
  const created = await Git.createBranch(ROOT, feature);
  expect(created.branch).toBe(feature);
  expect((await Git.branches(ROOT)).current).toBe(feature);

  await Fs.write(ROOT, file, "feature\n", null, null);
  await Git.stage(ROOT, [file]);
  await Git.commit(ROOT, "on the feature");

  const back = await Git.checkout(ROOT, base);
  expect(back.branch).toBe(base);
  // The tracked file is the base branch's again.
  const reread = await Fs.read(ROOT, file);
  expect(reread.text).toBe("base\n");
  // And the feature branch keeps its own commit.
  const log = await Git.log(ROOT, 10);
  expect(log.map((commit) => commit.subject)).toEqual(["base"]);

  const again = await Git.checkout(ROOT, feature);
  expect(again.branch).toBe(feature);
  expect((await Fs.read(ROOT, file)).text).toBe("feature\n");
});

test("a path outside the workspace and an invalid branch are refused", async () => {
  await makeRepo();
  for (const bad of ["../escape.txt", "/etc/hosts", ":!keep", "-f"]) {
    await expect(Git.stage(ROOT, [bad])).rejects.toMatchObject({ code: "ERR_GIT_PATH" });
    await expect(Git.diff(ROOT, bad, false)).rejects.toMatchObject({ code: "ERR_GIT_PATH" });
  }
  await expect(Git.checkout(ROOT, "--upload-pack=x")).rejects.toMatchObject({
    code: "ERR_GIT_BRANCH",
  });
  await expect(Git.createBranch(ROOT, "bad name with spaces")).rejects.toMatchObject({
    code: "ERR_GIT_BRANCH",
  });
});

test("a workspace that is not a repository reports its own code", async () => {
  const folder = `zu-m9-not-repo-${TAG}`;
  await Fs.mkdir("/tmp", folder);
  await expect(Git.status(`/tmp/${folder}`)).rejects.toMatchObject({
    code: "ERR_GIT_NOT_REPO",
  });
});

test("a folder inside a repository is refused instead of showing part of it", async () => {
  await makeRepo();
  await Fs.mkdir(ROOT, "inner");
  await expect(Git.status(`${ROOT}/inner`)).rejects.toMatchObject({
    code: "ERR_GIT_NOT_REPO",
  });
});
