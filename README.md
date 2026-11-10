# Zu (`nsh-pi`)

**Zu**（祖冲之——纪念其对 π 的贡献）是 [`pi`](https://www.npmjs.com/package/@earendil-works/pi-coding-agent)
coding agent 的桌面端，TSX 写在 [NSH](https://nsh.dev) 上——当前为 outline PoC，引擎未接线。工作台形态
借鉴 [ThinkRail](https://github.com/JetBrains/ThinkRail) 与 iTerm2/Warp：壳（rail、项目侧栏、工具栏、
状态条）包着一块 `DockArea` 画布，**panel** 持有可拖拽的 **sheet**（Pi 会话、终端、各 agent TUI、
webview、会话的 aux 视图）。logo 暂用 `<Z>`（Steer 的 `<->` 同款构型）。

## Architecture docs

| Doc | What it covers | Status |
|---|---|---|
| [docs/engine-architecture.md](docs/engine-architecture.md) | 引擎与前后端架构：vendored pi sidecar、`EngineConnection` 边界、wire、能力面、分发、spike 清单 | 定稿；Q6 已裁决（E9） |
| [docs/ui-architecture.md](docs/ui-architecture.md) | 前端 UI 架构：轮廓分离、panel/sheet 画布、sheet 注册表、布局 store、待建清单 | 定稿；Q4/Q5 已裁决（U7–U10） |
| [docs/domain-model.md](docs/domain-model.md) | 关系对象模型：Project/membership、SessionContainer、资源三类、生命周期、状态分级表、pi 扩展裁决 | 定稿；Q1–Q3 已裁决（§4.4/§8/§9） |
| [docs/spike-report.md](docs/spike-report.md) | Spike 实测报告：bun compile、pi 会话格式与 custom entry、存储布局、子会话自证 | **已完成** |
| [docs/open-questions.md](docs/open-questions.md) | 问题清单：Q1–Q22 裁决总表、Q23–Q27 待回答（pi 生态与分发）、v1 待验证风险 | **Q23–Q27 待回答** |

开放问题回答后，结论并入对应文档的决策记录表，条目随之删除。

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
