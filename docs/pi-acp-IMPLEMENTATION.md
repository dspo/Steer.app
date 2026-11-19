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
4. **配置只有一个写面**：`set_config_option`；起始页不预选（Q116），进入会话页后的所有切换都走同一方法。
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
- `set_config_option` 对未知 id 回 `-32602`；`thought_level` 的值不在模型档位表内时**不报错**，
  交给 pi 的 clamp（`setThinkingLevel` 自己钳到最近可用档，issue #54）。
- 每个 model option 的 `_meta` 带 `{ contextWindow, providerName, authSource, authLabel }`
  （issue #54，ACP `SessionConfigSelectOption._meta` 自由槽）：菜单的 provider 行回答
  "这个 provider 凭什么列出来"（`authSource` 是 pi 的来源词：stored / environment /
  runtime / models_json_key / models_json_command / fallback，未配置为 `none`），model 行
  显示 context window——不再需要第二个模型目录进程。
- 配置在会话/转录里持久；resume 后恢复。
- 起始页不预选模型/档位（Q116）：新会话使用机器默认配置，进入会话页后以 `configOptions` 为准，
  切换一律走 `set_config_option`。Pi 的模型列表只有 `configOptions` 一个来源（native `PiModels`
  已随 Q116 删除）。manox 目前也以内核默认为起点（#55 恢复会话页的宿主目录与 picker）。

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

工具结果的 `details` 走 `_meta.zu.details`（ACP 的 `_meta` 扩展位）：harness 只在 **end** 更新上携带
（plain JSON、64 KiB 上限，超限整丢弃不截断），客户端折进工具行，`app/modules/pi/tool-cards.ts`
按工具名分发卡片，缺省回落紧凑行。**工具 details 只在直播 turn 可见；`session/load` 回放降级为文本**
（pi 不持久化 details），卡片渲染必须容忍 `details === undefined`。

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
- 调度与投递见 §21：每 captain FIFO 四并发（五号起 `queued`）、`max_turns` turn cap、
  settle 后 push-once，以及按 lineage 找回转录。

### 7.2 数据面

ACP 没有子代理标准位，因此用扩展方法/通知：

| 方法 | 方向 | 语义 |
|---|---|---|
| `_zu/subagents/list` | client→agent | 当前容器的 live + settled runs |
| `_zu/subagents/transcript` | client→agent | 一次 run 的只读转录 |
| `_zu/subagents/dispatch` | client→agent | 手动派发（等价于 captain 的 dispatch 工具） |
| `_zu/subagents/abort` | client→agent | 中止 live run |
| `_zu/subagents/updated` | agent→client | 状态/结算通知 |

- settled 索引落 `~/.steer/subagents/`（跨重启可读）；live 只在进程内。
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

- footer 的模型菜单（两级：provider → model）数据来自 `configOptions.model`；provider 行
  另外显示凭据来源（`_meta.authSource`/`authLabel` 的本话文案），model 行显示 context。
  不可用原因来自握手/配置（无凭证、无模型）而不是空列表。
- 档位是 footer 自己的 chip + 菜单（issue #54），选项来自 `configOptions.thought_level.options`
  ——per-model，`/thinking` 循环同表，不用固定 7 档；模型切换后档位列表可能变化，菜单立即刷新。
- 策略（审批模式）放在 `⋯` 菜单的"权限"小节；当前值以文字显示（不只用图标）。
- 会话中切换立即 `set_config_option`；若正在 streaming，菜单项标注"下一轮生效"（实际以 distro 为准，
  客户端在 `config_option_update` 前显示 pending 态）。
- 会话进程被释放（关标签/归档容器）后，重开、打开菜单、换模型/档位都先 resume 再动作；
  resume 失败落在 composer/chat 的错误行与菜单的错误行上，不静默（issue #54）。
- 起始页不预选（Q116）；新会话使用机器默认配置，模型/档位只在会话页切换。

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

## 10.5 转录事实与已知缺口（issue #20，T1）

数据补齐（[PROTOCOL §5.2.1](pi-acp-PROTOCOL.md)）已落地：`_meta.pi`（at/model/entryId/settled/durationMs/stopReason/error）、user_entry_chunks、settle marker、`_meta.zu`（durationMs/exitCode/truncation）、`_zu/session_banner`、replay 同词（时间戳/模型/stopReason/error + 每条 assistant 的 settle + edit diff 重放）。客户端 `app/modules/pi/transcript.ts` 是纯 reducer，live 与 replay 同路径；`SessionView.transcript` 取代 `messages`，更新按 16ms 批量 reduce；乐观用户行 `pending:<seq>` 按 entryId 就地换键。

修复（2026-11-18）：**live 消息的 entry id 改从 `message_end` 后回读 branch 取**。pi 1.5.0 只在 `message_end` 持久化普通消息，`entry_appended` 仅覆盖 custom entry / boundary draft——旧实现把 user chunk 与 settle marker 都挂在 `entry_appended` 上，于是 live turn 既不送用户消息、也不送 settle：用户行永远停在乐观行（换不上 entryId），最后一条回复在下一轮首个 delta 之前一直是 draft。后者会让「用户读完回答再追问」这一最常见的输入落进 `entries` 末尾，而 draft 渲染在其后——追问行因此被排到它所回复的那条回答**上方**（issue 症状：会话中间某条 user message 看起来没渲染）。现在 user chunk 与 settle 都按落盘前的 branch 长度回读 entry；reducer 同步补两条：flush/settle 的新行插在尾部的乐观行之前（`appendAt`），乐观行按文本在尾部任意位置换键。同日 follow-up：换键对重复帧幂等（同 id 同文一律 no-op，无论该行在末尾还是中部）；pi 在落盘前展开 `/` 输入（已知技能 → `<skill …>` 块、模板 → 正文），entry 文本与乐观行原文不同——同文匹配落空且尾部仍有乐观行时，最老的一条就地换键并采纳 entry 权威文本（live 不再出现第二行，replay 同形）。

目视修正（2026-11-16）：同一消息的 thought delta 在 draft 上累加（曾只留最后一个 delta）；`TranscriptState.activeId` 让被工具卡 flush 的回复在 settle marker（pi entry id）到达时换 key 并 settle，不再新增空行；页脚 `waitingForWords` 在非 streaming 时不再画 caret；复制/打开动作改为 icon-only（`copy`/`file` 线图标 + tooltip），文字只留在无障碍名里。

**已知缺口（登记，不阻塞）：**

