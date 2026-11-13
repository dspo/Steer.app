# 决策台账

> 决策文档。Zu 的全部已定决策，Q 编号是唯一编号。每条给「问题 → 裁决 → 落点 → 一句话理由」。
> 设计正文见 [architecture.md](architecture.md)。
>
> **读法**：每条是裁决**当时**的记录，落点路径不随重构回改——`engine/` 在 C8 后是 `pi-harness/`，
> ACP cutover 后 pi 的控制面在 `app/harness/pi-acp/`，manox 的落点是 `native/manox` 与 `app/harness/manox/`。
> 当前代码地图以 [README 的代码地图](../README.md) 为准；被后续裁决取代的条目在行内注明。

## 引擎与后端

| # | 问题 | 裁决 | 落点 |
|---|---|---|---|
| Q6 | 要不要保留「系统 pi」调试通道 | **不保留**。唯一引擎路径 = 内嵌 sidecar；调试用源码形态 | arch §3.2 |
| Q7 | 持久化根 | 全部用户状态落 `~/.pi`；pi 的持久化逻辑完全兼容；Zu 增强落 `zu/`；**凭据天然共享** | arch §3.5 |
| Q10 | Zu 增强写入 captain 会话的形式 | **C — `CustomEntry`**（不进 LLM 上下文，pi 容忍） | arch §5.7 |
| Q14 | 自更新渠道 | GitHub Releases（nsh/updater） | arch §3.7 |
| Q17 | 访问机制 | **不引入**沙箱 vs 完全访问轴，用 pi 原生能力 | arch §3.4 |
| Q23 | 用户已有的 pi 扩展与 skill | **加载**（全量）+ `ctx.ui` 三态桥（confirm/select/input）；editor/custom 降级 | arch §4.5 |
| Q24 | `settings.json` 读写 | **读共享、写独立**；模型选择写回共享 | arch §3.5 |
| Q27 | 遥测 | 支持 pi-telemetry，**不在早期里程碑**；默认不上报 | arch §3.7 |
| Q28 | sidecar 怎么被启动 | **B — Rust native module**（`zu/engine` spawn） | arch §3.6 |
| Q30 | LSP 客户端放哪 | **Rust native module**（与 PTY 共享子进程基础设施） | arch §3.6 |
| Q31 | native module 职责边界 | **按域拆注册面**（engine/pty/lsp/git/fs，共用一个 crate）+ 生命周期表 | arch §3.6 |

## 前端与 UI

| # | 问题 | 裁决 | 落点 |
|---|---|---|---|
| Q2 | 跨容器画布 | **单容器画布 + 单窗口**视图切换；多窗口不在设计中 | arch §4.2 |
| Q4 | 布局 stash 三语义点 | 恢复上次容器；死资源 sheet 静默移除；空态 = Launcher | arch §4.3 |
| Q5 | 键盘范围 | v1 最小集：`⌘W` / `⌘1-9` / `⌘K` | arch §4.4 |
| Q9 | 界面语言 | zh-CN 第一 + en fallback，键表第一天立住 | arch §6；实现见 Q39 |
| Q12/Q16 | 托盘与通知 | 托盘常驻 + 通知；关窗收起不确认、单实例、不自启、通知首版激进 | arch §4.6 |
| Q20 | 多窗口打开面 | **澄清**：多窗口不在设计中（侧栏 item 即容器入口） | arch §4.2 |
| Q21 | Zoom 持久性 | **持久**（写进容器布局 stash） | arch §4.3 |

## 关系对象模型

| # | 问题 | 裁决 | 落点 |
|---|---|---|---|
| Q1 | 子会话转录归属 | **路径即关系**：captain 住 pi 原生存储（pi 可见），subagents 住 `zu/subagents/{captainId}/{ts}_{runId}.jsonl`（pi 视而不见）；**兼容方向不对称** | arch §3.5 / §5.3 |
| Q3 | 注册表格式 | JSON 快照 + 原子 rename + 启动对账 + 状态生命周期分级 | arch §5.5 |
| Q11 | 归档可见性 | v1 不做；未来候选设置页「归档管理」子页 | arch §5.4 |
| Q13 | 子代理定义体系 | markdown + frontmatter；三来源；认 skills 字段；热生效 | arch §5.6 |
| Q15 | 外部容器种类 | 四类 TUI（Terminal/Claude/Codex/Copilot） | arch §5.3 |
| Q18 | 无主会话呈现 | 启动对账自动纳入；运行时 watch；外部改动复活 | arch §5.4 |
| Q19 | 定义的项目来源目录 | `.pi/agents/` | arch §5.6 |
| Q22 | turn 进行中的语义 | 切容器丢弃增量、restore 重建；退出弹确认（早期可直接退出） | arch §4.3 |

## 产品与分发

