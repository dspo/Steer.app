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
 * Automation Run Channel Reducer.
 *
 * @module channels-automation-run/reducer
 */

import type { AutomationRunAction } from '../action-origin.generated';
import { ActionType } from '../common/actions';
import { softAssertNever } from '../common/reducer-helpers';
import type { AutomationRunState } from './state';

/** Pure reducer for automation-run state. */
export function automationRunReducer(state: AutomationRunState, action: AutomationRunAction, log?: (msg: string) => void): AutomationRunState {
  switch (action.type) {
    case ActionType.AutomationRunLifecycleChanged:
      return { ...state, lifecycle: action.lifecycle };

    case ActionType.AutomationRunSessionSet:
      if (state.sessions.includes(action.session)) {
        return state;
      }
      return { ...state, sessions: [...state.sessions, action.session] };

    case ActionType.AutomationRunSessionRemoved: {
      const index = state.sessions.indexOf(action.session);
      if (index < 0) {
        return state;
      }
      const sessions = state.sessions.slice();
      sessions.splice(index, 1);
      const next: AutomationRunState = { ...state, sessions };
      if (state.primarySession === action.session) {
        delete next.primarySession;
      }
      return next;
    }

    case ActionType.AutomationRunPrimarySessionChanged: {
      const next: AutomationRunState = { ...state };
      if (action.primarySession === undefined) {
        delete next.primarySession;
      } else {
        next.primarySession = action.primarySession;
      }
      return next;
    }

    case ActionType.AutomationRunCancelRequested:
      return state;

    default:
      softAssertNever(action, log);
      return state;
  }
}
