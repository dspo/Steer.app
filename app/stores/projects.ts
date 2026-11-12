import { signal } from "nsh";
import { readState, writeState } from "./zu-state";
import type { ContainerRecord, ProjectRecord, ProjectsData } from "../../contracts/protocol";
import { activeCwd, send } from "./sessions";
import {
  createContainer,
  liveContainers,
  openScratch,
  setMembershipWriter,
  setProjectCwdResolver,
} from "./containers";

// The container store mints membership rows when it creates a container and
// snapshots a project's primary cwd; both facts live here. The seams avoid
// a store import cycle.
setMembershipWriter((containerId, projectId) => {
  void setContainerProject(containerId, projectId);
});
setProjectCwdResolver((projectId) => {
  const project = projects().find((row) => row.id === projectId);
  const primary = project?.roots.find((root) => root.primary) ?? project?.roots[0];
  return primary?.path ?? null;
});

/**
 * Projects and the Hero. A project owns one or more roots with exactly one
 * primary; a container's cwd is the primary's snapshot at creation, so
 * editing roots never moves a live container. Membership is explicit: a
 * container absent from the map is in Chats.
 *
 * Since the v2 writer inversion the projects file is written here, through
 * `zu/state` — the engine's `project.*` commands are not consulted. The
 * file keeps its shape (`projects.json`: projects + the membership map), so
 * an upgrade reads the engine-written file in place.
 */

export const projects = signal<ProjectRecord[]>([]);
export const membership = signal<Record<string, string | null>>({});
export const projectError = signal<string | null>(null);

type ProjectTransport = (type: string, payload?: Record<string, unknown>, timeoutMs?: number) => Promise<any>;
let transport: ProjectTransport | null = null;

/**
 * Legacy hook: when set, reads and writes still ride the given transport
 * (fixtures and old tests). Null — the default, and the packaged app —
 * uses `zu/state` directly.
 */
export function setProjectTransport(next: ProjectTransport | null): void {
  transport = next;
}

/** The project the next conversation starts in; null is Chats. */
export const heroProjectId = signal<string | null>(null);
/** Opened from a project row: the target cannot be changed in this pass. */
export const heroLocked = signal(false);
export const heroStarting = signal(false);

interface ProjectsFile {
  projects?: ProjectRecord[];
  membership?: Record<string, string | null>;
}

/** Applies a file's shape to the signals. */
function applyProjects(data: ProjectsFile | null): void {
  projects.set(data?.projects ?? []);
  membership.set(data?.membership ?? {});
}

export async function loadProjects(): Promise<void> {
  if (transport) {
    try {
      const data = (await transport("project.list", {}, 10000)) as ProjectsData;
      projects.set(data.projects ?? []);
      membership.set(data.membership ?? {});
      projectError.set(null);
    } catch (failure) {
      projectError.set(String(failure));
    }
    return;
  }
  applyProjects(await readState<ProjectsFile>("projects.json"));
  projectError.set(null);
}

/** Saves the current projects + membership through `zu/state`. */
async function saveProjects(): Promise<void> {
  await writeState("projects.json", {
    projects: projects(),
    membership: membership(),
  });
}

/** Exactly one primary root; omitted flags make the first root primary and
 * several primaries are an error. Roots stay absolute paths (the existence
 * check the engine did is the folder picker's job here). */
function normalizeRoots(roots: Array<{ path: string; primary?: boolean }>): ProjectRecord["roots"] {
  if (!Array.isArray(roots) || roots.length === 0) throw new Error("a project needs at least one root");
  const seen = new Set<string>();
  const normalized: Array<{ path: string; primary: boolean }> = [];
  let primaries = 0;
  for (const root of roots) {
    const path = String(root?.path ?? "").trim();
    if (!path || !path.startsWith("/")) throw new Error(`project root is not an absolute path: ${path}`);
    if (seen.has(path)) continue;
    seen.add(path);
    const primary = root.primary === true;
    if (primary) primaries++;
    normalized.push({ path, primary });
  }
  if (normalized.length === 0) throw new Error("a project needs at least one root");
  if (primaries > 1) throw new Error("a project has exactly one primary root");
  if (primaries === 0) normalized[0]!.primary = true;
  return normalized;
}

function primaryRootPath(project: ProjectRecord): string {
  return (project.roots.find((root) => root.primary) ?? project.roots[0]!).path;
}