| # | 问题 | 裁决 | 落点 |
|---|---|---|---|
| Q8 | 产品名 / logo | **Zu**（祖冲之）；`<->` + 密率 355/113 | arch §6；`ui.tsx` 的 `Logo` |
| Q25 | macOS 签名与公证 | sidecar 放 `Contents/Helpers`、直接执行不释放；嵌套签名 + hardened runtime + JIT entitlement + 公证 | arch §3.7 |
| Q26 | 仓库公开性 | **公开** | arch §3.7 |
| Q29 | 终端仿真核 | **M2 先用 nsh 内置**冒烟 + 修 alt 缺陷；「Ghostty + 扩 trait/组件」作为条件性里程碑 **M-tty**，一次换到位 | arch §6；[evidence/terminal-emulator.md](evidence/terminal-emulator.md) |
| Q32 | 浏览器的域名授权 | **任意站点**（`capabilities.webview.hosts: ["*"]`），地址栏可输入任意 URL；风险在 UI 上标明 | arch §3.4；M10 |
| Q33 | 扩展的 `ctx.mode` | **`"rpc"`**，不自创 `"gui"`——pi 已有语义，ThinkRail 同样用 `bindExtensions({ mode: "rpc", uiContext })`，逐方法实现或降级 | arch §4.5 |
| Q34 | 归档容器的可恢复性 | **永不删除**；v1 无 UI 入口，后续在设置页「归档管理」找回 | arch §5.4；M-arch |
| Q35 | wire 契约的冻结方式 | **`contracts/` v1 单一共享面**：TS 类型 + 运行时校验 + `protocol.md`；命令表带域/幂等/重放语义；破坏性改动递增 `v`，握手不匹配即拒连 | `contracts/`；arch §3.3 |
| Q36 | 引擎监督的归属 | **UI 侧监督 + native 侧进程事实**：引擎每 5 s 心跳并持久化 `generation`；UI 15 s 判死、指数退避重启；Rust 只提供 `start/stop/kill/status/pid/exit_code`，不解释协议 | `engine.ts`、`src/lib.rs`；arch §3.3 |
| Q37 | 扩展宿主未实现的方法 | **显式 no-op + 日志 + `ui.unsupported` 事件**，不静默；dialogs 走 `ui.request`，notify/status/title 走事件；project trust 复用 `select` 并写 pi 的 trust store | `engine/src/server.ts`、`ui-host.tsx`；arch §4.5 |
| Q38 | 扩展 UI 的对话框形态 | `confirm` 用平台 `AlertDialog`（强决策）；`select/input/editor` 用应用内 `Dialog` + `Input`（长选项/多行）；超时按 pi 默认值 resolve | `ui-host.tsx`；arch §4.5 |
| Q40 | 容器注册表与生命周期 | `registry.json` v1（containers/runs/activeContainerId）；`container.create` 单一创建入口；`archive` 单一 teardown（abort/dispose/丢 runs），记录、会话文件与布局永不删除；`requireSession` 按 registry 按需 rehydrate，空闲会话 LRU 上限 8 | `engine/src/server.ts`、`engine/src/store.ts`；arch §5.3/§5.4 |
| Q41 | 布局与 zoom 的归属 | 布局树与 zoom 仍归 UI；经 `layout.get/put` 落 `~/.pi/zu/layouts/`（UI 不持 fs）；切容器前 flush、恢复时先离开现有 zoom 再用 panel id 找 group 灌回 | `containers.ts`、`engine/src/store.ts`；arch §4.3 |
| Q42 | 多会话的转录取景 | `sessions.ts` 由单一 transcript 改为按 session id 的多视图；sheet id 稳定为 `session:{sessionId}`，切容器/拖 panel 时 `renderPanel` 按 key 保留状态 | `sessions.ts`、`dock.ts`；arch §4.2/§4.3 |
| Q43 | 非可见 sheet 的节流 | 先对会话 sheet 生效：`visiblePanels` 由布局的 active tab（或 zoom panel）算出；不可见时只画占位、不挂 Markdown 树/composer，转录取景继续更新，可见时一次渲染 | `dock.ts`、`sheets.tsx`；arch §4.3 |
| Q49 | 子代理的进程模型 | **进程内 AgentSession**，不 spawn `pi` 子进程：独立 `SessionManager` + `parentSession`，继承 captain model/thinking，`noExtensions`；省进程、可直读转录，代价是与 captain 共享引擎（M5 不要求隔离崩溃域） | `engine/src/subagents.ts`；arch §5.6 |
| Q50 | 三级禁止的落点 | dispatch 工具只作为 captain 的 `extensionFactories` 注册；子会话 `noExtensions` 且没有工具，工具层与注册层双重保证只两级 | `engine/src/subagents.ts`、`engine/src/server.ts`；arch §5.6 |
| Q51 | 子代理 run 的存储 | 文件 `zu/subagents/{captainId}/{ts}_{runId}.jsonl`；live run 只在内存，settled 写 `registry.json.subagentRuns[]`；archive captain 中断 live、保留 settled；重启后只读 settled | `engine/src/subagents.ts`、`engine/src/store.ts`；arch §5.6/§5.7 |
| Q52 | 名册与 note | 名册 sheet（`subagents:{containerId}`）从 `subagent.list` 投影 live+settled；选中走只读 `subagent.transcript`；派发/交付同时写 captain 的 `zu.dispatch`/`zu.delivery` custom entry 与 `subagent.note` 事件，转录显示 note 行 | `subagents.ts`、`sheets.tsx`、`sessions.ts`；arch §5.6 |
| Q45 | Project 的存储与校验 | `projects.json` v1（projects/membership）；只由用户显式创建；多根、恰一 primary；绝对路径且必须是目录；名称未自定义时跟随 primary basename；容器 cwd 是创建时的 primary 快照，改根不移动活容器 | `engine/src/store.ts`、`engine/src/server.ts`；arch §5.2 |
| Q46 | Launcher 的顺序 | **先 composer 后容器**：空画布或「＋」进入 Launcher，项目 chip 选目标（从项目行进入则锁定），提交才 `container.create` + `session.prompt` | `launcher.tsx`、`projects.ts`；arch §4.2 |
| Q48 | 660+ 会话的列表 | 全部会话用虚拟化 `List`（只挂视口附近的行）；引擎 `session.list` 先用会话目录的最大 mtime 做水位，水位不变直接回缓存，变了才 `listAll`；上限扩到 2000 | `shell.tsx`、`engine/src/server.ts`；arch §3.3 |
| Q44 | 侧栏的过渡形态 | M3 在容器行下保留 M1 的「全部会话」，让无主会话可打开/归入容器；M4 再改为 Project → 分组的两层聚合。容器行提供 archive 动作，但不做归档管理页（Q34） | `shell.tsx`、`containers.ts`；arch §4.2 |
| Q39 | i18n 运行时 | nsh 0.4.0 发布运行时未导出 `nsh/i18n`/`localeSettings`（checkout 有、发布版没有），**键表落为纯 TS**（`i18n.ts` + `locales/*.ts`，`%{name}` 插值），zh-CN 为源语言、en 为 fallback；`nsh test` 的 parity 用例保证两表与 `K` 集合同构 | `i18n.ts`、`locales/`、`i18n.test.ts` |

