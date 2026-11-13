# pi 模块：ACP 协议映射与历史裁决

> 状态：**P0–P4 已落地（2026-11-13）；本文冻结为协议参考**。
> 当前系统形态见 [architecture.md](architecture.md)，扩展机制见
> [sheet-module-ARCHITECTURE.md](sheet-module-ARCHITECTURE.md)，**目标实现与 UI/UX 见
> [pi-acp-IMPLEMENTATION.md](pi-acp-IMPLEMENTATION.md)**。
> 本文只回答"ACP 词汇怎样映射到 Pi"以及"P0–P4 当时为何这样裁决"；§12 的迁移路径与 §5 的
> "deliberately absent" 清单是历史记录。**A0–F0 已按 IMPLEMENTATION 落地**；本文不回写，
> 当前形态以 [architecture.md](architecture.md) 与实现为准。

## 阅读边界（P0–P4 冻结，先读）

本文冻结于 P0–P4。**下列内容已被 [pi-acp-IMPLEMENTATION.md](pi-acp-IMPLEMENTATION.md) 取代**，
不要照着它们规划或改代码：

| 本文位置 | 历史裁决 | 已落地（IMPLEMENTATION） |
|---|---|---|
| §0/§7 进程模型 | 轮级子进程，settle 即退出，无监督 | D1/A0：一会话一持久进程 + resume |
| §5.2/§13 | models/thinking/compaction/permission 缺席 | B0/C0/D0：协议原生 config/usage/commands/permission/elicitation |
| §7.4 | "为什么轮级而非 session 级" | 已推翻：产品需要会话状态，轮级的代价大于收益 |
| §12 | P0–P4 迁移路径 | 已全部完成；下一步是 A0–F0 |

仍然有效：§4 的 ACP 方法/会话身份约束、§5 的 payload 映射、§10 的失败矩阵、§11 的协议不变量
（帧、错误、取消语义）。

## 0. 一句话

**Zu 是零 agent 语义的 ACP 薄宿主，pi-harness 是会说 ACP 的 pi 发行版**：读面以 pi 会话文件为唯一权威、
UI 本地 fold、零进程可读；写面是 harness 子进程，ACP over stdio（P0–P4 为轮级、settle 即退出；
目标形态见 IMPLEMENTATION D1）；宿主↔distro 的协议
是公共标准（ACP 0.11 基线），私有面收缩为 `_session/steering`（生态惯例）+ 少量 `x-zu` 方法，全部可降级。

## 1. 动机、约束与原则

### 1.1 要解决的病（沿 v1）

现状引擎是**常驻服务**：单进程多会话 SDK 宿主 + loopback WS + 自维护 wire，由此长出端口/token、心跳、
指数退避、generation、snapshot 重连、LRU dispose、单实例端口互斥一整层生命周期机器；引擎崩溃 = 全会话
中断 + 监督重启。参照系（Steer 的 journal 权威 + in-proc leg；ACP 的「协议里没有重连，恢复 = 再 spawn」）
给出的答案不变。

### 1.2 不可消除的约束（沿 v1）

1. pi 是 Node 生态 JS 引擎，进不了 nsh 的 QuickJS——进程边界不可消除（运行时嵌入与 WASM 化已评估否决，§2.2）。
2. pi 会话文件（`~/.pi`）是唯一 durable 权威；pi → Zu 兼容最高优先。
3. nsh 能力沙箱：UI/TSX 不持 fs/process；文件与进程访问在 Rust native module 侧。
4. 版本确定性：Zu 的行为对「哪个 pi」可复现，不依赖用户系统装了什么。

### 1.3 薄宿主原则（v2 新增，宿主裁决）

**宿主零 agent 语义**。宿主（`app/`）只拥有四件事：进程表（`zu/acp`）、文件 fold（`zu/fs` + 扫描）、
Zu 状态（`zu/state`）、UI。凡是「agent 是什么」的知识——模型、thinking、工具、压缩、子代理、斜杆命令的
语义——都住在 distro；宿主拿到的是**协议词汇**（modes 列表、models 列表、commands 列表、事件流），渲染
但不解释。

可执行的守门（进 §9.3 门禁）：

- **依赖规则**：`app/` 无 `package.json`、无任何 npm 依赖（ACP 与 x-zu 类型是 `contracts/` 里的手写窄类型）；
  `pi-harness` 才依赖 `@agentclientprotocol/sdk` 与 pi。bundler 解析不到 pi 词汇 = 门禁过。
- **grep 规则**：`app/` 的 TS 里不出现 pi 领域词（`AgentSession`、`setThinking`、`compaction` 的语义分支等）；
  composer 渲染 modes/models/commands 全部走协议数据，无本地语义表。

## 2. 已否决方向（台账，沿 v1 §2 + v2 增补）

### 2.1 常驻 sidecar 服务（现状）

否决理由沿 v1：整层生命周期机器、引擎单点的全会话爆炸半径、协议自维护成本。**保留其合理内核**：
文件权威、UI = 文件投影 + 事件加速、settle ≠ 死——全部继承。

### 2.2 单进程化（运行时嵌入 / WASM）——沿 v1，否决不变

