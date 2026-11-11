# 可吸纳项：ThinkRail 与 manox-app

> 2026-11-10。目的：把两个同源项目"已经付过学费"的设计，映射到 Zu 的决策台账（Q1–Q31）、架构章节与里程碑，给出"抄什么 / 怎么改 / 不抄什么"。
> 方法：只读源码与设计文档；每条给 `path:line`；判定按 Zu 的现有决策，而不是泛泛比较。子代理的调研已逐条复核，标「未核实」的不作事实引用。
> 同日的另外两份文档：[事实审计](../review/fact-audit.md)、[架构评审](../review/architecture-review.md)。

## 0. 一句话

- **ThinkRail**（JetBrains，HEAD `bbb0e307`）是**同一个问题的另一解**：宿主进程内跑 pi、版本化 wire、把扩展做成可移植 pi 包。它的价值在**协议与宿主契约**——正好是 Zu 评审里 P0-1/P0-2/P0-3 的现成答案。
- **manox-app**（HEAD `4ae113ab`）是**同一类产品的更成熟实现**：原生壳 + 会话容器 + PTY/终端/更新/打包。它的价值在**对象模型与发布链**——正好是 Zu 的 M3/M10/M11 与 `§5.3/§5.4` 的现成答案。
- **最值得抄的六样**：① 兼容性台账的"升级契约 + removal gate"；② hydrate-then-stream + 命令幂等 + 分特性协议版本；③ `ExtUi` 协议 + `bindExtensions` + `plainTextTheme`；④ 子代理的"交付进上下文 + `excludeTools` 递归门控 + builtin 编译进产物"；⑤ 容器/资源的宿主侧对象模型（Pi 容器不落盘、资源有 owner 表）；⑥ `bundle-mac` 的嵌套二进制签名规则。
- **两仓都没有解决、Zu 仍需自己定**：pi CLI 与 Zu 并发写同一会话（事实审计 F5）、引擎崩溃隔离（ThinkRail 明确**接受**不做，manox 没有这个问题）、nsh 打包没有 `Contents/Helpers` 钩子。

## 1. ThinkRail：对 pi 的增强

### 1.1 它是什么，与 Zu 的差异

三环拓扑（`architecture.md:19`）：**engine host**（`packages/server`，进程内 `createAgentSession`）——**wire**（`packages/contracts`，带版本的唯一耦合）——**UI client**（`apps/web`，可独立分发；`apps/desktop` 用 Electrobun 套壳；`apps/cli` 起 host 并开浏览器）。

| 维度 | Zu | ThinkRail |
|---|---|---|
| UI | nsh TSX（AppKit，无 DOM） | React（DOM）+ Electrobun 原生壳 |
| 引擎 | 独立 bun 单文件 sidecar（进程隔离） | 与 host 同进程（`createAgentSession`） |
| 传输 | loopback WS + token | loopback HTTP+WS，可指向远程 host（Tailscale） |
| 协议 | 未冻结（评审 P0-1） | `contracts` 全量方法表 + 幂等重放 + 分特性版本 |
| 扩展 | 用户扩展全量加载 + `ctx.ui` 三态桥（未实现） | `ExtensionUIContext` 全量桥 + 扩展描述符（server/web 两半） |
| 分发 | 随 app 的 sidecar + nsh 打包 | CLI/桌面双启动器，Electrobun 打包 + 服务端签名 |
| 状态 | `~/.pi` 权威 + `~/.pi/zu/` | pi 权威 + `~/.thinkrail/`（delegation、todos 等） |

**根本差异**：ThinkRail 用"同进程 + 可远程的 wire"换掉了 Zu 的"独立 sidecar"；代价是**没有崩溃隔离**，而它把这写成了不变量（`architecture.md:381`："The agent runs in-process with no crash isolation — wrap session calls and forward errors; a fatal fault takes the whole host down (accepted tradeoff vs the subprocess RPC mode)"）。Zu 有 native module，可以选择"有监督的 sidecar"，比两者都好——但要把监督写出来（评审 P0-3）。

### 1.2 A 档：建议吸收

#### A1 兼容性台账的"升级契约 + removal gate + parity test"

- **是什么**：`pi-compatibility.md` 不是"注意事项"，而是一份**可执行的升级清单**：每个绕过 pi 的适配登记「它为什么存在、上游满足什么条件可以删（removal gate）、升级时跑哪些测试、怎么验证」。硬规则：**"Importing a private dist path in production is not a replacement"**、"a parity failure is evidence of drift, not permission to weaken the test"（`pi-compatibility.md:21-32`）。
- **Zu 现状**：`architecture.md:103` 只有"兼容性台账：每个绕过 pi 缺口的适配登记「上游什么条件下可删」"——有原则，没有机制、没有条目、没有测试约定。
- **它已经替你踩过的 seam**（Zu 一定会撞上）：
  1. **单文件产物里的扩展加载**：forced Jiti transformation、virtual-module identity、static provider registration、image-resize override（`pi-compatibility.md:105-109`）——Zu 的 `$bunfs` / `build:binary` 问题。
  2. **headless theme**：SDK 创建会话时**不初始化** pi 的终端主题，扩展读 `ctx.ui.theme` 会崩；用 `plainTextTheme` 兜底（`pi-compatibility.md:110-112`、`packages/server/src/agent/plainTextTheme.ts:1-40`）。
  3. **project trust 的发现与排除式重载**：资源种类发现要镜像 pi 私有的 trust 规则（`pi-compatibility.md:113-117`）——Zu 的 D4 缺口。
  4. **image-only queued input**：pi 破坏性的 queue API 会丢图片内容（upstream #8612，`pi-compatibility.md:100-104`）。
  5. **`AgentSession.dispose()` 不发 shutdown**：扩展的串行 shutdown 可能被无关 handler 卡住，重载/替换的时序要宿主兜（`pi-compatibility.md:60-70`）——Zu 的 LRU `dispose()` 会踩。
- **Zu 落点**：`architecture.md §3.7` 扩成"兼容性台账（含升级契约）"；`docs/evidence/pi-compatibility.md`；每个 M 的 PR 加一条"新绕过的 pi 缺口 → 台账 + removal gate + parity test"。
- **成本**：低（流程与文档），收益高（升级 pi 不靠记忆）。

#### A2 协议骨架：hydrate-then-stream + 读方法 + 命令幂等 + 分特性版本

