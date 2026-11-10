# 事实审计：把叙述逐条对到事实

> 2026-11-10。对象：[architecture.md](../architecture.md)、[decisions.md](../decisions.md)、[roadmap.md](../roadmap.md)、[evidence/](../evidence/)。
> 方法：不评观点，只把文档里的**承重断言**（撑着某个决策或里程碑的那几句话）抽出来，回到源码、包声明、本机真实状态与可重放命令上核对。
> 判定口径：**成立** / **成立但有前提** / **表述不准**（结论可能仍对，理由或措辞要改）/ **不成立**（事实错）/ **无法在本机核实**。

## 0. 观测口径（重要：审计期间工作区在动）

文档最后修改于 16:44–16:46（未再变）。工作区在审计期间被推进过两轮：

| 时间 | 事件 |
|---|---|
| 16:53 | 第一版 `engine/dist/pi-engine` 构建完成（单入口、无版本常量）。实测**起不来**（见 F1） |
| 17:03–17:07 | 新增 `Cargo.toml`、`src/lib.rs`、`engine.ts`、`sessions.ts`；`engine/src/version.ts` + `check-version`；重建产物并**实测可起**；`/tmp/zu-e2e` 出现三份真实会话（其中一份有 `stopReason: "stop"` 的助手回复） |

因此本文的判定以 **17:10 的工作区**为准，并把"文档写的"与"代码现在做的"分开标注。这不是找茬：**文档与实现已经开始分叉**，而文档里没有"当前状态"的锚点（见 §1.5）。

| 来源 | 版本/位置 | 用途 |
|---|---|---|
| nsh | `/Users/chenzhongrun/projects/github/nsh` @ `506b5392`，workspace `0.4.0` | 终端、DockArea、能力面、原生模块、打包 |
| pi | `engine/node_modules/@earendil-works/pi-coding-agent` `1.5.0` | SDK 类型、`docs/`、事件与存储 |
| pi CLI | `/opt/homebrew/bin/pi` `1.5.0` | 与文档声称的版本一致 |
| Bun / Node | `1.3.14` / `v26.0.0` | 与 spike 报告的环境一致 |
| 本机真实状态 | `~/.pi/agent/sessions`：**276 个 cwd 目录、660+ 个会话、195 MB**；`~/.pi/zu/subagents` 已存在；`~/.pi/agent/extensions` 有 2 个真实扩展 | 规模、兼容性、信任 |

**一句话审计结论**：决策主体（Q1、Q10、Q28、Q29 的结论面）经得起核对。**四条承重事实仍然错或过时**（RPC 语义、能力声明、扩展宿主机制、并发写依据），**一条在审计期间被代码修掉了但文档还错着**（构建产物/构建回路），另有一类**文档与实现的分叉**已经发生（协议命令、capability 写法、当前状态）。

## 1. 结论表

### 1.1 架构（architecture.md）