## 终端与外部容器（M7）

| # | 问题 | 裁决 | 落点 |
|---|---|---|---|
| Q53 | PTY 归谁、何时清理 | **native module 的资源，按 external 容器持 handle**：`terminals.ts` 一容器一个 `Pty`；sheet 只 attach sink，切容器/隐藏标签不杀 shell；`container.archive` 成功后显式 `closeTerminal`；JS handle `dispose()`/GC 时 Rust `Drop` 兜底 kill。应用重启不恢复 PTY（§5.5），按布局新开 | `src/pty.rs`、`terminals.ts`、`containers.ts`；arch §3.6/§5.4 |
| Q54 | M7 的 nsh 版本 | 发布版 0.4.0 **没有** `nsh/base Terminal`；`nsh-core`/`nsh-base` 改为 git pin `506b5392`（仍是 0.4.0），CLI 把生成的 hosts 也指到同一 checkout。不 fork、不 vendor | `Cargo.toml`、`Cargo.lock`；arch §6 |
| Q55 | 非可见终端 sheet 的降级 | `Terminal` 始终挂载：alt screen 与 scrollback 必须留在 emulator 里；DockArea 只画当前 tab，隐藏标签不产生额外绘制。切容器才卸载 sheet，PTY 留在 store，用 replay buffer 重建（>512 KiB 丢头部并 reset）。**没有**「保留 emulator、跳过绘制」的受支持钩子，因此不另做暂停 | `sheets.tsx`、`terminals.ts`；arch §4.3/§5.4 |

## 文件与编辑器（M8）

| # | 问题 | 裁决 | 落点 |
|---|---|---|---|
| Q56 | 编辑器的文件访问与保存语义 | **`zu/fs` 是唯一文件面，UI 不开 `capabilities.fs`**。每次调用显式传工作区根（active container cwd），Rust 侧 canonicalize 后拒绝 `..`、根外绝对路径与越界 symlink；读上限 2 MiB、目录上限 1000 项；保存写同目录临时文件再 `rename`，保留 mode 与 UTF-8 BOM；`write` 接收 `expected {mtimeMs,size}`，不符即 `ERR_FS_STALE`（附当前版本），编辑器转只读直到 reload；保存后 `read` 回读校验；所有错误带 `code`；`mkdir` 只允许根内一级创建 | `src/fs.rs`、`fs.ts`、`editors.ts`；arch §3.6 |
| Q57 | M8 的 Diff 做到哪一步 | **M8 只做两文件 `DiffView`**（文件树行/对话框选两个真实路径，稳定 sheet id `diff:{containerId}:{old~new}`），**不做工作区 git diff**；M9 的 `zu/git` 提供 `status`/`diff` 后，Changes 面板用 `git diff` 驱动。文件树保留为通用入口，不把「两文件对比」伪装成 git diff | `files.tsx`、`editors.ts`；arch §3.6 |

## Git（M9）

| # | 问题 | 裁决 | 落点 |
|---|---|---|---|
| Q58 | Git 怎么执行、根与路径的边界 | **shell out `git`，只走 argv，不引 libgit2**。每次调用显式传工作区根；根必须等于 `git rev-parse --show-toplevel`（容器 cwd 是仓库子目录 → `ERR_GIT_NOT_REPO`，不显示半份状态）；`git` 以 `Command` 的 argv 数组、`current_dir(root)` 执行，不经 shell，清掉 `GIT_DIR`/`GIT_WORK_TREE`/`GIT_INDEX_FILE` 等重定向变量；路径只接受根内相对路径，拒绝 `..`、绝对路径、pathspec magic 与 `-` 开头。**不做网络操作**（无 fetch/pull/push/remote），**不改全局 git 配置**；唯一写配置的是 `setIdentity`，且 `--local`。status 走 porcelain v2 `-z`；diff 固定 `--no-ext-diff --no-textconv --unified=3`，untracked 走 `--no-index /dev/null`，补丁上限 2 MiB；命令失败带 `exit`/`stderr`（`ERR_GIT_COMMAND`），缺身份 `ERR_GIT_IDENTITY` | `src/git.rs`、`git.ts`；arch §3.6 |
| Q59 | Changes 与 History 的形态、DiffView 复用 | **两个稳定 sheet，不合并**：`changes:{containerId}` 是「现在」——staged/工作区/未跟踪/冲突分组、单文件与全部 stage/unstage、选中文件的真实 `git diff`、提交行；`history:{containerId}` 是「过去」——真实 log、分支菜单 checkout、新建分支。工作区 diff **复用 M8 的 `DiffView` 的 `patch` 模式**（统一 diff 直接喂给同一组件），不新增 diff 组件、不把两文件对比当 git diff。顶栏 `open-changes`/`open-history` 是入口；checkout 后重读两表并 reload 该容器中**没有未保存改动**的编辑器（脏文档保持原文，保存时走既有的 stale 冲突路径） | `git-ui.tsx`、`git.ts`、`shell.tsx`、`sheets.tsx`；arch §3.6/§4.3 |
| Q60 | 未初始化仓库与缺失身份 | Changes 的 `ERR_GIT_NOT_REPO` 空态提供 **初始化仓库**（`Git.init` → `git init --quiet`，只在该根建仓）；commit 前用 `git var GIT_AUTHOR_IDENT/GIT_COMMITTER_IDENT` 检查身份，缺失时弹一次身份对话框，`Git.setIdentity` **只写该仓库的 `.git/config`**，随后重试同一次提交。测试自建仓库也走这两条路，因此不依赖机器的全局 git 身份 | `src/git.rs`、`git-ui.tsx`、`git.test.ts`；arch §3.6 |

## 浏览器（M10）

