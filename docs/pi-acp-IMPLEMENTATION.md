# Pi distro × ACP 集成设计（实现稿）

> 状态：**已落地（2026-11-13，A0–F0）**。本文从设计稿转为实现记录；仍以 §9 的 UI/UX 与 §11
> 的验收清单为准，未跑的真机/live 项在 §11 明确标注。
> 门禁（2026-11-13）：`nsh check app` ✓、`node script/check-layers.mjs` ✓、
> `ZU_SKIP_LIVE=1 nsh test app` 221 用例 207 通过 / 14 skip、`pi-harness bun test` 56 ✓、
> distro `bun run build` ✓、`bun run smoke`（ACP offline）✓、`bun run acceptance:live`（真机，两轮）✓、
> `LIVE_CRASH_ONLY=1 bun run acceptance:live` ✓、`script/bundle-mac.sh` ✓。
> 关系：本文是 Pi 模块的**目标实现**。当前系统形态见 [architecture.md](architecture.md)；
> 协议映射与 P0–P4 的历史裁决见 [pi-acp-PROTOCOL.md](pi-acp-PROTOCOL.md)；
> 扩展机制（sheet 模块、能力域）见 [sheet-module-ARCHITECTURE.md](sheet-module-ARCHITECTURE.md)；
> 视觉 token 与外壳几何见 [DESIGN.md](DESIGN.md)。
>
> 一句话：**把"每轮 spawn 一次的 ACP 调用"改造成"活着的会话运行时"**——
> 一个会话一个持久 `pi-acp` 进程，ACP 宿主只做协议，会话语义（模型、档位、命令、审批、用量、恢复）
> 全部回到协议里；Pi 扩展继续负责 agent 能力，不被协议层替代。

## 0. 裁决摘要

| # | 决定 | 理由 |
|---|---|---|
| D1 | **一会话一持久 `pi-acp` 进程**；**不限制进程数量与资源**；容器级多 session 复用延后 | ACP 的寻址单位是 session；进程生命周期跟会话 sheet 走，不做 cap/LRU/RSS 回收。`AcpHost` 抽象保留容器级复用的空间 |
| D2 | **留在 stable ACP v1**，补齐会话语义面；不迁 v2 | SDK 2.6.0 的 stable v1 已含 `set_config_option`、`set_mode`、`resume/list/close`、`usage_update`、`available_commands_update`、`session_info_update`、`compaction_update`、`notice`、`request_permission`、`elicitation`。v2 的 `state_update` 暂不需要 |
| D3 | **配置/命令/上下文是协议状态**，不是客户端代偿 | 删除 `ZU_PI_MODEL`/`ZU_PI_EFFORT`、静态斜杆表、native `PiModels` 的会话内路径、"ACP 不可用"分支 |
| D4 | **权限策略在 distro 的扩展里**，客户端只渲染 | 工具审批与扩展对话需要阻塞能力；策略（ask/auto/read-only）属于 agent 侧 |
| D5 | **子代理是 Pi 扩展 + `_zu/subagents/*`**，不是 ACP 标准位 | ACP 没有子代理通道；扩展能拿到 captain 的会话与工具钩子，持久进程让后台 run 可跨 turn |
| D6 | **ACP 宿主是独立进程，不是 Pi 扩展** | 扩展没有 stdio/进程所有权，也回答不了 `initialize`/`session/new`；扩展只提供能力 |
| D7 | **不采用 `pi-ahp`** | AHP 是 manox 的 journal/reducer 协议；在 Pi 上实现等价宿主是重写，且失去 ACP 生态。统一发生在 sheet 模型层 |

## 1. 实施前复盘：当时的缺口（历史）

> 本节保留实施前的诊断，便于理解 A0–F0 为何这样切；当前形态已不是这样。

### 1.1 现在的形状

- 进程：`startTurn` 每轮 `spawn → initialize → session/new|load → prompt → settle → close`，注释明说
  "The process is never kept between turns"（[`acp.ts`](../app/modules/pi/acp/acp.ts) §startTurn）。
- 协议：distro 只实现 5 个方法——`initialize`、`session/new`、`session/load`、`session/prompt`、
  `session/cancel`（[`app.ts`](../pi-harness/src/acp/app.ts)）。
- 客户端：服务端→客户端的请求一律 `-32601`；没有权限、elicitation、扩展 UI 的入口。
- 代偿：
  - 模型/effort 走 spawn env（`applySessionPrefs`）；
  - 模型菜单回退 native `PiModels`，会话内 `/model`、`/thinking`、`/compact` 报"ACP 不可用"；
  - 斜杆是客户端静态表；
  - 扩展 `uiContext` 全部 no-op，只写 stderr；
  - 子代理 transport 为空时直接"不可用"。

### 1.2 根因（三个，不是三个独立缺口）

1. **拓扑错**：会话是长活对象，协议却是每轮一次函数调用。配置、审批、后台工作、prefix cache、
   恢复都无处安放。
2. **协议面欠账**：stable v1 已有会话语义，我们只用了最小回路；问题不是协议版本，而是实现面。
3. **职责错**：客户端拥有模型/命令/上下文/审批的语义，distro 只做流式转发。于是同一个事实在
   native、store、composer、UI 四处维护，ACP 一缺位就退化成"不可用"。

### 1.3 结论

G1（审批/扩展 UI）、G2（模型/档位/压缩）、G3（子代理）是同一根因的症状。本文按"拓扑 → 协议面 →
会话语义 → 权限 → 子代理"重排，而不是逐条打补丁。

