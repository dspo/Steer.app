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
下一轨道是 [§5 代码仓库整洁化](docs/plan.md)（C1–C7，与功能并行；Casing II 功能项已完，C2/C3 的移动不再冲突）。
门禁：`nsh check` ✓、`cargo check --all-targets` ✓、`nsh test` ✓（live 的 steer 用例偶发供应商慢首 token，重跑全绿）、`script/bundle-mac.sh` ✓。证据见
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

## 代码地图（app + `engine/` + `src/`）

| File | What it is |
|---|---|
| `App.tsx` | The bootstrap: install the scrollbar theme, boot the engine once, then render `Workbench` |
| `lifecycle.ts` | The app lifecycle: claim the single-instance lock (desktop only), boot the engine only as the primary instance, release the claim on quit |
| `lifecycle-ui.tsx` | `LifecycleHost` (tray, close-press → hide, application menu with a real Quit) and the second-instance notice |
| `notifications.ts` | System notifications for settled turns/subagents: hidden-or-unfocused policy, per-session ids, permission, press → window + sheet |
| `updates.ts` | The update state machine: development/unconfigured/available, check → download progress → ready → install, honest errors |
| `updates-ui.tsx` | The Updates dialog (version, notes, progress, install) and the notification permission row |
| `instance.ts` | The typed face of `zu/native`'s `Instance` claim |
| `src/instance.rs` | The native single-instance lock: state-dir file, atomic `hard_link` creation, pid liveness, stale reclaim, release |
| `assets/tray.svg` | The menu bar's template Z icon |
| `shell.tsx` | The workbench: project/container sidebar, engine bar, controlled `DockArea`, status line |
| `contracts/` | The frozen wire contract: `protocol.ts` (types, command/event tables, validation) and `protocol.md` |
| `engine.ts` | The shell's connection, supervised reconnect, snapshot/Ui request plumbing |
| `ui-host.tsx` | Extension UI host: dialogs, toast stack, status lines, window title |
| `i18n.ts`, `locales/` | zh-CN/en key tables and the parity test's key list |
| `containers.ts` | Container store: create/switch/archive, the scratch canvas (in-memory layout), layout stash + zoom restore, the Hero's open/submit paths, sidebar projection |
| `projects.ts` | Project store: `projects.json` projection, explicit membership, the Hero's project target |
| `subagents.ts` | Subagent roster store: runs, selection, read-only transcript, note/auto-open wiring |
| `hero.tsx` | The Hero sheet (`home:{containerId}` / `home:scratch`): project chip, composer, the two tool rows and the project creation dialog |
| `tab-plus.tsx` | The `+` at each tab bar's right edge (nsh's `DockArea` has no trailing slot): group rectangles from the layout tree and the overlay button |
| `dock.ts` | Layout data and pure edits: stable session and Hero sheet ids, append/activate/prune, visible-panel set |
| `sheets.tsx` | The sheet registry: kinds, tab titles and glyphs; `home`/`session`/`terminal`/`files`/`editor`/`diff`/`changes`/`history` have real bodies, the rest mock |
| `fs.ts` | The typed face of `zu/fs`: entries, versions, failure codes, canonical workspace root |
| `editors.ts` | Editor documents by stable sheet id, save (`stat` → `write` → read-back), stale conflict, reload, Mod+S target |
| `files.tsx` | The real Files sheet (lazy tree, compare dialog), Editor sheet (find/replace bar, conflict/read-only states) and two-file Diff sheet |
| `git.ts` | The typed face of `zu/git` and the per-container Changes/History projection: status, log, branches, staging, commit, checkout, notices |
| `git-ui.tsx` | The real Changes sheet (grouped status, stage/unstage, `DiffView` in `patch` mode, commit line, identity dialog) and History sheet (log, branch menu) |
| `browser.ts` | The browser store: one page per `webview:{containerId}:{n}` sheet (the scratch canvas's pages are `webview:scratch:{n}` until a container mints), URL/title/loading/error state, address normalization, `WebView.available()` probe |
| `browser-ui.tsx` | The real Browser sheet: one `WebView`, address bar, history/reload/stop, loading rail, error panel, default page and the UI-only page-message log |
| `languages.ts` | The editor/LSP language table (`languageFor`), shared so `editors.ts` and `lsp.ts` agree on a file |
| `lsp.ts` | The UI LSP client: one server per container/language family, initialize/document sync, diagnostics, hover/definition/completion, request ids/timeouts/cancellation, URI↔path, the diagnostics and Problems stores |
| `lsp-ui.tsx` | The real Problems sheet (`problems:{containerId}`: severity/file/line, reveal on click, server state/progress/error/restart) and the hover card (`Overlay` + `TextView`) |
| `src/lsp.rs` | The native `Lsp` class: argv/explicit cwd/no shell, process group, bounded `Content-Length` framing, reader/writer/stderr/waiter threads, `Callback::post`, stop/drop cleanup, coded errors |
| `file-tree.ts` | Pure file-tree data: sorting, expanded rows, row test ids, sheet-id helpers |
| `sessions.ts` | Per-session views: folds engine events by session id, rebuilds from a snapshot, reopens by file |
| `terminals.ts` | PTY store: one `Pty` per terminal resource (`terminal:{containerId}:{n}`, several per container), replay buffer, title/exit mirror, archive close |
| `src/pty.rs` | The native `Pty` class: `portable-pty` open/write/resize/close, reader/writer/waiter threads, `Callback::post` |
| `src/fs.rs` | The native `zu/fs` module: path policy, caps, atomic write, BOM, stale check, coded errors |
| `src/git.rs` | The native `zu/git` module: porcelain v2 status, patch diffs, log, branches, stage/unstage, commit, checkout; root and path policy, coded errors |
| `ui.tsx` | Canvas glyphs、`Logo`、`Dot`/`Chip`/`SectionTitle`、motion/阴影 token、`applyScrollbarTheme` |
| `theme.json` | Design tokens (shadcn-style, light + dark) via `nsh.json` `"theme"` |
| Tests | `App.test.tsx`、`containers.test.ts`、`containers.ui.test.tsx`、`dock.test.ts`、`dock-move.test.tsx`、`contracts.test.ts`、`i18n.test.ts`、`many-sessions.test.tsx`、`projects.test.ts`、`projects.ui.test.tsx`、`subagents.test.ts`、`subagents.ui.test.tsx`、`ui-host.test.tsx`、`external.test.ts`、`external.ui.test.tsx`、`pty.test.ts`、`terminal.ui.test.tsx`、`terminal.claude.test.tsx`、`engine.test.ts`（live）、`fs.test.ts`、`file-tree.test.ts`、`files.ui.test.tsx`、`git.test.ts`、`git.ui.test.tsx`、`browser.test.ts`、`browser.ui.test.tsx`、`browser.live.test.tsx`、`lsp.test.ts`（真实 rust-analyzer）、`lsp.ui.test.tsx`（受控 LSP + 真实 Workbench）、`notifications.test.ts`、`updates.test.ts`、`updates.ui.test.tsx`、`lifecycle.test.ts`、`lifecycle.ui.test.tsx`、`lifecycle.window.test.tsx`、`lifecycle.quit.test.tsx`、`lifecycle.app.test.tsx`、`tab-plus.test.ts`、`models.ui.test.tsx`、`terminals.test.ts`、`titles.test.ts`、`locale.ui.test.tsx`、`hero-terminals.ui.test.tsx`、`auto-archive.ui.test.tsx`、`settings.test.ts`、`vscode.test.ts`、`search.test.ts`、`chat.ui.test.tsx`、`slash.test.ts`、`startup.test.tsx`（`nsh test` 计 262/262，含 44 条 Rust 单测） |

交互全部来自 `nsh/base DockArea`：拖 sheet 到另一 panel（移动且状态不丢）、拖到组边缘分栏、拖手缩放、`×` 关闭、Zoom、<600pt compact。
唯一的例外是每组标题栏右端的 `+`：0.4.0 的 tab bar 没有尾部插槽，`tab-plus.tsx` 按布局几何把它画成覆盖层（见
[docs/evidence/s1-hero-sheet.md](docs/evidence/s1-hero-sheet.md)）。

## Run it

With `nsh` on your `PATH` ([install](https://nsh.dev/docs/installation)), or a checkout build:

```sh
nsh run . --target macos   # the AppKit host
nsh run . --target web     # the browser
nsh check .                # cargo check + typecheck the TSX
nsh test .                 # Rust + headless TS tests (live pi cases; ZU_SKIP_LIVE=1 skips)
```

The engine is a working copy of the sidecar: `cd engine && bun run build` before
`nsh run` or `script/bundle-mac.sh` if `engine/src` changed. `cd engine && bun run models:parity`
compares a session's model list with `pi --list-models` on this machine.

## 文档治理

- **状态锚点**：本节的「当前状态」写日期、未提交状态与最近一次门禁结果；技术细节不靠散文维护，以 `nsh check` / `nsh test` / 打包冒烟的输出为准。
- **版本台账**：pi 在 `engine/package.json` 精确 pin（`src/version.ts` 由 `check-version` 守）；nsh 在 `Cargo.toml` **git pin `506b5392`（0.4.0）** + `Cargo.lock`——发布版 0.4.0 没有 `nsh/base Terminal`，M7 必须用 checkout（Q54）。任一侧升级都要跑引擎测试、UI 测试、终端与 DockArea 冒烟，并在 [decisions.md](docs/decisions.md) 记录。
- **协议变更**：`contracts/` 是 UI 与 engine 的唯一共享面。改协议 = 同一个 PR 里改 TS 类型、`protocol.md` 与两侧实现；`v` 递增即表示不兼容。
- **决策变更**：先改 [decisions.md](docs/decisions.md) 的台账与 [architecture.md](docs/architecture.md) 的正文，再改代码；过程写进 [docs/evidence/decision-log.md](docs/evidence/decision-log.md)。
