# Zu (`nsh-pi`)

**Zu**（祖冲之——纪念其对 π 的贡献）是 [`pi`](https://www.npmjs.com/package/@earendil-works/pi-coding-agent)
coding agent 的桌面端，TSX 写在 [NSH](https://nsh.dev) 上。工作台形态
借鉴 [ThinkRail](https://github.com/JetBrains/ThinkRail) 与 iTerm2/Warp：壳（项目侧栏、顶栏、页签条、
状态条）包着一块 `DockArea` 画布，**panel** 持有可拖拽的 **sheet**（Pi 会话、终端、各 agent TUI、
webview、会话的 aux 视图）。logo 为 Steer 的 `<->` 构型加载祖冲之密率（上 355、下 113）。

**当前状态（2026-11-11，M8 未提交工作树；上一提交 `52a1ed1`）：M0–M6 完成；M7 实现完成、验收未全过；M8 实现完成、验收一半。** 应用能连上随包分发的 pi 引擎（Bun sidecar，`zu/engine` 原生模块启动）；侧栏按 **Project → 容器** 组织，无归属容器落 Chats，全部 pi 会话用虚拟化列表保留；空画布/「＋」进入 **Launcher**（composer 先行、项目 chip、锁定目标），提交后才创建容器；容器 = 一组面板，各自恢复布局与 zoom，可持多个 pi 会话；归属显式（菜单或拖行），重启后由 `projects.json`/`registry.json` 恢复。M5 让 captain 在进程内派子代理：`dispatch`/`list_agents` 只在 captain 注册，名册显示 live/settled，子会话只读转录，archive 级联中断 live。M6 把外壳对齐 Steer.app：232pt 侧栏、48pt 顶栏、34pt 页签条（白 pill + 指示器）、12 半径的 composer/Launcher/对话框、统一菜单与 toast 表面、120/180ms 颜色过渡、token 化滚动条。M7 加真终端：`zu/native` 的 `Pty`（`portable-pty`，输出经引擎线程 `Callback::post` 直推 TSX，不过 wire）、external 容器（Terminal/Claude/Codex/Copilot，无 pi session）、真实 `Terminal` sheet（`onData`/`onResize`/`onTitleChange`）、Launcher 动作行、归档杀 PTY；vim/htop/Claude Code TUI 已实测。M8 加真文件：`zu/fs`（`list`/`stat`/`read`/`write`/`mkdir`，Rust 侧路径策略、2 MiB/1000 项上限、原子写、`ERR_FS_STALE`）、文件树 sheet（懒加载、目录优先、空/加载/错误态）、真 `Editor` sheet（语言高亮、折叠、查找/替换、脏标记、Save/Mod+S、冲突只读、reload/close）、两文件 `DiffView` sheet（split/unified，真实 hunk 统计）；headless 已验「打开真实 /tmp 文件 → 编辑 → 保存 → 用 `zu/fs` 读回磁盘一致」，外部改动会拒绝保存并转只读。**未达成**：M7 的 Claude Code 真实对话（本机 API error）与 `VtEmulator` 缩小不重排；M8 的「看一次 git diff」不在 M8（两文件 diff 已实现，worktree diff 留给 M9）。另有 nsh pin 的 Menu owner-disposal panic 日志，见 architecture 已知问题。详见 [roadmap M7/M8](docs/roadmap.md) 与 [terminal evidence](docs/evidence/terminal-emulator.md) §8、[M8 evidence](docs/evidence/m8-editor-diff.md)。门禁：`nsh check` ✓、`nsh build` ✓、`cargo check --all-targets` ✓、`cargo test --lib` ✓（15）、`nsh test` 99/99 ✓。下一步是 [roadmap](docs/roadmap.md) 的 M9（Git）。

## 文档

**决策文档**（最终形态，轻易不动）

| Doc | 内容 |
|---|---|
| [docs/architecture.md](docs/architecture.md) | 架构：约束与原则、后端 sidecar、前端轮廓/画布、对象模型、技术选型 |
| [docs/decisions.md](docs/decisions.md) | 决策台账：Q1–Q57（问题 → 裁决 → 落点） |
| [docs/roadmap.md](docs/roadmap.md) | 产品目标、里程碑纪律、M0–M13 与条件性里程碑（M2–M5 架构落地 → M6 轮廓 Casing → M7+ 细节） |
| [docs/DESIGN.md](docs/DESIGN.md) | M6 设计系统：token、外壳几何、表面语言、交互状态、动效清单及与 Steer 的剩余差异 |

**依据文档**（决策的过程与证据）

| Doc | 内容 |
|---|---|
| [docs/evidence/decision-log.md](docs/evidence/decision-log.md) | 每条决策的约束、选项与选择理由；被否决的方向 |
| [docs/evidence/spike-report.md](docs/evidence/spike-report.md) | spike 实测：bun compile、pi 会话 API、custom entry、存储布局 |
| [docs/evidence/feasibility.md](docs/evidence/feasibility.md) | 五项重型集成可行性：终端、浏览器、PTY、编辑器/IDE、Git |
| [docs/evidence/terminal-emulator.md](docs/evidence/terminal-emulator.md) | nsh VtEmulator 与 Ghostty 的逐项对比、trait 上限约束、M7 实测缺陷 |
| [docs/evidence/m7-terminal-captures.md](docs/evidence/m7-terminal-captures.md) | M7 门禁、PTY/Terminal/vim/htop/Claude 的实测记录与 resize 截断证据 |

## 当前实现（outline）

| File | What it is |
|---|---|
| `App.tsx` | The bootstrap: install the scrollbar theme, boot the engine once, then render `Workbench` |
| `shell.tsx` | The workbench: project/container sidebar, engine bar, controlled `DockArea`, status line |
| `contracts/` | The frozen wire contract: `protocol.ts` (types, command/event tables, validation) and `protocol.md` |
| `engine.ts` | The shell's connection, supervised reconnect, snapshot/Ui request plumbing |
| `ui-host.tsx` | Extension UI host: dialogs, toast stack, status lines, window title |
| `i18n.ts`, `locales/` | zh-CN/en key tables and the parity test's key list |
| `containers.ts` | Container store: create/switch/archive, layout stash + zoom restore, sidebar projection |
| `projects.ts` | Project store: `projects.json` projection, explicit membership, Launcher state |
| `subagents.ts` | Subagent roster store: runs, selection, read-only transcript, note/auto-open wiring |
| `launcher.tsx` | Launcher, project chip and the project creation dialog |
| `dock.ts` | Layout data and pure edits: stable session sheet ids, append/activate/prune, visible-panel set |
| `sheets.tsx` | The sheet registry: kinds, tab titles and glyphs; `session`/`terminal`/`files`/`editor`/`diff` have real bodies, the rest mock |
| `fs.ts` | The typed face of `zu/fs`: entries, versions, failure codes, canonical workspace root |
| `editors.ts` | Editor documents by stable sheet id, save (`stat` → `write` → read-back), stale conflict, reload, Mod+S target |
| `files.tsx` | The real Files sheet (lazy tree, compare dialog), Editor sheet (find/replace bar, conflict/read-only states) and two-file Diff sheet |
| `file-tree.ts` | Pure file-tree data: sorting, expanded rows, row test ids, sheet-id helpers |
| `sessions.ts` | Per-session views: folds engine events by session id, rebuilds from a snapshot, reopens by file |
| `terminals.ts` | PTY store: one `Pty` per external container, replay buffer, title/exit mirror, archive close |
| `src/pty.rs` | The native `Pty` class: `portable-pty` open/write/resize/close, reader/writer/waiter threads, `Callback::post` |
| `src/fs.rs` | The native `zu/fs` module: path policy, caps, atomic write, BOM, stale check, coded errors |
| `ui.tsx` | Canvas glyphs、`Logo`、`Dot`/`Chip`/`SectionTitle`、motion/阴影 token、`applyScrollbarTheme` |
| `theme.json` | Design tokens (shadcn-style, light + dark) via `nsh.json` `"theme"` |
| Tests | `App.test.tsx`、`containers.test.ts`、`containers.ui.test.tsx`、`dock.test.ts`、`dock-move.test.tsx`、`contracts.test.ts`、`i18n.test.ts`、`many-sessions.test.tsx`、`projects.test.ts`、`projects.ui.test.tsx`、`subagents.test.ts`、`subagents.ui.test.tsx`、`ui-host.test.tsx`、`external.test.ts`、`external.ui.test.tsx`、`pty.test.ts`、`terminal.ui.test.tsx`、`terminal.claude.test.tsx`、`engine.test.ts`（live）、`fs.test.ts`、`file-tree.test.ts`、`files.ui.test.tsx`（99 条） |

交互全部来自 `nsh/base DockArea`：拖 sheet 到另一 panel（移动且状态不丢）、拖到组边缘分栏、拖手缩放、`×` 关闭、Zoom、<600pt compact。

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
