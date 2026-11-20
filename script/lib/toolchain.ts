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
import { homedir, tmpdir } from "node:os";
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

/** The CLI the app was written for: `$NSH`, else nsh's own install dir, else PATH.
 * Strict lookup — no installation happens here; the tasks use `ensureNsh()`. */
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

/** Downloads `url` to a temp file and runs it with `sh`. The download lands
 * on disk before executing — the discipline .cnb.yml's toolchain stage spells
 * out: piped into a shell, a curl failure would be masked by the shell's
 * exit code and the fault would surface only as a later `command not found`.
 * (nsh keeps its own runner in installNsh below: its tag fallback needs the
 * quiet-when-404 semantics this function's fail() would not allow.) */
function runInstallerScript(url: string, args: string[], env: Record<string, string>, label: string): void {
  const script = join(tmpdir(), `zu-${label}-install.sh`);
  const download = Bun.spawnSync(["curl", "-fsSL", url, "-o", script], { stdio: ["inherit", "inherit", "inherit"] });
  if (download.exitCode !== 0) fail(`could not download ${url} (curl exit ${download.exitCode})`);
  const result = Bun.spawnSync(["sh", script, ...args], {
    cwd: ROOT,
    stdio: ["inherit", "inherit", "inherit"],
    env: { ...process.env, ...env },
  });
  if (result.exitCode !== 0) fail(`the ${label} installer exited ${result.exitCode}`);
}

/** The nsh CLI, installed on demand: a machine with only bun gets the pinned
 * release installed here (the same install.sh .cnb.yml's toolchain stage runs,
 * with NSH_VERSION pinned so `checkNsh` cannot drift). `$NSH` stays a hard
 * override — when it names a missing binary, say so instead of installing
 * behind the user's back. An existing nsh of the wrong version is still
 * `checkNsh`'s manual-error case: upgrading it would clobber the user's setup. */
export function ensureNsh(): string {
  const override = process.env.NSH;
  if (override && !existsSync(override)) {
    fail(`NSH=${override} does not exist. Unset it to have the pinned ${pinnedNsh()} installed automatically.`);
  }
  const own = join(homedir(), ".nsh", "bin", "nsh");
  const found = override ?? (existsSync(own) ? own : Bun.which("nsh"));
  if (found) return found;
  const pin = pinnedNsh();
  console.log(`nsh is not installed; installing the pinned nsh ${pin}…`);
  // The release tag is `v`-prefixed (CI's NSH_VERSION: v0.5.0); the bare
  // number stays as the fallback in case a release ships untagged.
  const installed =
    installNsh(`v${pin}`) || installNsh(pin);
  if (!installed || !existsSync(own)) {
    fail(`no nsh ${pin} release could be installed; put it at ~/.nsh/bin/nsh manually (https://nsh.dev)`);
  }
  return own;
}

/** One install.sh run for one release tag; false when the download or the
 * install failed (a missing release 404s), leaving the retry to the caller. */
function installNsh(tag: string): boolean {
  const script = join(tmpdir(), "zu-nsh-install.sh");
  const download = Bun.spawnSync(["curl", "-fsSL", "https://nsh.dev/install.sh", "-o", script], { stdio: ["inherit", "inherit", "inherit"] });
  if (download.exitCode !== 0) return false;
  const result = Bun.spawnSync(["sh", script], {
    cwd: ROOT,
    stdio: ["inherit", "inherit", "inherit"],
    env: { ...process.env, NSH_VERSION: tag },
  });
  return result.exitCode === 0;
}

/** Runs one toolchain probe in ROOT with output captured, failing loudly.
 * For cargo this is also the warm-up: the rustup shim reads the repo's
 * rust-toolchain.toml and downloads the pinned channel on first use — done
 * here, the download happens under a clear message instead of buried in
 * `nsh package`'s build output.
 *
 * `path` is absolute on purpose: Bun resolves spawned executables against the
 * PATH this process started with, so a `process.env.PATH` amended mid-run
 * (to expose a just-installed ~/.cargo/bin to child processes) is invisible
 * to the spawn lookup itself. */
function probeInRoot(path: string, rescue: string): void {
  const result = Bun.spawnSync([path, "--version"], { cwd: ROOT, stdio: ["inherit", "pipe", "inherit"] });
  const version = result.stdout?.toString().trim();
  if (result.exitCode !== 0 || !version) {
    fail(`${path} --version failed in the repo root; the cargo toolchain is broken (${rescue})`);
  }
  process.stdout.write(`${version}\n`);
}

/** cargo, installed on demand: rustup lands in ~/.cargo, and rust-toolchain.toml
 * pins the channel — no separate version check is needed. The profile is
 * minimal, mirroring CI's image: the pinned channel's own
 * `components = ["clippy", "rustfmt"]` bring the gate's lints along when it
 * installs. PATH is amended for this process so the children (`nsh package`'s
 * cargo builds) find a freshly installed cargo even though this shell does
 * not know ~/.cargo/bin. */
export function ensureCargo(): void {
  const cargoBin = join(homedir(), ".cargo", "bin");
  const expose = () => {
    if (!Bun.which("cargo")) process.env.PATH = `${cargoBin}:${process.env.PATH ?? ""}`;
  };
  const onPath = Bun.which("cargo");
  if (onPath) {
    probeInRoot(onPath, "https://rustup.rs");
    return;
  }
  const own = join(cargoBin, "cargo");
  if (existsSync(own)) {
    expose();
    probeInRoot(own, "https://rustup.rs");
    return;
  }
  console.log("cargo is not installed; installing rustup…");
  runInstallerScript("https://sh.rustup.rs", ["-y", "--profile", "minimal"], {}, "rustup");
  if (!existsSync(own)) {
    fail("rustup finished but ~/.cargo/bin/cargo is missing; install Rust manually (https://rustup.rs)");
  }
  expose();
  probeInRoot(own, "https://rustup.rs");
}

/** What every task needs before spawning nsh: the CLI (installed when
 * missing), cargo for the rust workspaces `nsh package`/`check`/`test`
 * build (rustup when missing), and then the pinned-version gate. */
export function ensureToolchain(): string {
  const nsh = ensureNsh();
  ensureCargo();
  checkNsh(nsh);
  return nsh;
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
