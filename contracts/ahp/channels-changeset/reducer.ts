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
 * Changeset Channel Reducer — Pure reducer for `ChangesetState`.
 *
 * @module channels-changeset/reducer
 */

import { ActionType } from '../common/actions';
import type { ChangesetState, ChangesetFile, ChangesetOperation } from './state';
import { ChangesetStatus, ChangesetOperationStatus } from './state';
import type { ChangesetAction } from '../action-origin.generated';
import { softAssertNever } from '../common/reducer-helpers';

/**
 * Pure reducer for changeset state. Handles all {@link ChangesetAction}
 * variants.
 *
 * The reducer preserves a stable file order by appending new files via
 * {@link ActionType.ChangesetFileSet} when the id is unknown, and replacing in
 * place when it matches an existing entry. Per-file review lives on
 * {@link ChangesetFile.reviewed} and is toggled (per file, in batches) by the
 * client-dispatchable {@link ActionType.ChangesetFilesReviewChanged}.
 */
export function changesetReducer(state: ChangesetState, action: ChangesetAction, log?: (msg: string) => void): ChangesetState {
  switch (action.type) {
    case ActionType.ChangesetStatusChanged: {
      // Carry `error` only when the new status is `Error` so we don't
      // leave a stale error sitting on a recovered changeset.
      if (action.status === ChangesetStatus.Error) {
        return { ...state, status: action.status, error: action.error };
      }
      const { error: _ignored, ...rest } = state;
      return { ...rest, status: action.status };
    }

    case ActionType.ChangesetFileSet: {
      const idx = state.files.findIndex(f => f.id === action.file.id);
      if (idx < 0) {
        return { ...state, files: [...state.files, action.file] };
      }
      const next: ChangesetFile[] = [...state.files];
      next[idx] = action.file;
      return { ...state, files: next };
    }

    case ActionType.ChangesetFileRemoved: {
      const idx = state.files.findIndex(f => f.id === action.fileId);
      if (idx < 0) {
        return state;
      }
      const next: ChangesetFile[] = [...state.files];
      next.splice(idx, 1);
      return { ...state, files: next };
    }

    case ActionType.ChangesetFilesReviewChanged: {
      let changed = false;
      const ids = new Set(action.files);
      const next: ChangesetFile[] = state.files.map(f => {
        if (!ids.has(f.id) || f.reviewed === action.reviewed) {
          return f;
        }
        changed = true;
        return { ...f, reviewed: action.reviewed };
      });
      return changed ? { ...state, files: next } : state;
    }

    case ActionType.ChangesetContentChanged: {
      return action.operations === undefined
        ? { ...state, files: action.files }
        : { ...state, files: action.files, operations: action.operations };
    }

    case ActionType.ChangesetOperationsChanged: {
      if (action.operations === undefined) {
        const { operations: _ignored, ...rest } = state;
        return rest;
      }
      return { ...state, operations: action.operations };
    }

    case ActionType.ChangesetOperationStatusChanged: {
      if (state.operations === undefined) {
        return state;
      }
      const idx = state.operations.findIndex(o => o.id === action.operationId);
      if (idx < 0) {
        return state;
      }
      const current = state.operations[idx];
      // Carry `error` only when the new status is `Error` so we don't leave
      // a stale error on an operation that recovered or started running.
      let nextOp: ChangesetOperation;
      if (action.status === ChangesetOperationStatus.Error) {
        nextOp = { ...current, status: action.status, error: action.error };
      } else {
        const { error: _ignored, ...rest } = current;
        nextOp = { ...rest, status: action.status };
      }
      const next: ChangesetOperation[] = [...state.operations];
      next[idx] = nextOp;
      return { ...state, operations: next };
    }

    case ActionType.ChangesetCleared:
      if (state.files.length === 0) {
        return state;
      }
      return { ...state, files: [] };

    default:
      softAssertNever(action, log);
      return state;
  }
}
