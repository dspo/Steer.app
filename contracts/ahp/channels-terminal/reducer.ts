// Vendored from dspo's AHP spec checkout (microsoft/agent-host-protocol):
//   repo:    ~/projects/github/agent-host-protocol  (remote: https://github.com/microsoft/agent-host-protocol.git)
//   commit:  296b25e7b698a4a84a0ee5a28d9573e70048a0bf  (working tree clean at vendoring time)
//   spec:    v0.9.0 (clients/typescript package.json version), LAST_SYNCED_COMMIT file said 20c6b266 (not resolvable locally)
//   pin:     contracts/ahp/PIN.md — read it before syncing; do not edit these files by hand.
// The only transform applied at vendoring time: relative import specifiers lost
// their `.js` suffix (upstream ships ESM `.js` extensions; this app resolves
// extensionless TS). Everything else is byte-identical to the pinned commit.
/**
 * Terminal Channel Reducer — Pure reducer for `TerminalState`.
 *
 * @module channels-terminal/reducer
 */

import { ActionType } from '../common/actions';
import type { TerminalState, TerminalContentPart } from './state';
import { TerminalLifecycleStatus } from './state';
import type { TerminalAction } from '../action-origin.generated';
import { softAssertNever } from '../common/reducer-helpers';

/**
 * Pure reducer for terminal state. Handles all {@link TerminalAction} variants.
 */
export function terminalReducer(state: TerminalState, action: TerminalAction, log?: (msg: string) => void): TerminalState {
  switch (action.type) {
    case ActionType.TerminalData: {
      const content = [...state.content];
      const tail = content.length > 0 ? content[content.length - 1] : undefined;
      if (tail && tail.type === 'command' && !tail.isComplete) {
        content[content.length - 1] = { ...tail, output: tail.output + action.data };
      } else if (tail && tail.type === 'unclassified') {
        content[content.length - 1] = { ...tail, value: tail.value + action.data };
      } else {
        content.push({ type: 'unclassified', value: action.data });
      }
      return { ...state, content };
    }

    case ActionType.TerminalInput:
      // Side-effect-only: the server forwards to the pty.
      // No state change in the reducer.
      return state;

    case ActionType.TerminalResized:
      return { ...state, cols: action.cols, rows: action.rows };

    case ActionType.TerminalClaimed:
      return { ...state, claim: action.claim };

    case ActionType.TerminalTitleChanged:
      return { ...state, title: action.title };

    case ActionType.TerminalCwdChanged:
      return { ...state, cwd: action.cwd };

    case ActionType.TerminalExited:
      return {
        ...state,
        lifecycle: {
          status: TerminalLifecycleStatus.Exited,
          exitCode: action.exitCode,
        },
      };

    case ActionType.TerminalCleared:
      return { ...state, content: [] };

    case ActionType.TerminalCommandDetectionAvailable:
      return { ...state, supportsCommandDetection: true };

    case ActionType.TerminalCommandExecuted: {
      const part: TerminalContentPart = {
        type: 'command',
        commandId: action.commandId,
        commandLine: action.commandLine,
        output: '',
        timestamp: action.timestamp,
        isComplete: false,
      };
      return {
        ...state,
        content: [...state.content, part],
        supportsCommandDetection: true,
      };
    }

    case ActionType.TerminalCommandFinished: {
      const content = state.content.map(p => {
        if (p.type === 'command' && p.commandId === action.commandId) {
          return {
            ...p,
            isComplete: true as const,
            exitCode: action.exitCode,
            durationMs: action.durationMs,
          };
        }
        return p;
      });
      return { ...state, content };
    }

    default:
      softAssertNever(action, log);
      return state;
  }
}
