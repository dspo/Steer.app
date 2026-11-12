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
 * State Types — Aggregator shim that re-exports channel-organized state
 * declarations. New code should import directly from the per-channel files
 * under `types/common/`, `types/channels-root/`, `types/channels-session/`,
 * `types/channels-terminal/`, and `types/channels-changeset/`.
 *
 * @module state
 */

export * from './common/state';
export * from './channels-root/state';
export * from './channels-session/state';
export * from './channels-chat/state';
export * from './channels-terminal/state';
export * from './channels-changeset/state';
export * from './channels-annotations/state';
export * from './channels-otlp/state';
export * from './channels-resource-watch/state';
export * from './channels-automation/state';
export * from './channels-automation-run/state';
