// Vendored from dspo's AHP spec checkout (microsoft/agent-host-protocol):
//   repo:    ~/projects/github/agent-host-protocol  (remote: https://github.com/microsoft/agent-host-protocol.git)
//   commit:  296b25e7b698a4a84a0ee5a28d9573e70048a0bf  (working tree clean at vendoring time)
//   spec:    v0.9.0 (clients/typescript package.json version), LAST_SYNCED_COMMIT file said 20c6b266 (not resolvable locally)
//   pin:     contracts/ahp/PIN.md — read it before syncing; do not edit these files by hand.
// The only transform applied at vendoring time: relative import specifiers lost
// their `.js` suffix (upstream ships ESM `.js` extensions; this app resolves
// extensionless TS). Everything else is byte-identical to the pinned commit.
/**
 * Action Types — Aggregator shim that re-exports channel-organized action
 * declarations. New code should import directly from the per-channel files
 * under `types/common/`, `types/channels-root/`, `types/channels-session/`,
 * `types/channels-terminal/`, and `types/channels-changeset/`.
 *
 * @module actions
 */

export * from './common/actions';
export * from './channels-root/actions';
export * from './channels-session/actions';
export * from './channels-chat/actions';
export * from './channels-terminal/actions';
export * from './channels-changeset/actions';
export * from './channels-annotations/actions';
export * from './channels-resource-watch/actions';
export * from './channels-automation/actions';
export * from './channels-automation-run/actions';