- **是什么**（`architecture.md:121-150`、`packages/contracts/src/wsProtocol.ts`）：
  - 客户端连上时**先读**（`project.list`/`workspace.list`/`session.list`/`session.getMessages`/`session.stateList`），**再订阅** `pi.event` 增量；重载、第二个 tab、host 重启都靠同一路径重建。`session.list` **合并内存会话与磁盘会话**（正是 Zu 的"注册表 + 文件对账"）。
  - 漏掉的 delta **不重放**，靠重连时的读修复；命令侧另有 `RequestReplayCache`（`packages/server/src/host/requestReplayCache.ts:1-80`）：同 `id` + 同 fingerprint 返回缓存；fingerprint 不同 → `RequestReplayConflictError`；超预算 → `RequestReplayUnretainedError`；每 client 上限 512 条 / 16 MB。
  - **分特性版本**：不是只有一个 `PROTOCOL_VERSION`（现在是 86），而是每个特性一个引入版本常量（`wsProtocol.ts:115-136`：`PROJECT_TRUST_PROTOCOL_VERSION = 81`、`SESSION_STATE_PROTOCOL_VERSION = 73`…），旧 UI + 新 host 只关掉缺的那几个能力。
  - **模型 allowlist**：`WireModel = Pick<Model, "id"|"name"|"provider"|"contextWindow"|"reasoning"> & {…}`（`piProtocol.ts:31-42`）——用白名单而不是 `Omit`，`baseUrl`/`headers` 永远不过 wire；身份一律 `{provider,id}`（`sameModel`，`:50-56`）。
- **Zu 现状**：评审 P0-1/P0-3——`state.get` 三个字，没有快照、没有幂等、没有重连、只有一个全局 `protocol`。
- **Zu 落点**：`architecture.md §3.3` 写进"读—订阅"模型 + 幂等规则 + 分特性版本表；`contracts/` 加 `session.list/getMessages/state.snapshot`；M1 就做。
- **成本**：中（协议 + engine 侧缓存），但比事后返工低一个量级。

#### A3 扩展宿主：`ExtUi` 协议 + `bindExtensions` + `plainTextTheme`

- **是什么**：
  - **协议**（`packages/contracts/src/piProtocol.ts:248-297`）：对话框 `select`/`confirm`/`input`/`editor`（带 `id`、`sessionId`、`toolCallId`/`toolInput` 锚点）；单向 `notify`/`setStatus`/`setWidget`/`setTitle`/`dismiss`；响应 `ExtUiResponse {id, value}`（`session.extUiReply`，`wsProtocol.ts:759`）。
  - **宿主**（`packages/server/src/agent/webUiContext.ts:155-235`）：pending map、`opts.timeout` 自动 resolve、`signal` 取消、取消时发 `dismiss`、TUI-only 方法显式 no-op、`theme: plainTextTheme`、`notify` 可被 interceptors 拦截；`agentSessionManager.ts:1161-1165` 调 `bindExtensions({ mode: "rpc", uiContext, onError })`；断线重连用 `pendingExtUiDialog(sessionId)` 重建待答对话框。
- **Zu 现状**：`architecture.md:140` 只写"三桥两降级"，没有通道、没有 `bindExtensions`、没有 `mode`（评审 P0-2）。
- **为什么抄它而不是抄 pi 的 RPC**：它比 pi 的 `extension_ui_request` 多了 **`sessionId`（多会话）**、**tool-call 锚点（对话框渲染进工具卡）**、**`dismiss`**、**`setWidget` 用字符串数组而不是 TUI 组件**。nsh 端正好能按这四样做原生 UI。
- **Zu 落点**：`§4.5` 换成"扩展宿主契约"；wire 加 `ui.request`/`ui.response`；engine 调 `bindExtensions`；M1 用一个真实扩展验收。
- **成本**：约 200 行（engine）+ 100 行（UI）+ 协议类型；`custom()` 仍降级（两仓都一样）。

#### A4 子代理的"交付"与"门控"：`CustomMessageEntry` + `excludeTools`

- **交付**（`packages/pi-subagents/src/extension.ts:104-112`）：后台子代理完成后，用 `pi.sendMessage({ customType: "subagent-completion", content, display: true, details }, { deliverAs: "followUp", triggerTurn })` 把结果送回 captain 的**模型上下文**；`abortReason === "user"` 时 `triggerTurn: false`（不唤醒空闲父会话）。前台运行直接返回工具结果（文本上限 50k，全文留在 child transcript）。失败时先 stash details 再 throw，用 `tool_result` hook 把 details 塞回（pi 会清空抛错时的 details）。
  - **Zu 的关键区分**：Q10 只裁决了"**调度事件**写 `CustomEntry`（不进上下文）"；但"**子会话结果**"必须进上下文——两者是不同消息类型。`§5.7` 要写成二分，而不是"一律 CustomEntry"。
- **门控**：`RECURSION_GUARD_TOOLS = ["Agent","get_subagent_result"]`，子会话的 `SessionOptions.excludeTools` 固定带上它们（`packages/pi-subagents/src/mapping.ts:7,106`）；再配合 `childExtensionFactories` 的策展集（`pi-delegation` SPEC）。两层：**工具排除**（防递归）+ **扩展集策展**（防全量）。
- **Zu 落点**：`§5.6` 加"两种 session 的扩展集/工具集不同"；`§5.7` 加"结果交付用 CustomMessageEntry + followUp"；`§5.8` 不变量 8 落到工具层。
- **成本**：低（1 天），但它同时解决评审 P1-4 与"结果怎么回来"。

#### A5 定义体系：builtin 编译进产物、三来源、信任、优先级

- **builtin 用 TS 常量而不是 `.md`**（`packages/pi-subagents/SPEC.md:84-90`）："Built-ins are **TS constants**（scout / planner / worker / reviewer）... so they **survive `bun build --compile`** and get typechecked"。
  - **Zu 的隐患**：`architecture.md:80` 计划 `~/.pi/zu/agents/{builtin,personal,project}/`——把 builtin 当文件分发，在单文件 sidecar 里要运行时释放/定位资源，等于自造一个 `$bunfs` 问题。**改为编译进 engine**，`agents/` 只留 personal（`~/.pi/zu/agents`）与 project（`<cwd>/.pi/agents`、`<cwd>/.agents/agents`）。
- **发现顺序与优先级**：`builtins → personal（<agentDir>/agents）→ project（<cwd>/.pi/agents、<cwd>/.agents/agents）`，**first-name-wins**；project 定义只在 `ctx.isProjectTrusted()` 时加载（`definitions.ts:101-123`、`SPEC.md:80-84`）。他们**故意**让 builtin 永不被 worktree 遮蔽——Zu 要自己定（若希望项目覆盖 personal，需要反过来）。
- **字段的准确拼写**：`name`/`description`/`tools`/`model`/`thinking`/**`max_turns`**/**`inherit_project_context`**/**`skills`**/**`extensions`**，正文 = system prompt（`definitions.ts:1-80`）。`inherit_project_context` → `contextFiles: true`，`extensions: true` → 子会话加载扩展（`mapping.ts:106-111`）。
  - **Zu 的 Q13 记录写成了 `maxTurns`（驼峰），并漏了后两个字段**——台账与上游实现不一致，需要更正。
- **一个细节**：`worker`（唯一能改文件的 builtin）的提示词**禁止 git 历史命令**（commit/add/stash/reset/push）——因为子会话与父会话共享 worktree/branch，自提交会分裂父会话的历史。Zu 的子代理策略应写同一条。
- **Zu 落点**：`§3.5`（builtin 位置）、`§5.6`（优先级/信任/字段）、Q13 更正。