- **回放没有工具统计**：pi 不持久化工具 `details`，`_meta.zu` 只在 live 的结束帧存在；重开的转录里工具卡无 duration/exit/截断入口，UI 缺省不画。
- **回放 settle 无 durationMs**：replay 的 settle marker 不造 duration（pi 文件里没有该事实），折叠行只写 `思考` 不带时长。
- **`getPrompts()/getThemes()` 的 diagnostics 进 banner**（标 source），若真机噪声大再收窄到 skill/extension。
- **头less 宿主对虚拟化 List 里的小按压目标命中不稳定**：复制闪光与展开的 press 断言只覆盖大命中区（折叠头/卡头）；小图标按钮（复制/打开）的交互需真机确认（[evidence/transcript-tui.md](evidence/transcript-tui.md)）。

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

- [x] 同一会话连续多轮不换进程（`app/tests/acp.test.ts`）。
- [x] `set_config_option`/`set_mode` 到达 distro 并回传新状态（`pi-harness` + `app/tests/acp.test.ts`）。
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
- [x] 项目信任：resolver 的单测 + `app/tests/trust.ui.test.tsx` 验证会话存在前的对话框与接受/拒绝回答。
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
- UI：`app/tests/trust.ui.test.tsx` 验证信任对话框在会话存在前出现，接受/拒绝都返回真实答案。
- 漂移/loader/trust/MCP 单测：`bun test src/pi` 全绿。

### 16.6 非目标

- `llama.cpp` builtin（无公开 factory）；
- 主题可视化、`/login`/auth UI、CLI extension flags；
- `PI_SESSION_DIR`/代理/离线等 CLI 专属开关；
- 不引入官方 CLI 作为内层进程。

## 17. Prompt sections（B5，2026-11-16）

**根因**：captain 没有规则通道。要给 captain 加规则（dispatch 用法、后续的 artifacts/todos），
最直觉的写法是 `before_agent_start` 返回 `systemPrompt`——那会强制整段 prompt 重算，
provider 的 prefix cache 每轮全失效。pi 的命名 section 机制只 diff 一段，是唯一的正确入口。

### 17.1 机制

- `pi-harness/src/extensions/prompt-section.ts` 导出工厂
  `promptSectionExtension(section, text, log?)`：handler 在 `before_agent_start` 里把
  `text` 写进 `event.systemPromptOptions.sections[section]`，然后**返回 undefined**。
- pi 对 sections 逐个与 transcript 的 system message diff，写一段只发一段的 patch，
prompt 其余部分（含 provider prefix cache）不动。
- 两条铁律，都在文件头注释里：
  1. `text` 必须是调用方的模块级常量，工厂内不做任何插值（cwd/时间/会话状态都不行）——
     规则文本每一轮请求都随行，任何变化都会打破 provider cache；
  2. handler 绝不返回 `systemPrompt`：返回值类型允许整段替换，但那会丢弃所有命名 section
     （包括自己的），并强制全量 prompt 重渲染。
- section 名全局唯一，约定 `zu-<concern>`：本 issue 消费 `zu-dispatch`；
  `zu-artifacts`（A4）、`zu-todos`（A2）预留，各自一行即可接入，不再碰 `pi-session.ts` 的机制。
- 同名重复注册：后写覆盖，log 一行，不抛错（resource reload 可能重跑 factory）；
  同文本重复（纯 reload）静默。

### 17.2 装配

- `pi-session.ts` 把 captain 的 factory 列表抽成 `hostExtensionFactories(gate, subagentManager,
  captainId, log)`，顺序固定并写在注释里：权限门（必须最先看到每个 tool call）→
  prompt section（无状态）→ dispatch（注册 `dispatch` 工具）。
- captain 会话默认带 `zu-dispatch` 一条短规则（英文，与 pi 的 system prompt 语言一致）：
  一个 `read` 能回答的问题不是委派；真的要 dispatch 时，给子代理完整任务上下文而不是指针。
- 测试锁语义：`prompt-section.test.ts`（假 ExtensionAPI：写段、返回 undefined、两次调用
  字符串恒等、sections-only 事件对象上不给 `systemPrompt` 赋值、覆盖/重载/无 sections 分支），
  `app.test.ts` 断言 `hostExtensionFactories` 长度为 3 且中位 factory 产出
  `zu-dispatch` section——不起真会话。

### 17.3 与子代理 `appendSystemPrompt` 的区别

- 子代理的 `appendSystemPrompt`（`subagents.ts`，定义正文）是子代理**自己的**系统提示，
随 spawn 一次性传入，无 cache 压力问题；captain 的规则属于 captain 的长活会话，
每一轮请求都随行，所以才需要 byte-stable section。
- 本 issue 不给子代理加 sections：子代理没有 captain 的规则需求；机制上也不需要。

### 17.4 非目标

- section 的动态内容（live list、时间、cwd 插值）——违背 byte-stability，永远不做；
- 按会话开关 section（开关属于 B3 的 registry）；
- 把规则藏进 tool description（那是另一层，职责不同）；
- 升级 pi 版本。

## 18. 内置扩展 registry（B3，2026-11-16）

**根因**：内置扩展原来是 `PiHarnessSession.build` 里两个匿名工厂（权限门 + dispatch）：
没有名字、没有开关、没有技能归属。A1–A4 要加 4–5 个内置工具包，每个都需要一个身份，
否则「关掉 todos 扩展」无法同时关掉它的规则、工具与技能。

### 18.1 描述符与合成

- `pi-harness/src/extensions/registry.ts`：
  - `ZuExtension { name, factory(settings), skillDirs?, defaultEnabled? }`；
    `name` 就是 `disabledExtensions` 的键，也是 `skills/<name>` 的目录名，永久稳定。
  - `composeExtensions(registry, settings) → { factories, skillDirs }`：
    逐个判启用、每个 factory 每次合成只构建一次（reload 时重新合成，所以设置变化
    在下一次 `session/new|load` 生效）、同名 `name` 直接抛错（编译期常量里的重复是 bug），
    `skillDirs` 只取启用项、按 registry 顺序去重。
  - factory 以具名 inline 形式交给 pi：`{ name: "zu:<name>", factory }`，
    在扩展列表与冲突诊断里显示为 `<inline:zu:<name>>`。
  - `ZU_EXTENSIONS` 本 issue **为空**：机制用 fixture 测。第一个真实条目由 A2 落地
    （`todos`，见 §23）；因为 store 按会话组织，条目和 A1 的 ask 一样在 build 时合成进
    `composeExtensions([...ZU_EXTENSIONS, askExtensionEntry(...), todosExtensionEntry(...)])`，
    静态数组仍为空。
- 启用判定：`disabledExtensions` 命中即跳过；`defaultEnabled: false` 当前也是跳过
  （v1 只实现 disable，opt-in 列表是后续 issue，不是一个漏掉的分支）。
