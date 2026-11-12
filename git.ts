import {
  Git,
  type GitBranches,
  type GitCommit,
  type GitDiff,
  type GitStatus,
} from "zu/native";
import { signal } from "nsh";
import { activeContainerId, containers, layout, noteSheetOpened, setLayout } from "./containers";
import { appendSheet } from "./dock";
import { editorDocs, reloadEditor } from "./editors";
import { K, t } from "./ui/i18n";

/**
 * The Changes and History sheets' data: `zu/git` in Rust owns the repository
 * work (status parsing, diffs, staging, commits, checkout) and this module is
 * the typed face plus the per-container projection the sheets render.
 *
 * Nothing here touches the engine wire or a shell: every call names the
 * container's cwd, and the Rust side runs `git` with that directory as its
 * working directory. Failures keep the native error's `code`
 * (`ERR_GIT_NOT_REPO`, `ERR_GIT_IDENTITY`, `ERR_GIT_PATH`, ...), so the sheets
 * show a specific state instead of one generic message.
 */

/** A failure from `zu/git`, with its code and the fields the module set. */
export interface GitFailure {
  code: string;
  message: string;
  /** git's own message of a failed command, without its ending newline. */
  stderr?: string;
  /** The exit status of a failed command. */
  exit?: number;
  /** A patch's size and the limit it passed (ERR_GIT_TOO_LARGE). */
  size?: number;
  limit?: number;
  /** The repository a root inside it was refused for (ERR_GIT_NOT_REPO). */
  repository?: string;
}

/** `ERR_GIT_IDENTITY`: git has no author here; the commit dialog asks. */
export const ERR_GIT_IDENTITY = "ERR_GIT_IDENTITY";
/** `ERR_GIT_NOT_REPO`: the root is not a repository's top level. */
export const ERR_GIT_NOT_REPO = "ERR_GIT_NOT_REPO";

/** The failure of `error`, keeping `zu/git`'s code when there is one. */
function gitFailure(error: unknown): GitFailure {
  const value = error as
    | {
        code?: unknown;
        message?: unknown;
        stderr?: unknown;
        exit?: unknown;
        size?: unknown;
        limit?: unknown;
        repository?: unknown;
      }
    | null
    | undefined;
  const out: GitFailure = {
    code: typeof value?.code === "string" ? value.code : "ERR_GIT_UNKNOWN",
    message: typeof value?.message === "string" ? value.message : String(error),
  };
  if (typeof value?.stderr === "string" && value.stderr) out.stderr = value.stderr;
  if (typeof value?.exit === "number") out.exit = value.exit;
  if (typeof value?.size === "number") out.size = value.size;
  if (typeof value?.limit === "number") out.limit = value.limit;
  if (typeof value?.repository === "string") out.repository = value.repository;
  return out;
}

/** What a container's Changes sheet renders. */
interface ContainerChanges {
  phase: "loading" | "ready" | "error";
  /** The last status read; kept while a refresh runs. */
  status: GitStatus | null;
  error: GitFailure | null;
}

/** What a container's History sheet renders. */
interface ContainerHistory {
  phase: "loading" | "ready" | "error";
  commits: GitCommit[];
  branches: GitBranches | null;
  error: GitFailure | null;
}

/** A one-line result of an action, shown above the sheet's list. */
export interface GitNotice {
  tone: "info" | "error";
  text: string;
}

/** Every container's changes, by container id. */
export const changes = signal<Record<string, ContainerChanges>>({});
/** Every container's log and branches, by container id. */
export const histories = signal<Record<string, ContainerHistory>>({});
/** The action a container is waiting for (`"stage"`, `"commit"`, ...). */
export const gitBusy = signal<Record<string, string | null>>({});
/** The last action's result, by container id. */
export const gitNotice = signal<Record<string, GitNotice | null>>({});

function patchChanges(id: string, next: Partial<ContainerChanges>): void {
  const current = changes()[id] ?? { phase: "loading", status: null, error: null };
  changes.set({ ...changes(), [id]: { ...current, ...next } });
}

function patchHistory(id: string, next: Partial<ContainerHistory>): void {
  const current = histories()[id] ?? { phase: "loading", commits: [], branches: null, error: null };
  histories.set({ ...histories(), [id]: { ...current, ...next } });
}

/** The container's cwd, or `null` when it has none. */
function gitRoot(containerId: string): string | null {
  const container = containers().find((row) => row.id === containerId);
  return container?.cwd ? container.cwd : null;
}

function missingRoot(containerId: string): GitFailure {
  return {
    code: "ERR_GIT_ROOT",
    message: `the container has no workspace root: ${containerId}`,
  };
}

