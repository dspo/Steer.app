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
 * Resource-Watch Channel Commands — `createResourceWatch`.
 *
 * @module channels-resource-watch/commands
 */

import type { URI } from '../common/state';
import type { BaseParams } from '../common/commands';

// ─── createResourceWatch ─────────────────────────────────────────────────────

/**
 * Creates a resource watcher on the receiver's filesystem.
 *
 * The receiver allocates an `ahp-resource-watch:/<id>` channel URI and
 * returns it on {@link CreateResourceWatchResult.channel}. The caller then
 * [`subscribe`](/specification/subscriptions#subscribe-request)s to that channel to receive
 * `resourceWatch/changed` actions over the standard action envelope.
 *
 * The watch lifecycle is tied to subscription: when every subscriber has
 * unsubscribed (or the underlying connection drops), the receiver MUST
 * release the watcher. There is no explicit dispose command — `unsubscribe`
 * is the only handle the caller needs.
 *
 * Like the rest of the `resource*` family, `createResourceWatch` is
 * symmetrical and MAY be sent in either direction. Access is gated through
 * the same permission flow as `resourceRead`/`resourceWrite`.
 *
 * @category Commands
 * @method createResourceWatch
 * @direction Client ↔ Server
 * @messageType Request
 * @version 1
 * @throws `NotFound` (`-32008`) if `uri` does not exist.
 * @throws `PermissionDenied` (`-32009`) if the caller is not permitted to watch the URI.
 * @example
 * ```jsonc
 * // Client → Server
 * { "jsonrpc": "2.0", "id": 30, "method": "createResourceWatch",
 *   "params": {
 *     "channel": "ahp-root://",
 *     "uri": "file:///workspace",
 *     "recursive": true,
 *     "excludes": { "items": ["**\u002f.git/**", "**\u002fnode_modules/**"] }
 *   } }
 *
 * // Server → Client
 * { "jsonrpc": "2.0", "id": 30, "result": {
 *   "channel": "ahp-resource-watch:/d3a9f1e0-…"
 * } }
 * ```
 */
export interface CreateResourceWatchParams extends BaseParams {
  channel: 'ahp-root://';
  /** URI to watch. */
  uri: URI;
  /**
   * If `true`, the receiver MUST report changes for descendants of `uri`.
   * If `false` (default), only changes to `uri` itself — and, when `uri`
   * is a directory, its direct children — are reported.
   */
  recursive?: boolean;
  /**
   * Glob patterns or paths relative to `uri` to exclude from reporting.
   * Wrapped in `{ items }` for forward compatibility.
   */
  excludes?: { items: string[] };
  /**
   * Glob patterns or paths relative to `uri` to restrict reporting to.
   * Omit to report every change under `uri` subject to `excludes`.
   * Wrapped in `{ items }` for forward compatibility.
   */
  includes?: { items: string[] };
}

/**
 * Result of the `createResourceWatch` command.
 */
export interface CreateResourceWatchResult {
  /**
   * Receiver-assigned watch channel URI (`ahp-resource-watch:/<id>`). The
   * caller subscribes to this URI to start receiving change events and
   * unsubscribes to release the watcher.
   */
  channel: URI;
}
