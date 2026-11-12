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
 * Resource-Watch Channel State Types — Per-watch state exposed on
 * `ahp-resource-watch:` channels.
 *
 * Stability: 2 - Stable
 *
 * @module channels-resource-watch/state
 */

import type { URI } from '../common/state';

// ─── Resource Watch Types ────────────────────────────────────────────────────

/**
 * Full state for a single resource watch, returned when a client subscribes
 * to an `ahp-resource-watch:` URI.
 *
 * Watches are otherwise stateless: the watcher exists to deliver
 * {@link ResourceWatchChangedAction} events. The state carries only the
 * descriptor of what is being watched so a re-subscribing client can
 * recover the watch configuration after reconnecting.
 *
 * @category Resource Watch Types
 */
export interface ResourceWatchState {
  /**
   * The URI being watched. For recursive watches this is the root of the
   * subtree; for non-recursive watches this is the single file or
   * directory.
   */
  root: URI;
  /**
   * `true` if the watcher reports changes for descendants of `root`;
   * `false` if it only reports changes to `root` itself (and, when
   * `root` is a directory, its direct children).
   */
  recursive: boolean;
  /**
   * Optional glob patterns or paths relative to `root` to exclude from
   * change reporting.
   */
  excludes?: { items: string[] };
  /**
   * Optional glob patterns or paths relative to `root` to restrict
   * change reporting to. Omit to report every change under `root`
   * subject to `excludes`.
   */
  includes?: { items: string[] };
}

// ─── Resource Change ─────────────────────────────────────────────────────────

/**
 * Discriminant for {@link ResourceChange.type}.
 *
 * @category Resource Watch Types
 * @exhaustive
 */
export const ResourceChangeType = {

  Added: 'added',
  Updated: 'updated',
  Deleted: 'deleted',
} as const;
export type ResourceChangeType = (typeof ResourceChangeType)[keyof typeof ResourceChangeType];
export namespace ResourceChangeType {
  export type Added = (typeof ResourceChangeType)["Added"];
  export type Updated = (typeof ResourceChangeType)["Updated"];
  export type Deleted = (typeof ResourceChangeType)["Deleted"];
}

/**
 * A single change observed by a resource watcher.
 *
 * @category Resource Watch Types
 */
export interface ResourceChange {
  /** The URI of the resource that changed. */
  uri: URI;
  /** The kind of change observed. */
  type: ResourceChangeType;
}