function setNotice(containerId: string, notice: GitNotice | null): void {
  gitNotice.set({ ...gitNotice(), [containerId]: notice });
}

/** The action in flight, and a guard against starting a second one. */
function begin(containerId: string, action: string): boolean {
  if (gitBusy()[containerId]) return false;
  gitBusy.set({ ...gitBusy(), [containerId]: action });
  return true;
}

function end(containerId: string, action: string, notice: GitNotice | null): void {
  if (gitBusy()[containerId] === action) {
    gitBusy.set({ ...gitBusy(), [containerId]: null });
  }
  setNotice(containerId, notice);
}

/** Reads the container's status; a failed read is the sheet's error state. */
export async function refreshChanges(containerId: string): Promise<void> {
  const root = gitRoot(containerId);
  if (!root) {
    patchChanges(containerId, { phase: "error", status: null, error: missingRoot(containerId) });
    return;
  }
  if (!changes()[containerId]?.status) {
    patchChanges(containerId, { phase: "loading", error: null });
  }
  try {
    const status = await Git.status(root);
    patchChanges(containerId, { phase: "ready", status, error: null });
  } catch (error) {
    patchChanges(containerId, { phase: "error", status: null, error: gitFailure(error) });
  }
}

/** Reads the container's log and branches. */
export async function refreshHistory(containerId: string): Promise<void> {
  const root = gitRoot(containerId);
  if (!root) {
    patchHistory(containerId, {
      phase: "error",
      commits: [],
      branches: null,
      error: missingRoot(containerId),
    });
    return;
  }
  if (!histories()[containerId]?.branches) {
    patchHistory(containerId, { phase: "loading", error: null });
  }
  try {
    const [commits, branches] = await Promise.all([Git.log(root, 50), Git.branches(root)]);
    patchHistory(containerId, { phase: "ready", commits, branches, error: null });
  } catch (error) {
    patchHistory(containerId, {
      phase: "error",
      commits: [],
      branches: null,
      error: gitFailure(error),
    });
  }
}

/** A failure message for the sheet's banner. */
export function gitFailureText(problem: GitFailure): string {
  switch (problem.code) {
    case "ERR_GIT_NOT_REPO":
      return t(K.git.notRepo);
    case "ERR_GIT_IDENTITY":
      return t(K.git.noIdentity);
    case "ERR_GIT_TOO_LARGE":
      return t(K.git.tooLarge, { size: problem.size ?? 0, limit: problem.limit ?? 0 });
    case "ERR_GIT_PATH":
      return t(K.git.badPath);
    case "ERR_GIT_CONFLICT":
      return t(K.git.conflict);
    case "ERR_GIT_ROOT":
      return t(K.git.noRoot);
    default:
      return t(K.git.commandFailed, { message: problem.stderr ?? problem.message });
  }
}


/** Stages the paths (empty: everything), then refreshes the status. */
export async function stagePaths(containerId: string, paths: string[]): Promise<boolean> {
  const root = gitRoot(containerId);
  if (!root || !begin(containerId, "stage")) return false;
  try {
    const status = await Git.stage(root, paths);
    patchChanges(containerId, { phase: "ready", status, error: null });
    end(containerId, "stage", null);
    return true;
  } catch (error) {
    end(containerId, "stage", { tone: "error", text: gitFailureText(gitFailure(error)) });
    return false;
  }
}

/** Unstages the paths (empty: everything), then refreshes the status. */
export async function unstagePaths(containerId: string, paths: string[]): Promise<boolean> {
  const root = gitRoot(containerId);
  if (!root || !begin(containerId, "unstage")) return false;
  try {
    const status = await Git.unstage(root, paths);
    patchChanges(containerId, { phase: "ready", status, error: null });
    end(containerId, "unstage", null);
    return true;
  } catch (error) {
    end(containerId, "unstage", { tone: "error", text: gitFailureText(gitFailure(error)) });
    return false;
  }
}

/** What a commit attempt became. */
type CommitResult =
  | { ok: true; commit: GitCommit }
  | { ok: false; error: GitFailure };

/**
 * Commits the index and refreshes both sheets. `ERR_GIT_IDENTITY` comes back
 * to the caller instead of the notice line: the sheet asks for an identity,
 * then commits again.
 */