#### A6 会话状态机与未读回执

- **是什么**：`SessionState { execution, runId, needsInput, completion, completionUnread, queuedCount, backgroundWork }`（`packages/contracts/src/piProtocol.ts:100-112`），派生规则在决策 8（`architecture.md:138-150`）：`agent_settled` 是权威 idle；**needs-input 是 level-triggered**；完成态 unread 直到"在聚焦、未被遮挡、转录在最新边缘"的会话里看到；显式 Stop 是安静的；idle 会话的完成要等后台命令与子代理都结束。`acknowledgeCompletion` 幂等，回执持久化（`agentSessionManager.ts:455-480`）。
- **Zu 现状**：`architecture.md:56` 只有 `container.updated`（含未读）；`§5.5` 把未读列为易失。
- **Zu 落点**：`§4.6`/`§5.1`/`§5.5`；`agent.state` 事件改成 `SessionState` 形态；未读回执落 `~/.pi/zu/receipts.json`（持久层，加版本）。
- **成本**：中。

#### A7 delegation 的 run 语义（M5 的现成契约）

`packages/pi-delegation/SPEC.md` 是 Zu `§5.6` 的放大版。**不需要抄实现，抄契约**：

1. **一个创建原语 + 正交轴**：`origin`（fresh/fork）、`visibility`（hidden/listed）、`interactive`（true/false）、`info`（provenance）、`session`（from definition）。模式 = 轴组合。
2. **每个 parent 的 FIFO 信号量，默认 4**："each child is a full LLM session, so unbounded spawn multiplies token spend, provider 429 pressure"（SPEC "Concurrency"）；`setMaxConcurrentPerParent` 可实时 resize。
3. **run 生命周期统一**：`queued → running → completed|error|aborted`；`run-queued` 即使有空位也发。
4. **`RunOutcome` 是 per-run delta**：`finalText`/`stopReason`/usage 相对**本次 run 基线**，不是子会话累计（他们为此修过 PR #302）。Zu 的 `cost.update` 会踩同一个坑。
5. **`maxTurns`**：到顶先 `steer()` 收尾再 `abort()`；不做墙钟超时。
6. **`ChildHandle` 不暴露原始 `AgentSession`**："the raw child `AgentSession` never crosses the barrel"。
7. **结果收集三态**：终态 → final output；运行中 → 状态快照（不是错误）；未知 id → 报"重启丢失 + 转录路径"。
8. **信任继承**：`ParentContext.isProjectTrusted`，"a child never loads more of the project than its parent"。
9. **模型运行时继承**：子会话用**父会话创建时的 `modelRuntime` 世代**（他们为此修过 PR #303）。
10. **取消语义**：queued 的 run 要能被取消；`dispose` 先标记、再取消、再 await 共享 teardown；父 dispose 级联。
11. **fork 前必须隐藏 Anthropic 签名思考**：切换 prompt/tools/model 前用 context edit 隐藏 signed/redacted thinking（签名绑定前缀，不可移植），否则 fork 出来的子会话请求会被拒（`pi-delegation/SPEC.md:103-109`）。Zu 的 fork（M2）会撞上。
- **Zu 落点**：`§5.6` 补"轴 + 并发 + 终态 + delta + 信任/模型继承 + handle 边界 + fork 的 thinking 处理"；M5 验收加"并发 4 的 FIFO"与"per-run 成本"。

#### A8 项目信任：两级授权 + "把要加载的东西说出来"

- **是什么**：`ProjectTrustSummary { aliasSkills, piResources: ProjectResourceKind[], mcpServers? }` + `project.setTrust { id, trusted, resources? }`（`packages/contracts/src/domain.ts:56-61`、`wsProtocol.ts:539-550`）。信任分两级：**alias-only**（只读名字/别名）vs **pi 资源**（会跑代码）；summary 精确列出"将加载哪些种类 + 几个 MCP 条目"；MCP 还有**逐项 fingerprint 批准**：`McpServerSummary.fingerprint` + `approval.state = approved|pending|changed`，条目一改批准即失效（`packages/contracts/src/domain.ts:26,380,395`）。
- **Zu 现状**：完全没有这个面（D4）；pi `1.5.0` 默认 `defaultProjectTrust: "ask"` 会静默跳过项目资源。
- **与 Q24 的冲突**：`trust.json` 是 pi 的写面。要么承认这是 Q24 的例外（写 `~/.pi/agent/trust.json`），要么用 `defaultProjectTrust` 全局设置。**必须裁决**。
- **Zu 落点**：`§4.5`/`§5.2` + 一个 M1/M4 的信任弹窗；`§3.4` 补"为什么这是唯一的写 pi 状态"。
- **成本**：中（3 天）。

#### A9 单文件产物的扩展注入与资产 seam

- **是什么**：`registerBundledRuntime(extensions: BundledExtensions)`（`packages/server/src/agent/extensions.ts:42-62`）——编译形态下由产物**注入 factories/skillsDir**，开发形态下用 `createRequire` 解析路径（`resolveDevPaths`，`:64-91`）；`bundled ? [...bundled.factories, ...sharedFactories] : sharedFactories`（`:244`）。配合 `pi-compatibility.md:105-109` 的 jiti/虚拟模块/静态 provider 规则。
- **Zu 现状**：`architecture.md §3.8` 只写"照抄上游资产布局"；实际构建只拷了两个 wasm，worker 入口与扩展工厂注入都没处理（事实审计 A17）。
- **Zu 落点**：`§3.8` 写"dev 路径 vs bundled 工厂"双轨 + 资产清单（wasm、主题、export-html、worker）；M0 的编译冒烟要覆盖"扩展从产物里加载"。
- **成本**：中。

#### A10 终端的 reserve/attach 与"复活时带录制输出"

- **是什么**：`architecture.md:228-244`（决策 12）：终端以 `(workspaceId, tabKey)` 为键；`terminal.reserve` 先持久化"目录页签"（不建进程），唯一的 `terminal.attach` 才生 PTY；attach 独占、被抢的客户端收到通知；**host 重启不能保 shell，所以页签用新 shell 复活并显示录制的输出**。
- **Zu 现状**：`§5.5` 把终端列为易失、`§4.3` 恢复时"静默移除死资源 sheet"——重启后终端页签直接消失。
- **Zu 落点**：`§5.5` 把"终端页签（不含进程）"升为持久、"输出录制（有界）"可选持久；`§4.3` 改成"复活空 shell + 回放录制"。
- **成本**：中，可延到 M3 之后。

#### A11 后台命令与 TODO 模型（"后台任务"与"计划"两个 sheet）