## 2. 原则

1. **ACP 宿主薄，Pi SDK 在里，扩展提供能力**：宿主只拥有进程、stdio 帧、session 生命周期；
   agent 语义在 Pi SDK 与扩展里。
2. **协议原生优先**：stable v1 有标准位的（config/mode/permission/elicitation/commands/usage/info/
   compaction/notice），一律用标准；只有子代理与 host 状态用 `_zu/*` 扩展方法。
3. **客户端是投影**：UI 渲染 `SessionView`，不自行推断"哪个模型可用/哪条命令支持/什么上下文"。
4. **配置只有一个写面**：Hero 预选 → `set_config_option`；之后会话内所有切换走同一方法。
5. **删除代偿**：env、静态斜杆、假不可用、no-op UI 都随迁移删除，不保留双路径。
6. **恢复是 spawn + resume，不是重连**：stdio 连接随进程死；重开是显式的状态转移。

## 3. 进程与连接模型

### 3.1 单位

**一个打开的 Pi 会话 = 一个 `pi-acp` 子进程。**

- ACP 的 `sessionId`、取消、配置、权限、用量都是 session 粒度；进程与 session 1:1，状态最少。
- 子代理在 captain 的进程内创建子会话（Pi SDK 的 `createAgentSession`），不再多进程。
- 容器级多 session 复用（一个进程托管同容器所有会话）**第一版不做**；`AcpHost` 的接口按
  `containerId`/`sessionId` 设计，后续可把 key 换成容器而不改 store。

### 3.2 AcpHost 状态机

```
                 ensure()                 prompt()
   (none) ───────────────▶ starting ───────────────▶ ready ──▶ prompting ──▶ ready
      ▲                       │                       │            │
      │                       │ handshake fail        │ cancel     │ settle
      │                       ▼                       ▼            ▼
      └──── closed ◀──────── idle ◀──────────────── waiting_user ◀── approval/elicitation
                                                      │
                                                      └──── permission/扩展请求
```

状态：`none | starting | ready | prompting | waiting_user | interrupted | closed | dead`。
唯一写者是 `AcpHost`；store 只读状态、发命令。`closed` 只来自用户/容器生命周期（关 sheet、归档、
退出），**不存在因数量或内存触发的自动驱逐**。

### 3.3 生命周期规则

| 事件 | 行为 |
|---|---|
| 会话首次打开 / 首次 prompt | `ensure()`：spawn → `initialize`（60 s 看门狗）→ `session/new` 或 `resume` |
| turn 结束 | 进程保留；`session/update` 的 `usage`/`info` 继续维护视图 |
| sheet 关闭 | `session/close` → close stdin → 等 2 s → kill；会话可再次打开（`resume`） |
| 有 live 子代理 | 进程保留到 run 结束（生命周期延长，不是驱逐） |
| 进程退出（非用户） | `interrupted`：当前 turn 标中断；下一次操作 `resume`，不静默重放 |
| resume 失败 | 退避一次 + 可见错误（"会话无法恢复"），不循环重启 |
| 容器归档 | 取消所有 turn、拒绝 pending 请求、kill 该容器全部进程 |
| 应用退出 | 取消 turn、close stdin、超时 kill；不留孤儿 |
| 重复 ensure | 单飞 promise map，避免同会话双进程 |

**没有空闲 TTL、没有进程 cap、没有 RSS/轮数回收。** 进程只随会话 sheet 的显式生命周期结束。

### 3.4 为什么不是"一容器一进程"

多 session 复用会引入：更新按 `sessionId` 路由、一个 session 崩溃影响兄弟 session、共享事件循环被
一个长工具拖住。它节省的进程数在"每容器 1–2 个会话"的现实下很小。
因此：**第一版一会话一进程；容器级复用是后续优化，不是初始复杂度。**

### 3.5 资源

**按裁决：不限制 Pi 进程数量，也不按内存/轮数限制或回收。**

- **进程数**：等于当前打开的 Pi 会话 sheet 数；没有 cap、没有 LRU、没有"最久未用"。
- **内存**：不做 RSS 阈值、不做 turn 数回收；长会话的增长由 Pi 的压缩与 OS 管理。RSS 只作为
  **诊断指标**记录，不作为动作依据。
- **stdio**：`session/update` 是 notify；每 session 一条顺序泵，**等待写完成**而不是无界排队——
  客户端慢时背压回 distro，不丢 update、不无限堆内存。
- **stderr**：保留尾部用于错误诊断（这是日志裁剪，不是资源限制）；不写协议 stdout。
- **观测**：进程表（session/状态/最后活动/RSS）、cold/warm 延迟、resume 次数/失败、权限等待时长。
  只记录，不触发驱逐或重启。

## 4. 协议面（stable ACP v1）

### 4.1 方法矩阵