- 永远在线的权限门、prompt section、dispatch 不进 registry：它们是会话机制，
  不是用户可关的能力；仍在 `hostExtensionFactories` 里。

### 18.2 设置读取

- `pi-harness/src/settings.ts`：`readZuSettings(agentDir)` 只读
  `join(agentDir, "..", "zu", "settings.json")`，与子代理存储共用
  `zuStateDir(agentDir)`（`subagents.ts` 也改为同一个推导）。
- app 是唯一写者；harness 只认 `disabledExtensions` 的字符串数组。
  文件缺失 / 坏 JSON / 顶层非对象 / 字段非数组 → 视为「没有禁用任何扩展」，绝不抛错；
  其余键留在 `raw` 里，给后续扩展读自己的设置。
- 不做热重载：设置变化在下一次 session build 生效（与 ACP `session/new|load` 同拍）。

### 18.3 同名工具优先级（现场验证的结论）

pi 1.5.0 的真实语义，用探针（现固化为 `extensions/precedence.test.ts`）核过：

1. **首注册胜**：`ExtensionRunner.getAllRegisteredTools` 按扩展顺序遇到同名工具时保留第一个；
   两个 inline 工厂 A、B 注册同一 `probeTool`，`[A,B]` 得到 A，`[B,A]` 得到 B。
2. **file 扩展先于 inline**：resource loader 永远把 inline factory 追加在
   `~/.pi` / 项目里的扩展文件之后。所以不干预时，用户装一个同名 `dispatch` 的包会顶掉宿主的。

结论：光调 `extensionFactories` 数组顺序不够（它们本来就在最后），
`createPiServices` 用 `DefaultResourceLoaderOptions.extensionsOverride` 把
inline（宿主）扩展整体前移，保持相对顺序（`hostExtensionsFirst`）。
测试用真包 + 真 session 锁住：`builtins win over user extensions (first registration wins,
host inline loads first)`，并断言 inline 扩展在包之前。

`extensionsOverride` 只改顺序；冲突仍由 pi 记为 diagnostic（`Tool "x" conflicts with ...`），
不会被吞掉。registry 用具名 `zu:<name>`，所以诊断里能看出是谁顶了谁。

### 18.4 技能布局

- 源码：`pi-harness/skills/<extension>/SKILL.md`；本 issue 只提交
  `skills/README.md`（布局说明，pi 不把它当技能），第一个真实技能归 A2。
- `skillsBase()`：编译产物看 `dirname(process.execPath)/skills`
  （`Contents/Helpers/pi-acp` → `Contents/Helpers/skills`），源码运行回落到
  `pi-harness/src/extensions/../../skills`（即 `pi-harness/skills`）。
  扩展的 `skillDirs` 在模块加载时用 `bundledSkillDir(name)` 算出绝对路径，
  不在 factory 里算（避免 cwd 影响）。
- `bun run bundle`（`script/tasks.ts` 的 `bundle()`，打包入口自 #21 从 sh 脚本收进 bun）
  复制 `pi-harness/skills` 到 `Contents/Helpers/skills`，并对照源树逐个断言每个
  `SKILL.md` 都在包里——列表从源码派生，A2 加技能不需要改脚本。
- 技能名在 pi 里是全局共享的（用户 `~/.pi`、`~/.agents/skills` 先加载），
  同名会被记为 collision diagnostic；本 issue 不抢占用户技能名。

### 18.5 装配

- `pi-session.ts` 的 `build`：`readZuSettings` → `composeExtensions` →
  `extensionFactories: [...hostExtensionFactories(...), ...composed.factories]`，
  `additionalSkillPaths: composed.skillDirs`。
- `pi/services.ts`：新增 `additionalSkillPaths` 透传与 `hostExtensionsFirst`
  （见 §18.3）。子代理仍走 `noExtensions: true`，不加载 registry 扩展；
  内置工具包属于 captain 的宿主 UI。

### 18.6 测试与门禁

- `registry.test.ts`：空 registry、启用/禁用、`defaultEnabled: false`、重复名抛错、
  技能归属/去重/顺序、`skillsBase` 源码布局；最后一块用真 loader 断言
  禁用后技能不进 `resourceLoader.getSkills()`（断言包含关系——pi 还会发现开发机的
  `~/.agents/skills`）。
- `settings.test.ts`：缺失、坏 JSON、顶层非对象、字段非数组、正常数组、raw 透传。
- `precedence.test.ts`：§18.3 的两个结论，真 loader + 真 session。
- 门禁：`(cd pi-harness && bun test)`、`bun run build`、`bun run bundle`（macOS）。

### 18.7 非目标

- Settings UI 的开关控件（只认文件里的 `disabledExtensions`）；
- 热重载；用户扩展（`~/.pi` 包）的开关；
- `preferRegistryTools` 的完整实现（只保证内置工具优先，冲突仍如实报告）；
- 技能内容（A2 提供第一个 `SKILL.md`）。

## 19. Artifacts 守卫（A4，2026-11-16）

**根因**：会话是持久资产（`~/.pi/agent/sessions/`），产出物不是——模型把报告/图表/mockup
写到 `/tmp`，被系统清理后无处可寻。A4 只做两件小事：一条 prompt 规则告诉模型产出物写哪里，
一个 `write` 工具守卫拦截在系统临时目录新建文件。不做索引、不做恢复、不做面板
（完整 Artifacts 属于 C 档后置 issue）。

### 19.1 目录约定

- 产出物目录：`<cwd>/.zu/artifacts/`（`artifactsDir(cwd)`；常量
  `ARTIFACTS_DIRNAME = ".zu"`、`ARTIFACTS_SUBDIR = "artifacts"`）。
- 自忽略：首次允许写入时由 `ensureArtifactsDir(cwd)` 创建目录，并写
  `.zu/.gitignore` 与 `.zu/artifacts/.gitignore`（内容均为 `*\n`，双保险），
  整棵树不进 git，不碰项目自己的 `.gitignore`；已存在的 `.gitignore` 永不覆盖。
- 不在 session 启动时创建：只读仓库/用户项目零副作用；目录只在第一次允许写入时出现。
- 它是工作区侧的目录，写者只有 harness 守卫；UI 只读（见 `docs/architecture.md` §3.6）。

### 19.2 规则 section 与临时路径判定

- `promptSectionExtension("zu-artifacts", ARTIFACTS_RULE)`（复用 §17 机制，一行接入）：
  产出物写 `.zu/artifacts/`、不要在 /tmp 新建文件、移出目录是用户的事。