| # | 问题 | 裁决 | 落点 |
|---|---|---|---|
| Q61 | 浏览器的能力面与链接策略 | **只加 `capabilities.webview.hosts: ["*"]`**（Q32 的任意站点），地址栏旁显示「任意站点」；**不授予 `webview.input`**（不给页面可信输入）、**不授予 `openUrl`**（nsh 0.4.0 没有链接外开/新窗口回调，普通链接在 sheet 内导航，`target=_blank`/`window.open` 不会被打开）。页面 `onMessage` 只写 UI 日志，**不用 `injectJavaScript`**，页面内容永不过 wire、不进 agent 上下文。若未来 nsh 提供外开回调，再按需加 `openUrl.schemes: ["http","https"]` 并只在该回调里调用 | `nsh.json`、`browser.ts`、`browser-ui.tsx`；arch §3.4/§8.12；M10 证据 §5/§6 |
| Q62 | 浏览器 sheet 的状态与非可见降级 | 每个 sheet 的 URL/标题/loading/canGoBack/canGoForward/error/页面消息日志存在 UI store（`browser.ts`），key 为 `webview:{containerId}:{n}`（n 递增，可多开）；nsh 的 `WebView` **没有 pause API**，所以非可见 sheet **卸载 `WebView`、显示时按 store 的 URL 重挂载**：URL/标题保留，页面运行时状态（滚动、表单、SPA 内存、页内 history）丢失；应用重启只恢复页签 id，store 为空，因此是新标签页。不声称存在暂停能力 | `browser.ts`、`browser-ui.tsx`、`dock.ts`；arch §4.3/§5.5 |
| Q63 | 地址栏接受什么 | **只开 http/https**：裸域名/裸 `host:port` 补 `https://`，`HTTP://` 规范为小写 scheme；`javascript:`/`data:`/`file:`/`about:` 与不是主机的文本（含空格、无点的裸词）拒绝并显示原因，**不**转成搜索引擎查询。搜索通过搜索结果 URL 或页面自己的搜索框完成；M10 不引入默认搜索引擎 | `browser.ts` 的 `normalizeAddress`；`browser.test.ts`；M10 证据 §4 |

## LSP（M11）

| # | 问题 | 裁决 | 落点 |
|---|---|---|---|
| Q64 | LSP 的传输、同步与语言映射 | **Rust 只做进程与帧，TS 做协议**：`zu/lsp` 以 argv 数组 + 显式 canonical cwd 起 server（无 shell、独立进程组），`Content-Length` 帧有界（header 8 KiB / body 8 MiB / stdin 队列 8 MiB），每条完整消息、stderr 片段与 exit 经 `Callback::post` 推给 TSX；JSON-RPC id、超时（initialize 60 s、hover 8 s、definition 10 s、completion 8 s）、`$/cancelRequest` 与陈旧应答丢弃都在 `lsp.ts`。**全文同步**：`didChange` 发整份文本（180 ms 防抖），不假装增量 range；只同步容器根内文件，只保留打开文件的 `publishDiagnostics`。语言映射 rust→`rust-analyzer`、ts/tsx/js/jsx→`typescript-language-server --stdio`、go→`gopls`，每容器 × 语言族一个进程，归档即停；命令解析保留 rustup 的 symlink（不 canonicalize）。LSP 永远不经过 engine wire、agent 或网络 | `src/lsp.rs`、`lsp.ts`、`lsp-ui.tsx`、`files.tsx`、`sheets.tsx`、`shell.tsx`；arch §3.6/§4.3/§5.5/§8.13；M11 证据 |

## 常驻、通知与更新（M12）

| # | 问题 | 裁决 | 落点 |
|---|---|---|---|
| Q65 | 单实例怎么挡、锁放哪、死了怎么办 | **app 状态目录的锁文件 + pid 判活，native 侧实现**（nsh 没有单实例原语，也不用 `NSRunningApplication`）。`zu/native` 的 `Instance.claim()` 在 `bootShell()` 之前调用；锁为 `~/.pi/zu/instance.lock`（`ZU_STATE_DIR` 同样生效），内容 pid + 创建时间。**原子创建**：先写同目录临时文件再 `hard_link`，竞争只有一个成功，读者看不到半截锁；pid 用 Unix `kill(pid, 0)` 判活（`EPERM` 算活），死 pid/截断锁在下一轮**重读后**回收；同进程重复 claim 幂等，release 只删自己的。**非 Unix 一律当活锁**（不抢），Zu 只发 macOS。**headless 不 claim**（`isAvailable` 先判），所以测试 fixture 不占锁、不需要托盘。第二实例不 boot 引擎，显示「Zu 已在运行」（owner pid、锁路径、Quit），不提供跨进程 Show（nsh 无此原语，不伪造）。端口仍固定 `47823`；`Engine.portAvailable()` 让「端口被占用」有单独文案。跨进程真实双开未自动化：会与用户正在运行的 app 抢端口；以 Rust 的活 owner/并发 claim 测试 + 第二实例 UI fixture 为证据 | `src/instance.rs`、`instance.ts`、`lifecycle.ts`、`lifecycle-ui.tsx`、`nsh.json`、`engine.ts`；arch §3.4/§3.6/§4.6/§8.8 |
| Q66 | 关窗、托盘、应用菜单与通知策略 | **关窗 = 收起**：`window.closeOnPress: false` + `LifecycleHost` 的 `closePress` → `hide()`，engine/PTY/turn 不 teardown；托盘 Show/Hide + 主键显示聚焦；应用菜单保留 Edit roles，Window 菜单给 Show `⌘0`（headless 可验证的恢复路径）与 Close，Quit 用自定义项（`quitApp`：先释放 claim 再 `Application.quit()`），不用 `role: "quit"`（role 绕过 release；系统级退出留下的死 pid 锁由下次启动回收）。**通知只在主窗口不在前台时发**（可见但失焦也发；聚焦不发），turn settle 只认 running→idle 边沿（快照补 running、断线清空，所以重连中断不计完成），子代理 settle 另发。id 按 session/run，系统替换；相同正文 5 s 去重；权限第一次需要时问一次，拒绝后不再弹。按通知 → 关闭该条 + 显示聚焦窗口 + 按 id 排队（最多 20 次）等 engine/registry 就绪后打开会话 sheet / 子代理名册，冷启动成立。headless/无能力 no-op，不抛错。**未真机验证**：真实系统横幅/点击与托盘点击（用户 app 不能重启，开发运行不是 signed bundle） | `lifecycle-ui.tsx`、`notifications.ts`、`nsh.json`、`App.tsx`、`i18n.ts`；arch §4.6 |
| Q67 | 自更新接到哪、没有源时说什么 | **不伪造更新源**：本仓库没有 `nsh.json` 的 `"updater"`、公钥和 release，所以不写；`updates.ts` 先区分 **development / 未配置 updater / 可检查**，再走 check → available(version/notes/`canInstall`) → download（真实进度）→ ready → install & restart。**安装成功会退出进程**，promise resolve 只可能是“还没退出”，UI 保持「正在安装」，不显示“已安装”；失败显示错误并保持原状。`canInstall: false` 只显示 URL（没有 `openUrl` 能力，不偷偷加）。没有 updater 时 `checkForUpdate()` 在 dev 返回 null，**不当“已是最新”**。发布时写 GitHub 或自托管 `updater`（`nsh keygen` 的公钥；私钥只在发布机/CI），并用 `nsh update-manifest`；**更新包必须含 `Contents/Helpers`**，`script/bundle-mac.sh` 断言三个文件都在，`NSH_UPDATE_ARCHIVE=1` 打出整个 `.app` 的 tar.gz。**端到端安装不可测**：无真实 release，只以 fake service 的状态机测试 + 真实 UI 状态测试为证据 | `updates.ts`、`updates-ui.tsx`、`nsh.json`、`script/bundle-mac.sh`；arch §3.7；evidence/m12-lifecycle.md |