| 方向 | 方法 | 现状 | 目标 |
|---|---|---|---|
| client→agent | `initialize` | ✅ | 补 capabilities（loadSession、promptCapabilities；不虚报） |
| client→agent | `session/new` | ✅ | 返回 `configOptions` + `availableCommands` |
| client→agent | `session/load` | ✅ | 保留（读面/兼容）；新路径优先 `resume` |
| client→agent | `session/resume` | ❌ | ✅ 重启/关闭后恢复，返回 config/commands（+ replayFrom 可选） |
| client→agent | `session/list` | ❌ | 可选：给外部客户端；Zu 的读面仍以文件扫描为准 |
| client→agent | `session/close` | ❌ | ✅ sheet 关闭时的显式释放（进程可留） |
| client→agent | `session/set_config_option` | ❌ | ✅ 模型 / 思考档 |
| client→agent | `session/set_mode` | ❌ | ✅ 审批策略（ask / auto / read-only） |
| client→agent | `session/prompt` | ✅ | 保持单飞行；错误分类 |
| agent→client | `session/cancel` | ✅ | 保持 |
| agent→client | `session/request_permission` | ❌ | ✅ 工具审批 |
| agent→client | `elicitation/create` | ❌ | ✅ 扩展 confirm/select/input/editor |
| agent→client | `elicitation/complete` | ❌ | ✅ 异步 elicitation 的收尾（如需要） |
| agent→client | `session/update` | 部分 | 补 usage / session_info / compaction / commands / config / mode / notice |

### 4.2 初始能力声明

`initialize` 只声明真实能力：`loadSession: true`；`promptCapabilities` 按实际（文本，不支持图片/音频/
嵌入资源）；不声明未实现的 session capabilities。客户端在握手时记录 distro 的版本与能力，UI 据此
隐藏不可能的动作，而不是运行时报错。

### 4.3 配置选项

`SessionConfigOption` 三个（`category` 是 UX 提示，不参与正确性）：

| configId | category | 值 | 语义 |
|---|---|---|---|
| `model` | `model` | 分组的 `provider/model`（来自 `ModelRuntime.getAvailable()`） | `setModel`；写进会话转录 |
| `thought_level` | `thought_level` | 当前模型支持的档位（`getAvailableThinkingLevels()`） | `setThinkingLevel`；模型切换后重新钳制 |
| `approval` | `mode` | `ask` / `auto` / `read-only`（或 `session/set_mode`） | 审批策略，见 §6 |

规则：

- `session/new` 与 `resume` 都返回完整的 `configOptions`；任何变化发 `config_option_update`。
- `set_config_option` 对未知 id/非法值回 `-32602`，状态不变。
- 配置在会话/转录里持久；resume 后恢复。
- Hero 的预选仍然用 native `PiModels`（不为了拉菜单 spawn 进程）；会话绑定后以 `configOptions`
  为准，首次 `resume/new` 之后用 `set_config_option` 应用预选。两个来源都读 `~/.pi`，允许短暂不一致，
  但不允许第三个来源。

### 4.4 命令

- `session/new`/`resume` 返回 `availableCommands`；扩展/模板/技能命令变化时发
  `available_commands_update`。
- 客户端把 `/name args` 原样放进 `session/prompt`；**distro 的命令分派器**负责执行：
  - 内置：`/compact`（`session.compact()`，发 `compaction_update`）；
  - 扩展命令：走 Pi 的 extension runner；
  - 模板/技能：按 Pi 的展开规则进 prompt。
- 纯客户端命令（`/new`、`/clear`、`/resume` 面板）不进 `availableCommands`，由 UI 本地处理并标注。
- 删除 `slash.ts` 的 18 条静态"不支持"表；支持与否由 distro 声明。

### 4.5 更新面

| update | 用途 |
|---|---|
| `agent_message_chunk` / `agent_thought_chunk` | 流式正文/思考（思考要进 UI，不再丢弃） |
| `tool_call` / `tool_call_update` | 工具卡（含 partial content、状态、locations） |
| `plan` | 计划视图（有则渲染，无则隐藏） |
| `usage_update` | context 百分比、成本；替代 `session.info` 的用量字段 |
| `session_info_update` | 标题/名称；容器标题与页签 |
| `compaction_update` / `compaction_summary_chunk` | 压缩进度与摘要 |
| `available_commands_update` | 斜杆候选 |
| `config_option_update` / `current_mode_update` | 配置/策略变化 |
| `notice` | 扩展 notify、非致命错误、重试提示 |

### 4.6 为什么不是 ACP v2

v2（`experimental/v2`）提供 `state_update`、`session/status`、`plan_update`、elicitation 等更完整的
状态面，但当前产品缺口全部能在 stable v1 表达；引入实验性协议会把风险叠在进程模型上。
**v2 的重新评估条件**：需要 agent 自发后台工作、跨 turn 的细粒度 foreground 状态、或标准终端/文件
能力时，再单独提案。

## 5. 会话语义

### 5.1 SessionView（客户端唯一投影）

```ts
interface PiSessionView {
  id: string;                 // ACP sessionId（视图 key 与之一致；不再需要 alias 映射）
  cwd: string;
  messages: Msg[];            // 正文/工具/notice 行
  streaming: boolean;
  interrupted: boolean;
  state: "starting" | "ready" | "streaming" | "waiting_user" | "interrupted" | "closed" | "dead";
  config: {
    model?: { provider: string; id: string; label: string };
    thoughtLevel?: string;
    approval: "ask" | "auto" | "read-only";
  };
  commands: CommandInfo[];    // availableCommands
  usage?: { used: number; size: number; cost?: number };
  pending: PendingRequest[];  // permission / elicitation
  error?: { code?: string; message: string };
}
```

组件只读这个结构；`sessions.ts` 的 engine-era 分支（`session.info`、models transport、alias map、
queue lane 的旧实现）删除或重写为投影。

### 5.2 读面与恢复

