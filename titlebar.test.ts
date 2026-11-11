import { expect, test } from "nsh/test";
import { containers } from "./containers";
import { membership, orderedProjects, projects } from "./projects";
import { pickerCandidates, vscodeUrl } from "./titlebar";

function container(id: string, updatedAt: number, patch: Record<string, unknown> = {}) {
  return {
    id,
    kind: "Pi",
    cwd: `/tmp/${id}`,
    archived: false,
    createdAt: 1,
    updatedAt,
    sessions: [],
    ...patch,
  } as any;
}

test("the picker lists the ten most recent live containers", () => {
  containers.set(
    Array.from({ length: 14 }, (_, index) => container(`c${String(index).padStart(2, "0")}`, index)),
  );
  const picked = pickerCandidates("");
  expect(picked.length).toBe(10);
  expect(picked[0].id).toBe("c13");
  expect(picked[9].id).toBe("c04");
});

test("the picker filters before the cap, by title, cwd and project", () => {
  projects.set([
    { id: "p1", name: "Needle Project", nameOverridden: true, roots: [], position: 0, createdAt: 1, updatedAt: 1 },
  ] as any);
  membership.set({});
  containers.set([
    ...Array.from({ length: 10 }, (_, index) => container(`filler-${index}`, 1000 - index)),
    container("needle-cwd", 5, { cwd: "/tmp/needle" }),
    container("needle-project", 4, { projectId: "p1" }),
    container("archived-needle", 1, { archived: true, cwd: "/tmp/needle" }),
  ]);
  const ids = pickerCandidates("needle").map((row) => row.id);
  expect(ids).toEqual(["needle-cwd", "needle-project"]);
});

test("the picker orders equal stamps by id and leaves archived rows out", () => {
  containers.set([
    container("b", 10),
    container("a", 10),
    container("gone", 20, { archived: true }),
  ]);
  expect(pickerCandidates("").map((row) => row.id)).toEqual(["a", "b"]);
});

test("projects keep the registry's position order", () => {
  projects.set([
    { id: "late", name: "Late", nameOverridden: true, roots: [], position: 2, createdAt: 1, updatedAt: 1 },
    { id: "early", name: "Early", nameOverridden: true, roots: [], position: 0, createdAt: 1, updatedAt: 1 },
    { id: "middle", name: "Middle", nameOverridden: true, roots: [], position: 1, createdAt: 1, updatedAt: 1 },
  ] as any);
  expect(orderedProjects().map((row) => row.id)).toEqual(["early", "middle", "late"]);
});

test("the VS Code URL is the vscode scheme over the absolute path", () => {
  expect(vscodeUrl("/Users/me/My Project")).toBe("vscode://file/Users/me/My%20Project?windowId=_blank");
  expect(vscodeUrl("relative/root")).toBe("vscode://file/relative/root?windowId=_blank");
});
