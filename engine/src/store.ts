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
import type { ContainerLayoutData, ContainerRecord } from "../../contracts/protocol";

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
  runs: RunRecord[];
  activeContainerId: string | null;
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
  return { v: REGISTRY_VERSION, containers: [], runs: [], activeContainerId: null };
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
  return {
    v: typeof value.v === "number" ? value.v : REGISTRY_VERSION,
    containers,
    runs,
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
