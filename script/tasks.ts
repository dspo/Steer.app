/**
 * The way in: `bun run dev` (and `check`, `test`, `evidence`).
 *
 * This repo has three toolchains already — nsh for the app, cargo for the
 * native crates, bun for the pi harness — so the entry point uses one of
 * them rather than adding a fourth. Bun is the one that can run TypeScript
 * as-is, and the harness needs it anyway.
 *
 * What every task does first, because doing it wrong is invisible:
 *
 *  - the `nsh` CLI must be the version `.cnb.yml` pins. A 0.4.0 CLI refuses
 *    `notifications` in `app/nsh.json` and every test fails before it runs,
 *    with an error that points nowhere useful.
 *  - a worktree carries no `pi-harness/dist` and no `node_modules` (both
 *    gitignored): the app spawns `pi-acp`, so the harness is built here. A
 *    `node_modules` that is a symlink to another checkout cannot be
 *    installed into or built from (bun resolves through the link), so it is
 *    replaced with a real install — and a `dist` from another checkout
 *    would test this branch's app against someone else's harness.
 */

import { existsSync, lstatSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const APP = join(ROOT, "app");
const HARNESS = join(ROOT, "pi-harness");
const HARNESS_BIN = join(HARNESS, "dist", "pi-acp");

/** The app's own development-server port: another app's session may hold the
 * default one, and replacing it waits a minute before failing. */
const PORT = process.env.PORT ?? "8810";

/** `bun dev`'s state directory, beside the installed app's. The single-instance
 * claim is a file under the state dir, so a dev instance that shared it would
 * render "Zu is already running" and never boot the engine while Zu.app runs. */
const DEV_STATE = join(homedir(), ".pi", "zu-dev");

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** The nsh release `.cnb.yml` pins, as `0.5.0`. */
function pinnedNsh(): string {
  const manifest = readFileSync(join(ROOT, ".cnb.yml"), "utf8");
  const version = /NSH_VERSION:\s*"?v?([\d.]+)"?/.exec(manifest)?.[1];
  if (!version) fail(".cnb.yml has no NSH_VERSION to pin nsh to");
  return version;
}

/** The CLI the app was written for: `$NSH`, else nsh's own install dir, else PATH. */
function nshBinary(): string {
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

function checkNsh(nsh: string): void {
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
function run(command: string[], cwd: string, env?: Record<string, string>): void {
  const result = Bun.spawnSync(command, {
    cwd,
    stdio: ["inherit", "inherit", "inherit"],
    env: env && { ...process.env, ...env },
  });
  if (result.exitCode !== 0) process.exit(result.exitCode ?? 1);
}

/** The harness the app spawns: built here when missing, and never borrowed. */
function ensureHarness(): void {
  if (existsSync(HARNESS_BIN)) return;
  const modules = join(HARNESS, "node_modules");
  if (existsSync(modules) && lstatSync(modules).isSymbolicLink()) {
    console.log("pi-harness/node_modules is a symlink: replacing it with a real install");
    Bun.spawnSync(["rm", modules]);
  }
  console.log("building the pi harness the app spawns…");
  run([Bun.which("bun") ?? "bun", "install"], HARNESS);
  run([Bun.which("bun") ?? "bun", "run", "build"], HARNESS);
}

const nsh = nshBinary();
const task = process.argv[2] ?? "dev";

switch (task) {
  case "dev": {
    checkNsh(nsh);
    ensureHarness();
    // The installed Zu owns `~/.pi/zu`'s lock; give dev its own state dir so
    // both run at once. `ZU_STATE_DIR` still wins when set explicitly.
    const stateDir = process.env.ZU_STATE_DIR ?? DEV_STATE;
    console.log(`dev state: ${stateDir}`);
    // `nsh run` blocks while the app runs: the terminal is its own.
    run([nsh, "run", "--port", PORT], APP, { ZU_STATE_DIR: stateDir });
    break;
  }
  case "check":
    checkNsh(nsh);
    run([nsh, "check", "app"], ROOT);
    break;
  case "test":
    checkNsh(nsh);
    run([nsh, "test", "."], APP);
    break;
  case "evidence":
    checkNsh(nsh);
    mkdirSync(join(APP, "docs", "evidence"), { recursive: true });
    run([nsh, "test", "containers.ui.test.tsx", "--target", "macos", "--filter", "containers switch"], APP);
    break;
  default:
    fail(`unknown task: ${task} (dev, check, test, evidence)`);
}
