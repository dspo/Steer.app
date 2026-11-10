import { expect, open, test } from "nsh/test";
import { Fs } from "zu/native";
import { fileRowTestId, compareRowTestId } from "./file-tree";
import { M8_ROOT } from "./fixtures/m8-paths";

// M8's acceptance, on real files: the Files sheet lists a container's cwd,
// a file opens in the real `Editor`, typing marks it dirty, Mod+S writes
// through `zu/fs`, and the test reads the bytes back with `zu/fs` — not a
// mock. The diff case opens two real files and reads `DiffView`'s own stats.
//
// `fixtures/files.tsx` shows the editor store's state in a status line, so a
// wait does not depend on the shell's language.

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Screenshots need a real platform (`nsh test --target macos`); headless draws
// nothing, so these are opt-in and never the evidence of record by themselves.
const SHOTS = process.env.ZU_M8_SHOTS === "1";

async function shot(app: { screenshot: (path?: string | null) => Promise<Uint8Array> }, name: string): Promise<void> {
  if (!SHOTS) return;
  try {
    await app.screenshot(`docs/evidence/${name}.png`);
  } catch {
    // A headless run, or a window that cannot be drawn: no picture, no failure.
  }
}

async function until(what: string, condition: () => Promise<boolean> | boolean, timeoutMs = 15000): Promise<void> {
  for (let waited = 0; waited < timeoutMs; waited += 25) {
    if (await condition()) return;
    await sleep(25);
  }
  throw new Error(`timed out waiting for ${what}`);
}

test("a real file opens, edits, saves, and the disk agrees", async () => {
  await Fs.mkdir("/tmp", "zu-m8-fixture");
  await Fs.write(M8_ROOT, "note.txt", "M8_BEFORE\n", null, null);

  const app = await open("./fixtures/files.tsx", { width: 1200, height: 800 });
  await app.waitFor("id:files-root");
  const row = `id:${fileRowTestId("note.txt")}`;
  await app.waitFor(row);
  await shot(app, "m8-files-light");
  await app.press(row);
  await app.waitFor("id:editor-view");
  // Loaded from disk (status ready, clean).
  await app.waitUntil(() => app.texts().some((text) => text.includes("note.txt:ready:clean:rw")), {
    timeout: 10000,
  });

  // Typing goes into the real Editor; the document becomes dirty.
  await app.type("id:editor-view", "M8_EDIT\n");
  await app.waitUntil(() => app.texts().some((text) => text.includes("note.txt:ready:dirty:rw")), {
    timeout: 10000,
  });
  expect(app.count("id:editor-dirty-dot")).toBe(1);
  await shot(app, "m8-editor-light");
  if (SHOTS) {
    await app.setColorScheme("dark");
    await shot(app, "m8-editor-dark");
    await app.setColorScheme("light");
  }

  // Mod+S saves through zu/fs; the disk is the authority.
  await app.keyboard.press("mod+s");
  await until("the file on disk to hold the edit", async () => {
    const file = await Fs.read(M8_ROOT, "note.txt");
    return file.text.includes("M8_EDIT");
  });

  const saved = await Fs.read(M8_ROOT, "note.txt");
  expect(saved.text).toContain("M8_EDIT");
  expect(saved.text).toContain("M8_BEFORE");
  await app.waitUntil(() => app.texts().some((text) => text.includes("note.txt:ready:clean:rw")), {
    timeout: 10000,
  });
  expect(app.count("id:editor-dirty-dot")).toBe(0);
  // The sheet's status line agrees with the file it read back.
  expect(app.shows("id:editor-save")).toBe(true);
});