Deno/Node 嵌入（第三运行时兼容税 + 崩溃半径换错方向）；pi 编译 WASM（无 AOT 路径，child_process 无 WASI）。

### 2.3 前稿 manox 版（napi-rs + 私有 RPC + npm 部署）——沿 v1，否决不变

TS 原生扩展替代 addon；公共协议替代私有 RPC；distro 整体分发替代 npm 安装。

### 2.4 直接用用户系统 stock pi——沿 v1，否决不变

**v2 增补实证**：reviu 正是这条路线的量产实现（公共注册表 + `npx -y` 首跑拉包 + `required_cli` PATH 探测 +
install hint 文案）。它的源码注释自证代价——"a wrong entry here turns into a false 'not installed'"——
版本漂移与 PATH 退化的每一条都变成了运行时代码。Zu 拒绝这条路线作为常态；它只以**用户显式豁免**的形态
回来（§5.6 P5 的 generic agents）。

### 2.5 宿主自研 agent 面（v2 新增否决）

例如在宿主实现 thinking 档位语义、把 pi 的模型表翻译进 composer 本地状态、或把工具卡按 pi 工具名定制。
否决理由：每一条都是「宿主长出 agent 语义」的开端，最后重演 §2.1 的自维护面。宿主只渲染协议数据；
agent 面的定制一律以 distro 扩展/适配层为落点。

## 3. 拓扑

```
┌────────────────────────────────────────────────────────────────┐
│ Zu.app（nsh TSX + zu-native Rust，同进程）                      │
│                                                                │
│  薄宿主四件事：                                                 │
│   进程表  zu/acp   （Rust：spawn + 行传输 + exit；零协议语义）   │
│   文件读  zu/fs    （增量读 + 扫描 op）                          │
│   状态写  zu/state （temp+rename 原子写、版本字段）              │
│   UI      stores  （文件 fold + ACP 事件加速）                   │
│   TS 协议面        （jsonrpc.ts 配对 + acp.ts 会话对象；         │
│                     ACP/x-zu 类型来自 contracts/acp-xzu）        │
└──────┬─────────────────────────────┬───────────────────────────┘
       │                             │ ACP：JSON-RPC 2.0 / ndjson / stdio
       ▼                             ▼
  ~/.pi + ~/.pi/zu/（磁盘，唯一权威） pi-harness ×N（轮级子进程，settle 即退出）
                                     ┌────────────────────────────────┐
                                     │ ACP 适配层（stdio ↔ SDK，进程内）│
                                     │ pi SDK（createAgentSession）    │
                                     │ Zu TS 扩展（dispatch 等）        │
                                     │ pi 运行时（pin 版本，Bun 单文件）│
                                     └────────────────────────────────┘
```

- **宿主不知道 pi**：它说的是 ACP + x-zu。**harness 不知道 Zu**：它说的是 ACP + `_session/steering`。
- **传输分层**（v2 明确化）：Rust 的 `zu/acp` 只做 spawn、ndjson 行帧（含行长上限）、stdin 写、exit/stderr
  回调、kill、Drop 兜底——**不解析 JSON、不配对 id**；JSON-RPC id 配对、超时、通知分发全在 TS
  （`jsonrpc.ts`）。理由：与 `zu/lsp` 的分工同型（帧在 Rust、协议在 TS），native module 保持无异步运行时；
  Rust 层越薄，跨平台面越小。
- **共享面的唯一事实源 = `contracts/acp-xzu/`**（v2 新增，回答 v1 §13.1 的缺口）：`contracts/` 保持
  「UI↔引擎唯一共享面」的仓内地位不变，**内容从私有 wire 换成 ACP 窄类型 + x-zu 方法表**。
  `app/` 与 `pi-harness` 各以相对路径导入（深度恰好对称，与今天相同）；改方法 = 同一 PR 改类型、
  `protocol-notes.md` 与两侧实现；x-zu 版本号递增即不兼容。

## 4. pi-harness distro

### 4.1 内容物

| 层 | 内容 | 形态 |
|---|---|---|
| pi 运行时 | `@earendil-works/pi-coding-agent` 精确 pin | 构建时锁版本 |
| ACP 适配层 | stdio ndjson ↔ pi SDK（`createAgentSession`/`AgentSessionRuntime`），**进程内嵌 SDK** | TS；依赖 `@agentclientprotocol/sdk`（官方 TS SDK，2.x；旧 `@zed-industries/*` 包 2025-10 起改名废弃，不采用） |
| Zu 扩展 | dispatch/list_agents 子代理、`zu.*` custom entry、steer/queue 桥、审批桥（如启用） | TS pi 扩展，编译进产物 |
| 资产 | photon/quickjs 两个 WASM、主题、export-html | 与二进制同目录（pi 上游布局） |

适配层嵌 SDK 而非包 RPC 子进程：rpi-acp 式「ACP 前端 + RPC 后端」是两进程两翻译；SDK 进程内集成是 pi
官方指定路径，现有 engine 已验证。harness 进程数 = 1（每 turn）。

### 4.2 分发与版本（沿 v1）