- **后台命令**（`packages/pi-background-commands/SPEC.md:9-25,131-141`）：显式、**session 拥有**、**log-only** 的后台命令（无 PTY、无 stdin、无 daemon 发现），8 个活跃 / 20 个保留、输出 2000 行 / 50 KiB、按命令取消、完成投递；普通 `bash` 不变。
- **TODO/plan**（`packages/pi-todos/SPEC.md:41-82`）：group=task、状态**派生不存储**、全计划恰一个 `in_progress`、`todo_write` 是 identity-preserving reconcile、每会话一文件（`<worktree>/.thinkrail/context/todos/<sessionId>.json`）；`before_agent_start` 规则"短且字节稳定"，"如何用"放在 skill 里——他们试过"把实时列表注入每个 prompt"又撤回了。
- **Zu 现状**：`sheets.tsx` 有 `tasks` 页签（mock），设计文档没有对应物；"图形化 task 组织面"（README）没有模型。
- **Zu 落点**：M5 的后台任务成员视图；M4 之后再评估 TODO（先取模型，不取 6 个工具）。

#### A12 架构守护与测试分层

- **是什么**：`pi-compatibility.md:31-33` 的验证手段：**no-agent 浏览器 e2e + `@agent` live spec + workflow harness + artifact/binary probes + `check:seams` / `check:pi-packages`**；`e2e/agent-naming.live.spec.ts` 连"agent 自己命名"都有 live 测试；`e2e/fixtures/portBlock.ts` 用文件锁把 500 个端口槽分给并行 worktree（`PORT_BLOCK_BASE = 25000`、`STRIDE = 10`）。
- **Zu 落点**：M0 就立"分层 e2e + 冒烟门"；端口槽的思路可借给"多实例/并行测试"（Zu 现在固定 47823，见评审 P2-8）。
- **成本**：低。

### 1.3 B 档：有参考价值，但不建议直接搬

| 项 | 是什么 | 为什么是 B |
|---|---|---|
| `extension-api` 双半 + `resource-renderers` | 扩展带 `./server`（pi 工厂）与 `./web`（tool renderer），宿主注册（`extension-api/SPEC.md:18-31`、`resource-renderers/SPEC.md:9-20`） | 这是"扩展自带 React 渲染"的路，nsh 无 DOM；但"tool renderer 注册表"的思想可直接用到 Zu 的工具卡（M1） |
| `pi-todos` 的完整工具面 | 6 个 `todo_*` + skill + 规则 | Zu 先取模型（A11），不取工具面 |
| `pi-spec-graph` | 把仓库的 spec 图谱当一等对象（`spec_*` 工具 + skill） | Zu 的 `docs/` 是决策记录；但"让 agent 先读决策再改代码"的规则可借 |
| `pi-dag` | 在 delegation 之上的持久 DAG；**他们自己都不 bundle** | Zu 用不上 |
| workspace = git worktree | 每个 workspace 一个 worktree（决策 6） | 产品形态差异；Zu 的 Project 不做 worktree |
| 布局语义 | frame 是**无资源、每窗口、客户端本地**的；host 不存 current layout（`architecture.md:94-103,162-189`） | Zu 把 layout 存宿主文件也能成立，但应写明"客户端作用域、资源无关"（与评审"UI 不持 storage"之争相关） |
| MCP 宿主级移植 | 配置加载器/写入器/状态解析/关机排序 | 先用 pi 的 MCP 扩展，等有项目级策略再说 |

### 1.4 C 档：明确不适用

- **Web 优先的客户端 + 远程 host + Tailscale**：Zu 是本地单窗口桌面端（Q2/Q20）。
- **Electrobun 套壳**：nsh 已经给出原生壳。
- **xterm.js / Monaco / WebView 面板**：栈不同；但决策 11 的评估标准（"mouse reporting / OSC 8 都没有的 WASM 终端会让 vim/htop 退化"）可作 Q29 的旁证。
- **"eager 接受无崩溃隔离"**：ThinkRail 是**故意**接受（`architecture.md:381`）；Zu 有 native module，应做有监督的 sidecar。
- **全量精确 pin + 浏览器包规则**：web monorepo 的需要；Zu 缺的是 nsh 侧台账，不是更严的 pin。
- **"一个 id 模型：UI tab = sessionId"**：Zu 有 external 容器，不能照搬。

## 2. manox-app：设计与实现

### 2.1 它是什么，与 Zu 的差异

原生 Rust 桌面 app（GPUI），crate 边界清晰（`AGENTS.md:16-27`）：唯一壳 `steer-agent-chrome-ui`、会话列状态机 `steer-agent-chat-ui`、终端面 `steer-ghostty`（libghostty-vt 静态链接）、终端进程缝 `steer-term-process`、自更新 `steer-updater`、外部 agent 桥 `steer-ext-agents`、headless agent `cx`。与 Zu 的差别在**栈**（GPUI/Rust vs nsh/TSX），不在**产品模型**——Zu 的 SessionContainer/Project/Launcher 基本就是从这仓的 PLAN 里长出来的。

所以下面只列**Zu 丢了、写偏了或没写到的部分**。特别注意：manox 的 `AGENTS.md:188-190` 明令"**运行时禁止 schema migration**"——Zu 有自更新与长寿命状态，必须**反着做**（版本化 + 迁移），但可以借它"修复式读取 + 原子写 + 拒绝空文档重写"的手法。

### 2.2 A 档：建议吸收

#### A1 容器与资源：宿主侧对象模型（Zu 的 `§5.3` 需要改数据面）

- **Pi 容器是 runtime 的视图，不落盘**（`crates/agent-ui/src/workspace/container.rs:1-30`）：native 容器的 id **就是** captain session id，状态由 fold 承载，"active threads construct on demand and nothing is stored client-side"；只有 **external** 容器有记录（`ExternalSessionRecord`）。死亡谓词统一为 `container_alive()`：native 读 archived 位、external 读 record 的 alive 位（由 PTY child-exit 翻转），翻转即发 `ContainerEvent::Died`，workspace 订阅自身事件跑 `teardown_container`。
  - **Zu 现状**：`§5.1/§5.3` 把 Pi 容器写进 `registry.json`，cwd 与 archived 双源，启动对账复杂。
  - **建议**：native 容器 = pi 会话目录 + 一份 `overrides.json`（archived + membership）；`registry.json` 只存 external。cwd 以 pi header 为准（配合 A4 的 sticky cwd 规则）。成本：M2 数据面改一次；风险：660 会话扫描 ~600ms（可接受）。
- **资源所有权注册表**（`crates/agent-ui/src/resource_registry.rs:1-20,28-42`）：每个容器键下登记"dock 终端视图（drop 即拆 PTY）、右栏会话、CLI tab 的 kill handle"；**spawn 时按当时的前台容器登记**，容器 teardown 按 key 回收。Zu `§5.1` 说资源权威在 engine/native，却没有"哪个 PTY 属于哪个容器"的表——teardown 无从回收。
  - **建议**：UI 侧 `ResourceRegistry{containerId → handles}`，kill handle 独立于 view 存活。成本：M3 约 1 天。
- **teardown 顺序**（`container.rs:456-500`）：先 kill external handle（避免主线程阻塞 reap）→ 删记录 → 杀 CLI tabs → 收浏览器 tab → 收 stash → 剪 membership（仅 external）。Zu `§5.4` 只有一句"回收资源 → 级联归档 → 摘行 → 剪 membership"，应照这个顺序写。