- `pi-harness/src/extensions/artifacts.ts` 的纯函数
  `temporaryWriteTarget(input, { cwd, env, home }) → string | null`：
  1. 取 `input` 第一个字符串字段（pi 1.5.0 的 write schema 是 `path`；`file_path` 容忍为别名）；
  2. `~`/`~/` 展开为 home，相对路径 resolve 到 cwd；
  3. 已存在 → null（编辑已有临时文件不拦）；目标在 `artifactsDir(cwd)` 下 → null
     （工作区优先，即使 cwd 本身在临时目录里）；
  4. 候选根：`os.tmpdir()`、`/tmp`、`/var/tmp`、`env.TMPDIR/TEMP/TMP`（resolve 后去重），
     且每个存在于磁盘的根同时收它的 `realpathSync()`（macOS 上 `/tmp → /private/tmp`，
     规范拼写与词法拼写都必须命中；不存在的根只留词法形式），
     目标等于根或以 `根 + sep` 开头即命中；
  5. 符号链接规避：父目录存在时 `realpathSync(parent)` 后再判一次，命中返回真实路径；
     父目录不存在按字面路径判。

### 19.3 守卫与装配

- `artifactsExtension(log)` 注册一个 `tool_call` handler（只认 `write`；`edit` 只改
  已存在文件，不需要拦）：命中时返回 `{ block: true, reason }`，reason 给出
  `<cwd>/.zu/artifacts/` 替代路径并 log 一行；不修改参数、不重试、不搬文件，模型自己改路径。
- 允许放行的写入若落在 `.zu/artifacts/` 下，先 `ensureArtifactsDir(cwd)`（幂等，唯一副作用）。
- 装配在 `hostExtensionFactories`：权限门 → `zu-dispatch` section → `zu-artifacts` section →
  artifacts 守卫 → dispatch。守卫与权限门是两个独立的 `tool_call` handler，都会跑；
  read-only 模式下 `write` 先被门拦住，守卫不再触发。
- bash 重定向（`> /tmp/x`、`tee /tmp/x`）不在拦截范围：nsh 的能力面不约束 agent 的 bash，
  这类路径靠 prompt 规则覆盖，守卫不假装能拦。

### 19.4 测试与门禁

- `artifacts.test.ts`：纯函数覆盖字面 `/tmp`、`os.tmpdir()`、`env.TMPDIR`、已存在文件、
  工作区路径、`.zu/artifacts/` 优先、`~` 展开、相对路径、符号链接父目录、别名/空输入；
  假 ExtensionAPI 覆盖 block reason、放行、惰性建目录、非 write 工具；
  `ensureArtifactsDir` 幂等且不覆盖已有 `.gitignore`。
- `app.test.ts` 断言装配列表长度为 5：两个 section、守卫各注册所述 handler。
- 门禁：`(cd pi-harness && bun test)`、`bun run build`、`bun run smoke`。

### 19.5 非目标

- Artifacts 索引、kept copies、reconcile、restore/discard、面板（C 档后置）；
- 拦 bash 的临时目录写入；拦已有临时文件的修改；
- 自动搬迁 `/tmp` 里的旧产出物；`.zu/` 在文件树里的隐藏/折叠。

## 20. 交互工具 mailbox（B2，2026-11-16）

**根因**：交互式工具（A1 的 `ask_user_question` 及后来者）会把回合停在「等用户答复」上。
pi 的回合模型没有这个状态：进程一死，`tool_call` 没有配对的 `tool_result`，pi 拒绝续跑；
UI 重启后问题卡片消失；用户等得不耐烦自己打字时，卡住的 waiter 无人收尸。B2 在 harness
侧搭 mailbox（pending ack、重启修复、晚到答案、supersede），A1 只负责注册工具与发问。

### 20.1 词汇与标记（`pi-harness/src/interactions.ts`）

- 文件头注明 clean room：只依据 issue SPEC 与 pi 公开契约，不引用 ThinkRail 私有实现。
- pending ack 的标记是双保险：主标记 `details.kind === "ack"`（`PENDING_ACK_DETAILS`，
  持久进 session 文件、reopen 后投影可读，见 §20.2 探针），文本 fallback
  `PENDING_ACK_TEXT`（精确单 text block）兜底 details 缺失的历史会话。
  `isPendingAck(toolResultMessage)` 只认这两样，不猜别的形状。
  A1 的工具不得在 `describeResponse` 里回显该保留文本（否则用户看到内部标记）。
- 自定义 entry 词汇：`zu.ask`（announce：工具发问，args 即问题结构）、
  `zu.ask.answer`（receipt：答案投递回执，重复投递靠它幂等）、
  `zu.tool-response`（晚到答案的注入通道）。
- `INTERACTIVE_TOOLS: Record<string, InteractiveTool>` 是注册表：B2 先落机制（fixture/stub
  测试覆盖），A1（#12）落地后由 `ask.ts` 的模块副作用注册 `ask_user_question`（见 §22）。
  修复与扫描按注册表工作，空表时是 no-op。
  修复与扫描对空 registry 都是 no-op，主线上零行为变化。
- `InteractiveTool`：`name` + `waiter(answer)`；A1 注册时提供 waiter，答案即回合内解决。

### 20.2 悬空调用修复（重启前）

- `repairDanglingInteractiveCalls(manager, interactive)`：只看 **active tail**（`branchTail()`：
  从尾部跳过 compaction/branch-summary 之前的部分）的**最后一条 assistant 消息**：
  有交互工具调用且无配对 `tool_result` → 补一条 ack `tool_result`（`details.kind:"ack"`），
  让 pi 能继续这个 session，返回补写条数。
- fail-closed：更早的悬空调用不动（不伪造历史）；已被 compaction 摘走的调用不修
  （避免孤儿 tool_result）；registry 空则无事可做。
- 接线在 `pi-session.ts` 的 `build()`：`createAgentSessionFromServices` **之前**跑修复
  ——pi 的 builder 遇到悬空调用会拒绝，修复必须先于它。`create` 路径 `repairTail:false`
  （全新 session 没有历史），`open` 路径 `repairTail:true`（reopen 才有悬空的可能）。
- 探针结论（决定主标记选型）：pi 1.5.0 把 `tool_result` 的 `details` 持久化进 session
  文件，reopen 后 `buildSessionProjection()` 可原样读出——所以 `details.kind:"ack"`
  能活过重启，比文本匹配可靠。

### 20.3 答案路由（AnswerRegistry）