## 轮廓与 Hero sheet（Casing II）

| # | 问题 | 裁决 | 落点 |
|---|---|---|---|
| Q68 | 页面状态 vs 画布状态 | **Hero 变 sheet**：`home:{containerId}` / `home:scratch`，删除 `launcherOpen`；画布永远只渲染 sheet 树 | arch §4.2 |
| Q69 | 容器何时回收 | **无 sheet 即自动归档**（Hero 计入）：切到相邻容器 → archive → 侧栏 180ms 退场 | arch §5.4、Q80 |
| Q70 | 容器标题 | **存活的最早创建 sheet 的标题**（`sheetOrder` 创建序，拖 tab 不改）；session/terminal/webview 各自动态 | arch §4.3 |
| Q71 | 界面语言 | **跟随系统** `locale()`：`zh*` → zh-CN，其余 → en；删除切换按钮，设置页留后续 | arch §4.6 |
| Q72 | 字体 | **仅 sheet 内容**用 Lilex（`Lilex-Light` 300 + `Lilex-Medium` 500，同 family，就近取字面）；轮廓保持系统字体 | arch §6、design §3.4 |
| Q73 | 外壳 | **一体化**：窗口一层 `sidebar` 底，顶栏与侧栏同材质无分隔；内容区是内嵌白色圆角卡片（radius 14，四周 8–10pt） | arch §4.1、design §2 |
| Q74 | tab 宽度 | **Chrome 式**：`maxWidth 240`、`minWidth 72`、`flexShrink 1`、`flexGrow 0`，panel 变窄/增多时均匀挤压 | design §3.2 |
| Q75 | 顶栏 picker | **三态**：常态纯文本标题（无框无底）／hover 凹槽（`bg-inset` + inset 阴影 + radius 6）／展开下拉从凹槽下沿接出；宽 360pt。**已由 Q90 整体移除** | design §3.3 |
| Q76 | 工具行图标 | 用各 CLI **品牌图标**：Claude/Codex/Copilot 取自 manox-app 的 `assets/icons/*.svg`；Pi 用 `pi-coding-agent.svg`；注入 tint 适配两外观 | design §3.5 |
| Q77 | composer | **对齐 Steer（仅交互）**：分割线只与 composer 同宽；模型/thinking/context 右对齐；idle=↑发送、streaming=■停止（同位置）；排队/引导/打断收进 `⋯` 菜单，**不接线** | design §3.6 |
| Q78 | 拖拽 tab | **抽象物 + 落位指示**：源 tab 变占位，幽灵为 tab 形状跟随指针；用 `DockDropIndicator.index` 在两 tab 间画 2pt brand 竖线 | design §3.7 |
| Q79 | scratch 画布 | **临时画布**：kind `Scratch`，无 cwd/进程/注册表/持久化；Hero 带项目 chip；提交后铸真实容器并迁移 sheet；未提交则暂存 | arch §4.2 |
| Q80 | 归档动效 | 侧栏行高度 + 透明度 180ms 退场，同组其余行平滑上移 | design §3.8 |
| Q81 | 模型注册表归属与「无模型」的表达 | **引擎级一个 `ModelRuntime`，启动时显式创建**，每个会话共用并 `await` 它；`session.models` 默认读它的 snapshot，`refresh: true` 才重新做 pi 的 auth 检查（snapshot 为空时总是重新检查），所以登录 provider 后无需重启。空列表必须带 `reason`（`no_catalog`/`no_credentials`/`no_models`/`unavailable`），菜单说原因而不是空列表；pi 的 `unknown/unknown` 占位模型不出现在 `session.info`——`model` 缺失即「无模型」。composer 此时保留输入、只停住发送，给说明与重试 | `engine/src/server.ts`、`contracts/protocol.md`、`sessions.ts`、`composer.tsx`、`src/lib.rs`（`setAgentDir`，测试专用）；evidence/s20-models.md |
| Q82 | 容器内的终端与 Pi TUI | **终端是容器的资源**：sheet `terminal:{containerId}:{n}`，PTY 按资源 id 记账（`terminalInfo`/attach/close 同键）；容器 Hero 的 Terminal/Claude/Codex/Copilot/Pi 都在本容器开资源并就地替换 Hero，不新建容器（scratch 仍铸 external 容器，待 §2.1-3）；归档先更新注册表再杀该容器全部 PTY，终端移除后 PTY 的 exit 回调不得写回 `terminalInfo`。**Pi 动作 = 原生 `pi` CLI 的 TUI**，Zu 会话只由 composer/`session:{id}` 承担。重启后资源没有"跑什么"的记忆，按容器 kind 取默认 | `terminals.ts`、`containers.ts`、`launcher.tsx`、`sheets.tsx`；arch §5.4；evidence/s211-f2f3-container-terminals.md |
| Q83 | scratch 的页面归属与动作铸容器 | **scratch 是一张画布，不是容器**（`activeContainerId === null`，无 cwd/进程/注册表/持久化）。浏览器页记在 `webview:scratch:{n}`（`SCRATCH_CANVAS`），离开再回来仍在；**铸容器时**由 `transferScratchBrowserSheets` 在切换前重挂到 `webview:{containerId}:{n}`，页面状态整体跟随，随后 scratch 布局重置为只有一个 Hero。动作的铸容器：Terminal/Claude/Codex/Copilot → external 容器（architecture §5.3 的"进程即容器"仍成立），Pi → 先铸 Pi 容器再开原生 TUI，composer → Pi 容器 + 首条消息 | `browser.ts`、`containers.ts`、`launcher.tsx`；arch §4.2/§5.4；evidence/s21-3-scratch.md |
| Q84 | 动作可用性矩阵 | 三种画布上下文：**容器内**全可用；**scratch + 项目**除顶栏「文件/更改/历史/问题」（需要容器）外可用；**scratch 无项目（Chats）**只剩浏览器与项目 chip——铸工作区的终端/TUI 禁用，composer 仍可用（Chats 是合法的对话目标），避免把进程绑到任意目录。顶栏「浏览器」不再要求容器（scratch 页在 `webview:scratch:{n}`）。禁用不隐藏（`opacity-40`，读屏与 tooltip 保留） | `launcher.tsx`、`shell.tsx`、DESIGN §4.1；evidence/s21-4-action-matrix.md |
| Q85 | 容器标题（S2 细则） | 标题 = **存活的最早创建 sheet** 的 `title()`（`sheetOrder` 记创建序，`noteSheetOpened` 在打开处记账、`setLayout` 只剪枝、`activateCanvas` 播种；不持久化）。session=会话名，**未命名的新会话不参与命名**（id 前缀撞名）；terminal=OSC 标题；webview=页面 title；Hero 不参与；无可命名 sheet 时回退 captain 名/终端标题/目录。`containerTitle` 移入 `titles.ts`（sheet 注册表在容器 store 之上） | `containers.ts`、`titles.ts`、`dock.ts`；arch §4.3；evidence/s21-5-container-title.md |
| Q86 | 语言跟随系统 | 顶栏语言按钮删除（连同 `toggleShellLocale` 与 `app.titlebar.language` 键）；`App` 首帧前 `followSystemLocale()` 读 nsh 的 `locale()`，`zh* → zh-CN` 其余 → `en`（Q71）；运行中不跟随，重启生效。测试：映射单测 + `setLocale` 扮演系统的两条 fixture UI 测试；打开真 App 的用例用 `copy(zh,en)` 断言当前文案（`copy.ts` 读同一个系统 locale），fixture 挂载的用例仍是 zh-CN 模块默认 | `i18n.ts`、`App.tsx`、`shell.tsx`、`copy.ts`、`fixtures/locale-*.tsx`；evidence/s21-6-system-locale.md |
| Q87 | 无 sheet 自动归档的路径 | 每个 tab 由 shell 画自己的 ×（`tab-close-{panel}`，最后一个也可关——路径可达的前提）；`setLayout` 发现容器画布 `sheetCount === 0` 时自动 `archiveContainer(id)`（切到引擎给的下一个容器或 scratch、结束终端/LSP 都在归档里）；侧栏退场用 `LayoutAnimation.configureNext(create(180))`（nsh style 不支持 height 过渡，原生删除动画播放行淡出与其余行上移）。external 容器进程退出即归档 | `shell.tsx`、`containers.ts`；arch §5.4、DESIGN §3.8；evidence/s21-7-auto-archive.md |
| Q88 | S3 外壳的几何落地 | Workbench 根与顶栏、侧栏同为 `sidebar`（一层）；顶栏 40pt 无分隔线；侧栏 232 无右边框；内容卡片 `bg-card` radius 14 `overflow hidden`，四周 8–10pt（上 8 其余 10）；卡内页签条 `bg-card` + 底部 hairline（活动页签靠 shadowCard + primary 下划线）；composer 卡内左右 24 底部 16。`TabBarPlus` 测量移到卡片，`+` 几何不受边距影响 | `shell.tsx`、`chat-view.tsx`；DESIGN §3/§3.1；evidence/s22-8-shell.md |
| Q89 | 侧栏宽度的持久化 | 走新的 `settings.*` 协议命令落 `zu/settings.json`（registry/layouts 同目录、原子写、合并写入、引擎侧钳 200–360），不走 nsh storage——壳的可视状态和容器/项目/布局同住一个 state 目录。手柄是 10pt 沟槽里的 4pt `PanResponder` 热区，move 即时 `setSidebarWidth`（signal 驱动重渲染），release 再写一次 | `settings.ts`、`shell.tsx`、`engine/src/store.ts`、`contracts/protocol.md`；evidence/s22-9-sidebar-drag.md |
| Q90 | 顶栏 picker 移除的收尾 | 组件、数据函数（`pickerCandidates`/`pickerSessions`/`pickContainer`/`PICKER_LIMIT`）、四个 i18n 键、三个以 picker 为入口的 UI 用例一并删除；`titlebar.ts` 拆为 `vscode.ts`（VS Code 动作）与 `search.ts`（侧栏搜索匹配，真实过滤路径共用）；顶栏中心留空作拖拽区，不补位 | `shell.tsx`、`vscode.ts`、`search.ts`、`i18n.ts`；DESIGN §3.3；evidence/s22-10-remove-picker.md |
| Q91 | composer 仅交互的收尾 | hairline 移进 `ChatComposer`（`hairline` 参数，恰与 composer 同宽；Hero 无线）；footer 一行右对齐（模型/thinking、context、⋯、主按钮）；排队/引导/打断收进 `⋯` 且**可点无副作用**（`sessions.steer/interrupt` 的真实接线暂无 UI 调用方，等 §3 挂账的 pi 扩展/协议扩展）；Enter 排队车道不变 | `composer.tsx`、`chat-view.tsx`；DESIGN §3.6；evidence/s22-11-composer.md |
| Q92 | 斜杆命令的三类映射 | `slash.ts` 一张表：**local**（/model 开模型菜单、/thinking 循环档位、/compact 走 `session.compact`、/clear 清本地视图、/new 开 scratch Hero、/resume 开侧栏搜索）、**prompt**（扩展/模板/技能命令按原文进 `session.prompt`）、**unsupported**（pi 交互独占的 18 条给明确提示不发送）。弹层列本地命令并随草稿过滤；Enter 对 `/` 草稿执行命令。wire 侧新增 `session.setThinking`（幂等）与 `session.compact`（非幂等、streaming 拒绝） | `slash.ts`、`composer.tsx`、`sessions.ts`、`engine/src/server.ts`；DESIGN §3.6、arch §3/§4.3；evidence/s22-11a-slash.md |
| Q93 | 红绿灯与页签宽度 | 红绿灯：`controlsOffset { x:16, y:14 }`（左边距 16、40pt 内垂直居中），直径/间距是 macOS 原生（12/8），顶栏左翼读 `titleBar().left + 12` 让位；页签：minWidth 72、maxWidth 240、grow 0、shrink 1，标题截断，`+` 的 30pt 预留带与单 tab 宽度无关 | `App.tsx`、`shell.tsx`；DESIGN §3/§3.2；evidence/s22-12-13-chrome.md |
| Q94 | 品牌图标 | Canvas 填充路径（`new Path2D(svgData)` 原生解析）：`brand-icons.tsx` 落四标的 path/viewBox/fill-rule，`BrandIcon` 按 size 缩放、以纯色 tint 填充（品牌色不保两外观可读）；Hero 第二排换品牌标，第一排功能位保持轮廓 Glyph | `brand-icons.tsx`、`launcher.tsx`；DESIGN §3.5；evidence/s23-14-brand-icons.md |
| Q95 | 拖拽 tab 的抽象物 | 用 nsh 0.4.0 的两个挂钩：`renderDragPreview`（幽灵：tab 形状 144 宽、卡底 + shadowCard + 图标标题，跟随指针）与 `renderDropIndicator`（页签槽位 = 2pt brand 竖线；组分割/边缘 = 块状框）。**源 tab 占位需要 DockTab.dragging 标志**，nsh 0.4.0 没有——按 Q54 的 pin 升级规则单独成批，应用侧不伪造 | `shell.tsx`；DESIGN §3.7；evidence/s23-15-drag-ghost.md |