#### A2 PTY：三线程 + 后代清扫 + 环境回退 + "字节不过 QuickJS"

- **三线程**（`crates/steer-ghostty/src/pty.rs`）：writer 线程消费 unbounded 队列（UI 线程永不阻塞）、reader 线程阻塞读、waiter 线程 50ms 轮询 `try_wait`（`REAP_POLL = 50ms`，不长期持 child 锁）；`TerminalProcess` 由 view 持有 `Arc`，**Drop 兜底 terminate**。
- **终止**：先 SIGTERM 所有后代 + 前台进程组（负 pgid），`SIGTERM_GRACE = 100ms` 后再 SIGKILL，再补 shell 组与 killer（`pty.rs:142-190`）——portable-pty 只杀直接子进程，后台作业会活下来。
- **环境回退**（`crates/steer-ext-agents/src/relay/pty.rs:55-75`）：GUI 启动的进程没有 `TERM`/`COLORTERM`，必须补 fallback（`TERM=xterm-256color`、`COLORTERM=truecolor`、`TERM_PROGRAM`），否则 TUI 能力协商失败；显式 spec 的 env 仍可覆盖。
- **对 Zu 的独特价值**：**字节流不该进 TSX**。Zu 计划 `Callback::post` 把每块 PTY 字节推给 TSX，再 `termRef.write()` 回到 Rust 仿真核——QuickJS 往返 + 字符串分配 + 信号更新。应改为：native 包装组件把 reader 直接接到 emulator（Rust→Rust），TSX 只收 8–16ms 合批后的"行/帧"或事件。这比"PTY 归谁"更影响体验。
- **Zu 落点**：`§3.6` 的 `zu/pty` 补 ownership/teardown/三线程/环境回退；`§4.2` 注明终端数据路径不过 wire、也不过 TSX。

#### A3 外部容器：记录 + 孤儿探活

- **是什么**（`crates/steer-ext-agents/src/session.rs:36-118`）：external 会话写 `<id>.json`（`SessionRegistry { id, socket, pid, agent, model, provider, started_at, cwd }`，原子写）；存活性用 **Unix socket connect** 判定（`socket_alive`，ECONNREFUSED 视为僵尸）；启动扫描注册表目录，清掉 app 崩溃留下的孤儿。
- **Zu 现状**：`§5.4` "external 型读 PTY 存活"——但 app 重启后内存没了，孤儿进程既活着又不在侧栏。
- **建议**：`~/.pi/zu/external/<id>.json`（pid、agent、cwd、createdAt、membership）+ 启动探活；孤儿要么收养为"已死"行，要么杀掉（取决于用户预期，建议先标死）。
- **成本**：M3 约 1 天。

#### A4 SessionContainer 的 D 系列：Zu 丢了哪几条

`PLAN-SESSION-CONTAINER.md:17-29` 是 Zu `§5.3/§5.4/§5.6` 的直接来源。对比后：

| manox 决策 | 内容 | Zu 现状 | 建议 |
|---|---|---|---|
| D4 | 子会话"协议层不拦截"——它就是普通会话，经其它途径注入的人类消息**不负责** | 不变量 8 写成"GUI 无人类直连入口"，像硬保证 | 改成"GUI 不提供入口；协议层不拦截" |
| D7 | **archive 可逆**：`unarchive 整树复活`；**不引入硬删除** | `§5.4` archive = 死亡；Q11 无 UI → 不可逆 | 加 `unarchive`（命令面板/设置即可）；不引入硬删除 |
| D10 | cwd **与 env** 创建时快照（env 只做资源继承，不进食工具环境） | 只有 cwd 快照 | 补 env 快照（终端/外部 agent 继承用） |
| D11 | env 不进 manox session 的工具执行环境 | 未提 | 写明边界 |
| D12 | 名册：常驻"子会话清单"；`backgroundWork` 保持 live-only | 名册有，live/持久边界没写 | `§5.6` 补"live 在内存、settled 在文件" |
| D13 | **单工具 + 类型参数**（`Steer` + `Dispatch`/`Inject`/`Abort`/`ListAgents`）；per-definition 工具是**回拨**掉的 | 5 个动词并列，形状未定 | 写明"一个工具，动词是参数"；把"每个定义一个工具"写进被否决方向 |

D7 的 `stop` 语义值得原文抄："stop = 杀容器全部活跃 run（用户显式动作，覆盖『后台 run 活到交报告』的运行时默认）"。另外 D2 的容器 id 形状（native = session id；external = `external:{agent}:{uuid}`）与 Zu 的 `pi:{sessionId}` 无实质差异。

#### A5 INITIAL-CWD：Zu 只引了 D1/D2/D8，还有六条

`PLAN-INITIAL-CWD-AND-PROJECT-VISIBILITY.md:16-25`：

- **D3 裸 ⌘N 默认无项目**（不记忆上次项目）——可预测性优先。Zu 的 Launcher 空态没有这条。
- **D4 已开始会话的 footer chip 退化为纯展示**（删 picker）——"展示面 = 给用户的项目可见性，与给 LLM 的可见性对称"。
- **D6 agent 的 sticky cwd 是唯一合法的 cwd 变化**（回合中 `cd`、回合末落盘，是 agent 行为不是 GUI 手势）。**Zu 必须补对账规则**：不变量 2 说"容器 cwd == 创建时确认的目标"，但 pi 会话 header 的 cwd 会随 agent `cd` 漂移 → **注册表 cwd 与 pi header cwd 会对不上**。建议：以 header 为准，容器 cwd 只作创建快照。
- **D7 根编辑只影响之后创建的会话**（Zu `§5.2` 已有）。
- **D9 项目名 v1 不进系统提示词**（只渲染主根 + 其余根 + 当前 CWD，零新增 wire 面）。Zu 应明确"名字不进提示词"。
- **D10 两侧独立验收**（旧 app + 新 runtime / 新 app + 旧 runtime / 两侧都新，各自自洽）——Zu 的 wire 兼容矩阵可借这个表述。
- **不变量的可观测判据**："会话首个 `bash -c 'pwd'` 的返回 == 提示词声明的 CWD"（`:29-35`）——Zu 的不变量都是描述性的，缺"怎么验收"。

#### A6 Project：删除、归属与写面纪律

`PLAN-PROJECTS-AND-NEW-ENTRY.md:102-130`、`crates/agent-ui/src/projects.rs`：