`Zu.app/Contents/Helpers/pi-harness`，沿用现有 sidecar 分发与嵌套签名链（嵌套先签、外层不带 `--deep`、
JIT entitlement 在 harness 上）；pi pin + 扩展 + 适配器同包同版本；harness 内禁 `pi update`；Bun 单文件的
已知 seam（$bunfs、jiti、WASM execPath 兜底）进兼容性台账，不新增。

### 4.3 会话身份、存储与加载

- **ACP `sessionId` = pi sessionId**（不透明句柄，distro 自定义取值——合法，且让文件 fold 与协议身份对齐）。
- `session/new { cwd }` 由 pi 铸会话文件；`session/load { sessionId }` 解析到 `~/.pi/agent/sessions/` 并
  resume。**v1 语义下 load 必须（MUST）全量重放 `session/update`（含 compaction 重放）**——重放对已 fold
  的宿主是纯冗余，抑制是承重的（见 §5.3 loadOptions）。
- **`session/resume` 跟踪（v2 新增）**：ACP 已在 stabilization 路径上推进 `session/resume`（无重放重连；
  v2 RFD 里它取代 load、加 `replayFrom` 游标），语义——「客户端本地已有对话，只恢复 agent 侧内存状态」——
  正是 Zu fold 模型的标准词汇版。P0 时核对它在当前稳定 spec 与两个 SDK（Rust/TS）中的可用性：可用则
  distro 以 `sessionCapabilities.resume` 声明、宿主走标准方法，`x-zu/loadOptions` 不再实现；不可用则先落
  loadOptions、台账登记迁移条件。
- **预热永不铸文件**（v2 裁决，修 v1 缺口）：预热只做 spawn + `initialize`（+ resume 场景的 `load`——
  load 不铸新文件）；`session/new` 推迟到**该进程被真实 prompt 认领时**。否则被遗弃的预热进程会在
  `~/.pi/agent/sessions/` 留下空会话文件，污染存储与侧栏索引。
- 子会话住 `~/.pi/zu/subagents/{captainId}/`（三重自证不变），captain 住 pi 原生位置。

### 4.4 与 pi-acp 的关系（v2 新增）

公共注册表里已存在第三方 `pi-acp`（ACP 前端 + pi CLI RPC 后端，需用户装 pi）。P0 前置项：**实跑
`pi-acp` 记录能力矩阵**（load/重放行为、modes/models/commands 暴露面、权限与 steer 处理），作为本仓
适配层的语义基线与 diff 对象；适配层保持「私面最小、可向上游/公共适配器靠拢」的形态——若未来把通用
部分反哺 pi-acp 或 pi 上游，x-zu 面进一步收缩。distro 与 pi-acp 的实现路线差异（SDK 进程内 vs CLI RPC
两进程）不变，见 §4.1。

## 5. 协议面（ACP 0.11 基线 + `_session/steering` + x-zu）

### 5.0 协议事实基线（v2 新增，修正 v1 §5.2/§5.3 的过窄假设）

以官方 SDK 的 0.11 schema（reviu 在用，`agent-client-protocol` Rust crate 0.11.1 与 TS SDK 2.x 同源）
为准，**以下已是核心能力，不得再造私有面**：

| 能力 | 核心原语 | reviu 实测语义 |
|---|---|---|
| 会话模式 | `available_modes` / `SetSessionModeRequest` / `current_mode_update` | "Plan/Build for Claude, **reasoning effort for Codex**"——thinking 档位的协议载体 |
| 模型选择 | `available_models` / `ModelInfo` / `SetSessionModelRequest` | initialize 返回模型表 + 当前模型；运行时可切换 |
| 压缩状态 | `CompactionUpdate`（in_progress/completed/failed/cancelled + summary chunk 流） | 自动压缩的状态机事件 |
| 通用配置 | `SessionConfigOption` / `SetSessionConfigOptionRequest` / `ConfigOptionUpdate` | 通用配置槽位（备选承载） |
| 用量 | `UsageUpdate` | token 用量（context footer 的候选来源，§13） |
| 会话信息 | `SessionInfoUpdate` | 会话元信息更新 |
| 斜杆命令 | `available_commands_update` | agent 侧命令表 |
| 认证 | `authMethods`（含 terminal_command 型登录） | 本 distro 不需要（凭据共享 `~/.pi`，§5.2）；generic agents（P5）用 |
| 文件/终端反向委托 | `fs/read_text_file`、`fs/write_text_file`、`terminal/*` | §5.5，P5 |

### 5.1 握手与能力

`initialize` 协商 `protocolVersion` 与双向 capabilities；**未声明的能力一律按不支持处理，不猜语义**。

- harness 声明：`loadSession`、`promptCapabilities.image`、modes/models 表、`_meta.steering.supported`、
  `x-zu` 方法表（带版本号）。
- Zu 声明：第一阶段 `clientCapabilities = {}`（pi 工具自治，§5.2）；`x-zu` 支持表。
- 版本不匹配：拒连并提示升级 app（distro 随 app 走，skew 只来自开发形态）。

### 5.2 核心映射（pi 语义 → ACP 原语）

