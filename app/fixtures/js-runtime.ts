/**
 * The JS runtime fixtures are spawned with: bun — the runtime the tests and
 * CI already have on PATH; `BUN` overrides for a pinned install. The typeof
 * guard stays because `process` here is nsh's own, not Node's.
 *
 * What makes the override work is `BUN` being listed in `app/nsh.json`'s
 * `capabilities.process.env`, and that is easy to lose: an app VM sees only
 * the granted names (plus nsh's built-in metadata ones), so an ungranted
 * name reads back undefined and the override silently degrades to the
 * default — a `BUN=…` run then looks like it tested the override when it
 * only ever tested the fallback.
 */
export function jsRuntime(): string {
  return (typeof process === "undefined" ? undefined : process.env.BUN) ?? "bun";
}
