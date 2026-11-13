import { sheetOrder } from "../core/containers";
import { sheetNamesContainer, sheetTitle } from "./sheets";
import type { ContainerRecord } from "../core/types";

/**
 * A container's title: the **earliest-created surviving sheet's** title.
 * Closing the first tab promotes the second instead of leaving a name with
 * nothing behind it. Each kind names itself through the module registry; a
 * kind may decline (an unnamed session says nothing), and the Hero never
 * names a container (every start page would read the same).
 */
/** The last path segment. */
function baseName(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

export function containerTitle(container: ContainerRecord): string {
  for (const id of sheetOrder()[container.id] ?? []) {
    if (id.startsWith("home:")) continue;
    if (!sheetNamesContainer(id)) continue;
    const title = sheetTitle(id).trim();
    if (title && title !== id) return title;
  }
  return baseName(container.cwd) || container.id.slice(0, 8);
}