| pi 语义 | ACP | 说明 |
|---|---|---|
| prompt | `session/prompt`（ContentBlock[]） | pending request 即 turn；应答 `stopReason` 即 settle |
| 流式文本 / thinking | `session/update`：`agent_message_chunk` / `agent_thought_chunk` | 事件只是文件投影的加速器 |
| 工具调用 | `session/update`：`tool_call` / `tool_call_update` | 宿主渲染通用工具卡（title/kind/status/locations），**不做 pi 工具名特化**（§2.5） |
| abort | `session/cancel` | 优雅停止 → `stopReason: cancelled` |
| 工具权限 | `session/request_permission`（allow/reject × once/always） | distro 把 pi 的权限门映射到标准方法；**第一阶段 pi 默认自治不变**——何时请求权限由 distro 按 pi 配置决定，宿主只出对话框。reviu 的 `PermissionPrompt`（完整 tool_call + options + auto-approve）是宿主卡片的数据形状参照 |
| thinking 档位 | **session modes**（`SetSessionMode`） | v2 变更：不再 x-zu。pi thinking levels 由 distro 暴露为 modes，composer 的档位控件渲染 `available_modes` |
| 模型选择 | `SetSessionModel` + `available_models` | v2 变更：composer 模型菜单从协议来 |
| 压缩（状态） | 核心 `CompactionUpdate` 事件 | 自动压缩状态条从协议来 |
| 斜杆命令（agent 侧） | `available_commands_update` + 命令文本进 prompt | 扩展/模板/技能命令按原文进 `session/prompt`，宿主不再维护这张表 |
| MCP | `session/new` 的 `mcpServers` 参数 **distro 显式忽略** | pi 用自己的 MCP 配置；忽略是声明行为，写进 protocol notes，标准 client 传入不 undefined |
| 斜杆命令（宿主本地） | 无协议 | `/new` `/resume` `/clear` 是纯 UI 动作，留在宿主本地表——三分法只剩 local 表 + 协议命令表两半 |

### 5.3 私有面：`_session/steering`（生态惯例）+ `x-zu`（收缩后）

私有方法承载 ACP 核心无对应的 pi 语义，按 `_meta` + 自定义方法约定，**全部可降级**。

| 方法 | 语义 | 与 v1 的差异 / 降级 |
|---|---|---|
| `_session/steering` | 运行中引导；`_meta.steering.supported` 协商 | **v2 变更：从 `x-zu/session.steer` 改名对齐 claude-agent-acp 的既有生态惯例**，三态结果沿用（injected / startedNewTurn / promptRequired）——标准 client（Zed/reviu）对 Zu 会话立即获得 steer 能力，Zu 反向也能统一 steer 生态 agent。降级：cancel + 新 prompt |
| `x-zu/queue.update` | followUp 排队状态（pi 原生 followUp 仍由 distro 扩展承载） | 隐藏排队状态条 |
| `x-zu/compact` | 手动压缩**触发**（核心只有压缩状态事件，无触发方法） | 隐藏命令；自动压缩的状态仍走核心事件 |
| `x-zu/modelState` | 「无模型」的原因（`no_catalog`/`no_credentials`/…，§2.0 P0 的 UX） | `available_models` 为空 + 宿主给通用提示 |
| `x-zu/ui.request` / `ui.response` | pi 扩展对话框（confirm/select/input/editor） | 沿 v1；tool 锚定的 confirm 优先走标准 `request_permission` |
| `x-zu/subagent.*` | dispatch/inject/abort/名册增量 | 名册退化为纯文件 fold |
| `x-zu/loadOptions` | v1 load 的重放抑制 | **P0 按 §4.3 核对 `session/resume`**：标准方法可用则本条不实现 |

v1 的 `x-zu/session.setThinking`（→ modes）、`compaction.*`（→ 核心事件）从表中**删除**。

### 5.4 读面不走协议（沿 v1）

`session/list`、历史转录、名册 settled 部分，Zu 一律不调协议——文件 fold（§6）。ACP 把会话存储当 agent
私有（看历史必须 spawn + load 重放），Zu 只有 pi 一种公开格式，享受零进程可读。协议只承载**控制与活事件**。

### 5.5 fs/terminal 反向委托（P5，可选增强，沿 v1）

`fs/*` 与 `terminal/*` 是宿主向 agent 提供的**通用**能力面（reviu 的 `terminal.rs`——660 行 TerminalStore、
输出截断、UTF-8 跨 chunk 拼接、`can_kill`——是完整参照），不是沙箱：威胁模型不变，agent 动作仍由 pi
权限模型负责。第二阶段声明后，适配层把 pi 的 read/edit 路由到宿主 fs（buffer 感知）、bash 路由到
`zu/pty` 终端；逐项能力独立开关。薄宿主不受损：宿主提供的是无语义的通用能力。

### 5.6 generic agents（P5，可选，版本确定性豁免）

其他 ACP agent（claude-acp、codex-acp、glm-acp…）可经**用户显式添加**成为会话（不是注册表自动发现）：
spawn 命令由用户给出，UI 标注「未 pin，随生态更新」。代价自证于 reviu：客户端自持久化转录
（版本化 JSON + meta）、工具卡归一化、authMethods 登录终端——三件套只在 P5 落地，且与 distro 会话
**并存不混用**（durable 权威两套：pi 文件 vs 客户端转录）。