- `AnswerRegistry`：`announce(session, toolCallId, args)` 记 pending；
  `answer(toolCallId, answer)` 分三路——
  - **live**：有 waiter，进程内 resolve，工具调用当回合返回，同样写 `zu.ask.answer` receipt；
  - **late**：无 waiter（进程/回合已死），经 `hooks.inject` → `session.sendCustomMessage({
    customType: "zu.tool-response", content: [答案文本 block], display: true,
    details: { toolCallId, response } }, { triggerTurn: true })`——注入用户可见消息并唤醒
    模型响应答案，同样补 receipt；
  - **none**：既无 waiter 也非 pending（未知 toolCallId），上层报错。
  **回执是 ask 退出 pending 的唯一机制**：`pendingAsksOf` 只认 `zu.ask.answer` receipt
  （ack toolResult 单独不退休 ask），live/supersede/late 三条路都写，重启后已答/已
  跳过的问题不会被重新种卡，重复投递靠 receipt 幂等。
- `pending(toolCallId)` / `supersedeAll()`：pending 集合供 `_zu/ask/pending` 拉取；
  用户直接输入时 `supersedeAll()` 以 `{ action: "supersede" }` 哨兵 resolve 所有 live
  waiter，工具侧见哨兵即答 pending ack，同时给每个被跳过的 ask 写 receipt（否则下次
  open 会把用户已跳过的问题重新种成卡片）。announce entry 保留：历史不改写。
  `prompt()` 开头固定跑 `supersedeAll()`——用户的话优先于悬着的问题。
- **wire 哨兵退休 seeded 卡**：重启后的卡没有 live waiter，用户打字跳过时 app 侧对它
  发 `_zu/ask/answer` 携哨兵；`answer()` 按值识别哨兵（跨 wire 是新 parse 的对象，
  引用相等必失效；真答案的 option/custom/discuss 形状不带 `action`），只写 receipt、
  返回 `late`，不走 `describeResponse`——哨兵不是答案，绝不注入对话。未知 id 或
  receipt 已在（二次退休）分别得 `none` / `late`，不产生多余 receipt。

### 20.4 ACP 面（`app.ts` / `host.ts` / `sessions.ts`）

- harness method：`_zu/ask/pending`（按 sessionId 列 pending，`{ asks: [{ toolCallId,
  args }] }`；无 mailbox 返回 `{asks: []}`）；`_zu/ask/answer`（投递答案；`delivered` 三态
  live/late/none，`none` 时 codedError(invalidParams, "unknown_ask")）。
  两个 method 都在 app.ts 的头部 doc 注释登记。
- app 侧 `AskRequest`/`AskResponse`（`modules/pi/acp/host.ts`）：`SessionHandlers` 加
  **类型预留** `requestAsk?`——B2 不 dispatch（没有真工具可发问），A1 接线时才有发起方。
- UI 状态（`modules/pi/sessions.ts`）：`pendingAsks` signal（key `${sessionId}:
  ${toolCallId}`）。open 后 `seedPendingAsks` 拉 `_zu/ask/pending` 把重启幸存的问题
  重新种成可答卡片（best-effort：旧 harness method_not_found 是诚实结果，静默跳过）；
  卡片无 waiter 走 wire，有 waiter 进程内 resolve；`supersedePendingAsks(key)` 在
  send 前清掉该会话的卡，其中无 resolve 的 seeded 卡记入 `seededSupersedes`，由
  `retireSeededAsks` 在 `ensureAcpSession` **之后**用活 session 投 wire 哨兵退休。
  顺序关键：`runAcpTurn` 先 supersede，再 ensure（`seed:false` 重开、不种卡），退休
  落回执，重开路径再显式 seed 剩余 pending——若在 ensure 之前退休，死进程的哨兵
  发不出去，重开的 seed 会把用户刚打字跳过的问题重新种回；若 ensure 时就 seed，
  同样先于退休复活卡片。reopen 失败才真正无对象可退休（stash 留待下次成功
  ensure）；哨兵投递失败则落回 seed 重现卡片。waiting_user 判定纳入 pendingAsks，
  协议状态随投影同步。

### 20.5 测试与门禁

- `interactions.test.ts`（真实 SessionManager + 临时 sessionDir）：ack 常量/isPendingAck、
  branchTail 跳过 compaction、悬空修复（create 不修/open 修、幂等、fail-closed 不碰
  更早调用）、pendingAsksOf 双条件（ack + announce）、AnswerRegistry live/late/none、
  receipt 幂等、supersede 哨兵。
- `acp/app.test.ts`：`_zu/ask` 两个 method 的 wire 行为（委托/空/unknown_ask 编码错误）。
- `app/tests/ask.test.ts`（stub + 手造 session 文件）：重启 re-seed 卡片与 waiting_user、
  seeded 卡走 `_zu/ask/answer`、live 卡进程内 resolve、send supersede 且不误伤其他
  会话的卡、runner 清理。
- 门禁：`(cd pi-harness && bun run check-version && bun test && bun run build && bun run
  smoke)`、`bun run check`、`ZU_SKIP_LIVE=1 bun run test`。

### 20.6 非目标

- 发问工具本身与 UI 问题卡片的渲染交互（B2 只留 `requestAsk` 类型；A1 已落地，见 §22）；
- 多轮 ask（一次工具调用一问）与 ask 超时/自动降级；
- manox 侧的对等 mailbox（manox 有自己的 AHP 宿主，另行设计）；
- 把 `zu.ask` announce 回放进 transcript 折叠规则（`fold.ts` 本期不动）。

## 21. 子代理织体（B1，2026-11-17）

**根因**：子代理只有"派发 + 轮询"：没有并发上限（一次响应里 N 个 `dispatch` 就是 N 个
完整 LLM 会话）、没有 turn cap（跑飞的 child 可以无限调用工具）、后台 run settle 后
模型看不到（custom entry 不进上下文，`host.emit` 只写 log）；而且定义发现顺序是反的
——`Map.set` 让 project 覆盖 personal/builtin，仓库里的 `.pi/agents/worker.md` 能换掉
内置 worker 的 tools/model/提示词。B1 把六条不变量按 Zu 的形态重写。

### 21.1 定义优先级

- `discoverAgents(cwd, agentDir, projectTrusted, log?)` 改为**先到先得**：
  builtin → personal → project（`.pi/agents`，then `.agents/agents`，仅 trusted）。
  同名后到者不覆盖，`log` 一行写明谁被谁压住。仓库可以**新增**代理，不能替换内置。
- frontmatter 的 `max_turns` 只接受正整数；`0`/字符串/负数一律丢弃（坏文件策略不变，
  不致命）。
- `AgentDefinition.maxTurns` 随定义进入 runner。

### 21.2 限流与 `queued`

- `MAX_CONCURRENT_PER_CAPTAIN = 4`（硬编码；跨 captain 不做全局上限）。
- `spawn`/`resume` 一律先建 run（`status: "queued"`）入队，`pump(captainId)` 按 FIFO
  填空位；真正启动时才改 `running` 并 `emit("subagent.started")`。`LiveRun.started`
  区分"占过 slot"与"还在排队"。
