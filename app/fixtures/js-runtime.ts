/**
 * The JS runtime fixtures are spawned with: bun — the runtime the tests and
 * CI already have on PATH; `BUN` overrides for a pinned install. The typeof
 * guard is not decoration: this module also loads inside the app VM, where
 * there is no Node `process` to read.
 */
export function jsRuntime(): string {
  return (typeof process === "undefined" ? undefined : process.env.BUN) ?? "bun";
}