## 仓库布局（C8）

| # | 问题 | 裁决 | 落点 |
|---|---|---|---|
| Q96 | 前端工程文件裸在仓库根，三块如何归位 | **三包 + 一共享面**：`app/`（nsh 应用：`nsh.json`/`App.tsx`/五层/测试与 fixtures 全在其中，nsh 命令一律以 `app` 为应用目录）、`native/`（`zu-native` crate，`app/nsh.json` 以 `"rust": "../native"` 指向——CLI 按 canonicalize 解析该字段，允许 crate 在 app 目录之外）、`pi-harness/`（完整 pi 发行版，原 `engine/`）、`contracts/` 留根（UI↔harness 的共享面不属于任何一侧；两侧导入深度恰好对称，都是 `../../contracts/`）。资产按归属拆：Lilex 随 crate（`assets!()` 要求资产在 crate 自己的 `assets/`）→ `native/assets/fonts`；托盘图标是 TSX 资产 → `app/assets/`。dev 模式 sidecar 按 `CARGO_MANIFEST_DIR` 回退 `../pi-harness/dist/pi-engine`；`script/bundle-mac.sh` 的 `nsh package` 改为从 `app/` 目录执行 | `app/nsh.json`、`native/src/lib.rs`、`app/tsconfig.json`、`.gitignore`、`script/bundle-mac.sh`；arch §3.6/§3.8 |