- `abort(queued)`：`settle("aborted", "cancelled before start")`，runner 从未被调用；
  `running` 则走 `session.abort()`（runner 经 `attach(session)` 把 child session 交给
  manager，abort/inject/transcript 都靠它）。
- `archiveCaptain` 先**删队列**再结算，避免 settle → pump 在归档过程中又启动了下一
  个 queued run；`dispose` 清空队列、run 与新 pending。
- `protocol.ts`/`view.tsx`/两个 locale 增加 `queued`（中文"排队中"）；名册计数包含它。

### 21.3 Turn cap

- `createPiSubagentRunner` 在 `session.prompt(task)` 前订阅 child 的 `turn_end`（仅当有 `maxTurns`）：
  数到 `turns === cap` 且 child 仍在跑（最后一条 assistant 有 `toolCall`）→ steer
  `WRAP_UP` **一次**；下一次 `turn_end`（`turns > cap`）→ `session.abort()`，settle
  `aborted`，output 取最后一条 assistant 文本。
- 在 cap 内自然结束 → 保留真实结果，不 abort；没有 `maxTurns` → 不订阅、无 cap。
- 不做 wall-clock 超时（provider 重试归 pi）。

### 21.4 完成投递与 claim

- `DeliveryBinding`（`send(batch, {triggerTurn})` + `isIdle()`）由 `dispatchExtension`
  在 `session_start` 绑定；`send` 走 `pi.sendMessage({ customType:
  "zu.subagent.completion", content: [text], display: true, details: { runs } },
  { triggerTurn })`。pi 1.5.0 的 `convertToLlm` 把 custom message 映射为 user content，
  所以它真正进入模型上下文（不是 `appendCustomEntry` 那种只留档）。
- `settle` 把结果放进 `pendingDelivery`，除非 run 已被 `list_agents`/`wait:true` claim、
  或 abort 原因是 `user`/`archive`/`dispose`（不该唤醒）。
- 投递点：`turn_end`（非 aborted）→ flush 不唤醒；captain 空闲时 settle → 微任务里
  flush 且 `triggerTurn: true`（最多唤醒一次）；`agent_settled` 为 aborted → 只以非
  唤醒方式 flush。
- `flushCompletions`：一次最多 6 条、一条 custom message；先标 `collected`（claim）再
  send；send 失败/抛错把未接受的放回队首。单条 output 上限 50,000 字符，超出截断并
  标注。`collected` 持久进 settled index，重启后不会重投。
- `list_agents` 与 `dispatch(wait:true)` 读取即 claim，且返回文本与 push 一致（push 能
  看到的，pull 也能看到，不会各说各话）。

### 21.5 Lineage 与转录恢复

- 目录仍是 `~/.steer/subagents/<captainId>/`；`deriveSubagentSessionFile` 先认 settled
  index 的 `sessionPath`，丢失时扫同目录 `_<runId>.jsonl` 后缀。
- `transcript`：live 用 child session 的 `state.messages`；settled 用 derive 出的文件；
  两者都失败 → 明确报错"重启后不可恢复"，不返回空列表假装成功（app 的 `selectRun`
  把它显示为错误）。

### 21.6 测试缝与纵深防御

- `SubagentRunner` 把真实 `createAgentSession` 抽成可注入 seam（`createPiSubagentRunner`
  默认实现；tests 用 fake runner 控制 settle/abort/onTurn）。`attach(session)` 让
  manager 拿得到 child session，abort 不再是无对象的空操作。
- `excludeTools: ["dispatch", "list_agents"]` 传给 child 的 `createAgentSession`：
  即使未来 child 加载扩展，递归 dispatch 也在工具层被挡（`noExtensions: true` 之外
  的第二道）。
- 测试：`subagents.test.ts` 覆盖定义优先级（builtin 胜/untrusted 不读 project/坏
  `max_turns`）、5 个 dispatch → 4 running + 1 queued、queued abort 不调 runner、
  running abort 触达 attached session、归档不启动 queued、turn cap 的 steer/abort 与
  自然结束、push-once/claim/send 失败恢复/idle 唤醒/user stop 不投递、lineage 后缀
  恢复、缺文件明确报错、`excludeTools` 构造参数。
- 投递语义有确定性探针：用 pi 的 `convertToLlm` 把 `zu.subagent.completion` custom
  message 映射一次，断言它成为 user content（若 pi 升级改变该语义，测试先红）。
- UI：`app/tests/subagents.ui.test.tsx` 断言 queued 状态与名册计数。

### 21.7 非目标

- 不做 fork/capture、resource owner、DAG；不做跨 captain 全局上限或 admission 配额。
- 不做 live roster 推送（名册仍在打开时加载；需要时另开 issue）。
- 不改 `inject` 的 steer 语义；不做 wall-clock timeout。

## 22. 结构化提问（A1，2026-11-18）

**目标**：模型经 `ask_user_question` 向用户发起 1–4 个结构化问题，答案以稳定 envelope 回到模型。

### 22.1 工具与 schema

- `pi-harness/src/extensions/ask.ts`（注册名 `ask_user_question`，`executionMode: "sequential"`）：
  1–4 题 × 1–4 选项；`header` ≤16、`label` ≤60、`description` ≤400、
  `recommendedReason` ≤160；`multiSelect` 可选（默认 false）。
- 保留标签（`Other` / `Type something.` / `Chat about this` / `Discuss this…` /
  `None of these` / `Next →`）由卡片拥有；`execute` 在 trim + lowercase 后 fail-closed
  拒绝，错误只报题号/选项号，不回显整段 JSON。
- `askExtension(bridge)` 只做「发问 + 等」；等待、晚到、supersede、重启修复全部走 B2 的
  `AnswerRegistry`（§20）。abort signal 故意忽略：用户可能走开，会话关闭由 B2 的悬空修复兜底。
- 门禁：`ask_user_question` 在 `READ_ONLY_TOOLS` 里（提问不改工作区）——`ask` 模式不弹
  审批卡，`read-only` 模式不被当成写操作拦掉。

### 22.2 请求/应答（`_zu/ask/create`）

harness → client 的 JSON-RPC 请求（server→client），`host.ts` 的 `requestAsk` 与
permission/elicitation 同构；无 handler 回 `{action:"cancel"}`。

```ts
type AskAnswer =
  | { kind: "option"; labels: string[]; text?: string }   // 选项 + 可选的补充文字
  | { kind: "custom"; text: string }                       // 只有自由文字
  | { kind: "discuss"; notes: string; labels?: string[] }; // 先聊聊，保留倾向选项
type AskResponse =
  | { action: "accept"; answers: AskAnswer[] }             // 每题一项，按题序
  | { action: "cancel" }
  | { action: "supersede" };
```

