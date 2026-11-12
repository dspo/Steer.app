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
 * Automation Catalogue Channel Reducer.
 *
 * @module channels-automation/reducer
 */

import type { AutomationAction } from '../action-origin.generated';
import { ActionType } from '../common/actions';
import { softAssertNever } from '../common/reducer-helpers';
import type { AutomationState } from './state';

/** Pure reducer for automation catalogue state. */
export function automationReducer(state: AutomationState, action: AutomationAction, log?: (msg: string) => void): AutomationState {
  switch (action.type) {
    case ActionType.AutomationCreateRequested:
    case ActionType.AutomationUpdateRequested:
      return state;

    case ActionType.AutomationSet: {
      const idx = state.entries.findIndex(automation => automation.resource === action.automation.resource);
      if (idx < 0) {
        return {
          ...state,
          entries: [...state.entries, action.automation],
        };
      }
      const entries = state.entries.slice();
      entries[idx] = action.automation;
      return { ...state, entries };
    }

    case ActionType.AutomationRemoved: {
      const idx = state.entries.findIndex(automation => automation.resource === action.resource);
      if (idx < 0) {
        return state;
      }
      const entries = state.entries.slice();
      entries.splice(idx, 1);
      return { ...state, entries };
    }

    default:
      softAssertNever(action, log);
      return state;
  }
}
