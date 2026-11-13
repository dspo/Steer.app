/**
 * The relationship model's own types (docs/sheet-module-ARCHITECTURE.md §3):
 * a container is an organizational unit — a working directory, a project and
 * a view stash — and carries **no harness identity**. Which sheets it holds
 * (and therefore which harness it talks to) is entirely in the layout and the
 * registered module kinds.
 */

/** One container. Archived rows stay (Q34) but leave the sidebar. */
export interface ContainerRecord {
  id: string;
  /** The workspace snapshot: the cwd the container was created with. */
  cwd: string;
  /** Explicit project membership; absent means Chats. */
  projectId?: string | null;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
  /** The container's sheets in creation order (drives its title). Persisted
   * so a container that was never shown this run still names itself. */
  sheetOrder?: string[];
}

/** A project's root. */
export interface ProjectRoot {
  path: string;
  primary: boolean;
}

/** One project. */
export interface ProjectRecord {
  id: string;
  name: string;
  nameOverridden: boolean;
  roots: ProjectRoot[];
  position: number;
  createdAt: number;
  updatedAt: number;
}

/** One container's stashed view. */
export interface ContainerLayoutData {
  containerId: string;
  layout: unknown;
  zoom: string | null;
  updatedAt: number;
}

/** What a fixture transport answers for a container listing. */
export interface ContainerListData {
  containers: ContainerRecord[];
  activeContainerId: string | null;
}

/** Settings the shell stores in `zu/settings.json`. */
export interface SettingsData {
  sidebarWidth?: number;
  [key: string]: unknown;
}