| # | 断言（出处） | 判定 | 事实 |
|---|---|---|---|
| A1 | TSX 运行时是 QuickJS 沙箱，**无 npm、非全量 Node**（`architecture.md:12`） | 表述不准 | nsh 支持 npm 包（解析 browser build，`project-structure.md:253-257`），并提供 `fs/promises`、`process`、`path`、`crypto`、`buffer`、`zlib` 等 Node 子集（LLRT，`standard-modules.md:18-19`）。**结论"pi 不能进 UI 进程"仍成立**，但真正的理由是：pi 需要 `node:module`/`worker_threads`/动态 require、原生依赖与 WASM 资产，且要一个可写 `~/.pi` 的进程；这些不靠"无 npm"来解释 |
| A2 | 唯一引擎路径 = 内嵌 sidecar，不依赖系统 pi（`architecture.md:47,101`） | 成立 | 与 Q6 一致；路径定位问题真实存在（见 A9） |
| A3 | pi 的 `--mode rpc` 是 **1 进程 1 会话、无多路复用协议**（`architecture.md:47`） | **不成立** | RPC 是长生命周期进程，支持 `new_session`/`switch_session`/`fork`/`clone`，并自带命令/响应/事件 + `extension_ui` 子协议（`docs/rpc.md:3`、`docs/rpc-commands.md:130,592,610,638`）。它缺的只是**多会话并发**（事件无 sessionId）。"用 SDK"的结论仍对，理由要重写 |
| A4 | `AgentSessionRuntime` 提供 `newSession`/`switchSession`/`fork`（`architecture.md:47`） | 成立 | `sdk.md:58`、`AgentSession` 导出表；另有 `importFromJsonl` |
| A5 | `agent_settled` 是回合终点；`agent_end` 只是低层 run 结束（`architecture.md:57`） | 成立 | `agent-session.d.ts:49-57`：`agent_settled` 带 `aborted`，`agent_end` 带 `willRetry`；`sdk.md:94` |
| A6 | prompt 响应的 `disposition` 区分 started/handled（`architecture.md:57`） | 表述不准 | `prompt()` 返回 `Promise<void>`；`PromptDisposition = "started" \| "queued" \| "handled"`，只能通过 `PromptOptions.preflightResult` 回调观察（`agent-session.d.ts:176-190`），该钩子注明是给 RPC 模式用的 |
| A7 | wire 命令表（`architecture.md:55`） | 不完整，且**已被实现分叉** | 缺 `session.list/create/close`（工作区的 `sessions.ts:125-172` 已经在用 `session.list/open/prompt/abort`，而 arch 没收录）、模型/thinking、文件读写（M6）、扩展 UI 的请求-响应（§4.5 依赖它）、重连快照/重放；且 `pty.*` 与 §3.6 的 `zu/pty` 归属冲突 |
| A8 | wire 事件表（`architecture.md:56`） | 不完整 | 缺 `queue_update`（steering/followUp）、`compaction_*`、`auto_retry_*`、`session_info_changed`、model/thinking 变更；`tool.update` 与 pi 的 `tool_execution_update` 名不对应；`extension_error` 不是会话事件（见 A21） |
| A9 | nsh 的 `capabilities.process.execute` 只认裸命令名或绝对路径、精确比对、不支持 `${dataDir}`（`architecture.md:97`） | 成立 | `access.rs:1103`（`valid_command`）、`access.rs:1469`（`allows_process`）；`${dataDir}` 只用于 `fs` 根 |
| A10 | 能力声明 `"network": { "sockets": ["127.0.0.1:*"] }, "notifications": true`（`architecture.md:62-65`） | **不成立（文档）；代码已用正确写法** | ① `sockets` 只接受**精确 `host:port`，禁止通配**（`SocketGrant::new`，`access.rs:199-234`；`sandbox-and-capabilities.md` 同述），`"*"` 作为端口直接解析失败；② 回环 WS 不走 `sockets`（那是 `net.connect` 的裸 TCP），WebSocket 按 `hosts`/`http` 授权（`access.rs:28-31`）。17:07 的 `nsh.json` 已经写成 `"network": { "hosts": ["127.0.0.1"] }`——**代码对、文档错** |
| A11 | UI **不持** fs、storage、process，全部状态经 wire 落 `~/.pi/zu/`（`architecture.md:68`） | 表述不准 | nsh 的 `Storage` **不需要任何 capability**（`nsh.md:2411`，"5 MB、字符串 KV"），`fs/promises`/`process` 也只是被授权而非不可用。所以这是**自选策略**，不是平台限制；它带来的代价（写 Project/layout 要过一次 wire、engine 不在时无法落盘）没有在文档里权衡 |
| A12 | 会话路径 `~/.pi/agent/sessions/--{encodedCwd}--/`（`architecture.md:73`） | 成立但有前提 | 实测 `safePath = "--" + cwd 去掉前导分隔符、把 / \ : 换成 "-" + "--"`（`session-manager.js:291-296`）。**该编码不是单射**：`/a/b`、`/a-b`、`/a:b` 落到同一个目录名，macOS 又大小写不敏感。所以"按目录名反解 cwd"不安全，cwd 必须读 header/`SessionInfo.cwd` |
| A13 | `~/.pi/zu/` 对 pi 零干扰（`architecture.md:82`） | 成立 | spike ③① 可重放；本机 `~/.pi/zu/subagents` 已存在且 `pi 1.5.0` 正常 |
| A14 | 子会话三重自证（路径/文件名/header），`NewSessionOptions { id, parentSession }`（`architecture.md:84`） | 成立 | `session-manager.d.ts:5-16`（`parentSession` 在 header），`:378`（`create(cwd, sessionDir, options)`） |
| A15 | 原生模块可导出 class + `Callback::post` + `on/Stop`，覆盖长生命周期资源、异步字节流、可撤销订阅（`architecture.md:88-97`） | 成立 | `website/docs/rust.md:229-330,376-379`；`Instance<T>` 见 `rust.md:295`。工作区的 `src/lib.rs` 已经用 `#[module]` 导出 `status/port/token/log_path` |
| A16 | 构建回路：`engine/build.ts` → `bun build --compile --target=bun-darwin-arm64` → `dist/`（`architecture.md:110`） | **与实现不一致** | 仓库里**没有** `engine/build.ts`；实际在 `engine/package.json`：`check-version → bun build --compile → cp photon_rs_bg.wasm → cp quickjs.wasm`。文档描述的入口文件不存在，读者会以为已有一条可重放的构建链 |
| A17 | 照抄上游 WASM 资产布局即可（`architecture.md:110`、`spike-report.md:73`） | 成立但漏步 | 上游 `build:binary` 是**三个入口**（cli + image-resize worker + codemode worker）+ `copy-binary-assets`，并带 `--no-compile-autoload-bunfig --no-compile-autoload-dotenv`（`package.json`）。photon 的 wasm 在编译形态下**必须与可执行文件同目录**（`dist/utils/photon.js:22-33`，`process.execPath` 兜底）；17:07 的脚本已补上两个 wasm，但**多入口仍未处理**（图像缩放/codemode 的 worker 入口） |
| A18 | M0 验收：sidecar 起来 + WS 握手（`roadmap.md:41`） | **成立（17:07 起）** | 16:53 的产物起不来（`Cannot find module '@earendil-works/pi-coding-agent/package.json' from '/$bunfs/root/pi-engine'`）；17:07 改为源码常量 `version.ts` + `check-version` 后，实测可起、可 `hello`/`session.list`。修法（源码常量 + 校验脚本）是正确方向，但**文档里没有这一节** |
| A19 | DockArea：受控 layout、`onLayoutChange` 回报整份、`renderPanel` 按 key 保状态、<600pt compact（`architecture.md:117-131`） | 成立 | `dock_area.rs:1-80`（模块文档原文）；`compact.rs` 阈值 `600.0` |
| A20 | 布局是纯数据，**含 zoom**（`architecture.md:130`、Q21） | 表述不准 | `DockAreaLayout` 里没有 zoom 字段；zoom 是内部 signal + `ZoomChange(panel)` 事件，恢复要用 ref 的 `zoomedGroup()`/`groupOf(panel)`/`toggleZoom(group)`（`dock_area.rs:374-376,503-521`）。可行，但"含 zoom"会误导实现：要**单独**订阅、单独存、恢复后再灌 |
| A21 | 扩展桥：engine 侧 `ctx.hasUI = true`，`confirm/select/input` 转原生，`editor/custom` 降级（`architecture.md:140`） | **不完整，机制写错** | 默认 `uiContext` 是 `noOpUIContext`、`hasUI=false`、`mode="print"`（`runner.js:132-168,203,355`）；必须 `session.bindExtensions({ uiContext, mode })`（`agent-session.d.ts:779`）才会变。`ExtensionUIContext` 有 20+ 方法（`types.d.ts:83-215`），不止 5 个；`notify` 在 no-op 下**静默丢弃**，`confirm` 静默返回 `false`——正是 Q23 想避免的"两前端行为分叉"。pi 自己在 RPC 模式给出了一份**成文的降级清单**（`docs/rpc-extension-ui.md`）可照抄。工作区当前的 `server.ts` 也**没有**调用 `bindExtensions` |
| A22 | 存储布局把子代理定义放 `~/.pi/zu/agents/…`，Q19 又说项目来源是 `.pi/agents/`（`architecture.md:80,215`） | 自相矛盾 | 两处对"project 来源"给了不同路径；需要二选一（建议：`~/.pi/zu/agents/{builtin,personal}` + `<cwd>/.pi/agents/`，并把 `.pi/agents` 不纳入 pi 的 trust 保护这一点写清） |
| A23 | 已知风险 4：并发写依赖 pi 自己的锁语义（`proper-lockfile` 在依赖列表里）（`architecture.md:252`） | **不成立** | `proper-lockfile` 只用于 `auth-storage.js` 与 `settings-manager.js`；会话写入是裸 `appendFileSync`（`session-manager.js:813`），没有锁。两个写者对同一 JSONL 会各自推进 leaf——比文档描述的风险**更高**，不是更低 |

