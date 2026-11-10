# Zu (`nsh-pi`)

**Zu**（祖冲之——纪念其对 π 的贡献）是 [`pi`](https://www.npmjs.com/package/@earendil-works/pi-coding-agent)
coding agent 的桌面端，TSX 写在 [NSH](https://nsh.dev) 上——当前为 outline PoC，引擎未接线。工作台形态
借鉴 [ThinkRail](https://github.com/JetBrains/ThinkRail) 与 iTerm2/Warp：壳（rail、项目侧栏、工具栏、
状态条）包着一块 `DockArea` 画布，**panel** 持有可拖拽的 **sheet**（Pi 会话、终端、各 agent TUI、
webview、会话的 aux 视图）。logo 为 Steer 的 `<->` 构型加载祖冲之密率（上 355、下 113）。

**当前状态**：outline PoC（工作台可交互、内容为 mock），引擎与 native module 尚未接线；下一步是 [roadmap](docs/roadmap.md) 的 M0。

## 文档

**决策文档**（最终形态，轻易不动）

| Doc | 内容 |
|---|---|
| [docs/architecture.md](docs/architecture.md) | 架构：约束与原则、后端 sidecar、前端轮廓/画布、对象模型、技术选型 |
| [docs/decisions.md](docs/decisions.md) | 决策台账：Q1–Q31（问题 → 裁决 → 落点） |
| [docs/roadmap.md](docs/roadmap.md) | 产品目标、里程碑纪律、M0–M11 与条件性里程碑 |

**依据文档**（决策的过程与证据）

| Doc | 内容 |
|---|---|
| [docs/evidence/decision-log.md](docs/evidence/decision-log.md) | 每条决策的约束、选项与选择理由；被否决的方向 |
| [docs/evidence/spike-report.md](docs/evidence/spike-report.md) | spike 实测：bun compile、pi 会话 API、custom entry、存储布局 |
| [docs/evidence/feasibility.md](docs/evidence/feasibility.md) | 五项重型集成可行性：终端、浏览器、PTY、编辑器/IDE、Git |
| [docs/evidence/terminal-emulator.md](docs/evidence/terminal-emulator.md) | nsh VtEmulator 与 Ghostty 的逐项对比、trait 上限约束 |

## 当前实现（outline）

| File | What it is |
|---|---|
| `App.tsx` | The shell + the controlled `DockArea` wiring (rail, projects pane, toolbar, status line) |
| `dock.ts` | Layout data and its pure edits (`initialLayout`, `appendSheet`, `activateSheet`) |
| `sheets.tsx` | The sheet registry: 13 kinds, tab titles and glyphs, mock bodies |
| `ui.tsx` | Canvas glyphs, `Logo`（`<->` + 355/113）, `Dot`, `Chip`, `SectionTitle` |
| `theme.json` | Design tokens (shadcn-style, light + dark) via `nsh.json` `"theme"` |
| `App.test.tsx` | Headless `nsh test`: outline, add-sheet, counter-survives-move |

交互全部来自 `nsh/base DockArea`：拖 sheet 到另一 panel（移动且状态不丢）、拖到组边缘分栏、拖手缩放、`×` 关闭、Zoom、<600pt compact。

## Run it

With `nsh` on your `PATH` ([install](https://nsh.dev/docs/installation)), or a checkout build:

```sh
nsh run . --target macos   # the AppKit host
nsh run . --target web     # the browser
nsh check .                # typecheck the TSX
nsh test .                 # the headless tests
```
