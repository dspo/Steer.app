/**
 * Host services a module may need but the shell owns (opening the sidebar's
 * search, the project-creation dialog). The shell installs them once; modules
 * read them through this seam instead of importing `shell/`.
 */
export interface ShellActions {
  openSidebarSearch: () => void;
  openProjectDialog: (onCreated?: (project: import("./types").ProjectRecord) => void) => void;
}

let actions: ShellActions | null = null;

export function setShellActions(next: ShellActions | null): void {
  actions = next;
}

export function shellActions(): ShellActions | null {
  return actions;
}