### 1.2 决策台账（decisions.md）

| # | 断言 | 判定 | 事实 |
|---|---|---|---|
| D1 | Q1 路径即关系 + 兼容方向不对称 | 成立 | 与 pi 的 `SessionManager` 能力一致；补一句"不反解目录名"即可（A12） |
| D2 | Q3 JSON 快照 + 原子 rename + 启动对账 + 状态分级 | 成立但有缺口 | 格式里**没有版本字段**，而 M10 有自更新；需要 `schemaVersion` 与迁移规则 |
| D3 | Q10 CustomEntry：不进上下文、pi 容忍 | 成立 | `CustomEntry` 类型注释 "display/state entries and do not participate in context"（`session-manager.d.ts:81-85,186-189`）；`registerEntryRenderer` 存在（`types.d.ts:1277`） |
| D4 | Q23 用户扩展与 skill **全量加载** | 不完整 | 项目级资源（`.pi/extensions`、`.pi/skills`、`.pi/settings.json`、项目 `.agents/skills`）受 **project trust** 门控；无交互提示的宿主在 `defaultProjectTrust: "ask"` 下**静默跳过**（`docs/security.md:35-58,75-81`）。用户的 `trust.json` 里没有该项目 = Zu 里不加载、CLI 里加载。设计里完全没有这个面 |
| D5 | Q24 读共享、写独立；模型选择写回共享 | 成立但自相矛盾 | `architecture.md:79` 写"pi 的 settings 只读"，与"模型选择写回共享"冲突。且"写独立"要自己实现 `SettingsStorage`（`settings-manager.d.ts:27-35`，`fromStorage`），文档没提；`trust.json` 又是另一处 pi 的写面 |
| D6 | Q28 = B（native module 启动 sidecar） | 成立 | A9 的事实支撑它；但同一模块同时承担 engine/PTY/LSP/Git 四域，M0 只该做第一域（见评审 §2 Q28 行） |
| D7 | Q29 先内置 VtEmulator、Ghostty 作条件性里程碑 | 结论成立，**关键证据错误** | 见 E5 |
| D8 | "Q1–Q31 覆盖全部已讨论问题，**无未决项**"（`decisions.md:58`） | 不成立 | 扩展宿主契约、project trust、引擎监督/重连、文件读写归属、协议完整性、格式版本、归档可用性、模型选择、i18n 落地——至少 9 项在正文里悬空；`roadmap.md:24` 承诺的"`decisions.md` 待决区"并不存在 |