## 6. 状态与读面

| 数据 | 唯一写者 | 读者 |
|---|---|---|
| pi 会话 JSONL（captain + subagent） | 对应 harness 进程（或外部 pi CLI） | UI fold |
| `~/.pi/zu/`（容器、projects、layouts、settings、未读回执） | **UI，经 `zu/state`**（原子写、版本字段、stale 检测）——**v2 明确：注册表写者从 engine 反转为 UI** | UI fold |
| 活 run 注册表 | 不落盘——`zu/acp` 进程表 + UI store；孤儿标记由 harness 自己写（§7.3） | UI |
| 子代理 settled 名册 | 不单独写——子会话文件三重自证，扫描即名册 | UI fold |

读面机制（沿 v1，补三点）：

- 会话索引：Rust 扫描 op 只读 JSONL header，mtime 水位增量对账；转录 fold 持
  `(path, size, mtime, leafId)` 游标增量 append-parse；流式期间协议事件乐观加速，settle 以文件
  `message_end` 对账收口。`zu/fs` 转录读面加按偏移增量读（range read）。
- **中断 turn 的 fold 判定**：文件缺 `message_end` 且进程表无活进程 = 中断——与崩溃恢复同一段代码。
- **不需要「空会话守卫」**：预热不铸文件（§4.3）后，空会话文件在源头不存在；fold 层不做补偿
  （reviu 的 `chat_items_have_persistable_content` 是它被迫在持久化层挡的，因为它的持久化就是权威——
  Zu 的权威在 pi 文件，源头治理即可）。
- 失效驱动：自己 spawn 的 turn 用事件流；外部改动（pi CLI 续聊）靠聚焦扫水位 + 低频轮询；归档复活是
  fold 的自然结果。启动：fold zu 状态（毫秒级）→ 立即渲染 → 异步扫索引，画布不等任何进程。
- 写者唯一性：进程表按 sessionPath 键控，一键一会话；外部 pi CLI 并发写由游标校验转只读（不变量 10）。

## 7. 进程模型（历史：轮级 + 预热）

> **已被 IMPLEMENTATION D1 推翻**。本节保留 P0–P4 的论证与边界；目标是一会话一持久 `pi-acp`
> 进程（`AcpHost`），轮级只作为迁移前的历史形态。

### 7.1 生命周期

1. **spawn**：`zu/acp` 拉起 harness：argv 显式、cwd/env 用容器创建快照、无 shell、进程组；stderr →
   日志文件（环形缓冲尾段附到启动错误上——reviu 的 `with_launch_stderr` 模式），stdout 只跑协议。
2. **握手**：`initialize`（60s 看门狗，超时即报「harness 未在 60s 内就绪」+ stderr 尾段）→
   `session/new { cwd }`（新会话，**在真实 prompt 认领时才铸**）或 `session/load { sessionId }`（抑制重放）。
3. **turn**：`session/prompt` pending；`session/update` 流式加速；应答 `stopReason` = settle。
4. **退出**：**settle 且无活子代理**才退出（后台子代理要求 linger；harness 自己判定并退出，宿主只观察）。
   优雅退出主路径 = 宿主关闭 stdin（ACP agent 对 client 断开的标准行为是 flush 并退出），
   SIGTERM/SIGKILL 只是宽限兜底。
5. **取消**：`session/cancel` → 优雅 flush → 退出。文件缺最后 partial 即标中断。
6. **崩溃**：无 `stopReason` 的退出 = 该 turn 标中断，文件兜底，重试 = 再 spawn。**无监督者、无重启
   循环**——重试是用户动作。

### 7.2 预热（性能优化，非正确性依赖）

composer 聚焦/输入时预 spawn + `initialize`（**不 `session/new`**，§4.3）；resume 场景可预 `load`；
闲置超时自杀。预热失败只是慢一点。预热进程在进程表里是「未绑定」句柄，被首个 prompt 认领后才绑定
sessionPath；同一时刻最多一个未绑定预热。冷启动预算（spawn + initialize + new/load 的 P50/P95）P1 实测
定数（§13），不可掩则回退 session 级（协议内选项，非架构返工）。

### 7.3 `zu/acp` 与孤儿收割

`zu/acp` 一个 Rust class：spawn、ndjson 行帧读写（**行长上限 32 MiB**——工具大输出的行会到 MiB 级，
照 `zu/lsp` 的有界帧先例）、stdin 写、exit → Callback、stderr 回调、kill、Drop 兜底。**零 JSON 解析、
零 id 配对**（§3）。

**孤儿收割**：run 标记由 **harness 自己**在 spawn 时写（`~/.pi/zu/runs/{pid}.json`：pid、startedAt、
sessionPath 认领后补），settle 退出时自删——宿主 SIGKILL 后标记仍在、进程仍活，下次启动扫标记、
pid 判活、孤儿一律 kill（控制端已死无法收养，durable 内容全在文件）。id 形状用
`{millis}-{pid}-{counter}`（reviu 配方：双实例同秒不撞）。

### 7.4 为什么轮级而非 session 级（历史论证，已被 D1 推翻）

