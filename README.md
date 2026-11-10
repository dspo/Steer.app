# nsh-pi (Pi Desktop)

A **panel + sheet workbench** for the [`pi`](https://www.npmjs.com/package/@earendil-works/pi-coding-agent)
coding agent, written in TSX on [NSH](https://nsh.dev) — outline PoC, no engine wired. The shape
borrows from [ThinkRail](https://github.com/JetBrains/ThinkRail) and iTerm2/Warp: a shell
(rail, projects pane, toolbar, status line) around a `DockArea` canvas whose **panels** hold
draggable **sheets** (a Pi session, terminals, agents' TUIs, a webview, a session's aux views).

## Architecture (frontend)

- **轮廓与内嵌对象分离** — the shell holds no domain state; the canvas is a controlled
  `nsh/base DockArea`: the app owns the layout, the area reports every edit as the whole new
  layout, and sheet bodies render keyed by sheet id (so a sheet keeps its state wherever it
  moves).
- **`dock.ts`** — the layout store: `initialLayout`, `appendSheet` (into the shown group),
  `activateSheet`, `sheetCount`, fresh instance ids. All pure edits of the layout value.
- **`sheets.tsx`** — the sheet registry: kinds (session, terminal, claude, codex, copilot,
  webview, editor, diff, files, subagents, tasks, traces, stats), tab titles and glyphs, and
  the mock body (one line of text plus a tap counter that survives drags).
- **`App.tsx`** — the shell: rail, projects pane (a session's row opens its sheet), toolbar
  (add a sheet of a kind, zoom the shown group, reset), the `DockArea` with styled parts
  (tab bar, handles, drop indicator), and the status line.

## Interactions (all `DockArea`, native)

- Drag a sheet's tab onto another panel — it moves there, state intact.
- Drag a tab to a group's edge — the group splits, the sheet docks there.
- Drag the hairline handles (a thumb grows in under the pointer) — resize panels and docks.
- Tab presses switch sheets; a tab's × closes it; Zoom fills the area with one panel.
- Docks (left) toggle, resize, and host sheets like any panel.
- Below 600 pt the area goes compact: one group at a time, docks as drawer and sheet.

## Layout

| File | What it is |
|---|---|
| `App.tsx` | The shell + the controlled `DockArea` wiring |
| `dock.ts` | Layout data and its pure edits |
| `sheets.tsx` | The sheet registry and mock bodies |
| `ui.tsx` | Canvas-stroked glyphs (`Glyph`), `Dot`, `Chip`, `SectionTitle` |
| `theme.json` | Design tokens (shadcn-style, light + dark) via `nsh.json` `"theme"` |
| `App.test.tsx` | Headless `nsh test`: outline, add-sheet, counter |

## Run it

With `nsh` on your `PATH` ([install](https://nsh.dev/docs/installation)), or the checkout build
`~/projects/github/nsh/target/debug/nsh`:

```sh
nsh run . --target macos   # the AppKit host — the real drag/resize feel
nsh run . --target gpui    # the GPUI host
nsh run . --target web     # the browser
nsh check .                # typecheck the TSX
nsh test .                 # the headless tests
```

Next steps (see the architecture notes in the repo's plan history): wire `EngineConnection`
to a vendored pi sidecar; sheet bodies become projections of the session stores.
