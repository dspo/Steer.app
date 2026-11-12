// Vendored from dspo's AHP spec checkout (microsoft/agent-host-protocol):
//   repo:    ~/projects/github/agent-host-protocol  (remote: https://github.com/microsoft/agent-host-protocol.git)
//   commit:  296b25e7b698a4a84a0ee5a28d9573e70048a0bf  (working tree clean at vendoring time)
//   spec:    v0.9.0 (clients/typescript package.json version), LAST_SYNCED_COMMIT file said 20c6b266 (not resolvable locally)
//   pin:     contracts/ahp/PIN.md — read it before syncing; do not edit these files by hand.
// The only transform applied at vendoring time: relative import specifiers lost
// their `.js` suffix (upstream ships ESM `.js` extensions; this app resolves
// extensionless TS). Everything else is byte-identical to the pinned commit.
/**
 * Root Channel Reducer — Pure reducer for `RootState`.
 *
 * @module channels-root/reducer
 */

import { ActionType } from '../common/actions';
import type { RootState } from './state';
import type { RootAction } from '../action-origin.generated';
import { softAssertNever } from '../common/reducer-helpers';

/**
 * Pure reducer for root state. Handles all {@link RootAction} variants.
 */
export function rootReducer(state: RootState, action: RootAction, log?: (msg: string) => void): RootState {
  switch (action.type) {
    case ActionType.RootAgentsChanged:
      return { ...state, agents: action.agents };

    case ActionType.RootActiveSessionsChanged:
      return { ...state, activeSessions: action.activeSessions };

    case ActionType.RootTerminalsChanged:
      return { ...state, terminals: action.terminals };

    case ActionType.RootConfigChanged:
      if (!state.config) {
        return state;
      }
      return {
        ...state,
        config: {
          ...state.config,
          values: action.replace ? { ...action.config } : { ...state.config.values, ...action.config },
        },
      };

    default:
      softAssertNever(action, log);
      return state;
  }
}