ACP 生态默认（Zed）与 reviu 的实现都是 session 级：暖会话、付空闲内存、生命周期管理回来（reviu 的
`AgentSession` 是「Drop kills the child」+ 每会话 driver task + channel 组）。轮级把失败半径压到一个
turn、空闲零成本、进程表即注册表；代价是冷启动（预热掩）与**并发内存画像**（v2 补记：并发活 turn =
N×Bun 运行时，每个 100–200MB 量级；现状是全体会话共享一个引擎进程。目标用户 1–2 并发可接受，
实测进 §13，作为回退阈值的输入）。**ACP 对两者中立**。

### 7.5 保留不动的域

`zu/pty`、`zu/lsp`、`zu/git`、`zu/fs`、`zu/instance`（单实例锁保留：两个 UI 实例写 zu 状态仍需互斥；
端口互斥理由消失）。单实例、关窗收起、通知策略全部沿用。**settle 通知的信号源（v2 修正 v1 的含混）**：

- captain settle = **prompt 应答边沿 + 进程退出**（无 x-zu 依赖）；
- 子代理 settle = `x-zu/subagent.settled` 事件（§8：第一阶段子代理在 harness 进程内，无进程边沿）。
  「降级」在这里不成立——generic agents（P5）没有子代理，不存在无通知的子代理；该信号不是降级面，
  是 distro 会话的私有增强，写明即可。

## 8. 子代理与扩展 UI

- **dispatch 是 distro 内的 TS 扩展**，只注册进 captain 会话（两级门控不变；子会话 `noExtensions` + 工具排除）。
- 子会话由扩展在 harness 进程内用 SDK 创建（沿用 SubagentManager 语义，落 `zu/subagents/`）——第一阶段
  进程内，少一层 IPC；captain linger 到子代理 settle。spawn 子 harness 是备选路径，不承诺。
- inject/abort：宿主经 `x-zu/subagent.*` → captain 扩展 → 子会话；GUI 无人类直连入口（协议层不拦截）。
- 结果交付：扩展内 followUp 进 captain 上下文（调度事件 CustomEntry 不进上下文、结果进——二分沿用）。
- 名册：live = `x-zu` 事件加速，settled = 文件 fold；并发上限 FIFO 信号量默认 4（沿用）。
- **扩展 UI**：`ctx.ui` 经 `bindExtensions` 绑到适配层 → `x-zu/ui.request` → nsh AlertDialog/Picker/Input →
  应答回 stdin；超时 resolve pi 默认值；pending 对话框随进程生灭。

## 9. 门禁与兼容台账

### 9.1 prompt cache parity（迁移门禁第一条，v2 补第三断言与实现手段）

Provider 前缀缓存命中条件 = 请求前缀字节一致。轮级架构每轮从文件 resume 重建，**两类不一致都要测**：

1. **跨引擎 parity**：同一会话同一 turn，旧引擎与新 harness 的 API 请求体 diff，前缀字节一致。
2. **跨轮命中**：第二轮断言 `cacheRead > 0`（pi 已统计 cacheRead/cacheWrite，`pi-ai/types.d.ts` 实证）。
3. **自跨轮前缀单调（v2 新增，承重）**：新 harness 自身 turn N → N+1 的请求体满足逐字节前缀关系
   （N+1 = N + 新增消息，无中途改写）。断言 1+2 测不出「与旧引擎 parity 但自己每轮 cache miss」——
   resume-from-file 重建若与 in-memory 续跑规范化不同（thinking 块省略、tool result 截断、字段顺序），
   税是每轮全额重算。重建确定性是适配层的显式职责。

**实现手段（不改 pi）**：`pi-ai` 的 provider 配置有 `baseUrl`——新旧两引擎指向同一个本地录制代理，
dump 请求体做 diff。门禁脚本进仓：`pi-harness/scripts/cache-parity.*`。

### 9.2 兼容性台账（v2 更新）

| 条目 | 上游 removable 条件 |
|---|---|
| Bun 单文件 seam（jiti/虚拟模块/WASM 资产） | pi 官方支持无资产单文件分发 |
| `_session/steering` | ACP 核心收编运行中引导（届时方法名随核心） |
| `x-zu/compact` 触发 | ACP 核心纳入压缩触发方法 |
| `x-zu/ui.request` | ACP 核心纳入通用对话框 |
| `x-zu/loadOptions` | **`session/resume` 在稳定 spec/SDK 落地（P0 核对，可能 P0 即删）** |
| `x-zu/modelState` | ACP 给 available_models 增加原因/状态表达 |
| thinking → session modes | **已对齐核心，无条目**（v1 的 x-zu/setThinking 台账删除） |
| pi pin 升级 | 每次 bump 跑：cache parity 三断言 + TUI 冒烟 + 本台账核对 |

### 9.3 验收门禁（每阶段）

`nsh check app` + `nsh test app` + `cargo test`（native/）+ 以下新增：

- **stdio 一致性**：用 stub ACP client（仓内最小驱动脚本）驱动 harness 全部方法面；
- **stub harness**：仓内最小 ACP agent（reviu `stub_agent.rs` 模式）打宿主 UI 测试——headless 真
  Workbench 不再依赖真实 distro；