- **删除 = 删实体 + membership；容器全数落回 Chats；会话与 journal 零触碰**；非软删、无恢复检测，但**有轻量确认**。
- **membership 写入时机**：launcher 铸容器 / 拖拽 / **fork 继承父容器** / **external seed 携带**；剪除只在 external 死亡时（native 保留，unarchive 仍在组内）。
- **校验**：每根存在且为目录、≥1 根、primary ∈ roots、嵌套父子根允许、去重静默。
- **写面**：sibling temp + rename 原子写；**"must NOT be rewritten from an empty doc"**（解析失败拒绝空文档重写，`projects.rs:623-641`）；dirty 重试。
- **多根的诚实边界**：manox 的多根是**真实授权**（`working_directories` 进 fence + 提示词，`PLAN-PROJECTS...:209-215`）；Zu `§5.2` 写"多根对 pi 只承载组织与终端 cwd——pi 没有多根授权面"。**若 pi 有附加目录能力，Zu 应升级；否则把"能力差"写进 §5.2**（pi 是否支持附加目录：未核实）。
- **Zu 落点**：`§5.2` 补删除/继承/外部携带/多根边界；`§3.5` 的 `projects.json` 补原子写与"拒绝空文档重写"。

#### A7 Launcher：后铸 + 首条消息 flush/退款

`PLAN-PROJECTS-AND-NEW-ENTRY.md:219-270`：三个提交手势（composer / agent 动作行 / 终端）都经唯一 `create_container`；**composer 发送时容器尚不存在**——文本先暂存，容器 attach 回调后 flush，失败退款；⌘N 幂等（空容器不重复铸）。

**Zu 现状**：`§4.3` 只写"空态 = Launcher"，`roadmap M4` 写"先 composer 后容器"，但没有"发送失败/容器未就绪"的时序与失败腿。manox 的答案：文本暂存 Launcher，`create_container` → `attach_thread` 完成回调是**唯一可靠 flush 点**；失败腿（session 已存在 / 创建被拒）把暂存文本**还回 Launcher**，不吞掉（`:251-252,319-320`）。这是 M4 最容易漏的一段。

#### A8 打包与签名：嵌套二进制的规则（M11 的硬知识）

`script/bundle-mac:124-247`、`script/bundle-dmg:101-113`：

1. **嵌套 Mach-O 放 `Contents/MacOS`**（与主二进制并列），**不要放 `Resources`**——"a Mach-O under Resources is sealed as a plain resource, stays unsigned, and cannot execute on Apple Silicon"。
2. **先签嵌套、再签外层**；嵌套**不带** app 的 entitlements；外层**不用 `--deep`**——"a single --deep pass would copy the app's JIT entitlements onto it. The outer pass runs without --deep, so a nested binary nobody signed fails the bundle loudly"。
3. DevID 分支：`codesign --force --timestamp --options runtime --sign <identity> <nested>`，再带 entitlements 签 app；无证书时 ad-hoc + entitlements。
4. entitlements 实样：`com.apple.security.cs.allow-jit`、`allow-unsigned-executable-memory`、`files.user-selected.read-write`（`crates/steer-app/resources/steer.entitlements`）。**Zu 的差异**：JIT entitlement 应在 **sidecar** 上（Bun JIT），app 侧未必需要。
5. DMG：`ditto`（不是 `cp`，否则签名/扩展属性会被改坏）→ `codesign --verify --strict` → `hdiutil create -format UDZO -fs HFS+` → `hdiutil verify` → `/Applications` 软链；**dmg 脚本只验证、不再签名**。
6. **公证**：manox 没有；Zu 要在 post-package 之后加 `notarytool submit --wait` + `stapler` + `spctl -a -vv` 验收。

**Zu 落点**：评审 P1-5 的 post-package 脚本直接照这六条写；`Contents/Helpers` 通常也被 codesign 当作嵌套代码位置（需在 M0 打包冒烟里实测一次），但 manox 的 `Contents/MacOS` 更省心。

#### A9 自更新：抄策略与状态机，不抄代码

`PLAN-MACOS-AUTO-UPDATE.md:29-47`：GitHub `releases/latest`；**版本决策在客户端**（semver，非法 tag 视为不可更新）；**完整性 = asset 的 `digest`（sha256）**；只认 `*_macos_arm64.dmg`；状态机 `Available/Downloading/ReadyToInstall/Failed`；`.part` → size → sha256 → rename；安装 = `hdiutil attach` + `rsync -a --delete` **覆盖运行中的 `.app`** → 重启；**非 bundle 形态拒绝自更新**；启动后一次 + 每 12h，失败静默，手动检查必答；**无签名校验、不依赖**（自下载不带 quarantine 位）。

**Zu 的差异**：用 `nsh/updater`（它已覆盖 GitHub/自建源 + 可选签名清单 + 整包替换 + 重启），但要做两件事：① 采用它的状态机与拒绝腿；② **验证发布包是 "post-package 之后的 app"**（含 `Contents/Helpers` + wasm），否则更新一次 sidecar 就没了——这正是 manox"整树替换 = 双 bin 同步更新"的答案。

#### A10 chrome/host 边界：把"壳零领域状态"变成可执行的纪律

`AGENTS.md:163-172` + `script/check-chrome-boundary.sh`：

- **四条不变量**：① chrome 状态**只有一个写入者**（`chrome_assembly::project`）；② **不镜像可派生事实**（侧栏高亮 = 渲染期读宿主 `active_row`，壳无本地字段）；③ 宿主对 shell 的动作只经 `defer_shell`；④ hook/subscription 载荷自足，回调里不碰发起它的实体。
- **顺序规则**：同一次 update 内"**先发命令、后 notify**"——否则投影泵先完成 stash/restore，陈旧命令会关掉刚恢复的 tab。与 Zu "切容器先 stash 后 restore"是同一类时序坑。
- **两层防御**：结构性防御是模块私有（外部拿不到 shell 句柄）；grep 脚本只是**tripwire**（脚本自述）。
- **为什么用脚本**："a stray `shell.update` compiles, passes every test, and only fails later... the bug class is invisible until a gesture hits it"。

**Zu 落点**：`§4.1`/`§4.3` 的原则目前不可执行；加 `check-boundaries.sh`（只许 `engine.ts` 持 socket；store 不许存可派生状态；`ui.tsx/sheets.tsx` 不许引领域写函数），M2 加 sheet/panel 顺序回归。

#### A11 CI 形状、真实渲染出图、i18n parity

- **一个必需检查 `checks_pass`**（`AGENTS.md:161`）：先 guards（fmt + chat crate 依赖不变量 + chrome 边界不变量），再两条并行 verify（linux/macOS）；**打包腿只在 main/tag/`ci:package` 标签/改到打包面时启用**——"冷 release 构建不该躺在每个 PR 的必经路上"。
- **截图从真实渲染出**：`crates/steer-agent-chrome-ui/tests/visual.rs` + `CHROME_SHOT=/tmp/x.png`（`AGENTS.md:104-114`）——"UI 静态图从真实渲染出，不要另画一套"。
- **i18n**（`AGENTS.md:143-153`）：Fluent、zh-CN primary + en fallback、**parity 单测**、只译 app chrome、**runtime 传入值一律原样渲染（禁止二次本地化）**、模型面向字符串只在引擎仓维护。
- **Zu 落点**：M0 立 `checks_pass`（`nsh check` + `nsh test` + engine 冒烟 + 边界脚本 + i18n parity）；`roadmap §2 门禁`目前只有前两项。

#### A12 派生状态阶梯与"宿主 rank"

