// Vendored from dspo's AHP spec checkout (microsoft/agent-host-protocol):
//   repo:    ~/projects/github/agent-host-protocol  (remote: https://github.com/microsoft/agent-host-protocol.git)
//   commit:  296b25e7b698a4a84a0ee5a28d9573e70048a0bf  (working tree clean at vendoring time)
//   spec:    v0.9.0 (clients/typescript package.json version), LAST_SYNCED_COMMIT file said 20c6b266 (not resolvable locally)
//   pin:     contracts/ahp/PIN.md — read it before syncing; do not edit these files by hand.
// The only transform applied at vendoring time: relative import specifiers lost
// their `.js` suffix (upstream ships ESM `.js` extensions; this app resolves
// extensionless TS). A second transform (contracts/ahp/enums-to-consts.py,
// see PIN.md) rewrites `export const enum` into const objects + unions +
// namespaces: the nsh bundler's oxc cannot transform TS enums. Everything
// else is byte-identical to the pinned commit.
/**
 * Root Channel Actions — Mutations of the `ahp-root://` state.
 *
 * @module channels-root/actions
 */

import type { AgentInfo } from './state';
import type { TerminalInfo } from '../channels-terminal/state';
import { ActionType } from '../common/actions';

// ─── Root Actions ────────────────────────────────────────────────────────────

/**
 * Fired when available agent backends or their models change.
 *
 * @category Root Actions
 * @version 1
 */
export interface RootAgentsChangedAction {
  type: ActionType.RootAgentsChanged;
  /** Updated agent list */
  agents: AgentInfo[];
}

/**
 * Fired when the number of active sessions changes.
 *
 * @category Root Actions
 * @version 1
 */
export interface RootActiveSessionsChangedAction {
  type: ActionType.RootActiveSessionsChanged;
  /** Current count of active sessions */
  activeSessions: number;
}

/**
 * Fired when the list of known terminals changes.
 *
 * Full-replacement semantics: the `terminals` array replaces the previous
 * `terminals` entirely.
 *
 * @category Root Actions
 * @version 1
 */
export interface RootTerminalsChangedAction {
  type: ActionType.RootTerminalsChanged;
  /** Updated terminal list (full replacement) */
  terminals: TerminalInfo[];
}

/**
 * Fired when agent-host configuration values change.
 *
 * By default, the reducer merges the new values into `state.config.values`.
 * Set `replace` to `true` to replace all values instead of merging.
 *
 * @category Root Actions
 * @version 1
 * @clientDispatchable
 */
export interface RootConfigChangedAction {
  type: ActionType.RootConfigChanged;
  /** Updated config values */
  config: Record<string, unknown>;
  /** When `true`, replaces all config values instead of merging */
  replace?: boolean;
}