- **cache parity 三断言**（§9.1）；
- **真实扩展冒烟**（加载/confirm/notify）+ **崩溃演练**（kill -9 后文件 fold 完整、孤儿收割、下次
  spawn 重试）；
- **薄宿主守门**：`app/` 无 npm 依赖 + grep 规则（§1.3）。

## 10. 失败矩阵

| 死的是什么 | 后果 | 恢复 |
|---|---|---|
| 一个 harness 进程 | 一个 turn 标中断；未落盘流式增量丢失 | 用户重发 = 再 spawn + load；孤儿标记自清或被收割 |
| 全部 harness（app 崩溃） | 活 turn 中断；**durable 状态无损** | 启动 fold 即恢复现场；孤儿收割（§7.3） |
| `zu/acp` 域 | spawn 失败报错（带 stderr 尾段）；**读面完全不受影响** | 重试 |
| UI 进程（GUI 退出/崩溃） | 子进程随进程组回收；SIGKILL 幸存者由孤儿收割兜底 | 重启 fold |
| pi CLI 并发写同一会话 | 游标不一致 → 只读 | reload |
| ACP 版本/能力不匹配 | 拒连/降级，明确文案 | 升级 app |
| 预热进程失败/超时 | 该次输入慢一点 | 正常路径重走 |

对照现状：引擎崩溃 = 全会话中断 + 监督重启 + generation 对账 + 「已恢复」横幅——这一整类事故不存在。

## 11. 不变量

0. **宿主零 agent 语义**：`app/` 只拥有进程表/文件 fold/zu 状态/UI 四件事；agent 面知识一律在 distro
   （§1.3 的依赖与 grep 门禁是本不变量的执行面）。
1. 任何 durable 事实零活进程可读；UI 渲染 = 文件 fold + 事件加速。
2. 一个 sessionPath 同时最多一个活 harness；未绑定预热句柄至多一个。
3. harness 只写自己的会话文件（及 captain 的子会话文件）与自己的 run 标记；zu 状态只由 UI 经 zu/state 写。
4. 进程死亡 = turn 中断，永不升级为 app 级故障。
5. **预热是性能优化，正确性不依赖暖进程，且永不铸会话文件**。
6. 视图操作永不触碰会话与资源。
7. settle 以文件为准；`stopReason` 与进程退出互为备份信号。
8. pi → Zu 兼容最高优先：pi CLI 的任何会话可列出/打开/继续；解析失败不阻塞启动。
9. `_session/steering` 与 `x-zu` 全部可降级；核心对话不依赖任何扩展方法。
10. 宿主不说 pi 方言，harness 不说 Zu 方言；私有面只有 `_session/steering` 与 x-zu，其唯一事实源在
    `contracts/acp-xzu/`。

## 12. 迁移路径（历史，已完成）

> 本节是 P0–P4 的历史记录；P4 已完成。后续的会话运行时、配置面、权限、子代理见
> [pi-acp-IMPLEMENTATION.md](pi-acp-IMPLEMENTATION.md) §12。

每阶段独立验收；P4 单独成批（删除也是一类改动），守「每步可全量回绿」。

| 阶段 | 内容 | 验收 |
|---|---|---|
| **P0** | **pi-harness 适配层**：ACP 适配层嵌 SDK（`@agentclientprotocol/sdk`），initialize / new / load / prompt / cancel + update 流；distro 构建（Bun 单文件 + 资产）；**前置：实跑 pi-acp 记能力矩阵；核对 `session/resume` 可用性** | 标准 ACP client 驱动真实对话；stdio 一致性（stub client） |
| **P1** | Zu：`zu/acp`（薄传输）+ `jsonrpc.ts`/`acp.ts` + `contracts/acp-xzu/`；与现有引擎**双跑 parity**（`ZU_STATE_DIR` 隔离，防旧 registry 与新 zu/state 对账打架） | cache 三断言（§9.1）+ turn 生命周期 + 60s 看门狗 + 冷启动预算定数（§13.3） |
| **P2** | 读面切换：`zu/fs` 增量读 + 扫描 op + `zu/state`；注册表写者反转（读旧 registry.json 迁移入 zu/state）；fold 与 wire 读对账 | 「引擎不在也能浏览」；启动不等待；中断 turn 的 fold 判定 |
| **P3** | 控制面切换：dispatch 扩展 port 进 distro；子代理/名册/交付；通知信号源切换（prompt 边沿 + `x-zu/subagent`）；`engine.ts` 全部 wire 用途改走 ACP | 全量门禁 + 崩溃演练 + 真实扩展冒烟 |
| **P4** ✅ | **删除批**：旧 distro（`server/store/subagents`）、`contracts/` 私有 wire、WS/token/心跳/`zu/engine` 监督 | 全量门禁 + grep 门禁（wire 词汇零残留） |
| **P5** | 可选增强（逐项开关）：fs/terminal 反向委托；generic agents（§5.6） | 逐项验收；与 distro 会话并存不混用 |

UI 侧各 store 的**对外行为**保持（侧栏/画布/composer 的用户可见语义不变），但内部数据面按 §6 重构——
v1「store 接口不变」的说法收窄为这句话：`snapshot/subscribe` 语义消失，containers 注册表写者反转，
这是数据面重构，不是换传输。

