/**
 * The way in: `bun run dev` (and `check`, `test`, `evidence`, `bundle`).
 *
 * This repo has three toolchains already — nsh for the app, cargo for the
 * native crates, bun for the pi harness — so the entry point uses one of
 * them rather than adding a fourth. Bun is the one that can run TypeScript
 * as-is, and the harness needs it anyway.
 *
 * What every task does first, because doing it wrong is invisible:
 *
 *  - the `nsh` CLI must be the version `.cnb.yml` pins (script/lib/toolchain.ts).
 *  - a worktree carries no `pi-harness/dist` and no `node_modules` (both
 *    gitignored): the app spawns `pi-acp`, so the harness is built here. A
 *    `node_modules` that is a symlink to another checkout cannot be
 *    installed into or built from (bun resolves through the link), so it is
 *    replaced with a real install — and a `dist` from another checkout
 *    would test this branch's app against someone else's harness.
 */

import { copyFileSync, cpSync as fsCopy, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { APP, BUN, checkNsh, fail, HARNESS, nshBinary, run, ROOT } from "./lib/toolchain.ts";

const HARNESS_BIN = join(HARNESS, "dist", "pi-acp");

/** The app's own development-server port: another app's session may hold the
 * default one, and replacing it waits a minute before failing. */
const PORT = process.env.PORT ?? "8810";

/** `bun dev`'s state directory, beside the installed app's. The single-instance
 * claim is a file under the state dir, so a dev instance that shared it would
 * render "Zu is already running" and never boot the engine while Zu.app runs. */
const DEV_STATE = join(homedir(), ".pi", "zu-dev");

const usage = () =>
  [
    "Usage: bun run bundle [-i] [-o] [out-dir]   (out-dir default: build)",
    "  -i    install Zu.app to /Applications once the bundle is complete",
    "  -o    open Zu.app once the bundle is complete (the /Applications copy with -i)",
    "  -h    show this help",
    "  NSH=/path/to/nsh overrides the nsh binary (default: nsh)",
  ].join("\n");

/** A `node_modules` that is a symlink to another checkout cannot be installed
 * into (bun resolves through the link): replace it with a real install. */
function replaceSymlinkedModules(): void {
  const modules = join(HARNESS, "node_modules");
  if (existsSync(modules) && lstatSync(modules).isSymbolicLink()) {
    console.log("pi-harness/node_modules is a symlink: replacing it with a real install");
    Bun.spawnSync(["rm", modules]);
  }
}

/** The harness the app spawns: built here when missing, and never borrowed. */
function ensureHarness(): void {
  if (existsSync(HARNESS_BIN)) return;
  replaceSymlinkedModules();
  console.log("building the pi harness the app spawns…");
  run([BUN, "install"], HARNESS);
  run([BUN, "run", "build"], HARNESS);
}

function bundle(outDir: string, installResult: boolean, openResult: boolean): void {
  if (process.platform !== "darwin") {
    fail(
      "bundle needs macOS: nsh package targets bun-darwin-arm64, and the signatures\n" +
        "and dmg are codesign/hdiutil. The CI pipeline (script/ci.ts) is Linux-only.",
    );
  }
  const nsh = nshBinary();
  checkNsh(nsh);
  const app = join(outDir, "Zu.app");
  const dmg = join(outDir, "Zu.dmg");

  // The bundle pairs this checkout's app with this checkout's harness: rebuild
  // every time. ensureHarness skips when a dist is already there — right for
  // dev and test, wrong for packaging, where that dist may belong to another
  // checkout and the app would ship someone else's harness silently.
  console.log("→ pi harness sidecar");
  replaceSymlinkedModules();
  run([BUN, "install"], HARNESS);
  run([BUN, "run", "build"], HARNESS);

  console.log("→ app");
  run([nsh, "package", "--target", "macos", "-o", outDir], APP);

  console.log("→ sidecar into Contents/Helpers");
  const helpers = join(app, "Contents", "Helpers");
  mkdirSync(helpers, { recursive: true });
  // pi loads these from beside the executable (photon for images, QuickJS for
  // code mode); without them those paths throw at run time.
  for (const file of ["pi-acp", "photon_rs_bg.wasm", "quickjs.wasm"]) {
    try {
      copyFileSync(join(HARNESS, "dist", file), join(helpers, file));
    } catch {
      fail(`error: pi-harness/dist/${file} could not be copied into Contents/Helpers`);
    }
  }

  // The harness and its WASM are part of the app, not an optional add-on: a
  // self-update replaces the whole .app, so an update archive that leaves
  // Contents/Helpers out ships an app whose conversations cannot start. Fail
  // the bundle here rather than shipping that.
  for (const file of ["pi-acp", "photon_rs_bg.wasm", "quickjs.wasm"]) {
    if (!existsSync(join(helpers, file))) {
      fail(`error: Contents/Helpers/${file} is missing; the app cannot start a conversation`);
    }
  }
  console.log("✓ Contents/Helpers carries the pi harness and its WASM");

  console.log("→ ad-hoc signatures (nested: the sidecar, then the app)");
  run(["codesign", "--force", "--sign", "-", join(helpers, "pi-acp")], ROOT);
  run(["codesign", "--force", "--deep", "--sign", "-", app], ROOT);
  run(["codesign", "--verify", "--deep", "--strict", app], ROOT);

  console.log("→ dmg");
  rmSync(dmg, { force: true });
  run(["hdiutil", "create", "-volname", "Zu", "-srcfolder", app, "-ov", "-format", "UDZO", "-quiet", dmg], ROOT);

  // An update archive is the whole app: `nsh/updater` replaces it, so the
  // archive must carry Contents/Helpers too. `nsh package` only writes one
  // when nsh.json has an "updater" source, and this repository has none yet;
  // opt in here when the release configuration exists. The archive is written
  // by tar, not Bun.Archive: the archive carries the app's main executable,
  // and Bun.Archive drops its executable bit (755 → 644) and zeroes mtimes —
  // an update that untarred it would install an app that cannot launch.
  if (process.env.NSH_UPDATE_ARCHIVE === "1") {
    const plist = readPlistValue(join(app, "Contents", "Info.plist"), "CFBundleShortVersionString") ?? "0.0.0";
    const arch = process.arch === "arm64" ? "aarch64" : process.arch === "x64" ? "x86_64" : process.arch;
    const archive = join(outDir, `Zu-${plist}-macos-${arch}.tar.gz`);
    console.log("→ update archive (includes Contents/Helpers)");
    rmSync(archive, { force: true });
    run(["tar", "-czf", archive, "-C", outDir, "Zu.app"], ROOT);
    console.log(`  ${archive}`);
    console.log(`  release: nsh update-manifest ${archive} --notes CHANGES.md --key keys/update.secret`);
  } else {
    console.log("  (set NSH_UPDATE_ARCHIVE=1 to write the whole-app archive an update needs)");
  }

  // Install and open come after every bundle step, so /Applications gets
  // exactly the signed bundle the dmg was built from — never a half-built copy.
  let result = app;
  if (installResult) {
    const installDest = "/Applications/Zu.app";
    console.log(`→ install ${installDest}`);
    rmSync(installDest, { recursive: true, force: true });
    cpSync(app, installDest);
    console.log(`✓ installed ${installDest}`);
    result = installDest;
  }

  if (openResult) {
    console.log(`→ open ${result}`);
    run(["open", result], ROOT);
  }

  console.log(`✓ ${result}`);
  console.log(`✓ ${dmg}`);
  console.log(`${humanSize(dirSize(result))}\t${result}`);
  console.log(`${humanSize(statSync(dmg).size)}\t${dmg}`);
}

/** One plist string value, read with a regex: spawning `plutil` for one key
 * is a heavier lift than the file is. */
function readPlistValue(plist: string, key: string): string | null {
  return new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`).exec(readFileSync(plist, "utf8"))?.[1] ?? null;
}

/** `cp -R` for the install step: `fs.cpSync` recursive, so /Applications gets
 * exactly the tree `nsh package` and the signatures were built from. */
function cpSync(from: string, to: string): void {
  fsCopy(from, to, { recursive: true });
}

/** `du -sh` for one path: files only, recurse on demand. */
function dirSize(path: string): number {
  const stats = statSync(path);
  if (!stats.isDirectory()) return stats.size;
  let total = 0;
  for (const entry of readdirSync(path)) total += dirSize(join(path, entry));
  return total;
}

function humanSize(bytes: number): string {
  const units = ["", "K", "M", "G", "T"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  const rounded = unit === 0 ? String(size) : size.toFixed(1).replace(/\.0$/, "");
  return `${rounded}${units[unit]}`;
}

const task = process.argv[2] ?? "dev";

// nsh is resolved per task, never on load: `bundle` parses its own arguments
// first, and `-h` has to answer without an nsh install the way the sh entry
// always did (it only needed $NSH, and defaulted it without looking).
switch (task) {
  case "dev": {
    const nsh = nshBinary();
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
  case "check": {
    const nsh = nshBinary();
    checkNsh(nsh);
    run([nsh, "check", "app"], ROOT);
    break;
  }
  case "test": {
    const nsh = nshBinary();
    checkNsh(nsh);
    run([nsh, "test", "."], APP);
    break;
  }
  case "evidence": {
    const nsh = nshBinary();
    checkNsh(nsh);
    mkdirSync(join(APP, "docs", "evidence"), { recursive: true });
    run([nsh, "test", "tests/containers.ui.test.tsx", "--target", "macos", "--filter", "containers switch"], APP);
    break;
  }
  case "bundle": {
    // `bun run bundle -- -i -o` passes the flags after a literal `--`; argv
    // carries it, and no out-dir is ever named `--`.
    let outDir = join(ROOT, "build");
    let installResult = false;
    let openResult = false;
    for (const arg of process.argv.slice(3).filter((a) => a !== "--")) {
      if (arg === "-i") installResult = true;
      else if (arg === "-o") openResult = true;
      else if (arg === "-h" || arg === "--help") {
        console.log(usage());
        process.exit(0);
      } else if (arg.startsWith("-")) {
        console.error(`error: unknown option '${arg}'`);
        console.error(usage());
        process.exit(1);
      } else outDir = arg.startsWith("/") ? arg : join(ROOT, arg);
    }
    bundle(outDir, installResult, openResult);
    break;
  }
  default:
    fail(`unknown task: ${task} (dev, check, test, evidence, bundle)`);
}