test("a file changed on disk turns the editor read-only until it reloads", async () => {
  await Fs.mkdir("/tmp", "zu-m8-fixture");
  await Fs.write(M8_ROOT, "stale.txt", "ORIGINAL\n", null, null);

  const app = await open("./fixtures/files.tsx", { width: 1200, height: 800 });
  await app.waitFor("id:files-root");
  const row = `id:${fileRowTestId("stale.txt")}`;
  await app.waitFor(row);
  await app.press(row);
  await app.waitFor("id:editor-view");
  await app.waitUntil(() => app.texts().some((text) => text.includes("stale.txt:ready:clean:rw")), {
    timeout: 10000,
  });

  // Somebody else writes the file: the save must be refused, not overwrite.
  await Fs.write(M8_ROOT, "stale.txt", "EXTERNAL LONGER TEXT\n", null, null);
  await app.keyboard.press("mod+s");
  await app.waitFor("id:editor-conflict");
  await app.waitUntil(() => app.texts().some((text) => text.includes("stale.txt:ready:clean:ro")), {
    timeout: 10000,
  });
  expect((await Fs.read(M8_ROOT, "stale.txt")).text).toBe("EXTERNAL LONGER TEXT\n");

  // Reload takes the disk's version and clears the conflict.
  await app.press("id:editor-conflict-reload");
  await app.waitUntil(() => app.count("id:editor-conflict") === 0, { timeout: 10000 });
  await app.waitUntil(() => app.texts().some((text) => text.includes("stale.txt:ready:clean:rw")), {
    timeout: 10000,
  });
  // The editor shows the external text: saving now writes the reloaded text.
  await app.type("id:editor-view", "RELOADED\n");
  await app.waitUntil(() => app.texts().some((text) => text.includes("stale.txt:ready:dirty:rw")), {
    timeout: 10000,
  });
  await app.keyboard.press("mod+s");
  await until("the reloaded edit on disk", async () =>
    (await Fs.read(M8_ROOT, "stale.txt")).text.includes("RELOADED"),
  );
  expect((await Fs.read(M8_ROOT, "stale.txt")).text).toContain("EXTERNAL LONGER TEXT");
});

test("find and replace all in the real Editor writes through zu/fs", async () => {
  await Fs.mkdir("/tmp", "zu-m8-fixture");
  await Fs.write(M8_ROOT, "find.txt", "M8_BEFORE one\nM8_BEFORE two\n", null, null);

  const app = await open("./fixtures/files.tsx", { width: 1200, height: 800 });
  await app.waitFor("id:files-root");
  const row = `id:${fileRowTestId("find.txt")}`;
  await app.waitFor(row);
  await app.press(row);
  await app.waitFor("id:editor-view");
  await app.waitUntil(() => app.texts().some((text) => text.includes("find.txt:ready:clean:rw")), {
    timeout: 10000,
  });

  await app.press("id:editor-find");
  await app.waitFor("id:editor-find-query");
  await app.type("id:editor-find-query", "M8_BEFORE");
  // The count comes from the Editor's own search (`onSearchChange`).
  await app.waitUntil(() => app.texts().some((text) => text.includes("2") && text.includes("个匹配")), {
    timeout: 10000,
  });
  await app.type("id:editor-find-replace", "M8_AFTER");
  await app.press("id:editor-replace-all");
  await app.waitUntil(() => app.texts().some((text) => text.includes("find.txt:ready:dirty:rw")), {
    timeout: 10000,
  });

  await app.keyboard.press("mod+s");
  await until("the replaced text on disk", async () => {
    const file = await Fs.read(M8_ROOT, "find.txt");
    return file.text === "M8_AFTER one\nM8_AFTER two\n";
  });
  expect((await Fs.read(M8_ROOT, "find.txt")).text).toBe("M8_AFTER one\nM8_AFTER two\n");
});

test("two real files open in DiffView with correct hunk stats", async () => {
  await Fs.mkdir("/tmp", "zu-m8-fixture");
  await Fs.write(M8_ROOT, "before.txt", "alpha\nbeta\ngamma\n", null, null);
  await Fs.write(M8_ROOT, "after.txt", "alpha\nBETA\ngamma\ndelta\n", null, null);

  const app = await open("./fixtures/files.tsx", { width: 1200, height: 800 });
  await app.waitFor("id:files-root");
  const compare = `id:${compareRowTestId("before.txt")}`;
  await app.waitFor(compare);
  await app.press(compare);
  await app.waitFor("id:diff-dialog");
  // The first path is the file whose row was pressed; type the second.
  await app.type("id:diff-path-b", `${M8_ROOT}/after.txt`);
  await app.press("id:diff-open");
  await app.waitFor("id:diff-view");

  // `DiffView`'s own computed stats: one changed line and one added line.
  await app.waitUntil(
    () => app.texts().some((text) => text.includes("+2") && text.includes("−1")),
    { timeout: 10000 },
  );
  expect(app.shows("id:diff-same")).toBe(false);
  await shot(app, "m8-diff-light");
  // The changed lines are drawn from the real files' text.
  await app.waitUntil(() => app.texts().some((text) => text.includes("BETA")), { timeout: 10000 });
  expect(app.texts().some((text) => text.includes("delta"))).toBe(true);

  // The unified layout draws the same diff.
  await app.press("id:diff-unified");
  await app.waitFor("id:diff-view");
  expect(app.shows("id:diff-view")).toBe(true);
});