## 13. 开放问题（历史，已转入 IMPLEMENTATION）

> 本节的问题已由 [pi-acp-IMPLEMENTATION.md](pi-acp-IMPLEMENTATION.md) 的 A0–F0 重新拆解；
> 不再作为待办来源。

1. **冷启动预算与回退阈值**：预热后首 token 延迟 P50/P95 的实测数（P1 定）；不可掩时的 session 级回退
   触发线（建议：P95 > 1.5s 或预热命中率 < 60%）。
2. **`session/resume` 落地版本**：P0 核对；可用则 P0 直采，`x-zu/loadOptions` 从实现中消失。
3. **UsageUpdate 承载 context footer**：composer 的 context 用量能否从核心 `UsageUpdate` 来（连带删除
   `x-zu/context` 的潜在需求），P1 实测字段覆盖度。
4. **thinking 的 modes 命名**：distro 暴露的 mode id/label 集合（与未来 ACP 语义的兼容取舍），P0 定。
5. **容器注册表瘦身**：顺势改 overrides-only（research A1「Pi 容器不落盘」）——与本架构兼容，独立裁决。
6. **distro 更新节奏**：第一阶段随 app 原子更新；独立更新通道（pi 升级快于 app）是后续产品决策。
7. **并发内存画像**：N×Bun 的实测值进 §7.4 的回退阈值输入（与 1 合并测）。
8. **generic agents 的目录归属**（P5 期）：客户端转录存 `~/.pi/zu/transcripts/{agentId}/` 还是独立根，
   到 P5 再裁。

## 14. 参考

- nsh-pi `docs/architecture.md`（当前形态）、`docs/sheet-module-ARCHITECTURE.md`（模块边界）
- `dspo/pi-harness-ARCHITECTURE.rejected.md`（manox 前稿）
- ACP：v1 规范（agentclientprotocol.com）；`session/resume` stabilized 公告与 v2 RFD（replayFrom 游标）；
  官方 SDK：Rust `agent-client-protocol` 0.11.1、TS `@agentclientprotocol/sdk` 2.x
- **reviu**（`~/projects/github/reviu`）：`agent_acp`（ACP client 核心、`_session/steering`、权限卡、
  terminal 委托、stub agent）、`agent_registry`（公共注册表解析、pi-acp 条目）、`agent_chat_panel`
  （客户端持久化、工具归一化、事件批处理边界）——通用路线的量产对照与 P5 蓝图
- Steer：`manox-app/AGENTS.md`（journal 权威、纯 fold、in-proc leg）

## 15. v1 → v2 变更清单

| # | 变更 | 动因 |
|---|---|---|
| 1 | 薄宿主升为第一原则 + 依赖/grep 门禁（§1.3、不变量 0） | 宿主裁决 |
| 2 | 传输分层明确：`zu/acp` 零 JSON 语义，id 配对移入 TS（§3、§7.3） | 薄宿主 + `zu/lsp` 同型分工 |
| 3 | 协议基线对齐 ACP 0.11：thinking→session modes、model→SetSessionModel、压缩状态→核心事件、UsageUpdate（§5.0–5.3）；x-zu 删两条 | reviu 实测 import 面 |
| 4 | steer 对齐生态惯例 `_session/steering`（§5.3） | claude-agent-acp 先例，标准 client 互通 |
| 5 | `contracts/acp-xzu/` 设为 x-zu 唯一事实源，私有 wire 让位（§3、不变量 10） | 修 v1 缺口「x-zu 契约无单一事实源」 |
| 6 | 预热永不铸文件；空会话守卫不需要（§4.3、§7.2） | 修 v1 缺口「预热污染存储」 |
| 7 | cache 门禁加第三断言（自跨轮前缀单调）+ 录制代理实现手段（§9.1） | 修 v1 缺口「resume 重建 vs in-memory 规范化」 |
| 8 | 子代理 settle 通知信号写明（captain=进程边沿；subagent=x-zu 事件，非降级面）（§7.5） | 修 v1 §7.5/§8 矛盾 |
| 9 | run 标记由 harness 写、stdin-close 优雅退出、行长上限、60s 看门狗 + stderr 附错（§7.1/7.3） | reviu 实证 + 有界帧先例 |
| 10 | 注册表写者反转、P1 双跑 `ZU_STATE_DIR` 隔离、mcpServers 忽略、slash 两分法修正（§5.2、§6、§12 P1） | 审查 P1 项 |
| 11 | 「store 接口不变」收窄为「对外行为不变」（§12） | snapshot/subscribe 无协议对应物 |
| 12 | 仓治理裁决：pi-harness 留在 nsh-pi（C8 布局第三包），抽取等 manox 复用成真（§13.1 → 已裁决移除） | 审查建议 |
| 13 | generic agents 降为 P5 显式豁免（UI 标注「未 pin」），注册表自动发现不做（§5.6） | 版本确定性约束 + reviu 代价实证 |
| 14 | 迁移 P4 拆出独立「删除批」（§12） | 「每批一类改动」纪律 |
| 15 | P0 前置：实跑 pi-acp 记能力基线（§4.4） | 适配层工作量评估与上游姿态 |
