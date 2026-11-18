/**
 * The CNB pipeline's stage bodies, as bun tasks: each `.cnb.yml` stage is one
 * line — `bun script/ci.ts <name>` — and the logic lives here, where it is
 * type-checked, runnable locally on macOS, and shares the nsh discovery and
 * spawn discipline with `script/tasks.ts` (script/lib/toolchain.ts).
 *
 * Stages, in pipeline order:
 *   layer-gate  the sheet-module dependency gate (zero compile, seconds)
 *   lint-rust   cargo fmt + clippy, hard gate, both workspaces
 *   build       `nsh check app` with the malachite-bigint split retry
 *   test        the native workspace's Rust tests, then the app's headless
 *               suite (`ZU_SKIP_LIVE` set by the pipeline)
 *   manox       the manox hermetic gate, both files, `ZU_MANOX_GATE=1`
 *   harness     pi-harness's own version ledger + bun test
 *   conformance  the esctest2/ucs-detect report — report-only, never red
 *
 * `toolchain` is the one stage that stays inline shell in `.cnb.yml`: it
 * installs bun itself (apt, curl, rustup components), and there is no bun to
 * run this file with until it has.
 */

import { existsSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BUN, checkNsh, fail, HARNESS, nshBinary, ROOT, run } from "./lib/toolchain.ts";

/** The native workspace and the manox workspace are independent ([workspace]
 * on both sides); a workspace-level cargo gate must run in each or half the
 * code goes ungated. */
const CARGO_WORKSPACES = ["native", "native/manox"];

function layerGate(): void {
  run([BUN, "script/check-layers.mjs"], ROOT);
}

function lintRust(): void {
  for (const workspace of CARGO_WORKSPACES) {
    const cwd = join(ROOT, workspace);
    run(["cargo", "fmt", "--all", "--check"], cwd);
    run(["cargo", "clippy", "--all-targets", "--", "-D", "warnings"], cwd);
  }
}

function build(): void {
  const nsh = nshBinary();
  checkNsh(nsh);
  // `nsh check` is the only type-checking gate; beyond the per-crate cargo
  // check it really compiles the dependencies in the generated app workspace
  // (app/.nsh/rust) — where resolution is fresh and the malachite-bigint
  // split (pymath 0.2.0 declares `version = "0"`, fresh resolution picks
  // 0.14 while rustpython-* pins 0.12) almost always fails the first try
  // with a wall of E0277/E0308. That wall goes to a file, not the log: a
  // green build's log stays clean, and a failure that is NOT the known
  // split prints in full and stays red.
  const firstLog = "/tmp/nsh-check-first.log";
  const logFd = openSync(firstLog, "w");
  const first = Bun.spawnSync([nsh, "check", "app"], { cwd: ROOT, stdout: logFd, stderr: logFd });
  if (first.exitCode === 0) return;

  const dup = malachiteSplit(join(ROOT, "app", ".nsh", "rust", "Cargo.lock"));
  if (!dup) {
    console.error("nsh check 失败，且不是已知 malachite 分裂——完整首试日志：");
    console.error(readFileSync(firstLog, "utf8"));
    process.exit(first.exitCode ?? 1);
  }
  console.error(`malachite-bigint 分裂成 0.12.0 + ${dup}（新鲜解析），降回单副本后重试`);
  run(["cargo", "update", "--manifest-path", "app/.nsh/rust/Cargo.toml", "-p", `malachite-bigint@${dup}`, "--precise", "0.12.0"], ROOT);
  run([nsh, "check", "app"], ROOT);
}

/** The non-0.12.0 `malachite-bigint` in the fresh lock, if any: the same
 * `name` line followed by its `version` line, first offender wins. */
function malachiteSplit(lock: string): string | null {
  if (!existsSync(lock)) return null;
  const lines = readFileSync(lock, "utf8").split("\n");
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i].trim() !== `name = "malachite-bigint"`) continue;
    const version = /version = "(.*)"/.exec(lines[i + 1])?.[1];
    if (version && version !== "0.12.0") return version;
  }
  return null;
}

function test(): void {
  const nsh = nshBinary();
  checkNsh(nsh);
  // `nsh test` runs `cargo test` for each `"rust"` crate alone; the native
  // workspace's member crates (`zu-ghostty`, the libghostty-vt wrapper) are
  // only tested by a workspace run.
  run(["cargo", "test", "--workspace"], join(ROOT, "native"));
  run([nsh, "test", "app"], ROOT);
}

function manox(): void {
  const nsh = nshBinary();
  checkNsh(nsh);
  // `gated = process.env.ZU_MANOX_GATE === "1"` in the files: without it the
  // assertions silently skip, and a bare `nsh test app` looks green while
  // the fold reconciliation, panic recovery and sheet gate never ran. The
  // paths are repo-root-relative, like the stage always ran them.
  run([nsh, "test", "app/tests/manox.test.ts"], ROOT, { ZU_MANOX_GATE: "1" });
  run([nsh, "test", "app/tests/manox.ui.test.tsx"], ROOT, { ZU_MANOX_GATE: "1" });
}

function harness(): void {
  // No `bun run build`: the compile target pins bun-darwin-arm64, which a
  // Linux runner cannot make; the version ledger and bun test are the gate.
  run([BUN, "install", "--frozen-lockfile"], HARNESS);
  run([BUN, "run", "check-version"], HARNESS);
  run([BUN, "test"], HARNESS);
}

function conformance(): void {
  // Report-only by decision (issue #46 §五, like Ghostty's own CI): the
  // esctest2/ucs-detect numbers land in this stage's log whatever happens
  // — a red conformance run never blocks a merge. `run` would exit the
  // process on failure, so this spawns and echoes by hand.
  console.log("conformance stage: report-only（结果不拦合并，摘要如下）");
  const proc = Bun.spawnSync([BUN, "script/tasks.ts", "conformance"], {
    cwd: ROOT,
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  process.stdout.write(proc.stdout.toString());
  process.stderr.write(proc.stderr.toString());
  console.log(`conformance stage: exit=${proc.exitCode ?? "signal"}（report-only，不拦合并）`);
}

const stages: Record<string, () => void> = {
  "layer-gate": layerGate,
  "lint-rust": lintRust,
  build,
  test,
  manox,
  harness,
  conformance,
};

const task = process.argv[2];
if (!task || task === "-h" || task === "--help") {
  console.log(`Usage: bun script/ci.ts <stage>   (stages: ${Object.keys(stages).join(", ")})`);
  process.exit(task ? 0 : 1);
}
const stage = stages[task];
if (!stage) fail(`unknown stage: ${task} (stages: ${Object.keys(stages).join(", ")})`);
console.log(`→ ci: ${task}`);
stage();
