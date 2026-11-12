// Vendored from dspo's AHP spec checkout (microsoft/agent-host-protocol):
//   repo:    ~/projects/github/agent-host-protocol  (remote: https://github.com/microsoft/agent-host-protocol.git)
//   commit:  296b25e7b698a4a84a0ee5a28d9573e70048a0bf  (working tree clean at vendoring time)
//   spec:    v0.9.0 (clients/typescript package.json version), LAST_SYNCED_COMMIT file said 20c6b266 (not resolvable locally)
//   pin:     contracts/ahp/PIN.md — read it before syncing; do not edit these files by hand.
// The only transform applied at vendoring time: relative import specifiers lost
// their `.js` suffix (upstream ships ESM `.js` extensions; this app resolves
// extensionless TS). Everything else is byte-identical to the pinned commit.
/**
 * Resource-Watch Channel Actions — Mutations of an `ahp-resource-watch:`
 * channel's state.
 *
 * @module channels-resource-watch/actions
 */

import { ActionType } from '../common/actions';
import type { ResourceChange } from './state';

// ─── Resource Watch Actions ──────────────────────────────────────────────────

/**
 * A batch of resource changes observed by the watcher.
 *
 * Watch events are coalesced into batches by the server to keep the
 * action stream tractable; an empty `changes.items` list MUST NOT be
 * dispatched. The reducer does not retain change history — these
 * actions exist purely to deliver events to subscribers, who consume
 * them directly off the action stream and apply their own logic.
 *
 * @category Resource Watch Actions
 * @version 1
 */
export interface ResourceWatchChangedAction {
  type: ActionType.ResourceWatchChanged;
  /** The set of changes in this batch, wrapped for forward compatibility. */
  changes: { items: ResourceChange[] };
}
