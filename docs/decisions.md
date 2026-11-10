# 决策台账

> 决策文档。Zu 的全部已定决策，Q 编号是唯一编号。每条给「问题 → 裁决 → 落点 → 一句话理由」。
> 设计正文见 [architecture.md](architecture.md)；决策过程与论证见 [evidence/decision-log.md](evidence/decision-log.md)。

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
| Q47 | 归属的移动方式 | membership 显式；侧栏容器行提供项目菜单与拖行（PanResponder 量项目头位置，落下按 pageY 选组），二者走同一 `project.setMembership` | `shell.tsx`、`projects.ts`；arch §5.2 |
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
| Q57 | M8 的 Diff 做到哪一步 | **M8 只做两文件 `DiffView`**（文件树行/对话框选两个真实路径，稳定 sheet id `diff:{containerId}:{old~new}`），**不做工作区 git diff**；M9 的 `zu/git` 提供 `status`/`diff` 后，Changes 面板用 `git diff` 驱动。文件树保留为通用入口，不把「两文件对比」伪装成 git diff | `files.tsx`、`editors.ts`、roadmap M8/M9；arch §3.6 |

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

## 决策编号说明

- Q1–Q63 覆盖全部已讨论的问题，**无未决项**。曾悬空的横切面已在 architecture 落成决策：扩展宿主契约与 project trust（§4.5）、引擎监督与重连（§3.3/§5.4，M2）、文件读写归属（Q56/§3.6 的 `zu/fs`）、git 执行与根/路径边界（Q58/§3.6 的 `zu/git`）、协议版本与幂等（§3.3）、归档可达性（Q34）、模型选择入口（§3.5 的写回规则）、i18n 键表（M2）、浏览器的能力/链接策略与非可见降级（Q61/Q62/§4.3）。
- 原 engine/ui/domain 三份文档里的 E/U 编号已废弃，统一并入本表。
- 条件性里程碑（M-tty / M-arch / M-web）的触发条件见 [roadmap.md](roadmap.md) §17。
