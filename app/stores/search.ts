import type { ContainerRecord } from "../../contracts/protocol";
import { containerTitle } from "../canvas/titles";
import { containerProject, projects } from "./projects";
import type { SessionMeta } from "./sessions";

/**
 * The sidebar's search filters, outside `shell.tsx` so the "what matches"
 * rules are testable without a window. Matching is case-insensitive
 * containment over the faces a row is known by.
 */

/** The project a container belongs to, or null for Chats. */
function containerProjectName(container: ContainerRecord): string | null {
  const id = containerProject(container);
  if (!id) return null;
  return projects().find((project) => project.id === id)?.name ?? null;
}

/** Case-insensitive containment over a container's title, cwd and project. */
export function containerMatches(container: ContainerRecord, query: string): boolean {
  const term = query.trim().toLowerCase();
  if (!term) return true;
  const faces = [containerTitle(container), container.cwd, containerProjectName(container) ?? ""];
  return faces.some((face) => face.toLowerCase().includes(term));
}

/** Case-insensitive containment over a session's title, cwd and file path. */
export function sessionMatches(session: SessionMeta, query: string): boolean {
  const term = query.trim().toLowerCase();
  if (!term) return false;
  const faces = [session.name, session.preview, session.cwd, session.path];
  return faces.some((face) => (face ?? "").toLowerCase().includes(term));
}
