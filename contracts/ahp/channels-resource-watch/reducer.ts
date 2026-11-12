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
 * Resource-Watch Channel Reducer — Pure reducer for `ResourceWatchState`.
 *
 * @module channels-resource-watch/reducer
 */

import { ActionType } from '../common/actions';
import type { ResourceWatchState } from './state';
import type { ResourceWatchAction } from '../action-origin.generated';

/**
 * Pure reducer for resource-watch state. Handles every
 * {@link ResourceWatchAction} variant.
 *
 * Watches are intentionally event-pass-through: change events are
 * delivered via `resourceWatch/changed` actions but the reducer keeps no
 * history of them. The state therefore tracks only the watch descriptor,
 * which is set at subscription time and never mutates over the life of
 * the watch.
 *
 * The reducer uses an `if`/else shape rather than `switch`/`softAssertNever`
 * because `ResourceWatchAction` currently has a single variant — TypeScript
 * does not narrow single-variant discriminated unions to `never` after the
 * sole case branch, so the usual exhaustiveness pattern would not compile.
 * Unknown action types degrade gracefully (mirroring `softAssertNever`'s
 * runtime behaviour) so a client speaking an older protocol stays correct
 * if the server adds new `resourceWatch/*` actions in a future version.
 */
export function resourceWatchReducer(state: ResourceWatchState, action: ResourceWatchAction, log?: (msg: string) => void): ResourceWatchState {
  if (action.type === ActionType.ResourceWatchChanged) {
    return state;
  }

  (log ?? console.warn)(`Unhandled action type: ${JSON.stringify(action)}`);
  return state;
}