- 每题都可以留空：空答案提交为 `{kind:"option", labels: []}`，envelope 渲染 `(no answer)`。
- 选项与补充文字**同发**（文字不覆盖选项）：信封是 `Postgres — additionally: …`；
  discuss 带倾向选项时追加 `Leaning toward: …`。
- `cancel` → “The user dismissed the question. Continue without an answer.”；
  `supersede` → B2 的 pending ack + `terminate: true`。

### 22.3 卡片（`app/modules/pi/ask.tsx`）

- dock 在 composer 上方、`ApprovalCard` 之前；一卡一次工具调用，多题分页
  （`第 n 题，共 m 题`）。
- 单选画圆圈、多选画方框；再次点击已选项取消。每题一个自由输入 +「先聊聊」开关
  （开关是模式：开启后即使 notes 为空也不作答，占位符切到讨论提示）。
- 底部按钮分角固定：上一题/下一题在左下（到头置灰、位置不动）；不答/提交在右下。
  Submit 始终可用。
- 卡片状态按 `toolCallId` 归零（页码与三份草稿）；supersede 不重挂载组件，旧答案不会
  漏进下一次提问。

### 22.4 测试与门禁

- `pi-harness/src/extensions/ask.test.ts`：schema/保留标签/信封（含留空、选项+文字、
  discuss+倾向）/工具结果/cancel/supersede。
- `app/tests/ask.ui.test.tsx`：选项提交、留空提交、取消选择、选项+补充文字、
  discuss 保留倾向、discuss 无 notes、分页与置灰、新问清空、Skip。
- `app/tests/ask.test.ts` / `acp.test.ts`：live ask 经 wire 往返、发送 supersede、
  无 handler → cancelled。
- 门禁：`nsh check app`、`ZU_SKIP_LIVE=1 nsh test .`、`cd pi-harness && bun test`。

### 22.5 非目标

- 选项预览/图片/文件预览/并排对比（A3 之后）；discuss 的 reason 枚举；
  独立「跳过本题」按钮（留空提交与 Skip 已覆盖）；多轮追问协议（模型重新调用即新的一轮）。

## 23. 会话 TODO plan（A2，2026-11-18）

**目标**：给每个 pi 会话一个可持久、双方可写的 TODO plan——agent 用六个 `todo_*` 工具维护，
用户在一个原生面板增删勾选，文件落 `~/.pi/zu/todos/<sessionId>.json`。纪律靠
「工具描述 + 一个技能 + 一条 byte-stable 规则」，**live list 不进 prompt**（会破 provider cache，
也会在用户编辑后过期——这是上游记录过的失败尝试，直接不做）。

### 23.1 数据模型与 store（`pi-harness/src/todos/core.ts`，pi 无关）

- `TodoFile { v: 1, todos[], groups[] }`：`todos` 是 loose lane（工作前的共享草稿），`groups`
  每个 group 是一个用户请求的结果（`g-<base36>`），item 是 `t-<base36>`、状态
  `pending|in_progress|done`、`origin: agent|user`；group 状态派生（all done → done；任一
  in_progress → active），不存。没有 priority。
- 不变量（纯函数里强制，工具层不重复）：全局最多一个 `in_progress`（设第二个，第一个回
  pending）；done 保留在列表；离开 done 时 `summary/verification/commitSubject` 清空
  （同 patch 重述则保留）；title 写入前 `\s+` 压成一个空格；id 由 store 生成（顺序 base36）。
- 所有变更操作返回判别式结果 `{ ok, file } / { ok, reason }`，reason 词表：
  `invalid-op / invalid-id / invalid-status / unknown-id / unknown-group / grouped-step /
  empty-title / title-collision / loose-item`；`TODO_FAILURE_TEXT` 给每条一段英文文案，
  工具错误与 wire 错误共用。
- 读：缺失/坏 JSON/形状不对 → 空计划，绝不抛；写：临时文件 + `rename`，先 `mkdir -p`。
  `planPath` 校验 sessionId 必须匹配 `^[A-Za-z0-9._-]+$`（路径段守卫）。
- `applyTodoOp(sessionId, root, op)` 是 wire 信封的调度器：读盘 → 分发 → 写盘一气唬成，
  失败的 op 不落盘。
- `todo_write` 是按 id 的 reconcile：已知 id 保留状态（传入 status 被忽略）、可改名；未知 id
  新建 pending（可自带 `t-*` id）；缺失的 grouped id 删除；空 group 合法；**loose lane 不被
  它触碰**——loose id 出现在 group 输入里直接拒绝（`loose-item`），promote 是唯一的
  lane→group 路径。group 标题全计划唯一，与现存未提及 group 撞名也是
  `title-collision`（fail-closed：要么带 id，要么改名，不允许静默替换）。

### 23.2 六个工具与扩展（`pi-harness/src/todos/tools.ts` + `extensions/todos.ts`）

- `todo_list`（无参）、`todo_add(title, group?)`、`todo_update(id, status?, note?, summary?,
  verification?, commitSubject?)`、`todo_promote(id)`、`todo_remove(id)`、
  `todo_write(groups[])`。工具名是模型接口，固定 `todo_*`。
- 每个工具读盘 → op → 写盘一个同步段；返回紧凑文本 + `details: { plan }`（新 TodoFile，
  B4 的卡片通道可消费）；拒绝时 `isError` + reason 文案，文件不动。
- 不变量写在 tool description 里：单步、done 保留、用户可改、write 不是覆盖、
  verification 写「实际跑过的检查」。
- `todo_*` 进审批门的 `READ_ONLY_TOOLS`：写的是会话自己的状态文件（`~/.pi/zu/todos/`），
  不是工作区——ask 模式不弹卡，read-only 不拦（否则只读跑会把 plan 冻住）。
- `zu-todos` section 与工具同厂注册（不是 `hostExtensionFactories` 的常驻位）：关掉
  `todos` 扩展，工具、技能、规则一起消失，prompt 不再宣传一个不存在的机制。规则文本
  模块级常量、无插值（B5 §17 的纪律）。

### 23.3 技能与归属

- `pi-harness/skills/todos/SKILL.md`（frontmatter `name: todos`，description 只写触发条件）。
  内容全部重写：何时建（用户明确要求，或 ≥3 个实质步骤且已理解任务）、粒度（1–2 步不建；
  3–7 步一个 group；>10 步拆 group）、按序执行一步一个 in_progress、阻塞写 note 告诉用户
  跳过、每次选步/用户输入后/结束前重读 `todo_list`、用户删的不加回、done 保留、
  代码改动写 summary/verification/commitSubject、fix 请求重开同一 item。
