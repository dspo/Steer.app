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
 * Terminal Channel Commands — `createTerminal` and `disposeTerminal`.
 *
 * @module channels-terminal/commands
 */

import type { URI } from '../common/state';
import type { BaseParams } from '../common/commands';
import type { TerminalClaim } from './state';

// ─── createTerminal ──────────────────────────────────────────────────────────

/**
 * Creates a new terminal on the server.
 *
 * After creation, the client should subscribe to the terminal URI to receive
 * state updates. The server dispatches `root/terminalsChanged` to update the
 * root terminal list.
 *
 * @category Commands
 * @method createTerminal
 * @direction Client → Server
 * @messageType Request
 * @version 1
 */
export interface CreateTerminalParams extends BaseParams {
  /** Terminal URI (client-chosen). */
  channel: URI;
  /** Initial owner of the terminal */
  claim: TerminalClaim;
  /** Human-readable terminal name */
  name?: string;
  /** Initial working directory URI */
  cwd?: URI;
  /** Initial terminal width in columns */
  cols?: number;
  /** Initial terminal height in rows */
  rows?: number;
}

// ─── disposeTerminal ─────────────────────────────────────────────────────────

/**
 * Disposes a terminal and kills its process if still running.
 *
 * The server dispatches `root/terminalsChanged` to remove the terminal from
 * the root terminal list.
 *
 * @category Commands
 * @method disposeTerminal
 * @direction Client → Server
 * @messageType Request
 * @version 1
 */
export interface DisposeTerminalParams extends BaseParams {}
