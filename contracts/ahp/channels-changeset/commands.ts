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
 * Changeset Channel Commands — `invokeChangesetOperation`.
 *
 * @module channels-changeset/commands
 */

import type { URI, ContentRef, StringOrMarkdown, TextRange } from '../common/state';
import type { BaseParams } from '../common/commands';

// ─── invokeChangesetOperation ────────────────────────────────────────────────

/**
 * Discriminator for {@link ChangesetOperationTarget}. Mirrors the
 * non-`Changeset` members of {@link ChangesetOperationScope} — the
 * `Changeset` scope has no target.
 *
 * @category Commands
 * @nonexhaustive
 */
export const ChangesetOperationTargetKind = {

  /** Operation acts on a single file. */
  Resource: 'resource',
  /** Operation acts on a line range within a single file. */
  Range: 'range',
} as const;
export type ChangesetOperationTargetKind = (typeof ChangesetOperationTargetKind)[keyof typeof ChangesetOperationTargetKind];
export namespace ChangesetOperationTargetKind {
  export type Resource = (typeof ChangesetOperationTargetKind)["Resource"];
  export type Range = (typeof ChangesetOperationTargetKind)["Range"];
}

/**
 * Identifies the file or range a {@link ChangesetOperation} should act on.
 *
 * The `kind` MUST match one of the operation's declared
 * {@link ChangesetOperation.scopes}.
 *
 * @category Commands
 */
export type ChangesetOperationTarget =
  | { kind: ChangesetOperationTargetKind.Resource; resource: URI; side?: 'before' | 'after' }
  | { kind: ChangesetOperationTargetKind.Range; resource: URI; side?: 'before' | 'after'; range: TextRange };

/**
 * Optional follow-up surfaced by the server after an operation completes —
 * a {@link ContentRef} the client can fetch and display.
 *
 * Set `external` to `true` to open the content in the user's preferred
 * external handler (e.g. browser); otherwise the client is expected to
 * surface it inline.
 *
 * @category Commands
 */
export interface ChangesetOperationFollowUp {
  content: ContentRef;
  /** When `true`, open in an external handler rather than inline. */
  external?: boolean;
}

/**
 * Invokes a server-defined {@link ChangesetOperation} against a changeset,
 * a single file, or a line range.
 *
 * The server validates that `operationId` exists in the changeset's
 * current `operations` list and that the requested `target.kind` is
 * contained in the operation's `scopes`. Invalid combinations result in a
 * JSON-RPC error.
 *
 * State changes resulting from invocation flow back through the normal
 * `changeset/*` action stream on the relevant changeset URIs. Clients
 * SHOULD NOT synthesise local optimistic changes for invocations unless
 * the server explicitly opts in via a future capability.
 *
 * @category Commands
 * @method invokeChangesetOperation
 * @direction Client → Server
 * @messageType Request
 * @version 2
 */
export interface InvokeChangesetOperationParams extends BaseParams {
  /** The expanded changeset URI. */
  channel: URI;
  /** Matches {@link ChangesetOperation.id} from the changeset's `operations` list. */
  operationId: string;
  /**
   * Target of the operation. Required iff the chosen scope is
   * `'resource'` or `'range'`. Omit for changeset-scoped operations.
   */
  target?: ChangesetOperationTarget;
}

/**
 * Result of the {@link InvokeChangesetOperationParams | `invokeChangesetOperation`}
 * command.
 *
 * Success is implicit: the server returns this result when it accepted
 * the operation. Failure is signalled by rejecting the JSON-RPC request
 * with an appropriate error code, not by any field on this result. The
 * operation MAY still produce subsequent failure feedback through the
 * {@link ChangesetStatusChangedAction | `changeset/statusChanged`} stream.
 *
 * @category Commands
 */
export interface InvokeChangesetOperationResult {
  /** Optional human-readable message describing the result. */
  message?: StringOrMarkdown;
  /** Optional follow-up: a URI to open (e.g. a PR), a content ref, etc. */
  followUp?: ChangesetOperationFollowUp;
}
