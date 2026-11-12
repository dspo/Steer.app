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
 * Common Reducer Helpers — Shared reducer utilities (`softAssertNever`,
 * dispatch validation) used by the per-channel reducers.
 *
 * @module common/reducer-helpers
 */

import type {
  RootAction,
  ClientRootAction,
  SessionAction,
  ClientSessionAction,
  TerminalAction,
  ClientTerminalAction,
  ChangesetAction,
  ClientChangesetAction,
  AnnotationsAction,
  ClientAnnotationsAction,
  AutomationAction,
  ClientAutomationAction,
  AutomationRunAction,
  ClientAutomationRunAction,
} from '../action-origin.generated';
import { IS_CLIENT_DISPATCHABLE } from '../action-origin.generated';

/**
 * Soft assertion for exhaustiveness checking. Place in the `default` branch of
 * a switch on a discriminated union so the compiler errors when a new variant
 * is added but not handled.
 *
 * At runtime, logs a warning instead of throwing so that forward-compatible
 * clients receiving unknown actions from a newer server degrade gracefully.
 */
export function softAssertNever(value: never, log?: (msg: string) => void): void {
  const msg = `Unhandled action type: ${JSON.stringify(value)}`;
  (log ?? console.warn)(msg);
}

// ─── Dispatch Validation ─────────────────────────────────────────────────────

/**
 * Type guard that checks whether an action may be dispatched by a client.
 *
 * Servers SHOULD call this to validate incoming `dispatchAction` requests
 * and reject any action the client is not allowed to originate.
 */
export function isClientDispatchable(action: RootAction | SessionAction | TerminalAction | ChangesetAction | AnnotationsAction | AutomationAction | AutomationRunAction): action is ClientRootAction | ClientSessionAction | ClientTerminalAction | ClientChangesetAction | ClientAnnotationsAction | ClientAutomationAction | ClientAutomationRunAction {
  return IS_CLIENT_DISPATCHABLE[action.type];
}
