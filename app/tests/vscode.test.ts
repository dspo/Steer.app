import { expect, test } from "nsh/test";
import { activeContainerId, containers } from "../core/containers";
import { containerProject, membership, projects } from "../core/projects";
import { vscodeTarget, vscodeUrl } from "../shell/vscode";

// The "open in VS Code" action's rules: which folder it names and what the
// URL looks like. The target follows the active container's project.

function container(id: string, cwd: string, projectId?: string) {
  return {
    id,
    kind: "Pi",
    cwd,
    archived: false,
    createdAt: 1,
    updatedAt: 1,
    projectId: projectId ?? null,
    sessions: [],
  } as any;
}

test("the VS Code URL is the vscode scheme over the absolute path", () => {
  expect(vscodeUrl("/Users/me/My Project")).toBe("vscode://file/Users/me/My%20Project?windowId=_blank");
  expect(vscodeUrl("relative/root")).toBe("vscode://file/relative/root?windowId=_blank");
});

test("the target is the active project's primary root, else the container's cwd", () => {
  projects.set([
    {
      id: "p1",
      name: "P1",
      nameOverridden: true,
      roots: [{ path: "/tmp/second", primary: false }, { path: "/tmp/primary", primary: true }],
      position: 0,
      createdAt: 1,
      updatedAt: 1,
    },
  ] as any);
  activeContainerId.set("c1");
  membership.set({ c1: "p1" });
  containers.set([container("c1", "/tmp/fallback", "p1")]);
  expect(vscodeTarget()).toBe("/tmp/primary");

  // No project (Chats): the container's cwd.
  membership.set({ c1: null });
  containers.set([container("c1", "/tmp/chats")]);
  expect(vscodeTarget()).toBe("/tmp/chats");

  // Nothing active: no target, and the action reports it.
  containers.set([]);
  expect(vscodeTarget()).toBeNull();
});

test("the project a row names is the explicit membership's", () => {
  membership.set({ c1: "p1" });
  containers.set([container("c1", "/tmp/a", "p1")]);
  expect(containerProject(containers()[0])).toBe("p1");
});