- `todosExtensionEntry(sessionId, agentDir)` 提供 `skillDirs: [bundledSkillDir("todos")]`，
  随扩展开关进出 `additionalSkillPaths`（§18.4）；`bun run bundle` 的复制断言从源树派生，
  加技能不用改脚本。

### 23.4 宿主通道与面板

| 方法 | 方向 | 语义 |
|---|---|---|
| `_zu/todos/list` | client→agent | `{ sessionId } → { plan: TodoFile }`；无 plan 面返回空计划 |
| `_zu/todos/write` | client→agent | `{ sessionId, op } → { plan }`；失败 `invalid_params` + `data.code = reason` |

- `PiHarnessSession.todos`（list/write）与 `subagents` 同构，**无条件存在**：面板读写的是
  store，不是扩展；关掉 `todos` 扩展只影响模型侧，面板照常工作。`write` 的唯一调用方是
  面板，所以每次成功写入都是用户编辑，附带模型侧引导（见 §23.5）。
- 工具与通道共享同一 store（同 sessionId 同 root），无缓存：面板改完，模型下一次
  `todo_list` 就看到；模型写完，面板下一轮轮询就看到。
- **入口是 composer 横幅**（`app/modules/pi/plan-banner.tsx`）：plan 还有未完成项时，
  ChatView 的 composer dock 顶部显示一条横幅——左侧盲文点阵 spinner（Canvas 绘制，不依赖
  字体带盲文字形；120ms/帧沿 2×3 六点阵顺时针转，reduce motion 时静止）+ 当前 item 标题。
  当前 item = 全局唯一 in_progress；无则下一个 pending（扫描 groups 后 loose），spinner
  静止变暗。点击横幅 = 把当前 session sheet 向右拆分（`core/dock.ts` 的 `splitRight`）出
  `plan:{containerId}` 面板；已开则激活。**plan 全部完成后不显示横幅，也即没有历史入口**
  （本版接受）。横幅只画在容器 captain session（面板读的就是它的 plan）。
- 面板 `plan:{containerId}`（`app/modules/pi/todos.ts` + `view.tsx` 的 PlanBody）：单列
  （草稿 + group 块），mounted 时每 1500ms 轮询；添加进 loose（`origin: user`），勾选 =
  `update(done)`、再点 = `update(pending)`（重开），提升、删除各一个按钮；不拖拽、不编辑
  note/标题（v1）。`pi.plan` intent 走同一拆分入口。

### 23.5 用户编辑的引导与打断（steer）

`pi-harness/src/todos/steer.ts`（`PlanSteer`，纯逻辑可单测；`PiHarnessSession` 用真端口接
线）：面板的每次成功写入都让模型知道——

- **编辑 = 引导**：变更成为一条 conversation 内的 note（`zu.plan.note` custom entry，进
  LLM 上下文），批量合并为一条（多次点击一个 turn，不一次点击一个 turn）：列出变更
  （added/removed/marked done/reopened/promoted/restructured）+ 指令「Re-read the plan
  (todo_list) before you continue」。session 空闲时 note 直接发出并**唤醒一个 turn**；
  turn 运行中 note 排队，`agent_settled` 时发出。
- **删除 = 打断**：模型可能正在执行刚被删除的 item——turn 运行中先 `abort()` 打断，再发
  note（「do not re-add it and do not keep working on it」）并唤醒，模型重读计划、继续剩余
  工作。空闲时删除不 abort，只引导。
- **用户的 stop 不被覆盖**：`agent_settled { aborted: true }` 的 flush 不唤醒（note 只进
  上下文）——用户手动停下的 turn，不能被一条 plan note 重新拉起。
- note 文案按 op 派生（`planEditFacts`，title 从 op 前的 plan 解析——删除的 title 只存在于
  旧文件里）；malformed op 不引导。

### 23.6 测试与门禁

- `todos/core.test.ts`：唯一 in_progress、done 保留/离开清空、reconcile（保留/新建/缺失
  删除/loose 不动/空 group/移动/撞名）、promote 四种失败、标题压缩、坏文件读空、原子写、
  路径段校验、applyTodoOp 信封与失败不落盘、紧凑渲染。
- `todos/steer.test.ts`：note 按 op 派生、空闲编辑即时注入+唤醒、运行中编辑排队并在
  settle flush、批量合并、删除运行中先 abort、删除空闲不 abort、用户 stop 的 flush 不
  唤醒、inject 失败仅记日志。
- `extensions/todos.test.ts`：技能在包内且经真 loader 加载、六工具注册、section
  byte-stable、工具经真 store 读写与拒绝。
- `acp/app.test.ts`：`_zu/todos/*` 的 wire 行为（空计划/写回/coded reason/无表面）。
- `acp/pi-session.test.ts`：门在 read-only 下放行 `todo_*`。
- `app/tests/dock.test.ts`：`splitRight`（新组在右、同组 tab 保留、重复拆分激活、无锚点
  回落 append）。
- `app/tests/plan.ui.test.tsx`（fixture `app/fixtures/plan.tsx`）：横幅当前 item、点击拆分
  （左右两 surface 都在）、面板全路径（勾选/重开/删除/提升/添加）、1500ms 轮询重读、
  全部完成后横幅消失。
- 门禁：`(cd pi-harness && bun test)`、`bun run build`、`nsh check app`、
  `ZU_SKIP_LIVE=1 nsh test app`。

### 23.7 非目标

- 面板不渲染 PR body/commit、不做 change/spec artifacts、不做用户编辑 note/标题、
  不做拖拽排序与优先级；
- plan 属于单个会话（面板显示容器第一个 session 的 plan），不做多会话共享；
- 不做 live 推送（轮询足够，`_zu/todos/changed` 是后续接口位）；
- 不做 plan 的归档/恢复 UI。

## 24. visualize（A3，issue #15）

- `pi-harness/src/extensions/visualize.ts` 注册 captain-only 的 `visualize` 工具（v1 仅
  `type: "file"`）：路径必须相对 cwd、落在工作区内、是常规文件、不在 `.git` 下，
  且 `realpath` 不逃逸；`before` 与 `path` 不能同名。拒绝返回 `isError` + 可读原因。
- 成功结果：文本 `Preview: <path>`（diff 为 `Diff: <before> → <path>`）加
  `details: { kind:"file", path, before?, caption? }`；B4 的 details 通道把它送到 UI。
- 客户端 `app/modules/pi/visualize-card.tsx` 注册卡片：HTML/图片/browser 面板、
  文本/editor 面板、before/diff 面板；纯引用，不渲染、不创建文件。
- `session/load` 回放没有 details 时回落紧凑工具行，卡片不猜形状。
