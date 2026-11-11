/**
 * Zu's durable state on disk: the container registry and one layout stash
 * per container. Both live under the same state directory as the token and
 * the log (`~/.pi/zu` by default, `ZU_STATE_DIR` for tests).
 *
 * Writes are JSON snapshots with an atomic rename: a crash leaves either the
 * old file or the new one, never a half-written registry. A file from a
 * newer protocol version is read only when its shape is understood; an
 * unreadable one degrades to empty state rather than blocking startup.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ContainerLayoutData, ContainerRecord, ProjectRecord, SubagentRun } from "../../contracts/protocol";

export const REGISTRY_VERSION = 1;

export interface RunRecord {
  id: string;
  containerId: string;
  sessionId: string;
  startedAt: number;
}

export interface Registry {
  v: number;
  containers: ContainerRecord[];
  /** Volatile turn runs; cleared on startup. */
  runs: RunRecord[];
  /** Settled subagent runs; kept across restarts (live ones are in memory). */
  subagentRuns: SubagentRun[];
  activeContainerId: string | null;
}

export interface ProjectsFile {
  v: number;
  projects: ProjectRecord[];
  membership: Record<string, string | null>;
}

/** The state directory: `ZU_STATE_DIR`, else `~/.pi/zu`. */
export function stateDir(): string {
  const override = process.env.ZU_STATE_DIR?.trim();
  if (override) return override;
  return join(homedir(), ".pi", "zu");
}

export function registryPath(): string {
  return join(stateDir(), "registry.json");
}

export function layoutPath(containerId: string): string {
  return join(stateDir(), "layouts", `${encodeURIComponent(containerId)}.json`);
}

export function projectsPath(): string {
  return join(stateDir(), "projects.json");
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function atomicWrite(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(value));
  renameSync(temporary, path);
}

export function emptyRegistry(): Registry {
  return { v: REGISTRY_VERSION, containers: [], runs: [], subagentRuns: [], activeContainerId: null };
}

/**
 * Reads the registry. A missing file is an empty one; a newer version is
 * read through the fields this build knows (the object model only grew
 * optional data in v1); anything unreadable is empty.
 */
export function readRegistry(): Registry {
  const raw = readJson(registryPath());
  if (!raw || typeof raw !== "object") return emptyRegistry();
  const value = raw as Record<string, unknown>;
  const containers = Array.isArray(value.containers)
    ? value.containers.filter((entry): entry is ContainerRecord => {
        if (!entry || typeof entry !== "object") return false;
        const container = entry as Record<string, unknown>;
        return (
          typeof container.id === "string" &&
          typeof container.kind === "string" &&
          typeof container.cwd === "string" &&
          typeof container.archived === "boolean" &&
          Array.isArray(container.sessions)
        );
      })
    : [];
  const runs = Array.isArray(value.runs)
    ? value.runs.filter((entry): entry is RunRecord => {
        if (!entry || typeof entry !== "object") return false;
        const run = entry as Record<string, unknown>;
        return (
          typeof run.id === "string" &&
          typeof run.containerId === "string" &&
          typeof run.sessionId === "string" &&
          typeof run.startedAt === "number"
        );
      })
    : [];
  const subagentRuns = Array.isArray(value.subagentRuns)
    ? (value.subagentRuns as SubagentRun[]).filter((run) => !!run && typeof run.runId === "string")
    : [];
  return {
    v: typeof value.v === "number" ? value.v : REGISTRY_VERSION,
    containers,
    runs,
    subagentRuns,
    activeContainerId: typeof value.activeContainerId === "string" ? value.activeContainerId : null,
  };
}

export function writeRegistry(registry: Registry): void {
  atomicWrite(registryPath(), registry);
}

export function readLayout(containerId: string): ContainerLayoutData {
  const raw = readJson(layoutPath(containerId));
  if (!raw || typeof raw !== "object") {
    return { containerId, layout: null, zoom: null };
  }
  const value = raw as Record<string, unknown>;
  return {
    containerId,
    layout: value.layout ?? null,
    zoom: typeof value.zoom === "string" ? value.zoom : null,
    updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : undefined,
  };
}

export function writeLayout(containerId: string, layout: unknown, zoom: string | null): ContainerLayoutData {
  const record: ContainerLayoutData = { containerId, layout, zoom, updatedAt: Date.now() };
  atomicWrite(layoutPath(containerId), { v: REGISTRY_VERSION, ...record });
  return record;
}

export function emptyProjects(): ProjectsFile {
  return { v: REGISTRY_VERSION, projects: [], membership: {} };
}

/**
 * Reads `projects.json`. Membership is explicit and only ever comes from
 * here; a container absent from it is in the Chats bucket.
 */
export function readProjects(): ProjectsFile {
  const raw = readJson(projectsPath());
  if (!raw || typeof raw !== "object") return emptyProjects();
  const value = raw as Record<string, unknown>;
  const projects = Array.isArray(value.projects)
    ? value.projects.filter((entry): entry is ProjectRecord => {
        if (!entry || typeof entry !== "object") return false;
        const project = entry as Record<string, unknown>;
        return (
          typeof project.id === "string" &&
          typeof project.name === "string" &&
          Array.isArray(project.roots) &&
          project.roots.some((root: any) => root && root.primary === true)
        );
      })
    : [];
  const membership: Record<string, string | null> = {};
  if (value.membership && typeof value.membership === "object" && !Array.isArray(value.membership)) {
    for (const [containerId, projectId] of Object.entries(value.membership as Record<string, unknown>)) {
      if (projectId === null || typeof projectId === "string") membership[containerId] = projectId;
    }
  }
  return { v: REGISTRY_VERSION, projects, membership };
}

export function writeProjects(projects: ProjectsFile): void {
  atomicWrite(projectsPath(), projects);
}

/** The shell's own settings (`settings.json`): window furniture that is not
 * a container, a project or a layout. Additive: unknown keys survive a
 * write, so a newer build's settings are not lost by an older one. */
export interface SettingsFile {
  v: number;
  /** The sidebar's width in points (the shell clamps it). */
  sidebarWidth?: number;
  [key: string]: unknown;
}

export function settingsPath(): string {
  return join(stateDir(), "settings.json");
}

/** A missing file is an empty settings object; anything unreadable too. */
export function readSettings(): SettingsFile {
  const raw = readJson(settingsPath());
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { v: REGISTRY_VERSION };
  const value = raw as Record<string, unknown>;
  const settings: SettingsFile = { v: REGISTRY_VERSION, ...value };
  settings.v = typeof value.v === "number" ? value.v : REGISTRY_VERSION;
  if (value.sidebarWidth !== undefined && typeof value.sidebarWidth !== "number") {
    delete settings.sidebarWidth;
  }
  return settings;
}

/** Merges `patch` over the file and writes it atomically. */
export function writeSettings(patch: Record<string, unknown>): SettingsFile {
  const settings = { ...readSettings(), ...patch };
  atomicWrite(settingsPath(), settings);
  return settings;
}
