import {
  Git,
  type GitBranches,
  type GitChange,
  type GitCommit,
  type GitDiff,
  type GitStatus,
} from "zu/native";

/**
 * The git capability's typed face (docs/sheet-module-ARCHITECTURE.md §5):
 * plain calls that name the repository root. The projection, the busy/notice
 * state and the two sheets live in the git module.
 */
export type { GitBranches, GitChange, GitCommit, GitDiff, GitStatus } from "zu/native";

export const gitStatus = (root: string): Promise<GitStatus> => Git.status(root);
export const gitLog = (root: string, limit: number): Promise<GitCommit[]> => Git.log(root, limit);
export const gitBranches = (root: string): Promise<GitBranches> => Git.branches(root);
export const gitDiff = (root: string, path: string, staged: boolean): Promise<GitDiff> => Git.diff(root, path, staged);
export const gitStage = (root: string, paths: string[]): Promise<GitStatus> => Git.stage(root, paths);
export const gitUnstage = (root: string, paths: string[]): Promise<GitStatus> => Git.unstage(root, paths);
export const gitCommit = (root: string, message: string): Promise<GitCommit> => Git.commit(root, message);
export const gitSetIdentity = (root: string, name: string, email: string): Promise<unknown> => Git.setIdentity(root, name, email);
export const gitCheckout = (root: string, branch: string): Promise<unknown> => Git.checkout(root, branch);
export const gitCreateBranch = (root: string, branch: string): Promise<unknown> => Git.createBranch(root, branch);
export const gitInit = (root: string): Promise<GitStatus> => Git.init(root);
