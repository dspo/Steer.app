#!/usr/bin/env python3
"""Vendoring transform #2: `export const enum` → `const` object + type union.

The nsh bundler (oxc 0.153, nsh 0.4.0) cannot transform TypeScript enums —
it requires `SemanticBuilder::with_enum_eval(true)` and panics otherwise
(`nsh run app` dies before the first frame; `nsh test` happened to take a
path that tolerates it). The AHP spec ships const enums, so every vendored
file is run through this script after vendoring (see PIN.md, "Transform").

Member semantics are preserved: string members map to string properties,
bare members auto-increment numerically (the TS enum rule, starting at 0
or after the last explicit numeric value), trailing comments stay. The
`as const` + `(typeof X)[keyof typeof X]` union keeps both value and type
positions (`X.Ready` and `let x: X`) working.

Run from the repo root:  python3 contracts/ahp/enums-to-consts.py
Idempotent: files without `export const enum` are left untouched.
"""

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent

ENUM_RE = re.compile(r"export const enum (\w+) \{([^{}]*)\}", re.DOTALL)
MEMBER_RE = re.compile(r"^(\s*)(\w+)\s*=\s*(.+?),?\s*(//.*)?$")
BARE_RE = re.compile(r"^(\s*)(\w+),?\s*(//.*)?$")


def convert_body(body: str, name: str) -> str:
    members: list[str] = []
    auto = 0
    for line in body.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith(("//", "/*", "*")):
            members.append(("comment", line))
            continue
        m = MEMBER_RE.match(line)
        if m:
            indent, key, value, comment = m.group(1), m.group(2), m.group(3).strip(), m.group(4) or ""
            members.append(("member", f"{indent}{key}: {value},{(' ' + comment) if comment else ''}"))
            numeric = re.fullmatch(r"-?\d+", value)
            if numeric:
                auto = int(value) + 1
            continue
        m = BARE_RE.match(line)
        if m:
            indent, key, comment = m.group(1), m.group(2), m.group(3) or ""
            members.append(("member", f"{indent}{key}: {auto},{(' ' + comment) if comment else ''}"))
            auto += 1
            continue
        raise SystemExit(f"enum {name}: unparsable member line: {line!r}")
    out = []
    for kind, line in members:
        out.append(line)
    return "\n".join(out)


def transform(text: str, path: pathlib.Path) -> tuple[str, int]:
    count = 0

    def repl(m: re.Match) -> str:
        nonlocal count
        count += 1
        name, body = m.group(1), m.group(2)
        members = member_names(body)
        ns = "\n".join(
            f'  export type {member} = (typeof {name})["{member}"];' for member in members
        )
        return (
            f"export const {name} = {{\n{convert_body(body, name)}\n}} as const;\n"
            f"export type {name} = (typeof {name})[keyof typeof {name}];\n"
            f"export namespace {name} {{\n{ns}\n}}"
        )

    return ENUM_RE.sub(repl, text), count


def member_names(body: str) -> list[str]:
    names: list[str] = []
    for line in body.splitlines():
        m = MEMBER_RE.match(line) or BARE_RE.match(line)
        if m:
            names.append(m.group(2))
    return names


def main() -> None:
    total = 0
    for path in sorted(ROOT.rglob("*.ts")):
        text = path.read_text()
        if "export const enum" not in text:
            continue
        text, count = transform(text, path)
        path.write_text(text)
        total += count
        print(f"{path.relative_to(ROOT)}: {count} enums → const objects")
    print(f"total: {total}")


if __name__ == "__main__":
    sys.exit(main())
