// Vendored from dspo's AHP spec checkout (microsoft/agent-host-protocol):
//   repo:    ~/projects/github/agent-host-protocol  (remote: https://github.com/microsoft/agent-host-protocol.git)
//   commit:  296b25e7b698a4a84a0ee5a28d9573e70048a0bf  (working tree clean at vendoring time)
//   spec:    v0.9.0 (clients/typescript package.json version), LAST_SYNCED_COMMIT file said 20c6b266 (not resolvable locally)
//   pin:     contracts/ahp/PIN.md — read it before syncing; do not edit these files by hand.
// The only transform applied at vendoring time: relative import specifiers lost
// their `.js` suffix (upstream ships ESM `.js` extensions; this app resolves
// extensionless TS). Everything else is byte-identical to the pinned commit.
/**
 * Adds a duration to an ISO 8601 timestamp and returns the result in canonical
 * ISO 8601 form.
 */
export function addMillisecondsToTimestamp(timestamp: string, duration: number): string {
  return new Date(Date.parse(timestamp) + duration).toISOString();
}
