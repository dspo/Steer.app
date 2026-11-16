/**
 * What `script/tasks.ts` and `script/ci.ts` share: the repo's paths, and the
 * nsh discipline both entry points need before they spawn anything.
 *
 * The `nsh` CLI must be the version `.cnb.yml` pins. A 0.4.0 CLI refuses
 * `notifications` in `app/nsh.json` and every test fails before it runs,
 * with an error that points nowhere useful — so every nsh invocation goes
 * through `nshBinary()` + `checkNsh()`, and every child process through
 * `run()`, which fails with the child's code instead of drowning it.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const ROOT = new URL("../..", import.meta.url).pathname;
export const APP = join(ROOT, "app");
export const HARNESS = join(ROOT, "pi-harness");

/** The bun runtime the harness and the mjs gate run under: PATH is where
 * dev and CI both have it (`/root/.bun/bin` is on CI's PATH), `BUN` wins
 * for a pinned install. */
export const BUN = Bun.which("bun") ?? "bun";

export function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** The nsh release `.cnb.yml` pins, as `0.5.0`. */
export function pinnedNsh(): string {
  const manifest = readFileSync(join(ROOT, ".cnb.yml"), "utf8");
  const version = /NSH_VERSION:\s*"?v?([\d.]+)"?/.exec(manifest)?.[1];
  if (!version) fail(".cnb.yml has no NSH_VERSION to pin nsh to");
  return version;
}

/** The CLI the app was written for: `$NSH`, else nsh's own install dir, else PATH. */
export function nshBinary(): string {
  const own = join(homedir(), ".nsh", "bin", "nsh");
  const found = process.env.NSH ?? (existsSync(own) ? own : Bun.which("nsh"));
  if (!found) {
    fail(
      `nsh is not installed. Put the pinned ${pinnedNsh()} at ~/.nsh/bin/nsh\n` +
        `(https://nsh.dev/install.sh) or set NSH=/path/to/nsh.`,
    );
  }
  return found;
}

export function checkNsh(nsh: string): void {
  const version = /(\d+\.\d+\.\d+)/.exec(Bun.spawnSync([nsh, "--version"]).stdout.toString());
  const want = pinnedNsh();
  if (!version) fail(`${nsh} does not answer --version`);
  if (version[1] !== want) {
    fail(
      `nsh ${version[1]} is not the pinned ${want}: the app's manifest would disagree with\n` +
        `the host (0.4.0 refuses \`notifications\` in app/nsh.json and every test fails).\n` +
        `Install ${want} at ~/.nsh/bin/nsh, or run with NSH=/path/to/nsh.`,
    );
  }
  process.stdout.write(`nsh ${version[1]}\n`);
}

/** Runs a command in `cwd`, inheriting the terminal, and fails with its code. */
export function run(command: string[], cwd: string, env?: Record<string, string>): void {
  const result = Bun.spawnSync(command, {
    cwd,
    stdio: ["inherit", "inherit", "inherit"],
    env: env && { ...process.env, ...env },
  });
  if (result.exitCode !== 0) process.exit(result.exitCode ?? 1);
}