- durable 权威仍是 `~/.pi` 会话文件；`session/load`/`resume` 的 replay 只用于重建进程内状态。
- 打开会话：文件 fold 先出转录（零进程可读）；进程就绪后 `resume` 拿 config/commands/usage，
  有 replay 时按 messageId 去重合并，不整屏重绘。
- 应用重启：进程全死，打开 sheet 时 `resume`；失败则显示"会话无法恢复"，不阻塞其他会话。
- `session/close`：sheet 关闭时释放会话并结束进程；再次打开走 `resume`。

### 5.3 队列与 steering

- ACP 的 `session/prompt` 单飞行。当前客户端 queue 是产品行为，保留为"排队车道"。
- 真正的运行中 steering 暂不做；如需，用 `_zu/session/steering`（扩展方法）或在下一轮 ACP 提案中
  标准化。UI 明确区分"排队（下一轮）"与"引导（当前轮）"，未实现时不显示假入口。

## 6. 权限与扩展 UI

### 6.1 权限策略（distro）

`approval` 配置（`session/set_mode` 或 config option）：

| 模式 | 行为 |
|---|---|
| `ask` | destructive/openWorld/非只读工具在执行前请求批准；只读工具直接执行 |
| `auto` | 全部直接执行（用户显式选择） |
| `read-only` | 所有写入/执行/网络工具阻断（返回 block reason），只读工具放行 |

实现：Pi 扩展监听 `tool_call`（`ToolAnnotations` 与工具名/参数），命中策略时调用
`session/request_permission`：

- 选项：`allow_once`、`allow_always`（本 session 的工具/类别记忆）、`reject`；
- 响应 `reject` → 返回 `block: true, reason`，工具不执行；
- 请求在飞时 session 状态 `waiting_user`，进程 pin；`session/cancel` 按 ACP 规则回 `cancelled`；
- 权限只改变 agent 的工具行为，**不是沙箱**；UI 文案不能说成安全边界。

### 6.2 扩展 UI 映射

| Pi `ExtensionUIContext` | ACP |
|---|---|
| `confirm(title, message)` | `elicitation/create`（form：boolean + 说明） |
| `select(title, options)` | `elicitation/create`（enum） |
| `input(title, placeholder)` | `elicitation/create`（string） |
| `editor(title, prefill)` | `elicitation/create`（multiline string） |
| `notify(message, type)` | `session/update` → `notice` |
| `setStatus(key, text)` | `_zu/status`（或 notice；状态条是宿主的，不伪装成标准位） |
| `setTitle(title)` | `session_info_update` |
| `custom` / widget / footer / header / terminal input | 明确"不支持"：记录 + 一条 `notice`，不再静默 no-op |

项目信任：需要 trust 的 workspace 首次打开时用 elicitation 询问；同意后写 Pi trust store 并重载资源；
拒绝则按未信任运行，UI 说明"项目资源未加载"。

### 6.3 请求的生命周期

- 每个请求有 `requestId`；session 内按到达顺序排队；UI 一次展示一个，其余显示计数。
- cancel/close/容器归档：所有 pending 请求以 `cancelled`/`reject` 结算，distro 不悬挂。
- 超时策略：不自动批准；默认等待用户。若产品需要，只在 UI 层给"稍后处理"，请求仍保留。
- 审批期间 UI 不阻塞整个应用：其他容器、终端、编辑器照常可用；只有在飞 session 的 composer 显示
  "等待审批"。

## 7. 子代理

### 7.1 形态

- 恢复 Pi 的 `dispatchExtension` + `SubagentManager`（历史实现见 git `7d2d523:pi-harness/src/subagents.ts`），
  在 `pi-session.ts` 的 `createAgentSession` 里作为 `extensionFactories` 注入；只给 captain 注册。
- 子会话用进程内 `createAgentSession`：独立 `SessionManager`、`parentSession`、继承 captain model，
  `noExtensions`，保持"只两级"。
- 持久进程是前提：后台 run 不再随 turn 退出。

### 7.2 数据面

ACP 没有子代理标准位，因此用扩展方法/通知：

| 方法 | 方向 | 语义 |
|---|---|---|
| `_zu/subagents/list` | client→agent | 当前容器的 live + settled runs |
| `_zu/subagents/transcript` | client→agent | 一次 run 的只读转录 |
| `_zu/subagents/dispatch` | client→agent | 手动派发（等价于 captain 的 dispatch 工具） |
| `_zu/subagents/abort` | client→agent | 中止 live run |
| `_zu/subagents/updated` | agent→client | 状态/结算通知 |

- settled 索引落 `~/.pi/zu/subagents/`（跨重启可读）；live 只在进程内。
- 有 live run 时进程保留到 run 结束；容器归档先 abort 再 kill。
- 客户端 `modules/pi/subagents.ts` 从 `transport = null → 不可用` 改为真实方法；名册/转录 UI 保留。

## 8. 客户端架构

```
app/modules/pi/
  acp/
    host.ts        AcpHost：进程表、生命周期、状态机、resume、关闭（唯一 spawn 入口）
    connection.ts  JSON-RPC/stdio：帧、超时、请求/通知路由（现有 jsonrpc 的扩展）
    protocol.ts    v1 payload 类型（窄类型，不引 npm）
    fold.ts        update → SessionView
  sessions.ts      投影 store：SessionView + 命令（send/stop/config/approve/answer）
  composer.tsx     纯渲染：输入、命令候选、config footer、状态
  approvals.tsx    审批卡与 elicitation 对话框（或并入 sheets/pi 包）
  subagents.ts     名册/转录投影
  search.ts        会话索引搜索（保留）
  container.ts     容器↔session 投影（保留）
  view.tsx         sheet body
```