### 1.3 路线图（roadmap.md）

| # | 断言 | 判定 | 事实 |
|---|---|---|---|
| R1 | M1 wire：`session.list/open/prompt/abort`（`roadmap.md:52`） | 与架构不一致 | `architecture.md:55` 没有 `session.list`；M1 的侧栏与"继续对话"都依赖它。工作区已经在实现这一组（`sessions.ts`），文档落后于代码 |
| R2 | M1 验收 5：用 pi CLI 看到 Zu 写的 custom entry（`roadmap.md:61`） | 顺序矛盾 | 写 custom entry 的是 M5 的 dispatch/delivered；M1 阶段 Zu 不写任何 custom entry，这条验收无法执行 |
| R3 | M2 引用 `U14/U9/U7/U8`（`roadmap.md:72-73`） | 失效引用 | `decisions.md:59` 明说 E/U 编号已废弃；正文却在用 |
| R4 | M-web 触发"Q6 的 web 挂账"（`roadmap.md:196`） | 引用错误 | Q6 是"系统 pi 调试通道"，与 web 无关；台账里没有 web 决策 |
| R5 | M3 "同时给 nsh 提 alt screen 污染的修复 PR"（`roadmap.md:87`） | 基于假缺陷 | 见 E5 |
| R6 | 每个 M 都要"可构建可用"（`roadmap.md:4,23`） | 部分不成立 | M0 正在落地（`Cargo.toml`、`src/lib.rs`、`engine.ts`、`sessions.ts` 已出现），但本机没有 `nsh` CLI（`which nsh` 为空）、仓库无 CI、无构建门禁；"每个 M 可构建"目前靠人工 |
| R7 | nsh 版本 | 实现已 pin，文档未记 | `Cargo.toml` 现在写 `nsh-core = "0.4.0"`、`nsh-base = "0.4.0"` + `Cargo.lock`；但**没有任何文档提到 nsh 的 pin 与升级台账**，而这里恰恰是行为最不稳定的一侧（`term` 四天前才加入） |

### 1.4 依据文档（evidence/）

