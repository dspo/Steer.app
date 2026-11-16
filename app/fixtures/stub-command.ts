/**
 * The ACP stub's spawn shape for `setAcpCommandOverride`: the stub
 * (`acp-stub-agent.ts`) is TypeScript, so the harness process is bun — the
 * runtime the tests and CI already have on PATH; `BUN` overrides for a
 * pinned install. No shell on the scaffolding side (the `/bin/sh` in
 * `pty.test.ts` is a different thing: the terminal's own shell, the tested
 * subject).
 *
 * Two shapes for two worlds: tests run where `import.meta.url` is a real
 * file path, so `stubCommand()` locates the stub itself; an app VM's
 * `import.meta.url` is no file path, so the entries that stand the stub in
 * (`app-stub-acp.tsx`, `fixtures/projects.tsx`) call `stubCommandAt()` with
 * the path handed over `host.params`. (This module loads in the VM too,
 * where there is no Node `process` — hence the guard.)
 */

/** Where the stub lives, as a spawnable path. Only meaningful outside an
 * app VM — see `stubCommandAt` for the VM's shape. */
export function stubPath(): string {
  return new URL("./acp-stub-agent.ts", import.meta.url).pathname;
}

/** The stub for tests: path derived from this module's own location. */
export function stubCommand(env?: Record<string, string>): { command: string; args: string[]; env?: Record<string, string> } {
  return stubCommandAt(stubPath(), env);
}

/** The stub for an app VM entry: the path rides `host.params`, not a file URL. */
export function stubCommandAt(stub: string, env?: Record<string, string>): { command: string; args: string[]; env?: Record<string, string> } {
  const bun = typeof process === "undefined" ? undefined : process.env.BUN;
  return { command: bun ?? "bun", args: [stub], ...(env ? { env } : {}) };
}
