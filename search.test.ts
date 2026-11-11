import { expect, test } from "nsh/test";
import { containers } from "./containers";
import { containerMatches, sessionMatches } from "./search";
import { membership, projects } from "./projects";

// The sidebar's search: case-insensitive containment over the faces a row
// is known by. The rows themselves are the sidebar's; only the rules live
// here.

function container(id: string, patch: Record<string, unknown> = {}) {
  return {
    id,
    kind: "Pi",
    cwd: `/tmp/${id}`,
    archived: false,
    createdAt: 1,
    updatedAt: 1,
    sessions: [],
    ...patch,
  } as any;
}

test("a container matches its title, its cwd or its project's name", () => {
  projects.set([
    { id: "p1", name: "Needle Project", nameOverridden: true, roots: [], position: 0, createdAt: 1, updatedAt: 1 },
  ] as any);
  membership.set({ byProject: "p1" });
  containers.set([
    container("plain"),
    container("byTitle", { cwd: "/tmp/zzz" }),
    container("byCwd", { cwd: "/tmp/needle-cwd" }),
    container("byProject", { projectId: "p1" }),
  ]);
  expect(containers().filter((row) => containerMatches(row, "needle")).map((row) => row.id)).toEqual([
    "byCwd",
    "byProject",
  ]);
  // An empty query matches everything (the resting list).
  expect(containers().every((row) => containerMatches(row, ""))).toBe(true);
});

test("a session matches its name, preview, cwd or path", () => {
  expect(
    sessionMatches({ id: "s", name: "", preview: "", cwd: "/tmp/a", path: "/tmp/a/notes.md", created: 1, modified: 1, messageCount: 1 }, "notes"),
  ).toBe(true);
  expect(
    sessionMatches({ id: "s", name: "other", preview: "", cwd: "/tmp/a", path: "/tmp/a/notes.md", created: 1, modified: 1, messageCount: 1 }, "zzz"),
  ).toBe(false);
});
