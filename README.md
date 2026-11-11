# Zu

**Zu**（祖冲之——纪念其对 π 的贡献）是 [`pi`](https://www.npmjs.com/package/@earendil-works/pi-coding-agent)
coding agent 的桌面端，TSX 写在 [NSH](https://nsh.dev) 上。工作台形态借鉴 ThinkRail 与 iTerm2/Warp：
壳（项目侧栏、顶栏、页签条）包着一块 `DockArea` 画布，**panel** 持有可拖拽的 **sheet**（Pi 会话、
终端、各 agent TUI、webview、编辑器、diff、LSP Problems）。logo 为 Steer 的 `<->` 构型加载祖冲之密率
（上 355、下 113）。

**当前状态（as of 2026-11-11）**：M0–M12 已交付（地基、对话、契约与监督、容器与面板、项目与 Launcher、子代理、轮廓、
终端、编辑器、Git、浏览器、LSP、常驻与更新）。Casing II：**§2.1-1（Hero sheet 化，`a58e0ad`）与 §2.1-2
（切容器必 hydrate，`bcd4004`）已提交**；**§2.1.1 F1（Hero 动作就地替换）已完成，工作树未提交**；F2/F3（容器内
终端/TUI 资源、原生 Pi TUI）与第 3 项起未动工。门禁：`nsh check` ✓、`cargo check --all-targets` ✓、
`nsh test` 235/235 ✓、`script/bundle-mac.sh` ✓。证据见
[docs/evidence/s1-hero-sheet.md](docs/evidence/s1-hero-sheet.md)、
[docs/evidence/s21-2-switch-hydrate.md](docs/evidence/s21-2-switch-hydrate.md)、
[docs/evidence/s21-1-hero-actions.md](docs/evidence/s21-1-hero-actions.md) 与 `docs/evidence/ui-s2-*.png`；
下一项是 [§2.1.1 F2](docs/plan.md)。

## 文档

| Doc | 内容 |
|---|---|
| [docs/plan.md](docs/plan.md) | **执行指导**：已完成的工作、下一批任务（Casing II / Hero sheet）、批次与验收 |
| [docs/architecture.md](docs/architecture.md) | 架构：约束、后端 sidecar、前端轮廓与画布、对象模型、技术选型、风险 |
| [docs/DESIGN.md](docs/DESIGN.md) | 视觉规格：Token、外壳几何（Casing II 目标）、表面语言、动效、各模块界面 |
| [docs/decisions.md](docs/decisions.md) | 决策台账 Q1–Q80 |
| [docs/evidence/](docs/evidence/) | 依据：spike 实测、可行性、终端仿真核对比、API 核实、各里程碑验证记录 |

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
| `launcher.tsx` | The Hero sheet (`home:{containerId}` / `home:scratch`): project chip, composer, the two tool rows and the project creation dialog |
| `tab-plus.tsx` | The `+` at each tab bar's right edge (nsh's `DockArea` has no trailing slot): group rectangles from the layout tree and the overlay button |
| `dock.ts` | Layout data and pure edits: stable session and Hero sheet ids, append/activate/prune, visible-panel set |
| `sheets.tsx` | The sheet registry: kinds, tab titles and glyphs; `home`/`session`/`terminal`/`files`/`editor`/`diff`/`changes`/`history` have real bodies, the rest mock |
| `fs.ts` | The typed face of `zu/fs`: entries, versions, failure codes, canonical workspace root |
| `editors.ts` | Editor documents by stable sheet id, save (`stat` → `write` → read-back), stale conflict, reload, Mod+S target |
| `files.tsx` | The real Files sheet (lazy tree, compare dialog), Editor sheet (find/replace bar, conflict/read-only states) and two-file Diff sheet |
| `git.ts` | The typed face of `zu/git` and the per-container Changes/History projection: status, log, branches, staging, commit, checkout, notices |
| `git-ui.tsx` | The real Changes sheet (grouped status, stage/unstage, `DiffView` in `patch` mode, commit line, identity dialog) and History sheet (log, branch menu) |
| `browser.ts` | The browser store: one page per `webview:{containerId}:{n}` sheet, URL/title/loading/error state, address normalization, `WebView.available()` probe |
| `browser-ui.tsx` | The real Browser sheet: one `WebView`, address bar, history/reload/stop, loading rail, error panel, default page and the UI-only page-message log |
| `languages.ts` | The editor/LSP language table (`languageFor`), shared so `editors.ts` and `lsp.ts` agree on a file |
| `lsp.ts` | The UI LSP client: one server per container/language family, initialize/document sync, diagnostics, hover/definition/completion, request ids/timeouts/cancellation, URI↔path, the diagnostics and Problems stores |
| `lsp-ui.tsx` | The real Problems sheet (`problems:{containerId}`: severity/file/line, reveal on click, server state/progress/error/restart) and the hover card (`Overlay` + `TextView`) |
| `src/lsp.rs` | The native `Lsp` class: argv/explicit cwd/no shell, process group, bounded `Content-Length` framing, reader/writer/stderr/waiter threads, `Callback::post`, stop/drop cleanup, coded errors |
| `file-tree.ts` | Pure file-tree data: sorting, expanded rows, row test ids, sheet-id helpers |
| `sessions.ts` | Per-session views: folds engine events by session id, rebuilds from a snapshot, reopens by file |
| `terminals.ts` | PTY store: one `Pty` per external container, replay buffer, title/exit mirror, archive close |
| `src/pty.rs` | The native `Pty` class: `portable-pty` open/write/resize/close, reader/writer/waiter threads, `Callback::post` |
| `src/fs.rs` | The native `zu/fs` module: path policy, caps, atomic write, BOM, stale check, coded errors |
| `src/git.rs` | The native `zu/git` module: porcelain v2 status, patch diffs, log, branches, stage/unstage, commit, checkout; root and path policy, coded errors |
| `ui.tsx` | Canvas glyphs、`Logo`、`Dot`/`Chip`/`SectionTitle`、motion/阴影 token、`applyScrollbarTheme` |
| `theme.json` | Design tokens (shadcn-style, light + dark) via `nsh.json` `"theme"` |
| Tests | `App.test.tsx`、`containers.test.ts`、`containers.ui.test.tsx`、`dock.test.ts`、`dock-move.test.tsx`、`contracts.test.ts`、`i18n.test.ts`、`many-sessions.test.tsx`、`projects.test.ts`、`projects.ui.test.tsx`、`subagents.test.ts`、`subagents.ui.test.tsx`、`ui-host.test.tsx`、`external.test.ts`、`external.ui.test.tsx`、`pty.test.ts`、`terminal.ui.test.tsx`、`terminal.claude.test.tsx`、`engine.test.ts`（live）、`fs.test.ts`、`file-tree.test.ts`、`files.ui.test.tsx`、`git.test.ts`、`git.ui.test.tsx`、`browser.test.ts`、`browser.ui.test.tsx`、`browser.live.test.tsx`、`lsp.test.ts`（真实 rust-analyzer）、`lsp.ui.test.tsx`（受控 LSP + 真实 Workbench）、`notifications.test.ts`、`updates.test.ts`、`updates.ui.test.tsx`、`lifecycle.test.ts`、`lifecycle.ui.test.tsx`、`lifecycle.window.test.tsx`、`lifecycle.quit.test.tsx`、`lifecycle.app.test.tsx`、`tab-plus.test.ts`、`startup.test.tsx`（`nsh test` 计 235/235，含 44 条 Rust 单测） |

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
`nsh run` or `script/bundle-mac.sh` if `engine/src` changed.

## 文档治理

- **状态锚点**：本节的「当前状态」写日期、未提交状态与最近一次门禁结果；技术细节不靠散文维护，以 `nsh check` / `nsh test` / 打包冒烟的输出为准。
- **版本台账**：pi 在 `engine/package.json` 精确 pin（`src/version.ts` 由 `check-version` 守）；nsh 在 `Cargo.toml` **git pin `506b5392`（0.4.0）** + `Cargo.lock`——发布版 0.4.0 没有 `nsh/base Terminal`，M7 必须用 checkout（Q54）。任一侧升级都要跑引擎测试、UI 测试、终端与 DockArea 冒烟，并在 [decisions.md](docs/decisions.md) 记录。
- **协议变更**：`contracts/` 是 UI 与 engine 的唯一共享面。改协议 = 同一个 PR 里改 TS 类型、`protocol.md` 与两侧实现；`v` 递增即表示不兼容。
- **决策变更**：先改 [decisions.md](docs/decisions.md) 的台账与 [architecture.md](docs/architecture.md) 的正文，再改代码；过程写进 [docs/evidence/decision-log.md](docs/evidence/decision-log.md)。
