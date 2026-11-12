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
 * Annotations Channel Reducer — Pure reducer for `AnnotationsState`.
 *
 * @module channels-annotations/reducer
 */

import { ActionType } from '../common/actions';
import type { AnnotationEntry, Annotation, AnnotationsState } from './state';
import type { AnnotationsAction } from '../action-origin.generated';
import { softAssertNever } from '../common/reducer-helpers';

/**
 * Pure reducer for annotations state. Handles every {@link AnnotationsAction}
 * variant.
 *
 * Per the spec, every annotations action is client-dispatchable; the reducer
 * runs identically on the client (optimistic, write-ahead) and the server. It
 * preserves the dispatch order of annotations (and of entries within an
 * annotation): new entries are appended; `*Set` actions with a matching id
 * replace in place, while actions whose target id is unknown are no-ops
 * (mirroring `changeset/fileRemoved` semantics). The single-entry
 * minimum invariant is enforced by producers, not the reducer — removing an
 * annotation's last entry via {@link AnnotationsEntryRemovedAction} (instead
 * of {@link AnnotationsRemovedAction}) would leave an empty annotation,
 * which is observable but not catastrophic.
 */
export function annotationsReducer(state: AnnotationsState, action: AnnotationsAction, log?: (msg: string) => void): AnnotationsState {
  switch (action.type) {
    case ActionType.AnnotationsSet: {
      const idx = state.annotations.findIndex(t => t.id === action.annotation.id);
      if (idx < 0) {
        return { ...state, annotations: [...state.annotations, action.annotation] };
      }
      const next: Annotation[] = [...state.annotations];
      next[idx] = action.annotation;
      return { ...state, annotations: next };
    }

    case ActionType.AnnotationsUpdated: {
      const idx = state.annotations.findIndex(t => t.id === action.annotationId);
      if (idx < 0) {
        return state;
      }
      const annotation = state.annotations[idx];
      const updated: Annotation = { ...annotation };
      if (action.origin !== undefined) {
        updated.origin = action.origin;
      }
      if (action.resource !== undefined) {
        updated.resource = action.resource;
      }
      if (action.range !== undefined) {
        updated.range = action.range;
      }
      if (action.resolved !== undefined) {
        updated.resolved = action.resolved;
      }
      const next: Annotation[] = [...state.annotations];
      next[idx] = updated;
      return { ...state, annotations: next };
    }

    case ActionType.AnnotationsRemoved: {
      const idx = state.annotations.findIndex(t => t.id === action.annotationId);
      if (idx < 0) {
        return state;
      }
      const next: Annotation[] = [...state.annotations];
      next.splice(idx, 1);
      return { ...state, annotations: next };
    }

    case ActionType.AnnotationsEntrySet: {
      const tIdx = state.annotations.findIndex(t => t.id === action.annotationId);
      if (tIdx < 0) {
        return state;
      }
      const annotation = state.annotations[tIdx];
      const cIdx = annotation.entries.findIndex(c => c.id === action.entry.id);
      let nextEntries: AnnotationEntry[];
      if (cIdx < 0) {
        nextEntries = [...annotation.entries, action.entry];
      } else {
        nextEntries = [...annotation.entries];
        nextEntries[cIdx] = action.entry;
      }
      const nextAnnotations: Annotation[] = [...state.annotations];
      nextAnnotations[tIdx] = { ...annotation, entries: nextEntries };
      return { ...state, annotations: nextAnnotations };
    }

    case ActionType.AnnotationsEntryRemoved: {
      const tIdx = state.annotations.findIndex(t => t.id === action.annotationId);
      if (tIdx < 0) {
        return state;
      }
      const annotation = state.annotations[tIdx];
      const cIdx = annotation.entries.findIndex(c => c.id === action.entryId);
      if (cIdx < 0) {
        return state;
      }
      const nextEntries: AnnotationEntry[] = [...annotation.entries];
      nextEntries.splice(cIdx, 1);
      const nextAnnotations: Annotation[] = [...state.annotations];
      nextAnnotations[tIdx] = { ...annotation, entries: nextEntries };
      return { ...state, annotations: nextAnnotations };
    }

    default:
      softAssertNever(action, log);
      return state;
  }
}
