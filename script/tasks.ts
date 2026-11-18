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

import { copyFileSync, cpSync as fsCopy, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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
const DEV_STATE = join(homedir(), ".steer", "dev");

const usage = () =>
  [
    "Usage: bun run bundle [-i] [-o] [out-dir]   (out-dir default: build)",
    "  -i    install Zu.app to /Applications once the bundle is complete",
    "  -o    open Zu.app once the bundle is complete (the /Applications copy with -i)",
    "Usage: bun run conformance [-- esctest|ucs|all] [--gate=p0]",
    "  esctest (default)  the esctest2 conformance run, report-only",
    "  --gate=p0          exit non-zero when a P0-class test fails (issue #46)",
    "  -h                 show this help",
    "  NSH=/path/to/nsh overrides the nsh binary (default: nsh)",
  ].join("\n");

/** The esctest2 release the conformance run pins (issue #46), never
 * vendored: the download goes to the cache and is verified against the
 * sha256 before use. When Ghostty bumps, re-check the pin its own
 * `test/esctest/build.zig.zon` carries (docs/upstream-watch.md). */
const ESCTEST2 = {
  url: "https://github.com/ThomasDickey/esctest2/archive/2798f12149a19c3295e9b4853ab2da4b2eff1b2b.tar.gz",
  sha256: "04b01a8343045a6801ea9a2a849b339e1b41179197102363a43fab13b25a2e1e",
  dir: "esctest2-2798f12149a19c3295e9b4853ab2da4b2eff1b2b",
  cache: join(homedir(), ".cache", "steer-conformance"),
};

/** The P0 classes: on the pinned kernel the upstream runner passes every
 * test in them, so a failure here is the embedding's, not the kernel's
 * (issue #46). The other classes are kernel-limited and recorded in
 * `native/conformance/esctest-baseline.txt`. */
const P0_CLASSES = new Set([
  "APCTests", "BSTests", "CBTTests", "CHATests", "CHTTests", "CNLTests",
  "CPLTests", "CRTests", "CUBTests", "CUDTests", "CUFTests", "CUPTests",
  "CUUTests", "DCHTests", "DCSTests", "DECALNTests", "DECBITests",
  "DECDCTests", "DECFITests", "DECICTests", "DECIDTests", "DECRCTests",
  "DECSEDTests", "DECSELTests", "DECSETTiteInhibitTests", "DECSTBMTests",
  "DECSTRTests", "DLTests", "ECHTests", "EDTests", "ELTests", "FFTests",
  "HPATests", "HPRTests", "HTSTests", "HVPTests", "ICHTests", "ILTests",
  "INDTests", "LFTests", "ManipulateSelectionDataTests", "NELTests",
  "PMTests", "REPTests", "RITests", "RMTests", "ResetColorTests",
  "S8C1TTests", "SCORCTests", "SDTests", "SMTests", "SMTitleTests",
  "SOSTests", "SUTests", "TBCTests", "VPATests", "VPRTests", "VTTests",
  "XtermSaveTests",
]);

function sha256(path: string): string {
  const hash = new Bun.CryptoHasher("sha256");
  hash.update(readFileSync(path));
  return hash.digest("hex");
}

/** Makes sure the pinned esctest2 is in the cache and verified; returns
 * the directory to point `ZU_ESCTEST_DIR` at. Downloading again when the
 * tarball does not match the pin keeps a corrupted cache from lying. */
async function ensureEsctest2(): Promise<string> {
  mkdirSync(ESCTEST2.cache, { recursive: true });
  const tarball = join(ESCTEST2.cache, "esctest2.tar.gz");
  if (existsSync(tarball) && sha256(tarball) !== ESCTEST2.sha256) {
    console.error("conformance: the cached esctest2.tar.gz does not match the pin, downloading again");
    rmSync(tarball);
  }
  if (!existsSync(tarball)) {
    console.log(`conformance: downloading esctest2 (${ESCTEST2.url})`);
    await Bun.write(tarball, await fetch(ESCTEST2.url));
  }
  if (sha256(tarball) !== ESCTEST2.sha256) {
    fail(`conformance: esctest2.tar.gz does not match the pin ${ESCTEST2.sha256}`);
  }
  const dir = join(ESCTEST2.cache, ESCTEST2.dir);
  if (!existsSync(join(dir, "esctest", "esctest.py"))) {
    rmSync(dir, { recursive: true, force: true });
    const unpacked = Bun.spawnSync(["tar", "-xzf", tarball, "-C", ESCTEST2.cache]);
    if (!existsSync(join(dir, "esctest", "esctest.py"))) {
      fail(`conformance: unpacking esctest2 failed: ${unpacked.stderr.toString().trim()}`);
    }
  }
  return dir;
}

/** Runs the esctest2 conformance pass and scores it: cargo runs the
 * `#[ignore]`d driver, the output carries the result, and the report
 * splits the failures into what the kernel also fails upstream and what
 * is ours. Report-only by default; `--gate=p0` fails when a P0-class
 * test does. */
async function conformanceEsctest(gate: boolean): Promise<void> {
  const esctestDir = await ensureEsctest2();
  console.log("conformance: running esctest2 (a full pass takes about a minute)");
  const proc = Bun.spawn(
    ["cargo", "test", "-p", "zu-app", "conformance", "--", "--ignored", "--nocapture"],
    {
      cwd: join(ROOT, "native"),
      env: { ...process.env, ZU_ESCTEST_DIR: esctestDir },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const killer = setTimeout(() => proc.kill(), 15 * 60 * 1000);
  const output: Uint8Array[] = [];
  const pump = (stream: ReadableStream<Uint8Array>) =>
    (async () => {
      const reader = stream.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        output.push(value);
        process.stdout.write(value);
      }
    })();
  const drained = Promise.all([pump(proc.stdout as ReadableStream<Uint8Array>), pump(proc.stderr as ReadableStream<Uint8Array>)]);
  const code = await proc.exited;
  clearTimeout(killer);
  await drained;
  if (code !== 0) {
    fail(`conformance: the esctest driver failed (exit ${code}) — see the output above`);
  }
  const text = Buffer.concat(output).toString();
  const summary = /ESCTEST-SUMMARY passed=(\d+) known=(\d+) failed=(\d+) total=(\d+)/.exec(text);
  if (!summary) fail("conformance: the driver printed no ESCTEST-SUMMARY — see the output above");
  const [passed, known, failed, total] = summary.slice(1).map(Number) as number[];
  const failing = [...text.matchAll(/^ESCTEST-FAILED (.+)$/gm)].map((match) => match[1]);
  // The driver names every failure it parsed; a shorter list means the log's
  // "Failing tests:" shape moved, and the split below would call an empty set
  // "ours: 0" and wave a failing P0 gate through.
  if (failing.length !== failed) {
    fail(
      `conformance: the driver named ${failing.length} failing tests but the summary says ${failed} — check failing_names() in native/src/conformance.rs against the pinned esctest2`,
    );
  }

  // What the kernel also fails upstream; what is left is ours.
  const baselinePath = join(ROOT, "native", "conformance", "esctest-baseline.txt");
  const baseline = existsSync(baselinePath)
    ? new Set(readFileSync(baselinePath, "utf8").split("\n").map((name) => name.trim()).filter(Boolean))
    : null;
  const upstream = baseline ? failing.filter((name) => baseline.has(name)) : [];
  const ours = baseline ? failing.filter((name) => !baseline.has(name)) : failing;
  const p0Failing = failing.filter((name) => P0_CLASSES.has(name.split(".")[0]));

  console.log(
    `\nconformance: esctest2 ${passed} passed / ${known} known bugs / ${failed} failed (${total})`,
  );
  if (!baseline) {
    console.log(
      `conformance: no ${join(ROOT, "native", "conformance", "esctest-baseline.txt")} — every failure counts as ours (regenerate the baseline per issue #46 §四)`,
    );
  } else {
    console.log(`  kernel-limited (upstream fails them too): ${upstream.length}`);
    console.log(`  ours (not in the upstream baseline): ${ours.length}`);
    for (const name of ours) console.log(`    ${name}`);
  }
  console.log(`  P0 (${P0_CLASSES.size} classes): ${p0Failing.length === 0 ? "all green" : `${p0Failing.length} failing`}`);
  for (const name of p0Failing) console.log(`    P0 ${name}`);

  // The badges read this: the measured numbers move, the kernel's do not.
  const today = new Date().toISOString().slice(0, 10);
  const conformanceJson = join(ROOT, "docs", "evidence", "conformance.json");
  const json = JSON.parse(readFileSync(conformanceJson, "utf8")) as Record<string, unknown>;
  (json.esctest2 as Record<string, unknown>) = {
    passed,
    knownBugs: known,
    failed,
    total,
    measured: today,
    against: `feat/conformance-e2e (issue #46)`,
  };
  writeFileSync(conformanceJson, `${JSON.stringify(json, null, 2)}\n`);
  console.log(`conformance: badges updated in ${conformanceJson}`);

  if (gate) {
    if (p0Failing.length > 0) {
      fail(`conformance: --gate=p0 fails: ${p0Failing.length} P0-class test(s) failing`);
    }
    console.log("conformance: --gate=p0 passes");
  }
}

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

  // Built-in extension skills are external assets like the WASM: bun compiles
  // them into nothing. `skillsBase()` looks beside the executable first, so the
  // tree must land next to pi-acp, not at the app root.
  rmSync(join(helpers, "skills"), { recursive: true, force: true });
  cpSync(join(HARNESS, "skills"), join(helpers, "skills"));

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

  // Every skill the source tree ships must be in the bundle; a partial copy
  // would disable one built-in extension's skill silently. The list is derived
  // from the source, so adding `skills/todos/SKILL.md` needs no edit here.
  const missingSkills = skillFiles(join(HARNESS, "skills")).filter(
    (skill) => !existsSync(join(helpers, "skills", skill)),
  );
  if (missingSkills.length > 0) {
    fail(`error: Contents/Helpers/skills is missing bundled skills:\n${missingSkills.join("\n")}`);
  }
  console.log("✓ Contents/Helpers/skills carries every built-in extension skill");

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

/** Every `SKILL.md` under a skills tree, as slash paths relative to its root. */
function skillFiles(root: string, prefix = ""): string[] {
  if (!existsSync(root)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...skillFiles(join(root, entry.name), relative));
    else if (entry.isFile() && entry.name === "SKILL.md") found.push(relative);
  }
  return found;
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
    // The installed Zu owns `~/.steer`'s lock and manox home; dev gets its
    // own roots so both run at once. `ZU_STATE_DIR` still wins when set
    // explicitly. `ZU_STATE_DIR` suppresses state migration; `MANOX_HOME`
    // suppresses manox migration.
    const stateDir = process.env.ZU_STATE_DIR ?? DEV_STATE;
    const manoxHome = process.env.MANOX_HOME ?? join(stateDir, "manox");
    console.log(`dev state: ${stateDir}; dev manox: ${manoxHome}`);
    // `nsh run` blocks while the app runs: the terminal is its own.
    run([nsh, "run", "--port", PORT], APP, { ZU_STATE_DIR: stateDir, MANOX_HOME: manoxHome });
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
  case "conformance": {
    // `bun run conformance -- esctest` passes the arguments after a literal
    // `--`; argv carries it, and no suite is ever named `--`.
    let gate = false;
    let suite: "esctest" | "ucs" | "all" = "esctest";
    for (const arg of process.argv.slice(3).filter((a) => a !== "--")) {
      if (arg === "--gate=p0") gate = true;
      else if (arg === "esctest" || arg === "ucs" || arg === "all") suite = arg;
      else if (arg === "-h" || arg === "--help") {
        console.log(usage());
        process.exit(0);
      } else {
        console.error(`error: unknown option '${arg}'`);
        console.error(usage());
        process.exit(1);
      }
    }
    if (suite !== "esctest") {
      fail("conformance: ucs-detect is 阶段 3 of issue #46 (P2, 记录制) — not wired yet");
    }
    await conformanceEsctest(gate);
    break;
  }
  default:
    fail(`unknown task: ${task} (dev, check, test, evidence, bundle, conformance)`);
}