function baseName(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

export async function createProject(
  name: string,
  roots: Array<{ path: string; primary?: boolean }>,
): Promise<ProjectRecord | null> {
  try {
    if (transport) {
      const data = await transport("project.create", { name, roots }, 20000);
      await loadProjects();
      projectError.set(null);
      return (data?.project as ProjectRecord) ?? null;
    }
    const normalized = normalizeRoots(roots);
    const requested = String(name ?? "").trim();
    const now = Date.now();
    const project: ProjectRecord = {
      id: `p-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      name: requested || baseName(normalized[0]!.path),
      nameOverridden: requested.length > 0,
      roots: normalized,
      position: projects().length,
      createdAt: now,
      updatedAt: now,
    };
    projects.set([...projects(), project]);
    await saveProjects();
    projectError.set(null);
    return project;
  } catch (failure) {
    projectError.set(String(failure));
    return null;
  }
}

/**
 * Renames a project or replaces its roots (the data plane behind a later
 * editor; container cwds are snapshots and do not move).
 */
export async function updateProject(
  projectId: string,
  patch: { name?: string; roots?: Array<{ path: string; primary?: boolean }> } = {},
): Promise<ProjectRecord | null> {
  try {
    const current = projects().find((project) => project.id === projectId);
    if (!current) throw new Error("project not found");
    const roots = patch.roots !== undefined ? normalizeRoots(patch.roots) : current.roots;
    const requested = patch.name === undefined ? undefined : String(patch.name).trim();
    const nameOverridden = requested !== undefined && requested.length > 0 ? true : current.nameOverridden;
    const name =
      requested !== undefined && requested.length > 0
        ? requested
        : nameOverridden
          ? current.name
          : baseName(primaryRootPath({ ...current, roots }));
    const updated: ProjectRecord = { ...current, name, nameOverridden, roots, updatedAt: Date.now() };
    projects.set(projects().map((project) => (project.id === projectId ? updated : project)));
    await saveProjects();
    return updated;
  } catch (failure) {
    projectError.set(String(failure));
    return null;
  }
}

/** Sets a container's project (null is Chats); the fold reads the map. */
export async function setContainerProject(containerId: string, projectId: string | null): Promise<void> {
  const next = { ...membership() };
  if (projectId === null) delete next[containerId];
  else next[containerId] = projectId;
  membership.set(next);
  if (!transport) await saveProjects();
}

/** A container's project, from the explicit map then the row the engine sent. */
export function containerProject(container: ContainerRecord): string | null {
  const mapped = membership()[container.id];
  if (mapped !== undefined) return mapped;
  return container.projectId ?? null;
}

/**
 * The projects in the sidebar's order: the registry's `position` ascending
 * (stable for equal positions), then `createdAt`, then the id. The list is
 * never reordered by activity: creating a container must not shuffle the
 * project groups under the pointer.
 */
export function orderedProjects(): ProjectRecord[] {
  return projects()
    .slice()
    .sort(
      (a, b) =>
        a.position - b.position ||
        a.createdAt - b.createdAt ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
}

/** The live containers of one project (null: Chats), newest activity first. */
export function containersIn(projectId: string | null): ContainerRecord[] {
  return liveContainers().filter((container) => containerProject(container) === projectId);
}

/** Opens the scratch canvas' Hero, optionally locked to a project row's
 * target. The hero is a sheet of that canvas, not a page state. */
export function openHero(projectId: string | null, locked = false): void {
  heroProjectId.set(projectId);
  heroLocked.set(locked);
  void openScratch();
}

/**
 * Starts the first conversation of a new container from a Hero. With a
 * project the primary cwd is snapshotted; without one it is Chats and the
 * previous cwd is used. A Hero inside an external (terminal/TUI) container
 * passes its own cwd and project: a Pi session cannot live there, so the
 * conversation gets a Pi container in the same workspace.
 */
export async function startFromScratch(
  text: string,
  target: { cwd?: string; projectId?: string | null } = {},
): Promise<boolean> {
  const prompt = text.trim();
  if (!prompt || heroStarting()) return false;
  heroStarting.set(true);
  try {
    const projectId = target.projectId === undefined ? heroProjectId() : target.projectId;
    // The cwd is the conversation's snapshot: an explicit one, else the
    // project's primary root, else the last active folder (Chats).
    const project = projectId ? projects().find((row) => row.id === projectId) : undefined;
    const primary = project?.roots.find((root) => root.primary) ?? project?.roots[0];
    const cwd = target.cwd ?? primary?.path ?? (projectId === null ? activeCwd() || undefined : undefined);
    const sessionId = await createContainer(cwd, projectId);
    if (!sessionId) return false;
    await loadProjects();
    await send(prompt, sessionId);
    return true;
  } catch (failure) {
    projectError.set(String(failure));
    return false;
  } finally {
    heroStarting.set(false);
  }
}
