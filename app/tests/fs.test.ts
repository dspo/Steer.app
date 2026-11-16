import { expect, test } from "nsh/test";
import { Fs } from "zu/native";

// `zu/fs` against real files under /tmp: atomic writes, reads, stats, the
// listing and the stale check, with every refusal code. No mock: the bytes
// are on disk.
//
// The app does not hold a `fs` capability (by design: `zu/fs` is the only
// file face), so the test makes its own workspace with `zu/fs`'s `mkdir`
// rather than a `fs/promises` call. Symlink escapes are covered by the Rust
// tests in `src/fs.rs`, where a test may use `std`.

const TAG = `${Date.now()}`;
const FOLDER = `zu-m8-fs-${TAG}`;
const ROOT = `/tmp/${FOLDER}`;
const name = (kind: string) => `zu-m8-${TAG}-${kind}.txt`;

test("write, read and stat round-trip a real file", async () => {
  await Fs.mkdir("/tmp", FOLDER);
  const file = name("roundtrip");
  const written = await Fs.write(ROOT, file, "first line\nsecond line\n", null, "utf-8");
  expect(written.size).toBe(23);

  const read = await Fs.read(ROOT, file);
  expect(read.text).toBe("first line\nsecond line\n");
  expect(read.encoding).toBe("utf-8");
  expect(read.binary).toBe(false);
  expect(read.size).toBe(23);
  expect(read.mtimeMs).toBeGreaterThan(0);

  const stat = await Fs.stat(ROOT, file);
  expect(stat.kind).toBe("file");
  expect(stat.size).toBe(23);
  expect(stat.readonly).toBe(false);
  expect(stat.path.endsWith(file)).toBe(true);
});

test("a listing sorts directories first and lists children lazily", async () => {
  await Fs.mkdir("/tmp", FOLDER);
  const file = name("listed");
  await Fs.write(ROOT, file, "listed\n", null, null);
  await Fs.mkdir(ROOT, "src");
  await Fs.write(ROOT, "src/main.rs", "fn main() {}\n", null, null);
  const entries = await Fs.list(ROOT, ".");
  // Other tests share this folder; the invariant is directories first, then
  // files, with our file present.
  expect(entries[0].name).toBe("src");
  expect(entries[0].kind).toBe("dir");
  const listed = entries.findIndex((row) => row.name === file);
  expect(listed).toBeGreaterThan(0);
  expect(entries[listed].kind).toBe("file");
  expect(entries[listed].size).toBe(7);
  expect(entries[listed].path.endsWith(file)).toBe(true);
  const firstFile = entries.findIndex((row) => row.kind !== "dir");
  expect(entries.slice(firstFile).every((row) => row.kind !== "dir")).toBe(true);

  const children = await Fs.list(ROOT, "src");
  expect(children.map((row) => row.name)).toEqual(["main.rs"]);
  expect(children[0].path.endsWith("/src/main.rs")).toBe(true);
  await expect(Fs.list(ROOT, file)).rejects.toMatchObject({ code: "ENOTDIR" });
});

test("a save keeps the file's content and leaves no temporary file", async () => {
  await Fs.mkdir("/tmp", FOLDER);
  const file = name("atomic");
  await Fs.write(ROOT, file, "one\n", null, null);
  await Fs.write(ROOT, file, "two\n", null, null);
  expect((await Fs.read(ROOT, file)).text).toBe("two\n");
  const entries = await Fs.list(ROOT, ".");
  expect(entries.some((row) => row.name.startsWith(".zu-"))).toBe(false);
});

test("a changed file rejects a stale save with the current version", async () => {
  await Fs.mkdir("/tmp", FOLDER);
  const file = name("stale");
  await Fs.write(ROOT, file, "mine\n", null, null);
  const read = await Fs.read(ROOT, file);

  // Somebody else writes it, changing the size.
  await Fs.write(ROOT, file, "somebody else's longer text\n", null, null);

  await expect(
    Fs.write(ROOT, file, "my save\n", { mtimeMs: read.mtimeMs, size: read.size }, null),
  ).rejects.toMatchObject({ code: "ERR_FS_STALE" });
  // Nothing was written.
  expect((await Fs.read(ROOT, file)).text).toBe("somebody else's longer text\n");

  // The current version saves.
  const current = await Fs.read(ROOT, file);
  await Fs.write(ROOT, file, "my save\n", { mtimeMs: current.mtimeMs, size: current.size }, null);
  expect((await Fs.read(ROOT, file)).text).toBe("my save\n");
});

test("a parent segment and an outside absolute path are refused", async () => {
  await Fs.mkdir("/tmp", FOLDER);
  const file = name("escape");
  await Fs.write(ROOT, file, "inside\n", null, null);
  await expect(Fs.read(ROOT, "../etc/hosts")).rejects.toMatchObject({ code: "ERR_FS_ESCAPE" });
  await expect(Fs.read(ROOT, "/etc/hosts")).rejects.toMatchObject({ code: "ERR_FS_ESCAPE" });
  await expect(Fs.write(ROOT, "../zu-m8-escape.txt", "x", null, null)).rejects.toMatchObject({
    code: "ERR_FS_ESCAPE",
  });
  await expect(Fs.write(ROOT, "/etc/zu-m8-escape.txt", "x", null, null)).rejects.toMatchObject({
    code: "ERR_FS_ESCAPE",
  });
});

test("a missing file, a relative root and a binary read are coded errors", async () => {
  await Fs.mkdir("/tmp", FOLDER);
  const binary = name("binary");
  await Fs.write(ROOT, binary, "\u0000binary", null, null);
  await expect(Fs.read(ROOT, binary)).rejects.toMatchObject({ code: "ERR_FS_BINARY" });

  await expect(Fs.read(ROOT, `zu-m8-${TAG}-missing.txt`)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(Fs.stat(ROOT, `zu-m8-${TAG}-missing.txt`)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(Fs.read("relative/root", "a.txt")).rejects.toMatchObject({ code: "ERR_FS_ROOT" });
});

test("a file over the read limit is refused with its size and limit", async () => {
  await Fs.mkdir("/tmp", FOLDER);
  const big = name("big");
  await Fs.write(ROOT, big, "a".repeat(2 * 1024 * 1024 + 1), null, null);
  await expect(Fs.read(ROOT, big)).rejects.toMatchObject({ code: "ERR_FS_TOO_LARGE" });
  const error = (await Fs.read(ROOT, big).catch((caught) => caught)) as {
    code: string;
    size: number;
    limit: number;
  };
  expect(error.code).toBe("ERR_FS_TOO_LARGE");
  expect(error.size).toBe(2 * 1024 * 1024 + 1);
  expect(error.limit).toBe(2 * 1024 * 1024);
});

test("a byte order mark comes back in the encoding and stays on a save", async () => {
  await Fs.mkdir("/tmp", FOLDER);
  const file = name("bom");
  await Fs.write(ROOT, file, "hello\n", null, "utf-8-bom");
  const read = await Fs.read(ROOT, file);
  expect(read.encoding).toBe("utf-8-bom");
  expect(read.text).toBe("hello\n");
  await Fs.write(ROOT, file, "again\n", { mtimeMs: read.mtimeMs, size: read.size }, read.encoding);
  const after = await Fs.read(ROOT, file);
  expect(after.encoding).toBe("utf-8-bom");
  expect(after.text).toBe("again\n");
  await expect(Fs.write(ROOT, file, "x", null, "latin1")).rejects.toMatchObject({
    code: "ERR_FS_ENCODING",
  });
});