- **唯一 spawn**：只有 `host.ts` 调 native `Acp`；store 不直接 spawn。
- **生命周期接线**：`onSheetActivated` → `host.ensure`；`onLayoutChanged`（sheet 消失）与 `closeSheet` → `host.release`；
  `onContainerArchive` → `host.destroyContainer`；`initialize` → 注意扫描（保留）。
- **通知**：turn settle 仍由模块调 `core/notifications.notifySettled`；审批等待时若窗口不在前台，
  额外发"需要你的批准"（同一 sheet id，替换语义）。

## 9. UI / UX 设计

视觉沿用 [DESIGN.md](DESIGN.md) 的 token 与几何；Pi 会话面当前是 hairline composer（DESIGN §3.6），
本文只定义 Pi 面的状态与交互，不改外壳。

### 9.1 原则

1. **状态诚实**：starting/resuming/interrupted/waiting_user 都有明确文案；不把"不可用"藏在空列表里。
2. **一个会话面**：消息区 + composer + 审批/询问卡都在 sheet 内，不弹全局阻塞模态。
3. **不抢焦点**：审批到达时 composer 停住，但不抢走用户正在别的 sheet 的输入焦点；页签/容器行显示标记。
4. **协议驱动**：模型/档位/命令/context 全部来自 SessionView；没有第二套本地表。
5. **可恢复**：中断、崩溃、关闭后重开都有下一步动作（继续/重试/查看错误）。

### 9.2 Composer 状态

| 状态 | 视觉 | 主按钮 | footer |
|---|---|---|---|
| idle | 正常 hairline | ↑ 发送 | 模型 · 档位 · context% · ⋯ |
| starting/resuming | 输入可写，顶部一条细进度行 | ↑ 禁用（ghost） | "正在恢复会话…" |
| streaming | 流式正文 + caret | ■ 停止 | 同上；context 实时 |
| waiting_user | 输入可写但发送暂缓；消息区出现审批/询问卡 | ↑ 禁用 | "等待你的确认" + 计数 |
| queued | 输入可写；"排队 2 条"小行 | ■ 停止 | 队列数 |
| dead/interrupted | 错误行 + 重试 | 重试 | 错误码/原因（可折叠） |

文案遵循 i18n 键表；不允许出现"ACP 不可用"这种实现词。

### 9.3 模型 / 档位 / 策略

- footer 的 `模型 · 档位` 是一个菜单（两级：provider → model），数据来自 `configOptions.model`；
  不可用原因来自握手/配置（无凭证、无模型）而不是空列表。
- 档位菜单来自 `configOptions.thought_level`；模型切换后档位列表可能变化，菜单立即刷新。
- 策略（审批模式）放在 `⋯` 菜单的"权限"小节；当前值以文字显示（不只用图标）。
- 会话中切换立即 `set_config_option`；若正在 streaming，菜单项标注"下一轮生效"（实际以 distro 为准，
  客户端在 `config_option_update` 前显示 pending 态）。
- Hero 的预选仍是同一套视觉，但语义是"新会话初始配置"。

### 9.4 斜杆命令

- 输入 `/` 弹出候选：`availableCommands` + 客户端本地命令（`/new`、`/clear`、`/resume`），
  本地命令带"本地"小标记。
- 每条显示 name + 一句 description；没有静态"不支持"清单。
- Enter 对 `/` 草稿执行：本地命令走本地；其余按原文 `prompt`（distro 分派）。
- 命令表更新（扩展热加载）时若候选打开，列表就地更新，不关闭输入。

### 9.5 审批卡（request_permission）

消息区内联卡（不是模态）：

```
┌──────────────────────────────────────────────┐
│ ⚠ 需要批准 · 运行命令                         │
│ bash: rm -rf build && make                    │
│ 风险：删除/覆盖文件 · 工作区 /Users/…/proj    │
│ [允许一次]  [始终允许]  [拒绝]     Esc=拒绝   │
└──────────────────────────────────────────────┘
```

- 主操作"允许一次"；"始终允许"按工具/类别记在本 session；拒绝返回 block reason，转录留一行。
- 多个请求排队：卡片显示"1/2"，处理完自动下一个；页签与容器行显示圆点。
- 快捷键：`⏎` 允许一次、`⌘⏎` 始终允许、`Esc` 拒绝；焦点在卡片内才生效，不劫持全局。
- 审批期间 composer 的发送暂缓，但输入不丢；其他 sheet 不受影响。
- 窗口不在前台：系统通知"需要批准"（按 sheet id 去重/替换），点击回到该 sheet。

### 9.6 elicitation 对话框

扩展的 confirm/select/input/editor 用应用内 `Dialog`（DESIGN 的对话框样式）：

- confirm：标题 + 说明 + 取消/确认（destructive 用 destructive 色）。
- select：列表/菜单，支持键盘。
- input/editor：单行/多行；editor 用等宽、可滚动；不提供富文本。
- 取消 = `decline`；关闭窗口/切换容器不自动批准；session cancel 时对话框关闭并回 `cancelled`。
- 表单校验错误就地显示，不关闭对话框。

### 9.7 通知与状态