export async function commitChanges(containerId: string, message: string): Promise<CommitResult> {
  const root = gitRoot(containerId);
  if (!root) return { ok: false, error: missingRoot(containerId) };
  if (!begin(containerId, "commit")) {
    return { ok: false, error: { code: "ERR_GIT_BUSY", message: "another git action is running" } };
  }
  try {
    const commit = await Git.commit(root, message);
    await Promise.all([refreshChanges(containerId), refreshHistory(containerId)]);
    end(containerId, "commit", {
      tone: "info",
      text: t(K.git.committed, { short: commit.short }),
    });
    return { ok: true, commit };
  } catch (error) {
    const problem = gitFailure(error);
    if (problem.code !== ERR_GIT_IDENTITY) {
      end(containerId, "commit", { tone: "error", text: gitFailureText(problem) });
    } else {
      end(containerId, "commit", null);
    }
    return { ok: false, error: problem };
  }
}

/** Saves the repository's own author identity, then reports it. */
export async function setAuthorIdentity(
  containerId: string,
  name: string,
  email: string,
): Promise<boolean> {
  const root = gitRoot(containerId);
  if (!root) return false;
  try {
    await Git.setIdentity(root, name, email);
    setNotice(containerId, null);
    return true;
  } catch (error) {
    setNotice(containerId, { tone: "error", text: gitFailureText(gitFailure(error)) });
    return false;
  }
}

/**
 * Checks out a local branch, refreshes the sheets and reloads the container's
 * clean editors (a dirty editor keeps its text; its save then reports the
 * stale file, as it already does for any external write).
 */
export async function checkoutBranch(containerId: string, branch: string): Promise<boolean> {
  const root = gitRoot(containerId);
  if (!root || !begin(containerId, "checkout")) return false;
  try {
    await Git.checkout(root, branch);
    await Promise.all([refreshChanges(containerId), refreshHistory(containerId)]);
    reloadCleanEditors(containerId);
    end(containerId, "checkout", {
      tone: "info",
      text: t(K.git.checkedOut, { branch }),
    });
    return true;
  } catch (error) {
    end(containerId, "checkout", { tone: "error", text: gitFailureText(gitFailure(error)) });
    return false;
  }
}

/** Creates a branch at HEAD, checks it out and refreshes both sheets. */
export async function createBranch(containerId: string, branch: string): Promise<boolean> {
  const root = gitRoot(containerId);
  if (!root || !begin(containerId, "create")) return false;
  try {
    await Git.createBranch(root, branch);
    await Promise.all([refreshChanges(containerId), refreshHistory(containerId)]);
    reloadCleanEditors(containerId);
    end(containerId, "create", {
      tone: "info",
      text: t(K.git.created, { branch }),
    });
    return true;
  } catch (error) {
    end(containerId, "create", { tone: "error", text: gitFailureText(gitFailure(error)) });
    return false;
  }
}

/** Makes the workspace root a repository, then refreshes the Changes sheet. */
export async function initRepository(containerId: string): Promise<boolean> {
  const root = gitRoot(containerId);
  if (!root || !begin(containerId, "init")) return false;
  try {
    const status = await Git.init(root);
    patchChanges(containerId, { phase: "ready", status, error: null });
    await refreshHistory(containerId);
    end(containerId, "init", { tone: "info", text: t(K.git.initialized) });
    return true;
  } catch (error) {
    end(containerId, "init", { tone: "error", text: gitFailureText(gitFailure(error)) });
    return false;
  }
}

/** Reloads the container's editors that hold no unsaved edit. */
function reloadCleanEditors(containerId: string): void {
  for (const doc of Object.values(editorDocs())) {
    if (doc.containerId === containerId && !doc.dirty) reloadEditor(doc.sheetId);
  }
}

/** The paths staging or unstaging one change touches (a rename names both). */
export function changePaths(change: { path: string; oldPath?: string | null }): string[] {
  return change.oldPath ? [change.oldPath, change.path] : [change.path];
}

/** A file's patch, for the selected row. */
export async function loadDiff(
  containerId: string,
  path: string,
  staged: boolean,
): Promise<{ diff?: GitDiff; error?: GitFailure }> {
  const root = gitRoot(containerId);
  if (!root) return { error: missingRoot(containerId) };
  try {
    return { diff: await Git.diff(root, path, staged) };
  } catch (error) {
    return { error: gitFailure(error) };
  }
}

/** Opens (or shows) the container's Changes sheet. */
export function openChangesSheet(containerId: string | null = activeContainerId()): void {
  if (!containerId) return;
  setLayout(appendSheet(layout(), `changes:${containerId}`));
  noteSheetOpened(`changes:${containerId}`);
}

/** Opens (or shows) the container's History sheet. */
export function openHistorySheet(containerId: string | null = activeContainerId()): void {
  if (!containerId) return;
  setLayout(appendSheet(layout(), `history:${containerId}`));
  noteSheetOpened(`history:${containerId}`);
}