`crates/agent-ui/src/sidebar_projection.rs:1-30,73-80`：侧栏状态是**派生**的（ladder `Pending > Running > Unread > Idle`），不存显示态；排序用宿主下发的 `rank`（`(pinned, rank)`），"no local timestamp can reshuffle it"。

**Zu 现状**：`§5.1` "未读 | 协议态，UI 不镜像"方向对，但没有派生规则与排序事实源；660 会话下"按本地 mtime 排序"会随客户端时钟漂移。**建议**：`container.updated` 带 `rank`（宿主排序键）+ 派生状态，UI 只投影。

#### A13 agent 显示语义分层与"代码面 A/B 契约"

`AGENTS.md:27-30,41`：`ai-elements` 承载对话语义（Reasoning、工具、消息流），渲染机械归 `steer-components`；`ai-elements` 不依赖 app 层，文案由调用方注入。代码面契约：**对话正文里的代码走"效果化"**（编辑器面板、行号、diff 分栏），**工具输出走"忠实字面"**（in-band、保留高亮、不合并不分割）。

**Zu 落点**：M1 的"对话 sheet + 工具卡"应分"语义组件（message/tool/thinking）"与"渲染件（TextView/DiffView/Editor）"；工具输出里的 diff **不要**解析成 DiffView 面板，保持字面。

### 2.3 B 档：参考

| 项 | 是什么 | 为什么是 B |
|---|---|---|
| `steer-ghostty` | libghostty-vt 静态链接：`build.rs` pin rev + sha256 + Zig ≥0.17，手写 `sys.rs` 516 行；全 crate 3,468 行（含 GPUI view 1,044、`terminal.rs` 628） | **成本证据**：M-tty 的"1–2 周"偏乐观；换核是"≥3–6 周 + CI 工具链"的工程。`terminal.rs` 的 cell→styled-run 转换是未来 `GhosttyEmulator` 的参考实现 |
| `steer-term-process` | gpui-free 的 `TerminalProcess`（attach/write/resize/kill + `ProcessOutput`） | 接口形状可借（A2），但 nsh 的 `#[class]` 映射不同，不搬代码 |
| `steer-ext-agents` | 外部 agent 启动/会话/IPC relay/PTY relay、ChatGPT app CDP、VS Code、Warp | Q15 只做 4 类 TUI；但"外部容器探活/relay"可参考（A3） |
| `steer-webview` | wry + Tauri 式 IPC + 过程宏 | nsh 的 WKWebView 更好；"页面 ↔ 宿主 IPC 白名单"可参考 M8 |
| 视觉回归 | `tests/visual.rs` + 环境变量出图 | 可借到 Zu 的 outline 验收（nsh 是否有离屏截图：未核实） |
| manox 的激进纪律 | "运行时禁止 schema migration"（`AGENTS.md:188-190`） | **反着学**：Zu 必须版本化 + 迁移；但借"修复式读取 + 原子写 + 拒绝空文档重写" |

### 2.4 C 档：明确不适用

- **GPUI 租约/`defer`/`cx.notify` 顺序的代码**：nsh 响应式模型不同；借"单写者 + 顺序规则"的思想。
- **`steer-ghostty` 整个 crate**（GPUI element + Zig 静态链接）。
- **`steer-updater` 源码**（gpui Global；nsh/updater 已有）。
- **`steer-webview` / wry + Tauri IPC**：nsh 用 WKWebView。
- **`cx` / `cx-cli` 与 AHP/journal runtime**：不同源。
- **多 agent GUI 直发**（ChatGPT app / VS Code / Warp）：Q15 已拒，且要 CDP/辅助功能权限。
- **Linux/Windows 打包与更新**：Zu 是 macOS-only。
- **"技术选型喜新厌旧"**：与 Zu 的"精确 pin + 台账"相反。

## 3. 两仓互证的三条结论（可直接写进 Zu 的决策）

1. **派发工具 = 单工具 + 类型参数**。manox D13 记录了从 per-definition 工具**回拨**的教训；ThinkRail 的 `Agent` 也是单工具。Zu `§5.6` 应明确，并把"每个定义一个工具"写进被否决方向。
2. **子会话必须门控**。ThinkRail 用 `excludeTools = [Agent, get_subagent_result]` + 策展扩展集；manox 用 `max_depth: 1` + 子会话无派发权。Zu 的 Q23"全量加载"只适用于 UI 会话；`§5.6` 要写"两种 session 的扩展集/工具集不同"。
3. **状态以读为准，wire 必须能读**。ThinkRail 的 hydrate-then-stream、manox 的"两词汇表 + 独立验收"、Zu 的"文件是事实"是同一原则；差别是 ThinkRail 把它落成了 `session.list`/`getMessages`/`state` 读方法。Zu 现在只有"文件是事实"，没有"wire 上能读"。

## 4. 落到 Zu 文档与里程碑的清单

| # | 改动 | 落点 | 来源 | 成本 |
|---|---|---|---|---|
| 1 | 兼容性台账 → 升级契约 + removal gate + parity test；先登记 5 个已知 seam | `architecture §3.7`、`docs/evidence/pi-compatibility.md` | TR A1 | 低 |
| 2 | wire：读—订阅、`session.list/getMessages/state.snapshot`、命令幂等、分特性版本、模型 allowlist | `§3.3`、`contracts/` | TR A2 | 中 |
| 3 | 扩展宿主：`ExtUi` 请求/响应、`bindExtensions({mode:"rpc"})`、`plainTextTheme`、no-op 矩阵、项目信任 | `§4.5`、`§3.3` | TR A3/A8 | 中 |
| 4 | 子代理：交付用 `CustomMessageEntry`+`followUp`；递归门控用 `excludeTools`；结果上限与失败 details | `§5.7`、`§5.6` | TR A4 | 低 |
| 5 | 定义体系：builtin 编译进产物；三来源 + 信任 + 优先级；字段更正（`max_turns` 等）；worker 禁 git 历史命令 | Q13、`§3.5`、`§5.6` | TR A5 | 低 |
| 6 | 会话状态机 + 未读回执（持久、幂等） | `§5.1`、`§5.4`、`§4.6` | TR A6 | 中 |
| 7 | delegation run 语义：轴、FIFO=4、per-run delta、maxTurns、handle 边界、信任/模型继承、fork 前隐藏签名思考 | `§5.6`、M5 | TR A7 | 中 |
| 8 | 单文件产物的扩展注入与资产 seam（dev 路径 vs bundled 工厂） | `§3.8` | TR A9 | 中 |
| 9 | 终端页签持久 + 复活回放（进程仍不恢复） | `§5.5`、`§4.3`、M3 | TR A10 | 中 |
| 10 | 后台命令模型（log-only、session 拥有、有界输出） | `§5.6`、`tasks` sheet、M5 | TR A11 | 中 |
| 11 | 分层 e2e + `checks_pass` + 端口槽 | M0、CI | TR A12 | 低 |
| 12 | 容器数据面：Pi 容器不落盘（overrides）、资源注册表、teardown 顺序 | `§5.1`、`§5.3`、`§5.4`、M2/M3 | manox A1 | 中 |
| 13 | PTY：三线程、后代清扫、TERM fallback、**字节不过 TSX** | `§3.6`、M3 | manox A2 | 中 |
| 14 | external 容器记录 + 启动探活 | `§5.4`、M3 | manox A3 | 低 |
| 15 | SessionContainer D 系列：unarchive、不硬删、env 快照、单工具、协议层不拦截 | `§5.4`、Q11、`§5.6` | manox A4 | 低 |
| 16 | INITIAL-CWD 补 D3/D4/D6/D7/D9/D10；**sticky cwd 与 registry cwd 对账规则** | `§5.2`、`§5.4`、不变量 2 | manox A5 | 低 |
| 17 | Project 删除语义、fork 继承 membership、external 携带、写面纪律、多根边界 | `§5.2`、`§3.5` | manox A6 | 低 |
| 18 | Launcher 后铸 + 首条消息 flush/退款 + ⌘N 幂等 | `§4.3`、M4 | manox A7 | 低 |
| 19 | post-package：嵌套先签、外层不带 `--deep`、entitlements 分离、ditto/verify、公证 | M11、`§3.7` | manox A8 | 中 |
| 20 | 更新策略/状态机；验证整树替换包含 Helpers | M10 | manox A9 | 低 |
| 21 | 壳单写者/不镜像派生事实/命令先于 notify；边界脚本 | `§4.1`、`§4.3` | manox A10 | 低 |
| 22 | CI：`checks_pass`、真实渲染出图、i18n parity | M0、`roadmap §2` | manox A11 | 低 |
| 23 | 派生状态阶梯 + 宿主 rank | `§5.1`、M2 | manox A12 | 低 |
| 24 | agent 显示语义分层 + 代码面 A/B 契约 | `§4.2`、M1 | manox A13 | 低 |
| 25 | M-tty 成本重估（3.5k 行 + Zig/CI + 手写 FFI） | Q29、`roadmap §15` | manox B | 低 |