- turn settle（`state` 回 idle）→ 现有通知；不重复。
- 待审批/询问且窗口不在前台 → 一条"需要你的批准"，id 用 sheet id；批准/拒绝后关闭。
- 容器行/页签：`waiting_user` 一个圆点，`interrupted` 一个警示。
- 状态条不显示进程数量（用户不关心），但"正在恢复会话"在 composer 顶部一行。

### 9.8 子代理名册

- 现有 `subagents` sheet 保留：live/settled、只读转录、abort。
- 入口：captain 的工具卡（dispatch 工具）与 `⋯` 菜单；不再依赖"agent 事件自动打开"的旧路径。
- 运行中：状态点 + 已运行时长；settle：结果摘要 + 打开转录。
- 容器归档前若有 live run，确认框说明会被中断。

### 9.9 错误与恢复的文案分级

| 场景 | 展示 |
|---|---|
| turn 失败（模型/工具错误） | 转录内 error 行，带 code（如 `provider_auth`），可重试 |
| 进程崩溃（turn 中） | "会话意外中断" + "恢复会话"；不自动重放该 turn |
| resume 失败 | "无法恢复会话" + 路径/原因；可"新开会话"（同 cwd） |
| 权限被拒 | 工具卡 failed/blocked + reason；不是全局错误 |
| 配置失败 | 菜单项回退 + 一行说明，不静默 |
| 慢客户端背压 | 等待写完成，不丢 update；不打扰用户 |

## 10. 错误、恢复与可观测

- **错误码**：distro 的 coded error 沿用 `data.code`；客户端分类：`transport` / `session` / `config` /
  `permission` / `provider`。UI 不展示原始 JSON。
- **恢复策略**：进程崩溃 → 标记中断；下一次用户动作 resume；resume 失败一次后停，显示可操作错误。
- **重试**：不自动重试 turn（避免重复工具副作用）；只允许用户显式"重试"。
- **指标（本地，仅诊断）**：进程数、每进程 RSS、cold spawn 与 warm first-token、resume 次数/失败、
  权限等待时长。写在状态/日志，不上报；不触发驱逐或回收。
- **日志**：stderr 尾部随错误；扩展 no-op 降级必须有一条可见 notice。

## 11. 测试与验收

### 11.1 分层测试

| 层 | 覆盖 |
|---|---|
| 协议 conformance | stub client 逐一调用 new/resume/list/close/set_config/set_mode/prompt/cancel；校验 update/config/usage/commands/permission/elicitation 的形状 |
| distro 单元 | model/thought 选项生成；命令分派；权限策略矩阵；tool_call 阻断；UI bridge 映射；错误码 |
| host 单元 | 单飞 ensure、状态机、sheet 关闭→结束、崩溃→resume、退出收尾、背压 |
| 客户端 UI | composer 状态、审批卡、对话框、命令候选、错误/恢复文案（fixtures 用 stub agent） |
| 产品 E2E | 真实模型：模型切换、档位、`/compact`、审批放行/拒绝、扩展 confirm/select/input、子代理、重启恢复、SIGKILL 后 resume（脚本 `pi-harness/scripts/acp-live-acceptance.ts`） |
| 性能 | 冷启动/resume 首 token/同会话第二轮首 token/RSS 记录（只测不设限） |

### 11.2 验收清单

代码级（hermetic）已覆盖：

- [x] 同一会话连续多轮不换进程（`app/acp.test.ts`）。
- [x] `set_config_option`/`set_mode` 到达 distro 并回传新状态（`pi-harness` + `app/acp.test.ts`）。
- [x] 服务端→客户端 `session/request_permission`、`elicitation/create` 往返。
- [x] `session/resume` 不重放历史；`session/close` 释放会话。
- [x] `available_commands_update` 在 new/load/resume 的响应前到达，客户端取到命令表。
- [x] 扩展 confirm/select/input/editor → elicitation；custom/widget 有 warning notice。
- [x] 子代理 `_zu/subagents/{list,transcript,dispatch,abort}` 方法面；settled 索引落盘。
- [x] kill/崩溃把 session 标死；下一次用户动作走 resume（host 的 `ensureAcpSession`）。
- [x] grep 门禁：无 `ZU_PI_MODEL`、`acpModelsUnavailable`、静态 unsupported 斜杆表、no-op `uiContext`。
- [x] 文档：PROTOCOL 的缺席清单标记被取代；plan 的 A–F 关闭。

真机 live（2026-11-13，`bun run scripts/acp-live-acceptance.ts`；记录见
[evidence/pi-acp-live-2026-11-13.md](evidence/pi-acp-live-2026-11-13.md)）：