| # | 断言 | 判定 | 事实 |
|---|---|---|---|
| E1 | spike ① `bun build --compile` 把 pi SDK 打进单文件，69 MB，运行正常 | 成立 | 与上游 `build:binary` 相符；但"probe 能跑"不等于 "server.ts 能跑"（A18） |
| E2 | spike ② `createAgentSession` 真实跑一轮**未验证** | **已被工作区验证** | 17:03–17:07 的 `/tmp/zu-e2e` 里有真实会话：`model_change` → bailian `qwen3.8-flash`，助手消息 `stopReason: "stop"`、含 thinking+text、约 10k tokens。**聊天路径成立**；**工具执行路径仍未验证**（该回合无工具调用） |
| E3 | spike ③④ 存储布局与 `SessionManager` 枚举面 | 成立 | 实测 `listAll()` 在本机 660 会话 / 195 MB 上用 **~600 ms**；`SessionInfo.cwd` 来自 header |
| E4 | terminal-emulator：nsh 支持/缺失逐项 | 基本成立 | `TerminalModes` 仅 2 字段、`TerminalCursor` 无形状、事件仅 3 种、`line()` 逐行取数——**行号与结构全部对**（`emulator.rs:111,121,131,144`）；`mod.rs:282` 是 `virtual_list`，文档引的 `mod.rs:32-36` 是模块文档（引用漂移） |
| E5 | terminal-emulator：**"真实解析缺陷：alt screen 滚动污染 scrollback"**，引 `vt.rs:216` 的 `scroll_up` | **不成立** | `scroll_up` 确实无条件调用 `push_scrollback`，但 `push_scrollback` 第一行就是 `if self.primary.is_some() \|\| self.max_scrollback == 0 { return; }`（`vt.rs:205-208`），`primary` 恰是 alt screen 期间的标志。该守卫**自文件创建起就存在**（`c8e044b4`，2026-11-06），且 `vt.rs:649` 有 `alternate_screen_restores_the_primary` 测试。文档只看了调用点，没跟进被调函数 |
| E6 | feasibility §1：换核"缺口：无"，只受 factory 是 Rust API 约束 | 表述不准 | `provide_context` 是**owner 子树**作用域（`reactive.rs:933-937`），`Terminal` 在渲染时 `use_context`（`term/mod.rs:248-252`）。要换核必须自己写一个 Rust 包装组件（`provide_context` + 渲染 `nsh_base::term::terminal()`），TSX 里直接用 `nsh/base` 的 `<Terminal>` 拿不到 factory。可行，但不是"无缺口" |
| E7 | feasibility §2 WebView 能力面（含原文引用） | 成立 | `web-view-and-video.md:10` 引文准确；devtools 确实没有；`sendInput` 仅 macOS（同前文档） |
| E8 | feasibility §5 Git 用 shell out | 成立 | `std::process` 无新依赖；`--porcelain=v2 -z` 稳定 |
| E9 | feasibility §6 "PTY、Ghostty、LSP 汇聚到一个 native module" 强化 Q28=B | 成立 | 但该模块的四域职责也意味着它是最大的构建风险（见评审 P1-5） |

### 1.5 文档 vs 工作区：已经发生的分叉

| 项 | 文档 | 工作区（17:10） |
|---|---|---|
| 当前状态 | README："引擎未接线；下一步是 M0" | `Cargo.toml`、`src/lib.rs`、`engine.ts`（WS 客户端 + port/token）、`sessions.ts`（侧栏/对话 store）已在 |
| 协议 | arch §3.3 无 `session.list` | `sessions.ts` 用 `session.list/open/prompt/abort` |
| 能力声明 | `sockets: ["127.0.0.1:*"]` | `network.hosts: ["127.0.0.1"]`（正确） |
| 构建 | `engine/build.ts`（不存在） | `package.json`：`check-version` + 编译 + 拷两个 wasm |
| 端口/令牌 | 未写 UI 如何拿到 | `src/lib.rs` 的 `port()`/`token()` 已经给出 |
| nsh 版本 | 未提 | `Cargo.toml` 0.4.0 + `Cargo.lock` |

这不是"文档写错了"那么简单：**没有任何机制让文档跟上实现**（没有 as-of 锚点、没有构建产物校验、没有把"当前状态"交给脚本生成）。一天之内就发生了 6 处分叉，M1 之后只会更快。

## 2. 承重事实：需要改的五处

### F1 构建回路与产物（已修一半，文档仍错）

