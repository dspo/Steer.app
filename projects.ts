import { signal } from "nsh";
import { request } from "./engine";
import type { ContainerRecord, ProjectRecord, ProjectsData } from "./contracts/protocol";
import { activeCwd, send } from "./sessions";
import {
  createContainer,
  liveContainers,
  openScratch,
} from "./containers";

/**
 * Projects and the Hero. A project owns one or more roots with exactly one
 * primary; a container's cwd is the primary's snapshot at creation, so
 * editing roots never moves a live container. Membership is explicit: a
 * container absent from the map is in Chats.
 */

export const projects = signal<ProjectRecord[]>([]);
export const membership = signal<Record<string, string | null>>({});
export const projectError = signal<string | null>(null);

type ProjectTransport = (type: string, payload?: Record<string, unknown>, timeoutMs?: number) => Promise<any>;
let transport: ProjectTransport = request;

/** Replaces the engine transport (tests drive the store without a sidecar). */
export function setProjectTransport(next: ProjectTransport | null): void {
  transport = next ?? request;
}

/** The project the next conversation starts in; null is Chats. */
export const heroProjectId = signal<string | null>(null);
/** Opened from a project row: the target cannot be changed in this pass. */
export const heroLocked = signal(false);
export const heroStarting = signal(false);

export async function loadProjects(): Promise<void> {
  try {
    const data = (await transport("project.list", {}, 10000)) as ProjectsData;
    projects.set(data.projects ?? []);
    membership.set(data.membership ?? {});
    projectError.set(null);
  } catch (failure) {
    projectError.set(String(failure));
  }
}

export async function createProject(
  name: string,
  roots: Array<{ path: string; primary?: boolean }>,
): Promise<ProjectRecord | null> {
  try {
    const data = await transport("project.create", { name, roots }, 20000);
    await loadProjects();
    projectError.set(null);
    return (data?.project as ProjectRecord) ?? null;
  } catch (failure) {
    projectError.set(String(failure));
    return null;
  }
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
 * project the engine snapshots the primary cwd; without one it is Chats and
 * the previous cwd (or the engine's) is used. A Hero inside an external
 * (terminal/TUI) container passes its own cwd and project: a Pi session
 * cannot live there, so the conversation gets a Pi container in the same
 * workspace.
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
    const cwd = target.cwd ?? (projectId === null ? activeCwd() || undefined : undefined);
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

/** The label a project chip shows. */
export function projectName(id: string | null): string {
  if (id === null) return "Chats";
  return projects().find((project) => project.id === id)?.name ?? "Project";
}