- [x] 官方配置：`settings.json` 的 `defaultTools:["+codemode"]` 生效，`codemode` 工具真实调用并返回 42。
- [x] ACP MCP：`session/new.mcpServers` 注册的 `echo` 服务器被 MCP 扩展连接，模型真实调用 `mcp__fixture__echo`。
- [x] 会话内切模型/档位：`deepseek-flash` → `deepseek-v4-pro` + `high`，下一轮 `end_turn`。
- [x] resume 后保留：新进程 resume 同一 session，模型与档位都在，首 token 207 ms。
- [x] `/compact`：compaction 完成，context 153,667 → 48,324（4 条大消息；单条巨大消息无法切分）。
- [x] 审批放行/拒绝：真实 `bash` 调用；允许的文件存在，拒绝的文件不存在，两轮都 `end_turn`。
- [x] 扩展 UI：confirm（接受/拒绝）、select、input 的真实答案都回到扩展。
- [x] 子代理：真实模型 `scout` settle（7 行转录）；`worker` abort 被接受；重启后 captain resume 仍能读同一 run 与转录。
- [x] 项目信任：resolver 的单测 + `app/trust.ui.test.tsx` 验证会话存在前的对话框与接受/拒绝回答。
- [x] kill 进程：`LIVE_CRASH_ONLY=1` 下 SIGKILL 中途 turn 拒绝，同 session resume 后回答。
- [x] 进程收尾：`session/close` + stdin EOF 后无 `pi-acp` 残留；容器归档/退出 app 调用同一组
  `closeContainerSessions`/`closeAllSessions`（GUI 菜单未手动驱动）。
- [x] 性能记录（不设限）：冷启动 1,367 ms、首个 token 1,944 ms、resume 首 token 725 ms、RSS 168.7 MB。

## 12. 实施工作包与顺序

| 包 | 内容 | 依赖 | 规模 |
|---|---|---|---|
| **A0 会话运行时** | `AcpHost`、一会话一进程、单飞、状态机、cancel、崩溃/resume、sheet/容器/退出生命周期、观测（无 cap/TTL） | — | L |
| **B0 协议面** | new/resume/close/list、configOptions、set_config/set_mode、usage/info/compaction/commands/config/mode/notice 更新、能力声明 | A0 | M |
| **C0 语义收口** | SessionView 重写；删 env/静态斜杆/`acpModelsUnavailable`/旧 transport；命令分派器；context/标题 | B0 | M |
| **D0 权限/扩展 UI** | permission 扩展 + 策略；request_permission；elicitation；UI bridge；project trust；客户端审批卡/对话框 | B0 | M–L |
| **E0 子代理** | dispatch 扩展恢复；`_zu/subagents/*`；持久索引；名册接线；live run 延长进程生命周期 | A0/B0 | L |
| **F0 收尾** | conformance/进程/产品/live 测试；性能基准；删除死代码；文档销账 | A0–E0 | M |

顺序：**A0 → B0 → C0 与 D0 并行 → E0 → F0**。A0 不改产品行为，只换运行时；B0 起 UI 才出现新能力。
E0 依赖 D0 的 permission（dispatch 本身也可能触发审批）。

### 12.1 删除清单（随迁移）

- `startTurn`/`loadTranscript` 的每轮 spawn 路径（保留 `load` 作为读面兼容）；
- `ZU_PI_MODEL`/`ZU_PI_EFFORT` 与 spawn-env 版的 `applySessionPrefs`（现名 `applySessionConfig`，走 `set_config_option`）；
- `sessionTransport`/`modelTransport` 的 ACP 分支、`acpAliasByPiId`；
- `updateToStoreEvents` 旧 fold（改为直接投影 v1 update）；
- `slash.ts` 静态表与 `acpModelsUnavailable` 文案；
- `uiContext` 的 no-op 实现；
- 子代理的 `transport = null → 不可用` 分支。

### 12.2 兼容

- 会话文件格式不变；已有 `pi` 会话可直接 `resume`。
- 旧布局/旧 sheet id 不变；session id 稳定后不再需要 alias。
- 分阶段可回退：A0/B0 用一个环境开关把 host 切回每轮路径，直到 C0 删除旧路径；开关只在开发期存在。

## 13. 风险与非目标

| 风险 | 处理 |
|---|---|
| 进程内存/数量 | **不设上限**（按裁决）：进程数随打开的会话增长，内存由 OS/Pi 压缩管理；只记录 RSS 作为诊断，必要时再讨论容器级复用 |
| 崩溃域 = 会话 | 从会话文件 resume；明确中断，不自动重放 |
| 权限等待挂死 | cancel/归档/退出都结算 pending；UI 不阻塞整壳 |
| 慢客户端背压 | 顺序泵等待写完成；不丢 update、不无界排队 |
| 扩展行为不可控 | 进程隔离；no-op 必须可见；stderr 尾部 |
| stable v1 的边界 | 缺 state_update/status；用 prompt 生命周期 + notice 表达；v2 条件见 §4.6 |

**非目标（本设计不做）**：
- ACP v2 迁移；
- `pi-ahp` / 让 Pi 说 AHP；
- 容器级多 session 复用（第一版）；
- 运行中 steering（先保留排队车道，标准位没有）；
- 终端/文件客户端能力（pi 自己执行工具，不需要 host 代劳）；
- 扩展的自定义 widget/footer/header（明确降级）。

## 14. 与 AHP / manox 的关系

- AHP 是 manox 的 journal/reducer 宿主协议，不是 ACP 的生态替代；Pi 侧不实现 `pi-ahp`。
- 统一发生在 sheet 模块层：Pi 走 ACP，manox 走 AHP，壳与容器模型不感知协议。
- 若未来只保留一个协议，方向是给 manox 加 ACP facade，而不是把 Pi 翻译成 AHP（理由见 §1 与
  pi-acp-PROTOCOL 的历史评审）。

## 15. 文档关系