- **16:53 的产物起不来**：`error: Cannot find module '@earendil-works/pi-coding-agent/package.json' from '/$bunfs/root/pi-engine'`——`server.ts` 曾用 `createRequire(import.meta.url)` 读包版本，编译后 `$bunfs` 无法解析裸包名。
- **17:07 已修**：`src/version.ts` 放版本常量 + `scripts/check-version.mjs` 校验与 `package.json` 的 pin 一致；实测可起、可握手、可 `session.list`。
- **仍未解决的**：① `architecture.md:110` 描述的 `engine/build.ts` 不存在，构建链没有文档化；② 上游的多入口（image worker、codemode worker）与 `--no-compile-autoload-*` 未跟进——两个 wasm 已被显式 `cp`，但 worker 入口是否被嵌入、图像缩放与 codemode 在产物里是否可用，都未验证；③ 没有"编译产物冒烟"这条门禁——这次是靠人肉发现的。
- **改法**：把构建回路写成文档；加一条 CI：构建 → 起动 → `hello`+`session.list` → 关掉；再补一条"图像缩放/codemode"的冒烟或明确标注"不支持"。

### F2 "alt screen 污染"的缺陷不存在（E5）

- `vt.rs:216` 的 `scroll_up` 与 `vt.rs:329` 的 `alternate` 被引用为证据，但真正的守卫在 `push_scrollback`（`vt.rs:205-208`）：alt screen 期间 `primary.is_some()`，直接 return。`c8e044b4`（2026-11-06）首个版本就有。
- **影响**：`terminal-emulator.md` 的"独立价值"（换 Ghostty 的第一个理由）消失；`roadmap.md:87` 的"给上游提修复 PR"变成一次**假 bug 报告**；M-tty 的触发条件需要重述——现在"换核"只买到解析正确性，而**我们还没有任何一条已知的解析错误**。
- **改法**：删掉该节，改为"M3 冒烟产出真实缺陷清单"；Q29 的结论保留（先内置），但理由从"已有明确缺陷"改为"没有证据表明内置不够用 + trait 上限锁定收益"。

### F3 能力声明（文档错，代码对）

- `sockets: ["127.0.0.1:*"]` 两重错：端口通配不被解析；回环 WS 属于 `hosts`/`http` 授权。`sockets` 是 `net.connect` 的裸 TCP，且必须精确 `host:port`。
- 17:07 的 `nsh.json` 已经改成 `"network": { "hosts": ["127.0.0.1"] }`——**照文档抄会写出非法配置，照代码才对**。这正是"文档作为唯一共享面"失效的实例。
- **改法**：更正 §3.4；补一句"UI 如何拿到 port 与 token"（`src/lib.rs` 已经在做，文档没有）；补"capability 是构建期静态"的提醒（M8 的 `webview`、M10 的通知权限要提前列）。

### F4 扩展宿主面被写成了结论（A21 + D4）

- 不是"把 `hasUI` 设成 true 就有三个对话框"：默认是 `noOpUIContext` + `mode="print"`；要 `bindExtensions({ uiContext, mode })`。`confirm` 在 no-op 下**静默 false**、`notify` **静默丢弃**——扩展作者与用户都看不见。
- `ctx.ui` 的真实面是 20+ 方法，pi 在 RPC 模式有一份**成文降级清单**（`docs/rpc-extension-ui.md`），而我们的 wire 连 `extension_ui_request/response` 这条通道都没有（工作区的 `server.ts` 也还没绑）。
- project trust（D4）是同一处的第二个洞：项目级扩展/skill 在无交互提示时**静默不加载**。
- **影响**：Q23 的动机（"同一会话在两前端行为分叉"）恰好会以最隐蔽的方式实现：不报错、只是不生效。
- **改法**：见架构评审 P0-2；至少要 `mode: "rpc"` + 完整 `uiContext` + wire 请求/响应 + 一张"支持/降级/no-op"矩阵 + 一个 trust 决策面。

### F5 并发写的依据错，风险被低估（A23）

- 会话文件无锁（`appendFileSync`）；`proper-lockfile` 只管 `auth.json` 与 `settings.json`。
- **影响**：`architecture.md:252` 把这列为"依赖 pi 自己的锁语义"，会让人**不做**防护；真实后果是两个写者各自维护 leaf，产生交错/分叉的转录，且没有任何报错。
- **改法**：打开会话时记录 `(size, mtime, leafId)`，每次写前校验；发现外部变化则拒绝写入并提示"外部已更新，重新加载"；至少加一条并发冒烟（spike 风险 4 已提，但要改结论）。

