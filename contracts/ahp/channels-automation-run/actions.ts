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
 * Automation Run Channel Actions — mutations and side-effect requests scoped
 * to an `ahp-automation-run:` channel.
 *
 * @module channels-automation-run/actions
 */

import { ActionType } from '../common/actions';
import type { URI } from '../common/state';
import type {
  AutomationRunLifecycle,
  AutomationRunState,
} from './state';

/**
 * Replace the run lifecycle.
 *
 * The host dispatches this action for every lifecycle transition.
 *
 * @category Automation Run Actions
 * @version 1
 */
export interface AutomationRunLifecycleChangedAction {
  type: ActionType.AutomationRunLifecycleChanged;
  /** Complete replacement {@link AutomationRunState.lifecycle}. */
  lifecycle: AutomationRunLifecycle;
}

/**
 * Add a session to {@link AutomationRunState.sessions}.
 *
 * Session URIs are unique. Setting an existing URI is a no-op.
 *
 * @category Automation Run Actions
 * @version 1
 */
export interface AutomationRunSessionSetAction {
  type: ActionType.AutomationRunSessionSet;
  /** Session URI to append to {@link AutomationRunState.sessions} when not already linked. */
  session: URI;
}

/**
 * Remove a linked session from the run.
 *
 * Removing the current primary session also clears
 * {@link AutomationRunState.primarySession}. An unknown URI is a no-op.
 *
 * @category Automation Run Actions
 * @version 1
 */
export interface AutomationRunSessionRemovedAction {
  type: ActionType.AutomationRunSessionRemoved;
  /** Entry in {@link AutomationRunState.sessions} to remove. */
  session: URI;
}

/**
 * Select or clear the session clients should open first for this run.
 *
 * @category Automation Run Actions
 * @version 1
 */
export interface AutomationRunPrimarySessionChangedAction {
  type: ActionType.AutomationRunPrimarySessionChanged;
  /** New {@link AutomationRunState.primarySession}, or omitted to clear the selection. */
  primarySession?: URI;
}

/**
 * Ask the host to cancel this run.
 *
 * This is the only client-dispatchable automation-run action. It is a
 * side-effect request and deliberately leaves optimistic state unchanged. The
 * client may dispatch it only when the host advertises its `runCancellation`
 * capability and the current lifecycle is `pending` or `running`. The host
 * revalidates that the run is non-terminal. The authoritative outcome arrives
 * later through
 * {@link AutomationRunLifecycleChangedAction}: cancellation may transition to
 * `cancelled`, or the run may complete or fail before cancellation takes
 * effect.
 *
 * @category Automation Run Actions
 * @version 1
 * @clientDispatchable
 */
export interface AutomationRunCancelRequestedAction {
  type: ActionType.AutomationRunCancelRequested;
}