### 4.1 如果只做五件（按"返工成本 × 依赖顺序"排）

1. **扩展宿主**（TR A3 的扩展 UI + TR A8 的项目信任）：M1 之前不做，Q23 的"同一会话两前端不分叉"就是空话；`ExtUi` 协议 + `bindExtensions` + `plainTextTheme` 是现成答案。
2. **协议骨架**（TR A2）+ **结果交付**（TR A4）：M1 的 `session.list`/快照/幂等，以及"子代理结果怎么进上下文"——两件事一起做，省一次协议返工。
3. **容器/资源数据面**（manox A1）+ **PTY**（manox A2）：M2/M3 的地基；先改数据面（Pi 容器不落盘、资源注册表），再写 PTY，否则 teardown 无处挂。
4. **builtin 定义编译 + Q13 字段更正**（TR A5）：改动最小、但 M5 之后才发现就要重做分发。
5. **post-package 签名脚本**（manox A8）：M0 起就跑 ad-hoc 冒烟；M11 才不会一次性暴露 Helpers/wasm/entitlements 三个问题。

## 5. 明确不要

1. **不要把 pi 做成同进程**：ThinkRail 的代价是无崩溃隔离；Zu 的 sidecar + native 监督能同时拿到隔离与可控（补评审 P0-3 即可）。
2. **不要引入 web 客户端/远程 host**：M-web 是条件性里程碑，现在做会重写整个 UI 层。
3. **不要抄 MCP 宿主级移植**：先用 pi 的 MCP 扩展。
4. **不要抄 GUI agent 直发**（CDP/VS Code/Warp）：Q15 已拒。
5. **不要照抄 `steer-ghostty` 的 view 层**：GPUI 绑死；只借 `terminal.rs` 的转换与 `build.rs` 的成本认知。
6. **不要丢掉"精确 pin + 台账"去学"喜新厌旧"**：两种产品的风险模型不同。
7. **不要给每个子代理定义一个工具**：两仓都证明单工具 + 类型参数是对的。
8. **不要把 layouts/zoom 过 wire**：ThinkRail 的决策 9 明确"workbench state is view state and never crosses the wire"；Zu 的 `layouts/{containerId}.json` 应留在 UI 侧（nsh Storage 或本地文件）。

## 6. 证据索引（精选）

- ThinkRail：`architecture.md:19,67-390`；`pi-compatibility.md:1-130`；`packages/pi-delegation/SPEC.md`、`src/storage.ts:18-45`；`packages/pi-subagents/SPEC.md:80-131`、`src/definitions.ts:1-125`、`src/mapping.ts:7,106-111`、`src/extension.ts:21,40-137,170-340`；`packages/contracts/src/wsProtocol.ts:115-136,189-330,539-550,759,960-1006`、`src/piProtocol.ts:31-56,100-112,248-297`、`src/domain.ts:56-61`；`packages/server/src/agent/webUiContext.ts:1-234`、`plainTextTheme.ts:1-40`、`agentSessionManager.ts:455-480,1161-1165`、`extensions.ts:42-91,244`；`packages/server/src/host/requestReplayCache.ts:1-80`；`packages/pi-background-commands/SPEC.md:9-25,131-141`；`packages/pi-todos/SPEC.md:41-82`；`packages/extension-api/SPEC.md:18-31`；`packages/resource-renderers/SPEC.md:9-20`；`e2e/fixtures/portBlock.ts:222-245`。
- manox：`AGENTS.md:16-30,91-96,104-114,143-153,161-172,188-190`；`PLAN-SESSION-CONTAINER.md:17-29,31-60`；`PLAN-INITIAL-CWD-AND-PROJECT-VISIBILITY.md:16-35`；`PLAN-PROJECTS-AND-NEW-ENTRY.md:82-130,209-216,219-270`；`PLAN-MACOS-AUTO-UPDATE.md:29-47`；`crates/agent-ui/src/workspace/container.rs:1-30,90-118,456-505`；`crates/agent-ui/src/resource_registry.rs:1-42`；`crates/agent-ui/src/projects.rs:623-641`；`crates/agent-ui/src/sidebar_projection.rs:1-30,73-80`；`crates/steer-ghostty/src/pty.rs:10-21,142-190,189-315`；`crates/steer-ghostty/build.rs:1-30`、`src/sys.rs:1-10`；`crates/steer-ext-agents/src/session.rs:42-116`、`crates/steer-ext-agents/src/relay/pty.rs:63-75`；`script/bundle-mac:124-247`；`script/bundle-dmg:101-113`；`script/check-chrome-boundary.sh:1-61`；`crates/steer-app/resources/steer.entitlements`。
- 未核实（不要当事实引用）：nsh 是否有离屏截图测试；pi 是否支持附加工作目录；ThinkRail 的 `session.getMessages` 是否分页/截断；manox 侧栏在 600+ 会话下的虚拟化行为；`steer-updater`/`steer-ghostty`/`steer-webview`/`ai-elements` 的实现细节（只读了 PLAN 与 Cargo/AGENTS）。