## 3. 成立且证据充分的部分（不要改）

- **Q10 / §5.7**：`CustomEntry` 不进上下文、pi 容忍、可用 `registerEntryRenderer` 在 CLI 渲染——证据链完整。
- **回合语义**：`agent_settled` vs `agent_end` 的判断准确，是整份文档里最关键、也最容易被做错的一处，做对了。
- **单进程多会话**：`SessionManager` 是纯内存对象，`createAgentSession` 的 cwd 会回退到 `manager.getCwd()`（`sdk.js:70`）；"容器 cwd 快照"与 SDK 行为一致。
- **Q28=B**：`process.execute` 的精确比对是真实约束，PTY/LSP 也确实需要同一个 Rust 模块。
- **DockArea 的使用方式**：受控 layout + `renderPanel` 保状态 + 600pt compact，与源码一致；"拖过去状态不丢"不是猜测。
- **nsh 的 WebView**：能力面描述与文档原文一致，且确实优于 wry 式集成。
- **终端 trait 上限的分析**（E4）：行号、字段、事件都核对无误，这是全文档质量最高的一节。
- **对 pi 升级的戒心**：把存储布局与 `createAgentSession` 真实运行列为风险，是正确的自我怀疑——而且现在已经有一条真实运行的正面证据（E2），正好说明这种戒心值得保留。

## 4. 无法在本机核实

| 项 | 原因 | 建议的核实方式 |
|---|---|---|
| 工具执行路径（`createAgentSession` + bash/edit + 扩展加载的组合） | 已有一条真实对话，但该回合没有工具调用 | 跑一次"读一个文件 + 改一行"的回合 |
| Ghostty/libghostty 对比 | 未编译 Zig 依赖 | 只在决定进 M-tty 时做 |
| 嵌套签名 + 公证 + JIT entitlement | 无 Developer ID 流程；nsh 只做 ad hoc、布局固定（`packaging.md`） | 见评审 P1-5：先做一次"post-package 重签 + Helpers + wasm"的冒烟 |
| pi CLI 打开 subagent 文件的 "forked from" 观感 | 未实测 | `pi --session ~/.pi/zu/subagents/…/x.jsonl` |
| WebView 的 Web Inspector | 文档未提 | M8 时试开发者菜单 |

## 5. 可重放的核对命令

```sh
# 环境与规模
nsh --version || echo "nsh CLI 不在 PATH"; pi --version; bun --version; node --version
ls ~/.pi/agent/sessions | wc -l                       # 276+ 个 cwd 目录
find ~/.pi/agent/sessions -name '*.jsonl' | wc -l     # 660+ 个会话
du -sh ~/.pi/agent/sessions                           # 195M

# listAll 成本
bun -e 'import {SessionManager} from "./engine/node_modules/@earendil-works/pi-coding-agent/dist/index.js";
const t=performance.now(); const a=await SessionManager.listAll();
console.log(a.length, Math.round(performance.now()-t)+"ms")'

# 编译产物（现在应成功；16:53 版本会失败）
ZU_PORT=47831 ZU_TOKEN=abc ./engine/dist/pi-engine &
# 握手 + list（任意 WS 客户端）
# dev 形态
cd engine && ZU_PORT=47825 ZU_TOKEN=abc bun run src/server.ts

# nsh 事实
grep -n "fn push_scrollback" -A 4 ~/projects/github/nsh/crates/nsh-base/src/term/vt.rs
git -C ~/projects/github/nsh log -L 205,212:crates/nsh-base/src/term/vt.rs --oneline
grep -n "fn valid_command" -A 10 ~/projects/github/nsh/crates/nsh-core/src/access.rs
grep -n "struct SocketGrant" -A 12 ~/projects/github/nsh/crates/nsh-core/src/access.rs

# pi 事实
grep -n "proper-lockfile" engine/node_modules/@earendil-works/pi-coding-agent/dist/core/*.js
grep -n "appendFileSync" engine/node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js
grep -n "new_session\|switch_session\|fork\|clone" engine/node_modules/@earendil-works/pi-coding-agent/docs/rpc-commands.md
grep -n "preflightResult\|PromptDisposition" engine/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.d.ts
grep -n "bindExtensions" engine/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.d.ts
```
