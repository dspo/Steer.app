import { expect, test } from "nsh/test";
import {
  diffSheetId,
  diffSheetPaths,
  editorSheetId,
  editorSheetPath,
  encodePath,
  languageFor,
} from "./editors";
import { ROOT_KEY, fileRowKey, fileRows, sortEntries, type DirState } from "./file-tree";
import { panelIds, removeSheet, visiblePanels, type DockAreaLayout } from "./dock";
import {
  activeContainerId,
  containers,
  layout,
  openFilesSheet,
  setContainerTransport,
} from "./containers";
import { baseName, relativeTo } from "./fs";

// The M8 identities and tree helpers without a screen: an editor sheet id
// must survive a layout stash (a container id with colons and a path with
// spaces/non-ASCII included), the diff pair must round-trip, and the
// flattened tree must keep directories first and expansion order.

test("an editor sheet id round-trips a container id and a path", () => {
  const container = "pi:0d6a8f2e-1111-2222-3333-444455556666";
  const path = "/tmp/zu m8/notes/第 1 章.md";
  const id = editorSheetId(container, path);
  expect(id.startsWith(`editor:${container}:`)).toBe(true);
  expect(id.includes(" ")).toBe(false);
  expect(editorSheetPath(id)).toEqual({ containerId: container, path });
  const external = "external:claude:0d6a8f2e";
  expect(editorSheetPath(editorSheetId(external, "/tmp/a:b.rs"))).toEqual({
    containerId: external,
    path: "/tmp/a:b.rs",
  });
  expect(editorSheetPath("session:abc")).toBeNull();
});

test("a diff sheet id round-trips both paths", () => {
  const id = diffSheetId("pi:abc", "/tmp/old file.txt", "/tmp/新 file.txt");
  expect(diffSheetPaths(id)).toEqual({
    containerId: "pi:abc",
    oldPath: "/tmp/old file.txt",
    newPath: "/tmp/新 file.txt",
  });
  expect(diffSheetPaths("editor:pi:abc:x")).toBeNull();
});

test("encodePath only uses the base64url alphabet", () => {
  const encoded = encodePath("/tmp/a b/c~d?e&f.rs");
  expect(/^[A-Za-z0-9_-]+$/.test(encoded)).toBe(true);
});

test("the editor's language comes from the extension, else the file name", () => {
  expect(languageFor("src/main.rs")).toBe("rust");
  expect(languageFor("App.tsx")).toBe("tsx");
  expect(languageFor("README.md")).toBe("markdown");
  expect(languageFor("Cargo.toml")).toBe("toml");
  expect(languageFor("Makefile")).toBe("makefile");
  expect(languageFor("Dockerfile")).toBe("dockerfile");
  expect(languageFor("LICENSE")).toBe("LICENSE");
});

test("the tree sorts directories first and flattens expansion lazily", () => {
  const root = "/w";
  const entries = sortEntries([
    { name: "b.txt", path: `${root}/b.txt`, kind: "file", size: 2, modified: 0 },
    { name: "src", path: `${root}/src`, kind: "dir", size: 0, modified: 0 },
    { name: "A.txt", path: `${root}/A.txt`, kind: "file", size: 1, modified: 0 },
  ]);
  expect(entries.map((entry) => entry.name)).toEqual(["src", "A.txt", "b.txt"]);

  const tree: Record<string, DirState> = {
    [ROOT_KEY]: { status: "ready", entries, error: null },
    [`${root}/src`]: { status: "loading", entries: [], error: null },
  };
  const collapsed = fileRows(tree, []);
  expect(collapsed.map((row) => row.kind)).toEqual(["entry", "entry", "entry"]);
  const expanded = fileRows(tree, [`${root}/src`]);
  expect(expanded.map((row) => (row.kind === "entry" ? row.entry.name : row.kind))).toEqual([
    "src",
    "loading",
    "A.txt",
    "b.txt",
  ]);
  expect(expanded[1].kind === "loading" ? expanded[1].depth : -1).toBe(1);

  const failed = fileRows(
    {
      [ROOT_KEY]: {
        status: "ready",
        entries: [{ name: "gone", path: `${root}/gone`, kind: "dir", size: 0, modified: 0 }],
        error: null,
      },
      [`${root}/gone`]: {
        status: "error",
        entries: [],
        error: { code: "EACCES", message: "denied" },
      },
    },
    [`${root}/gone`],
  );
  expect(failed[1].kind).toBe("error");
  expect(failed.map(fileRowKey)).toEqual([
    `dir:${root}/gone`,
    `error:${root}/gone`,
  ]);
});

test("removing an editor sheet leaves the rest of the layout", () => {
  const layout: DockAreaLayout = {
    center: {
      type: "tabs",
      panels: ["files:pi:a", "editor:pi:a:b", "session:s1"],
      activeIndex: 1,
    },
  };
  const next = removeSheet(layout, "editor:pi:a:b");
  const panels = next.center.type === "tabs" ? next.center.panels : [];
  expect(panels).toEqual(["files:pi:a", "session:s1"]);
  expect(next.center.type === "tabs" ? next.center.activeIndex : -1).toBe(1);
});

test("the shell's files action opens the active container's tree sheet", () => {
  setContainerTransport(async () => ({}));
  containers.set([
    {
      id: "pi:m8-files",
      kind: "Pi",
      cwd: "/tmp",
      archived: false,
      createdAt: 0,
      updatedAt: 0,
      sessions: [],
    },
  ]);
  activeContainerId.set("pi:m8-files");
  layout.set({ center: { type: "tabs", panels: [], activeIndex: 0 } });
  openFilesSheet();
  expect(panelIds(layout())).toContain("files:pi:m8-files");
  expect(visiblePanels()).toContain("files:pi:m8-files");
});

test("paths are shown relative to the workspace", () => {
  expect(relativeTo("/tmp/w", "/tmp/w/src/main.rs")).toBe("src/main.rs");
  expect(relativeTo("/tmp/w/", "/tmp/w/src/main.rs")).toBe("src/main.rs");
  expect(baseName("/tmp/w/src/main.rs")).toBe("main.rs");
});
