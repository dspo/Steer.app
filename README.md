# Zu

**Zu**（祖冲之——纪念其对 π 的贡献）是 [`pi`](https://www.npmjs.com/package/@earendil-works/pi-coding-agent)
coding agent 的桌面端，TSX 写在 [NSH](https://nsh.dev) 上。工作台形态借鉴 ThinkRail 与 iTerm2/Warp：
壳（项目侧栏、顶栏、页签条）包着一块 `DockArea` 画布，**panel** 持有可拖拽的 **sheet**（Pi 会话、
终端、各 agent TUI、webview、编辑器、diff、LSP Problems）。logo 为 Steer 的 `<->` 构型加载祖冲之密率
（上 355、下 113）。

**当前状态（as of 2026-11-12）**：M0–M12 已交付（地基、对话、契约与监督、容器与面板、项目与 Launcher、子代理、轮廓、
终端、编辑器、Git、浏览器、LSP、常驻与更新）。Casing II：**§2.1-1（`a58e0ad`）、§2.1-2（`bcd4004`）、
§2.1.1 F1（`4293eb7`）已提交**；**§2.0 的 P0-1/P0-2 已完成**（引擎级模型注册表、无模型界面），
**§2.1.1 F2/F3 已完成**（容器内终端资源、原生 Pi TUI），**§2.1-3 已完成**（scratch 画布的页面与铸容器）、**§2.1-4 已完成**（动作可用性矩阵）、**§2.1-5 已完成**（容器标题 S2）、**§2.1-6 已完成**（语言跟随系统）、**§2.1-7 已完成**（无 sheet 自动归档）；
**§2.1 全部完成**；§2.2 全部完成（S3 外壳、侧栏拖拽 + `settings.*`、移除 picker、composer 仅交互与 11a 斜杆命令、红绿灯、Chrome 页签宽度）；
**§2.3 全部完成**（第 14 项品牌图标、第 15 项拖拽幽灵 + 落位竖线、第 16 项 Lilex 字体——crate 经 `assets!()` 壳带、引擎首帧前注册，sheet 内容用 Lilex、轮廓系统字体；15 的"源 tab 占位"仍待 nsh 升级，见证据）。
**§5 代码仓库整洁化已完成**（C1 死代码与导出、C2 五层目录 shell/canvas/stores/sheets/ui、C3 Launcher→Hero 统一、
C4 单一事实源、C5 无条件等待清零、C6 文档与证据、C7 fmt/clippy/错误码表）；挂起项不变（B2 等样本、M13 等账号）。
**C8 三包布局已完成（2026-11-12，Q96）**：`app/`（nsh 应用 + 测试）+ `native/`（zu-native crate）+ `pi-harness/`（完整 pi 发行版），
`contracts/` 留根作共享面；nsh 命令以 `app` 为应用目录，字体随 crate（`native/assets/fonts`）。
门禁：`nsh check app` ✓、`cargo check --all-targets`（`native/`）✓、`nsh test app` ✓（live 的 steer 用例偶发供应商慢首 token，重跑全绿）、`script/bundle-mac.sh` ✓。证据见
[docs/evidence/c8-layout.md](docs/evidence/c8-layout.md)、
[docs/evidence/s1-hero-sheet.md](docs/evidence/s1-hero-sheet.md)、
[docs/evidence/s21-2-switch-hydrate.md](docs/evidence/s21-2-switch-hydrate.md)、
[docs/evidence/s21-1-hero-actions.md](docs/evidence/s21-1-hero-actions.md)、
[docs/evidence/s20-models.md](docs/evidence/s20-models.md)、
[docs/evidence/s211-f2f3-container-terminals.md](docs/evidence/s211-f2f3-container-terminals.md)、
[docs/evidence/s21-3-scratch.md](docs/evidence/s21-3-scratch.md)、
[docs/evidence/s21-4-action-matrix.md](docs/evidence/s21-4-action-matrix.md)、
[docs/evidence/s21-5-container-title.md](docs/evidence/s21-5-container-title.md)、
[docs/evidence/s21-6-system-locale.md](docs/evidence/s21-6-system-locale.md)、
[docs/evidence/s21-7-auto-archive.md](docs/evidence/s21-7-auto-archive.md)、
[docs/evidence/s22-8-shell.md](docs/evidence/s22-8-shell.md)、
[docs/evidence/s22-9-sidebar-drag.md](docs/evidence/s22-9-sidebar-drag.md)、
[docs/evidence/s22-10-remove-picker.md](docs/evidence/s22-10-remove-picker.md)、
[docs/evidence/s22-11-composer.md](docs/evidence/s22-11-composer.md)、
[docs/evidence/s22-11a-slash.md](docs/evidence/s22-11a-slash.md)、
[docs/evidence/s22-12-13-chrome.md](docs/evidence/s22-12-13-chrome.md)、
[docs/evidence/s23-14-brand-icons.md](docs/evidence/s23-14-brand-icons.md)、
[docs/evidence/s23-15-drag-ghost.md](docs/evidence/s23-15-drag-ghost.md)、
[docs/evidence/s23-16-lilex.md](docs/evidence/s23-16-lilex.md) 与 `docs/evidence/ui-s2-*.png`。
2026-11-11 的计划调整：移除顶栏 picker、模型问题升为 P0、
Composer 接入 pi 斜杆操作、新增代码仓库整洁化并行轨道（[plan §5](docs/plan.md)）。

## 文档

| Doc | 内容 |
|---|---|
| [docs/plan.md](docs/plan.md) | **执行指导**：已完成的工作、下一批任务（Casing II / Hero sheet）、批次与验收 |
| [docs/architecture.md](docs/architecture.md) | 架构：约束、后端 sidecar、前端轮廓与画布、对象模型、技术选型、风险 |
| [docs/DESIGN.md](docs/DESIGN.md) | 视觉规格：Token、外壳几何（Casing II 目标）、表面语言、动效、各模块界面 |
| [docs/decisions.md](docs/decisions.md) | 决策台账 Q1–Q95 |
| [docs/evidence/](docs/evidence/) | 依据：spike 实测、可行性、终端仿真核对比、API 核实、各里程碑验证记录 |
| [docs/research/](docs/research/) | 外源调研存档：ThinkRail 与 manox-app 的可吸纳项清单（已吸纳项的出处，按仓库 HEAD 快照） |

## 代码地图（`app/` + `native/` + `pi-harness/` + `contracts/`）

仓库是三包 + 一共享面：**`app/`**（nsh 应用：入口、五层前端、测试与 fixtures，`nsh.json` 在此）、
**`native/`**（`zu-native` crate：Rust native module，Lilex 经 `assets!()` 随 crate 壳带）、
**`pi-harness/`**（完整的 pi 发行版：精确 pin 的 pi 1.5.0 + wire 胶水 + 内置扩展，`bun --compile` 成 sidecar）、
**`contracts/`**（冻结的 wire 契约：`protocol.ts` 类型/命令/事件表/校验 + `protocol.md`——UI 与 harness 的共享面，
不属于任何一侧，留在根）。`app/nsh.json` 以 `"rust": "../native"` 指向 crate；nsh 命令一律以 `app` 为应用目录。

`app/` 根上是入口与锚点：`App.tsx`（bootstrap：装滚动条主题、boot 引擎一次、渲染 `Workbench`；nsh 的入口解析它，
留在 `app/` 根）、`theme.json`（shadcn 风格 token，light + dark）、`assets/`（托盘图标——TSX 资产）、
测试与 fixtures。

其余模块按层归位（依赖自上而下：shell → sheets/canvas → stores → ui；下表路径都相对 `app/`）：

**`shell/`——工作台与生命周期**

| File | What it is |
|---|---|
| `shell/shell.tsx` | The workbench: project/container sidebar, engine bar, controlled `DockArea`, status line |
| `shell/lifecycle.ts` | The app lifecycle: claim the single-instance lock (desktop only), boot the engine only as the primary instance, release the claim on quit |
| `shell/lifecycle-ui.tsx` | `LifecycleHost` (tray, close-press → hide, application menu with a real Quit) and the second-instance notice |

**`stores/`——域状态（引擎连接、容器、会话与各 sheet 的数据面）**

| File | What it is |
|---|---|
| `stores/engine.ts` | The shell's connection, supervised reconnect, snapshot/Ui request plumbing |
| `stores/dock.ts` | Layout data and pure edits: stable session and Hero sheet ids, append/activate/prune, visible-panel set |
| `stores/containers.ts` | Container store: create/switch/archive, the scratch canvas (in-memory layout), layout stash + zoom restore, the Hero's open/submit paths, sidebar projection |
| `stores/sessions.ts` | Per-session views: folds engine events by session id, rebuilds from a snapshot, reopens by file |
| `stores/projects.ts` | Project store: `projects.json` projection, explicit membership, the Hero's project target |
| `stores/editors.ts` | Editor documents by stable sheet id, save (`stat` → `write` → read-back), stale conflict, reload, Mod+S target |
| `stores/terminals.ts` | PTY store: one `Pty` per terminal resource (`terminal:{containerId}:{n}`, several per container), replay buffer, title/exit mirror, archive close |
| `stores/browser.ts` | The browser store: one page per `webview:{containerId}:{n}` sheet (the scratch canvas's pages are `webview:scratch:{n}` until a container mints), URL/title/loading/error state, address normalization, `WebView.available()` probe |
| `stores/git.ts` | The typed face of `zu/git` and the per-container Changes/History projection: status, log, branches, staging, commit, checkout, notices |
| `stores/lsp.ts` | The UI LSP client: one server per container/language family, initialize/document sync, diagnostics, hover/definition/completion, request ids/timeouts/cancellation, URI↔path, the diagnostics and Problems stores |
| `stores/fs.ts` | The typed face of `zu/fs`: entries, versions, failure codes, canonical workspace root |
| `stores/file-tree.ts` | Pure file-tree data: sorting, expanded rows, row test ids, sheet-id helpers |
| `stores/instance.ts` | The typed face of `zu/native`'s `Instance` claim |
| `stores/notifications.ts` | System notifications for settled turns/subagents: hidden-or-unfocused policy, per-session ids, permission, press → window + sheet |
| `stores/updates.ts` | The update state machine: development/unconfigured/available, check → download progress → ready → install, honest errors |
| `stores/slash.ts` | pi 1.5.0's slash commands mapped to Zu: local store actions, verbatim prompts, unsupported reasons |
| `stores/search.ts` | Sidebar search matching: `containerMatches`/`sessionMatches` |
| `stores/settings.ts` | `settings.get`/`settings.put` over `zu/settings.json`: the sidebar width, clamped, atomic |
| `stores/subagents.ts` | Subagent roster store: runs, selection, read-only transcript, note/auto-open wiring |
| `stores/vscode.ts` | The VS Code action: the active target's `vscode://file/` URL |
| `stores/picker.ts` | The typed face of `zu/picker` (the Finder folder picker) |

**`canvas/`——sheet 画布（注册表与标题）**

| File | What it is |
|---|---|
| `canvas/sheets.tsx` | The sheet registry: kinds, tab titles and glyphs; `home`/`session`/`terminal`/`files`/`editor`/`diff`/`changes`/`history` have real bodies, the rest mock |
| `canvas/titles.ts` | The container's title (S2): its earliest-created surviving sheet's `title()`, with folder/captain fallbacks |
| `canvas/tab-plus.tsx` | The `+` at each tab bar's right edge (nsh's `DockArea` has no trailing slot): group rectangles from the layout tree and the overlay button |

**`sheets/`——各 sheet 的实体界面**

| File | What it is |
|---|---|
| `sheets/chat-view.tsx` | The session transcript: streaming Markdown rows, tool cards, the streaming caret |
| `sheets/composer.tsx` | The composer: model/thinking/context footer, send/stop, slash-command palette |
| `sheets/files.tsx` | The real Files sheet (lazy tree, compare dialog), Editor sheet (find/replace bar, conflict/read-only states) and two-file Diff sheet |
| `sheets/git-ui.tsx` | The real Changes sheet (grouped status, stage/unstage, `DiffView` in `patch` mode, commit line, identity dialog) and History sheet (log, branch menu) |
| `sheets/lsp-ui.tsx` | The real Problems sheet (`problems:{containerId}`: severity/file/line, reveal on click, server state/progress/error/restart) and the hover card (`Overlay` + `TextView`) |
| `sheets/browser-ui.tsx` | The real Browser sheet: one `WebView`, address bar, history/reload/stop, loading rail, error panel, default page and the UI-only page-message log |
| `sheets/updates-ui.tsx` | The Updates dialog (version, notes, progress, install) and the notification permission row |
| `sheets/hero.tsx` | The Hero sheet (`home:{containerId}` / `home:scratch`): project chip, composer, the two tool rows and the project creation dialog |
| `sheets/project-roots.ts` | The dialog's root-draft rules: Finder paths only, exactly one primary, first chosen wins |

**`ui/`——呈现原语与文案**

| File | What it is |
|---|---|
| `ui/ui.tsx` | Canvas glyphs、`Dot`/`Chip`、motion/阴影 token、`applyScrollbarTheme` |
| `ui/ui-host.tsx` | Extension UI host: dialogs, toast stack, status lines, window title |
| `ui/fonts.ts` | The Lilex family constant the crate ships (§2.3-16) |
| `ui/brand-icons.tsx` | The four brand marks (Claude/Codex/Copilot/Pi), pure-tint Canvas fills |
| `ui/languages.ts` | The editor/LSP language table (`languageFor`), shared so `editors.ts` and `lsp.ts` agree on a file |
| `ui/i18n.ts`, `ui/locales/` | zh-CN/en key tables and the parity test's key list |
| `ui/copy.ts` | Shell copy helpers shared by fixtures and tests |

**Rust 侧（`native/src/`，与上表各 typed face 一一对应）**：`native/src/lib.rs`（native module 注册面 + Lilex 壳带；
dev 模式的 sidecar 路径按 crate 位置回退 `../pi-harness/dist/pi-engine`）、
`native/src/instance.rs`（单实例锁）、`native/src/pty.rs`（PTY）、`native/src/lsp.rs`（LSP）、`native/src/fs.rs`（fs 策略）、
`native/src/git.rs`（git 策略）、`native/src/picker.rs`（Finder picker）。错误码见 §3.6 的索引（权威在各模块 `//!` 文档）。

| Tests | `app/` 根上的 `*.test.ts(x)`（55 个文件：store 纯逻辑 + headless 真 Workbench + live 引擎/pi/LSP 用例），`nsh test app` 计 265/265，含 53 条 Rust 单测（crate 在 `native/`） |

交互全部来自 `nsh/base DockArea`：拖 sheet 到另一 panel（移动且状态不丢）、拖到组边缘分栏、拖手缩放、`×` 关闭、Zoom、<600pt compact。
唯一的例外是每组标题栏右端的 `+`：0.4.0 的 tab bar 没有尾部插槽，`tab-plus.tsx` 按布局几何把它画成覆盖层（见
[docs/evidence/s1-hero-sheet.md](docs/evidence/s1-hero-sheet.md)）。

## Run it

With `nsh` on your `PATH` ([install](https://nsh.dev/docs/installation)), or a checkout build:

```sh
nsh run app --target macos   # the AppKit host
nsh run app --target web     # the browser
nsh check app                # cargo check the crate + typecheck the TSX
nsh test app                 # Rust + headless TS tests (live pi cases; ZU_SKIP_LIVE=1 skips)
```

The harness is a working copy of the sidecar: `cd pi-harness && bun run build` before
`nsh run app` or `script/bundle-mac.sh` if `pi-harness/src` changed. `cd pi-harness && bun run models:parity`
compares a session's model list with `pi --list-models` on this machine.

## 文档治理

- **状态锚点**：本节的「当前状态」写日期、未提交状态与最近一次门禁结果；技术细节不靠散文维护，以 `nsh check` / `nsh test` / 打包冒烟的输出为准。
- **版本台账**：pi 在 `pi-harness/package.json` 精确 pin（`src/version.ts` 由 `check-version` 守）；nsh 在 `native/Cargo.toml` **git pin `506b5392`（0.4.0）** + `Cargo.lock`——发布版 0.4.0 没有 `nsh/base Terminal`，M7 必须用 checkout（Q54）。任一侧升级都要跑引擎测试、UI 测试、终端与 DockArea 冒烟，并在 [decisions.md](docs/decisions.md) 记录。
- **协议变更**：`contracts/` 是 UI 与 engine 的唯一共享面。改协议 = 同一个 PR 里改 TS 类型、`protocol.md` 与两侧实现；`v` 递增即表示不兼容。
- **决策变更**：先改 [decisions.md](docs/decisions.md) 的台账与 [architecture.md](docs/architecture.md) 的正文，再改代码；过程写进 [docs/evidence/decision-log.md](docs/evidence/decision-log.md)。