## 双 harness 与 sheet 模块（2026-11-13）

| # | 问题 | 裁决 | 落点 |
|---|---|---|---|
| Q97 | pi 的传输形态 | **ACP over stdio，轮级子进程**：每条 turn spawn 一个 `pi-acp`，`initialize` → `session/new`/`load` → `prompt` → `update` 流 → settle 退出；恢复 = 再 spawn。旧 loopback engine 与 `pi-engine` 入口已于 2026-11-13 删除（P4） | `pi-harness/src/acp/`、`app/harness/pi-acp/`、`native/src/acp.rs`；[pi-acp-PROTOCOL.md](pi-acp-PROTOCOL.md) |
| Q98 | manox 的接入形态与范围 | **in-proc AHP 单例**（`native/manox` 装配 manox v0.9.1 宿主半边）；泵边界 `catch_unwind` 把 panic 转 transport error，UI 走 restart + reconnect；折叠对账门禁保留。范围 = 「能对话」最小回路，不扩到 Steer 产品面 | `native/manox/`、`app/harness/manox/`；arch §3.3 |
| Q99 | pi 与 manox 的地位 | **同级公民**：都是容器里的 sheet（`session` / `manox-chat`），harness 属于 sheet 的 kind，不属于容器或壳；pi 不再享有「内置」特判，Manox 不再是「扩展」 | [sheet-module-ARCHITECTURE.md](sheet-module-ARCHITECTURE.md) |
| Q100 | 扩展单位 | **sheet 模块**：模块拥有 kind（可多个）、呈现、自己的 store、Hero/侧栏/命令/搜索贡献、能力声明与 intent；壳只渲染 registry，未知 kind 降级占位；模块之间禁止 import | 同上 §4、§7 |
| Q101 | native 的粒度 | **能力域，不是每 sheet 一个 crate**：`fs`/`git`/`pty`/`lsp`/`acp`/`state`/`pimodels`/`manox`；一个域服务多张 sheet；只有 `app/domains/` 可以 import `zu/native`；纯 TS 能做的（浏览器、SVG 预览）不碰 native | 同上 §5；`native/src/lib.rs` 的单一注册面 |
| Q102 | 容器模型 | **去 harness 身份**：容器 = `{ id, cwd, projectId, sheetOrder }`，`kind` 与 `sessions[]` 消失；容器标题仍由最早存活的 sheet 推导；「外部终端容器」变成 terminal 模块的 intent；pi 的多会话变成模块内投影 | arch §5.3；迁移 S3 |
| Q103 | 文档治理 | **权威链 + 状态锚点**：architecture（当前）/ sheet-module（目标）/ pi-acp（协议）/ DESIGN（视觉）/ decisions（裁决）/ plan（执行）；只有 plan §0 与 architecture §7 写状态；`docs/evidence/` 只放可再生的验证产物，过程叙事删除、历史留 git | [plan.md](plan.md) §5 |
| Q104 | 两条 harness 的模型目录 | **共用一份 pi 目录，不各养一套**：`native/manox` 的 boot 把 `~/.pi` 的 `models.json`/`auth.json` 翻译进内核 provider 注册（`register_providers_yaml`），app 侧把 pi ref 组合成 registration-qualified `{provider}-{wire}/{model}`；pi 侧把 Hero 的选择经 spawn env（`ZU_PI_MODEL`/`ZU_PI_EFFORT`）应用到 `ModelRuntime` | `native/manox/src/real.rs`、`app/stores/pi-models.ts`、`app/harness/pi-acp/acp.ts`、`pi-harness/src/acp/pi-session.ts`；bb94e6f |
| Q105 | 侧栏的 harness 分组 | **不设 harness 专属组**：manox 的侧栏组随 `ContributedSection` seam 一起移除（Hero 的 harness 段已是入口；一个侧栏只能说一种行的语言）。已开的 thread 经 sheet 与布局 stash 可达；后继是**合并的项目投影**，不是恢复分组 | `app/shell/contrib.tsx`、`app/harness/manox/register.tsx`、`app/shell/shell.tsx`；7d2d523 |

