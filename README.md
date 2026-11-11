# Zu (`nsh-pi`)

**Zu**（祖冲之——纪念其对 π 的贡献）是 [`pi`](https://www.npmjs.com/package/@earendil-works/pi-coding-agent)
coding agent 的桌面端，TSX 写在 [NSH](https://nsh.dev) 上。工作台形态
借鉴 [ThinkRail](https://github.com/JetBrains/ThinkRail) 与 iTerm2/Warp：壳（项目侧栏、顶栏、页签条、
状态条）包着一块 `DockArea` 画布，**panel** 持有可拖拽的 **sheet**（Pi 会话、终端、各 agent TUI、
webview、会话的 aux 视图）。logo 为 Steer 的 `<->` 构型加载祖冲之密率（上 355、下 113）。

**当前状态（as of `e6f5b9e`，2026-11-11；目视验收返工已落地）：M0–M6 完成；M7 实现完成、验收未全过；M8 实现完成、验收全过（git diff 一项由 M9 补齐）；M9 实现完成、验收全过；M10 实现完成、验收达成一半（外开未实现）；M11 实现完成、验收达成（Rust 真实，TS/Go 未实跑）；M12 实现完成、桌面端到端部分验证（关窗隐藏与第二实例已用打包 app 实测；托盘点击、系统通知投递、真实更新安装仍未验证；仓库无更新源）。** 应用能连上随包分发的 pi 引擎（Bun sidecar，`zu/engine` 原生模块启动）；侧栏按 **Project → 容器** 组织，无归属容器落 Chats，全部 pi 会话用虚拟化列表保留；空画布/「＋」进入 **Launcher**（composer 先行、项目 chip、锁定目标），提交后才创建容器；容器 = 一组面板，各自恢复布局与 zoom，可持多个 pi 会话；归属显式（菜单或拖行），重启后由 `projects.json`/`registry.json` 恢复。M5 让 captain 在进程内派子代理：`dispatch`/`list_agents` 只在 captain 注册，名册显示 live/settled，子会话只读转录，archive 级联中断 live。M6 把外壳对齐 Steer.app：232pt 侧栏、36pt 顶栏（2026-11-11 返工；此前 48）、统一 144pt 的页签条（白 pill + 指示器 + 悬浮关闭）、12 半径的 composer/Launcher/对话框、统一菜单与 toast 表面、120/180ms 颜色过渡、token 化滚动条。M7 加真终端：`zu/native` 的 `Pty`（`portable-pty`，输出经引擎线程 `Callback::post` 直推 TSX，不过 wire）、external 容器（Terminal/Claude/Codex/Copilot，无 pi session）、真实 `Terminal` sheet（`onData`/`onResize`/`onTitleChange`）、Launcher 动作行、归档杀 PTY；vim/htop/Claude Code TUI 已实测。M8 加真文件：`zu/fs`（`list`/`stat`/`read`/`write`/`mkdir`，Rust 侧路径策略、2 MiB/1000 项上限、原子写、`ERR_FS_STALE`）、文件树 sheet（懒加载、目录优先、空/加载/错误态）、真 `Editor` sheet（语言高亮、折叠、查找/替换、脏标记、Save/Mod+S、冲突只读、reload/close）、两文件 `DiffView` sheet（split/unified，真实 hunk 统计）；headless 已验「打开真实 /tmp 文件 → 编辑 → 保存 → 用 `zu/fs` 读回磁盘一致」，外部改动会拒绝保存并转只读。M9 加真 Git：`zu/git`（shell out `git`；status porcelain v2、diff/log/branches、stage/unstage、commit、checkout/createBranch/init，根必须是仓库顶层、路径越界拒绝、2 MiB 补丁上限、无网络、不写全局 git 配置）、Changes sheet（`changes:{containerId}`：真实文件分组 + stage/unstage + 用 `DiffView` 的 `patch` 模式显示真实 `git diff` + 提交行）、History sheet（`history:{containerId}`：真实 log + 分支菜单 checkout）、顶栏入口；headless 已验「改文件 → Changes → stage → 提交（`git log` 验证 author/subject/hash）→ 切分支（Changes/History/编辑器跟随）」，M8 的 worktree diff 缺口由此关闭。M10 加浏览器：`browser.ts` 按 `webview:{containerId}:{n}` 持每个 sheet 的 URL/标题/loading/canGoBack/canGoForward/error 与页面消息日志（UI state only）；`browser-ui.tsx` 的 Browser sheet 是一个 `WebView` + 地址栏（裸域名补 `https://`、只开 http/https）+ 后退/前进/刷新/停止（enabled 跟随真实 nav state）+ loading 轨道/文字 + 页签标题 + 错误码面板 + 默认页 + 只写 UI 的页面消息日志；顶栏 `open-browser` 与 Launcher「浏览器」是入口，每容器可开多个。`nsh.json` 只授予 `webview.hosts: ["*"]`，没有 `openUrl`/`webview.input`。真实 macOS 宿主已加载 `example.com`、IANA 文档页与 DuckDuckGo Lite 搜索，并跑通后退/前进；headless 没有 web view，默认测试只覆盖 UI 状态机。M11 加真 LSP：`src/lsp.rs` 的 `zu/native` `Lsp`（argv/显式 cwd/无 shell、独立进程组、`Content-Length` 有界帧、reader/writer/stderr/waiter 四线程、`Callback::post` 推完整消息/stderr/exit、`stop`/`Drop` 清理）；`lsp.ts` 每容器 × 语言族一个客户端（`rust-analyzer`、`typescript-language-server --stdio`、`gopls`），初始化/全文 didOpen·didChange·didSave·didClose/诊断/hover/definition/completion，请求 id、超时、取消与陈旧丢弃，URI↔path 与根内过滤；`files.tsx` 的 Editor 显示诊断、`Overlay`+`TextView` hover 卡片、F12/Mod-click 定义跳转（打开目标 sheet 并 reveal）、补全列表（Ctrl+Space 可触发）；`lsp-ui.tsx` 的 Problems sheet（`problems:{containerId}`，严重度/文件/行、点击打开并 reveal、server 状态/索引进度/错误/重启）与顶栏 `open-problems`。真实 `rust-analyzer 1.99.1` 在 `/tmp` 的 Cargo fixture 上跑通 initialize → diagnostics（`E0308 expected i32, found &'static str`）→ hover（`pub fn add(left: i32, right: i32) -> i32`）→ definition（`src/lib.rs`）→ completion（`value: i32`）；headless 真实 `Workbench` + 真实 `zu/lsp` + 受控 fake server 验证诊断/Problems/reveal/F12/补全/重启。M12 让 Zu 常驻：`zu/native` 的 `Instance` 在 app 状态目录上做单实例锁（临时文件 + `hard_link` 独占创建、pid 判活、死锁回收、同进程幂等；6 条 Rust 测试），桌面启动在 boot 引擎前 claim，第二个实例不 boot 引擎、只显示「Zu 已在运行」+ owner pid/锁路径 + Quit，headless 完全不 claim；`LifecycleHost` 让关窗只是 `hide()`（`nsh.json` 的 `closeOnPress:false` + `closePress`），托盘有 Show/Hide、Check for Updates…、Quit，应用菜单保留 Edit roles 并给 Show `⌘0`、Close 与真正退出（`quitApp` 先释放 claim）；`Engine.portAvailable()` 让端口被占时有单独文案。通知按「主窗口不在前台」才发（turn settle 的 running→idle 边沿 + 子代理 settle），id 按 session/run 替换、同正文 5 s 去重、权限只问一次，按下时恢复窗口并在 engine 就绪后打开对应会话/名册。更新对话框（托盘与顶栏齿轮）诚实区分开发构建/未配置 updater/可检查，走 check→进度→ready→install，`canInstall:false` 只显示 URL，安装 promise resolve 后保持「正在安装」不冒充成功；仓库没有 `nsh.json` 的 `"updater"`（无真实 source/公钥/release），所以不配置、不伪造。`script/bundle-mac.sh` 断言 `Contents/Helpers` 三个文件并在 `NSH_UPDATE_ARCHIVE=1` 时打出含 Helpers 的整个 `.app` tar.gz。真实 headless 窗口模型验证关窗隐藏、引擎仍 running、`⌘0` 可反复恢复；托盘点击、系统通知投递、第二进程实拦与真实更新安装仍列为未验证（见 [M12 evidence](docs/evidence/m12-lifecycle.md)）。**未达成 / 限制**：M7 的 Claude Code 真实对话（本机 API error）与 `VtEmulator` 缩小不重排；M8 的「看一次 git diff」当时没有模块，已由 M9 补齐；M10 的 `target=_blank`/`window.open` 外开（nsh 0.4.0 无新窗口回调，未授予 `openUrl`），页内链接点击与页内搜索框输入未自动化，headless 不能验证真实页面；M11 的真实 server 验收只覆盖 Rust（TS/Go 映射未实跑），headless 的 `app.hover` 无法驱动 Editor 内部 rows 的指针路径（hover 卡片由同一组件单独渲染验证），诊断只保留打开文件、无全工作区索引，重启/归档不恢复语言服务器。另有 nsh pin 的 Menu owner-disposal panic 日志，见 architecture 已知问题。详见 [roadmap M7–M12](docs/roadmap.md) 与 [terminal evidence](docs/evidence/terminal-emulator.md) §8、[M8 evidence](docs/evidence/m8-editor-diff.md)、[M9 evidence](docs/evidence/m9-git.md)、[M10 evidence](docs/evidence/m10-browser.md)、[M11 evidence](docs/evidence/m11-lsp.md)、[M12 evidence](docs/evidence/m12-lifecycle.md)。门禁：`nsh check` ✓、`nsh build` ✓（1 个 asset）、`cargo check --all-targets` ✓、`cargo test --lib` ✓（47）、`nsh test` 220/220 ✓（含 live 模型回合、三个真实语言服务器、2000 行虚拟化、容器切换内容）、`script/bundle-mac.sh` ✓（含 Helpers 断言与可选更新归档）。M12 的桌面端到端（托盘、系统通知、真实更新安装）尚未验证，见 [roadmap M12 台账](docs/roadmap.md) 与 [evidence](docs/evidence/m12-lifecycle.md)。下一步是 [roadmap](docs/roadmap.md) 的 M13（签名与公证）。

## 文档

**决策文档**（最终形态，轻易不动）

| Doc | 内容 |
|---|---|
| [docs/architecture.md](docs/architecture.md) | 架构：约束与原则、后端 sidecar、前端轮廓/画布、对象模型、技术选型 |
| [docs/decisions.md](docs/decisions.md) | 决策台账：Q1–Q67（问题 → 裁决 → 落点） |
| [docs/roadmap.md](docs/roadmap.md) | 产品目标、里程碑纪律、M0–M13 与条件性里程碑（M2–M5 架构落地 → M6 轮廓 Casing → M7+ 细节） |
| [docs/DESIGN.md](docs/DESIGN.md) | M6 设计系统 + M8/M9/M10 的表面与动效清单：token、外壳几何、表面语言、交互状态及与 Steer 的剩余差异 |

**依据文档**（决策的过程与证据）

| Doc | 内容 |
|---|---|
| [docs/evidence/decision-log.md](docs/evidence/decision-log.md) | 每条决策的约束、选项与选择理由；被否决的方向 |
| [docs/evidence/spike-report.md](docs/evidence/spike-report.md) | spike 实测：bun compile、pi 会话 API、custom entry、存储布局 |
| [docs/evidence/feasibility.md](docs/evidence/feasibility.md) | 五项重型集成可行性：终端、浏览器、PTY、编辑器/IDE、Git |
| [docs/evidence/terminal-emulator.md](docs/evidence/terminal-emulator.md) | nsh VtEmulator 与 Ghostty 的逐项对比、trait 上限约束、M7 实测缺陷 |
| [docs/evidence/m7-terminal-captures.md](docs/evidence/m7-terminal-captures.md) | M7 门禁、PTY/Terminal/vim/htop/Claude 的实测记录与 resize 截断证据 |
| [docs/evidence/m9-git.md](docs/evidence/m9-git.md) | M9 门禁、真实仓库 transcript、Changes/History 验收与未覆盖项 |
| [docs/evidence/m10-browser.md](docs/evidence/m10-browser.md) | M10 门禁、真实页面加载/搜索/前进后退、截图与未覆盖项（外开、headless、深色页面） |
| [docs/evidence/m11-lsp.md](docs/evidence/m11-lsp.md) | M11 门禁、真实 rust-analyzer 的 diagnostics/hover/definition/completion 原文、耗时与限制 |
| [docs/evidence/m12-lifecycle.md](docs/evidence/m12-lifecycle.md) | M12 门禁、单实例/关窗/通知/更新状态机实测、打包与 Helpers 断言、未验证项与发布时 updater 配置 |

## 当前实现（outline）

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
| `containers.ts` | Container store: create/switch/archive, layout stash + zoom restore, sidebar projection |
| `projects.ts` | Project store: `projects.json` projection, explicit membership, Launcher state |
| `subagents.ts` | Subagent roster store: runs, selection, read-only transcript, note/auto-open wiring |
| `launcher.tsx` | Launcher, project chip and the project creation dialog |
| `dock.ts` | Layout data and pure edits: stable session sheet ids, append/activate/prune, visible-panel set |
| `sheets.tsx` | The sheet registry: kinds, tab titles and glyphs; `session`/`terminal`/`files`/`editor`/`diff`/`changes`/`history` have real bodies, the rest mock |
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
| Tests | `App.test.tsx`、`containers.test.ts`、`containers.ui.test.tsx`、`dock.test.ts`、`dock-move.test.tsx`、`contracts.test.ts`、`i18n.test.ts`、`many-sessions.test.tsx`、`projects.test.ts`、`projects.ui.test.tsx`、`subagents.test.ts`、`subagents.ui.test.tsx`、`ui-host.test.tsx`、`external.test.ts`、`external.ui.test.tsx`、`pty.test.ts`、`terminal.ui.test.tsx`、`terminal.claude.test.tsx`、`engine.test.ts`（live）、`fs.test.ts`、`file-tree.test.ts`、`files.ui.test.tsx`、`git.test.ts`、`git.ui.test.tsx`、`browser.test.ts`、`browser.ui.test.tsx`、`browser.live.test.tsx`、`lsp.test.ts`（真实 rust-analyzer）、`lsp.ui.test.tsx`（受控 LSP + 真实 Workbench）、`notifications.test.ts`、`updates.test.ts`、`updates.ui.test.tsx`、`lifecycle.test.ts`、`lifecycle.ui.test.tsx`、`lifecycle.window.test.tsx`、`lifecycle.quit.test.tsx`、`lifecycle.app.test.tsx`（128 条 TS；`nsh test` 计 172/172，含 44 条 Rust） |

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
