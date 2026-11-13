#!/usr/bin/env node
/**
 * The sheet-module dependency gate (docs/sheet-module-ARCHITECTURE.md §11).
 *
 * Rules, in the target architecture:
 *   1. `core/`, `shell/`, `canvas/` never import `modules/` or `domains/`.
 *   2. `domains/` is a leaf: it may import `contracts/` and native faces only.
 *   3. modules may import `core/`, `domains/`, `ui/`, `contracts/` and their
 *      own directory; never `shell/`, `stores/`, `sheets/` or another module.
 *   4. `zu/native` / `manox/native` are imported only under `app/domains/`.
 *
 * The migration is staged (S0–S3), so known violations live in ALLOW with the
 * stage that removes them. A new violation fails the gate immediately; an
 * allow-list entry that no longer exists is a failure too (it must be deleted
 * with the code it excused).
 *
 * Usage: node script/check-layers.mjs [--list]
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
const APP = join(ROOT, "app");

/** Scores of staged exceptions: remove as S1–S3 land. */
const ALLOW = new Set([
  // Empty: S0–S3 landed. A new violation fails the gate immediately.
]);

const categories = new Set(["core", "shell", "canvas", "domains", "modules", "ui", "sheets", "stores", "harness"]);

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) && !full.includes("/fixtures/")) out.push(full);
  }
  return out;
}

function appRel(file) {
  return relative(APP, file).replaceAll("\\", "/");
}

function category(rel) {
  const first = rel.split("/")[0];
  return categories.has(first) ? first : "other";
}

function moduleId(rel) {
  const parts = rel.split("/");
  return parts[0] === "modules" ? parts[1] : null;
}

const violations = [];
for (const file of walk(APP)) {
  const rel = appRel(file);
  // The assembly list is the one file that composes modules; it is not a
  // module and is allowed to import them all.
  if (rel === "modules/register-all.ts") continue;
  const source = category(rel);
  const sourceModule = moduleId(rel);
  const text = readFileSync(file, "utf8");
  const specifiers = [...text.matchAll(/(?:^|\n)\s*(?:import|export)[^"'`]*?from\s+["']([^"']+)["']/g)].map((m) => m[1]);
  for (const spec of specifiers) {
    if (spec === "zu/native" || spec === "manox/native") {
      if (!rel.startsWith("domains/")) violations.push({ rel, spec, rule: "native-only-in-domains", key: `${rel} => native` });
      continue;
    }
    if (!spec.startsWith(".")) continue;
    const target = appRel(resolve(dirname(file), spec)).replace(/\.(tsx?|jsx?)$/, "");
    const targetCat = category(target);
    if (!categories.has(targetCat)) continue;
    const key = `${rel} -> ${target}`;
    const base = target.split("/").slice(0, 2).join("/");
    const keyBase = `${rel} -> ${base}`;
    const fail = (rule) => violations.push({ rel, spec, rule, key, keyBase });
    const sameModule = source === "modules" && targetCat === "modules" && moduleId(target) === sourceModule;
    // Infrastructure, not a module-facing capability: the core persists its
    // state through the `state` domain, and the shell owns two host services
    // (the single-instance lock and the Finder folder picker).
    const infra =
      ((source === "core" || source === "shell") && target === "domains/state") ||
      (source === "shell" && (target === "domains/instance" || target === "domains/picker"));
    if (!infra && ["core", "shell", "canvas"].includes(source) && ["modules", "domains"].includes(targetCat)) fail("trunk-imports-module");
    if (source === "domains" && ["modules", "shell", "core", "stores", "sheets"].includes(targetCat)) fail("domain-is-leaf");
    if (source === "modules" && !sameModule && !["core", "domains", "ui"].includes(targetCat)) fail("module-imports-trunk");
    if (source === "modules" && targetCat === "modules" && !sameModule) fail("modules-do-not-import-each-other");
  }
}

const unknown = [];
const real = [];
for (const v of violations) {
  if (ALLOW.has(v.key) || ALLOW.has(v.keyBase)) real.push(v);
  else unknown.push(v);
}

if (process.argv.includes("--list")) {
  for (const v of [...real, ...unknown]) console.log(`${v.rule}: ${v.rel} -> ${v.spec}`);
  console.log(`known: ${real.length}, new: ${unknown.length}`);
}
if (unknown.length) {
  console.error(`check-layers: ${unknown.length} new dependency violation(s):`);
  for (const v of unknown) console.error(`  ${v.rule}: ${v.rel} -> ${v.spec}`);
  process.exit(1);
}
console.log(`check-layers: ok (${real.length} staged exception(s) in ALLOW)`);