| Q106 | sheet 模块的落地形态 | **S0–S3 一次落地**：`contracts/module.ts` 是唯一契约；`app/core/registry.ts` 提供 `registerModule/startModules`；`app/domains/` 是唯一 import `zu/native` 的地方；`app/modules/` 收编 home/browser/files/git/terminal/problems/pi/manox；容器记录只剩 `{id,cwd,projectId,sheetOrder}`；通知以 sheet id 为单位；依赖门禁 `script/check-layers.mjs` 零白名单 | `contracts/module.ts`、`app/core/registry.ts`、`app/modules/register-all.ts`、`app/sheet-modules.test.tsx` |
| Q107 | 旧 wire 与 legacy distro 的删除 | **P4 完成**：删 `contracts/protocol.{ts,md}`、`stores/engine.ts`、`native` 的 `Engine` 模块、`pi-harness/src/{server,store,subagents}.ts` 与 `dist/pi-engine`；打包只带 `Helpers/pi-acp`。代价：ACP distro 尚无 dispatch，子代理名册在 UI 上明确显示不可用（后续以 [pi-acp-IMPLEMENTATION.md](pi-acp-IMPLEMENTATION.md) E0 恢复） | `script/bundle-mac.sh`、`native/src/lib.rs`、`pi-harness/package.json`、`app/modules/pi/subagents.ts` |

## 待审设计（不计入 Q 编号）

[pi-acp-IMPLEMENTATION.md](pi-acp-IMPLEMENTATION.md) 的 D1–D7 是**设计稿**，尚未成为裁决：

- D1 一会话一持久 `pi-acp` 进程（容器级复用延后）
- D2 留在 stable ACP v1，补齐会话语义面
- D3 配置/命令/上下文是协议状态，删除客户端代偿
- D4 权限策略在 distro 扩展里
- D5 子代理 = Pi 扩展 + `_zu/subagents/*`
- D6 ACP 宿主是独立进程，不是 Pi 扩展
- D7 不采用 `pi-ahp`

审查通过后，这些条目按 Q108 起登记；在此之前，plan 只把 A0–F0 标为"设计待审"。

## 决策编号说明

- Q1–Q107 覆盖全部已讨论的问题，**无未决项**。历史横切面已在 architecture 落成决策：扩展宿主契约与 project trust（§4.5）、
  文件读写归属（Q56）、git 执行与根/路径边界（Q58）、协议版本与幂等（旧 §3.3）、归档可达性（Q34）、
  浏览器能力/降级（Q61/Q62）、LSP 传输/同步（Q64）、单实例与通知（Q65/Q66）、更新源（Q67）、
  模型注册表（Q81）、容器内终端资源（Q82）、scratch 与铸容器（Q83）、动作矩阵（Q84）、容器标题（Q85）、
  语言跟随系统（Q86）、自动归档（Q87）、S3 几何（Q88）、侧栏宽度（Q89）、picker 移除（Q90）、
  composer 收尾（Q91）、斜杠映射（Q92）、红绿灯/页签（Q93）、品牌图标（Q94）、拖拽抽象物（Q95）、
  三包布局（Q96）、ACP 传输（Q97）、manox 接入（Q98）、双 harness 同级（Q99）、sheet 模块（Q100）、
  native 能力域（Q101）、容器去 harness 身份（Q102）、文档治理（Q103）、模型目录共用（Q104）、
  侧栏不设 harness 分组（Q105）、sheet 模块落地（Q106）、旧 wire 删除（Q107）。
- 原 engine/ui/domain 三份文档里的 E/U 编号已废弃，统一并入本表。
- 已完成与下一批工作见 [plan.md](plan.md)；条件性里程碑（M-tty / M-arch / M-web）的触发条件也记在那里。
