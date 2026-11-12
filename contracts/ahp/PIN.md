# AHP vendored types — pin and sync

The manox harness client (`app/harness/manox/`) folds channel state with the
AHP spec's TypeScript types and reducers. They are **vendored** here (the app
keeps zero npm dependencies; vendored files are plain TS imports), pinned to
one upstream commit.

## What is vendored

The client's needed closure, computed from the seed list below by following
relative imports until fixed point. `types/action-origin.generated.ts` (the
generated action union) and the `types/actions.ts` / `reducers.ts` / `state.ts`
aggregators pull type-only leaves of channels the client never folds
(terminal/changeset/annotations/automation/otlp/resource-watch); they are
vendored unmodified so the generated union type-checks. The client's fold
surface is exactly:

- `reducers.ts` → `rootReducer` / `sessionReducer` / `chatReducer`
  (and `softAssertNever` / `isClientDispatchable` from `common/reducer-helpers.ts`)
- channels: `channels-root`, `channels-session`, `channels-chat` (types + reducers)
- wire: `common/messages.ts` (JSON-RPC), `common/commands.ts` +
  `channels-*/commands.ts` (initialize/subscribe/reconnect/dispatchAction,
  createSession, createChat), `common/errors.ts`, notifications
- vocabulary: `common/actions.ts`, `common/state.ts`, `action-origin.generated.ts`

Seeds: `common/errors.ts`, `action-origin.generated.ts`, `actions.ts`,
`reducers.ts`, `common/messages.ts`, `notifications.ts`, `state.ts`,
`common/{reducer-helpers,timestamps}.ts`, and the root/session/chat channels'
`{actions,reducer,state}.ts` (+ `channels-root/notifications.ts`).

## Pin

| | |
|---|---|
| Source repo | `~/projects/github/agent-host-protocol` (remote `https://github.com/microsoft/agent-host-protocol.git`) |
| Vendored commit | `296b25e7b698a4a84a0ee5a28d9573e70048a0bf` (working tree clean) |
| Spec version | TypeScript client `clients/typescript` `0.9.0`; latest tag `v0.9.0` |
| Vendored at | 2026-11-12 (T0-manox, `feat/manox-harness`) |

The repo's `LAST_SYNCED_COMMIT` file named `20c6b266d86c0e22f4e595e43eb41e70dcc17f4b`,
which is not resolvable in the local clone (not an ancestor of the checkout and
not fetchable); the working-tree commit above is what was actually vendored and
tested against.

## Transform (the only edit)

Relative import specifiers lost their `.js` suffix (upstream ships ESM-style
`./x.js` specifiers; this app's TS setup resolves extensionless TS). Everything
else is byte-identical to the pinned commit; each file carries a provenance
header.

## Transform (the second edit)

`export const enum` declarations became `const` objects + type unions +
member-type namespaces. The nsh bundler's oxc (0.153) cannot transform TS
enums (`nsh run` panics: `SemanticBuilder::with_enum_eval(true)` required),
and the spec ships const enums throughout. The mechanical transform —
`contracts/ahp/enums-to-consts.py`, run after every sync — preserves value
semantics (members become properties; the `as const` + union keeps type
positions; the namespace keeps `X.Member` legal in type positions, which
the reconnect discriminants use). The fold gate (`manox.test.ts`) pins
reducer behavior across the transform.

## Sync procedure (M1 and later)

1. In the spec repo: `git pull`, note `HEAD` and confirm the working tree is
   clean.
2. Re-run the vendoring with the same seed list (the closure may have grown —
   recompute it), with the header's commit updated.
3. `grep -r "LAST_SYNCED\|@version"` in `types/` for protocol-version deltas;
   read the upstream `docs/.changes/` fragments since the pinned commit for
   breaking changes.
4. Gates: `nsh check app` (tsc over the vendored tree), then `nsh test app`
   — the fold gate (`manox.test.ts`) pins reducer behavior against the stub
   host's fixtures, so a drift shows up as a failing gate, not on a live wire.
5. Update this file's Pin table; commit vendored changes separately from
   behavior changes.