| 文档 | 角色 |
|---|---|
| 本文 | Pi × ACP 的**目标实现与 UI/UX**；实施依据 |
| [pi-acp-PROTOCOL.md](pi-acp-PROTOCOL.md) | ACP 协议映射、P0–P4 历史裁决、被否决方向；不再承载未来计划 |
| [architecture.md](architecture.md) | 当前系统形态；§3.2/§4.5/§5.6 指向本文 |
| [sheet-module-ARCHITECTURE.md](sheet-module-ARCHITECTURE.md) | 模块/能力域边界；Pi 是其中一个模块 |
| [DESIGN.md](DESIGN.md) | 视觉 token 与外壳；Pi 面的交互以本文 §9 为准 |
| [plan.md](plan.md) | 执行计划；本文审查通过后，A0–F0 进入批次表 |
| [decisions.md](decisions.md) | 裁决台账；本文的 D1–D7 在批准后登记 |

## 16. 官方配置 parity（G0–G4，2026-11-13）

**根因**：官方 `pi` CLI 在 `main.js` 里把 `llama.cpp`、`codemode`、`tool-search`、`mcp` 作为
built-in 扩展交给 `DefaultResourceLoader`，并用 `createAgentSessionServices` 装配 settings / trust /
model runtime。`pi-harness` 是 SDK 嵌入，原来只注册了权限门和 dispatch，于是
`defaultTools: ["+codemode"]` 没有可激活的扩展，`mcp.json` 也没有消费者。

### 16.1 装配路径

- `pi-harness/src/pi/official.ts` 用公开 factory 复刻 CLI builtin：
  `codemode`、`tool-search`、`mcp`，每项 `{ replaceable: true, builtin: true }`；
  `builtin:true` 保留 `-builtin:<name>`、`--no-extensions`、包替换与 trust 顺序。
- `pi-harness/src/pi/services.ts` 使用 `createAgentSessionServices`（而不是手拼 loader）：
  `SettingsManager` → loader（含 trust resolver）→ extension provider 注册 → model refresh；
  `createAgentSessionFromServices` 创建会话。进程级 `ModelRuntime` 共用一份（auth/models 路径对齐 CLI）。
- `defaultTools`、`packages`、`skills`、`prompts`、`enabledModels` 都由 settings/loader 消费；
  `ACP_NO_EXTENSIONS`/`ACP_EXTRA_EXTENSION_PATHS` 语义不变。
- 子代理也用同一 `createPiServices`（`noExtensions:true` 禁 dispatch，沿用 captain 的 trust/agentDir/
  ModelRuntime），保留独立 session 目录与隔离上下文。

### 16.2 项目信任

- `trust.ts` 按 CLI 优先级：无 trust 资源 → store/true；**pre-trust 扩展的 `project_trust`
  处理器**（首个 yes/no 胜出，可 remember 进 store）；store 有决定 → 用之；
  `defaultProjectTrust` 的 always/never/ask；ask 且无 UI → untrusted。
  `emitProjectTrustEvent` 本身未从 SDK 根导出，但 `LoadExtensionsResult` 的 handler map 与
  `ProjectTrustHandler` 类型是公开的，语义在 distro 内复刻。handler 以 headless context 执行
  （`hasUI:false`）；需要 UI 的 handler 返回 `undecided`，由下面的 ACP 对话框兜底。
- ask 时由 `createAgentSessionServices` 的 `resourceLoaderReloadOptions.resolveProjectTrust` 调用
  `elicitation/create`；这发生在 `session/new` 尚未返回时，客户端在 `host.ts` 安装**会话创建期**
  request handler，把问题交给 app root 的 `TrustDialog`。
- 接受后写 `~/.pi/agent/trust.json`（官方 store，CLI 也认）；拒绝只影响本次，不写 false。

### 16.3 MCP

- `mcp.json` 由 `createMcpExtension()` builtin 消费（global + trusted project，官方优先级）。
- ACP `session/new`/`session/load` 的 `mcpServers` 经 `mcp.ts` 映射后注册：
  stdio env 数组转对象；http 直通；sse 以 http 连接并记录；ACP 服务器用 `exposure:"direct"`，
  同名时 `mcp.json` 优先。
- 服务端在 `bindExtensions` 的 `session_start` 连接；首个 direct 工具请求最多等 10 秒。

### 16.4 防漂移

- `official.test.ts` 读取已安装包的 `dist/extensions/index.js`，断言
  `llama.cpp / codemode / tool-search / mcp` 的名称与顺序；上游新增 builtin 时测试失败，
  提示更新 `official.ts`。
- `services.test.ts` 覆盖 builtin 注册/`-builtin:mcp`、`createPiServices`、本地 package + skill、
  trust 四分支、ACP MCP 映射。
- 已知例外：`llama.cpp` 的 factory 未从 SDK 根导出，本次不纳入；漂移测试显式列出它。
  `project_trust` 事件不是例外：handler 从公开的 `LoadExtensionsResult` 读取并执行。

### 16.5 验证

- live：`bun run acceptance:live` 新增 codemode 调用（返回 42）与 ACP MCP `echo` 工具；
  既有模型/档位/resume/审批/compact/扩展 UI/子代理/崩溃恢复全绿。
- UI：`app/trust.ui.test.tsx` 验证信任对话框在会话存在前出现，接受/拒绝都返回真实答案。
- 漂移/loader/trust/MCP 单测：`bun test src/pi` 全绿。

### 16.6 非目标

- `llama.cpp` builtin（无公开 factory）；
- 主题可视化、`/login`/auth UI、CLI extension flags；
- `PI_SESSION_DIR`/代理/离线等 CLI 专属开关；
- 不引入官方 CLI 作为内层进程。
