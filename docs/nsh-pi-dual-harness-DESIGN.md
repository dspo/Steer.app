# nsh-pi 双 harness 集成设计（manox + pi）：薄壳 × 各自对话面

> 状态：**决策已定**（2026-11-12），待实施。产品总纲：架构、产品 UI 与交互、里程碑。
> 上游文档：`docs/zu-pi-harness-ARCHITECTURE.v2.md`（pi 线架构，引用不重抄；已随本文落盘 docs/）。
> `dspo/manox/docs/ahp-v3-architecture.md`（manox↔宿主协议规格，W0 冻结）。
> 载体裁决：**nsh-pi 是唯一演进载体**；manox-app 冻结为参考（死刑清单 = 不搬代码，仍可作能力语义
> 抽取源）。
>
> 修订记录：
> v1.1——统一会话视图模型（SessionView）；T0 双原型前置。
> v1.2——范围修正：只接入 manox 对话，撤出全部 Steer 产品面 sheet。
> v1.3——否决统一消息渲染：manox 独立会话 sheet；SessionView 废除，改为共享 Composer 契约。
> **v1.4（本次）——Composer 分家（宿主裁决）：**
> **pi harness**：composer 回归传统**圆角矩形、底色纯白的气泡式输入框**，复刻
> **ZCode**（`~/projects/github/ZCode`，`ChatPromptEditor` 输入壳：`rounded-2xl` 气泡、独立浮面）。
> **manox harness**：**无边框、与消息区域仅一条分割线**的 composer，复刻
> **Steer.app** 的 Composer UI/UX。
> 共享 Composer 契约废除——**对话层（消息区 + Composer）完全归各 harness pack**；
> 跨 harness 共享的只剩壳与 `ui/` 无状态呈现原语。
> **v1.5（本次）——吸纳 `nsh-pi-dual-harness-DESIGN-REVIEW.md`（该评审针对 v1.1，逐条按 v1.4 分诊）：**
> 采纳——in-proc 三项工程边界（§3.6：崩溃隔离不对称 / tokio 线程模型 / 构建体积）、跨实现 reducer
> 一致性门禁（§3.5）、M1 断连杀线定义（§5）、文档落盘前置（头部）、未来终端落点备忘（§4.4）、
> 风险重排（§6）、日期与现状措辞修正。
> 已被 v1.2–v1.4 消解，不再适用——SessionView 的 elicitation/browser-suite 形状缺口（SessionView 已于
> v1.3 废除）、clipboardRead 阶段冲突（客户端能力面已于 v1.2 整体裁出）、`ahp-annotations` 简写
> （通道已出范围）。
>
> **两条铁律（宿主裁决）**：
> **R1 非 generic 客户端**：消息区与 Composer 的渲染权、交互、视觉全归各 pack，壳不做任何会话层
> 抽象。跨 harness 共享的只有壳。
> **R2 manox 对话接入（能对话为止）**：in-proc AHP 直连，跑通「发送 → 流式响应 → 工具执行可见 →
> 完成/取消」的最小完整回路；UI = 一个独立的 manox 会话 sheet（Steer 风格 composer）。

## 0. 一句话

**manox 是 Zu 的第二种会话来源**：`native/manox` 进程内直连 harness，manox pack 自建会话 sheet
（无边框 + 单分割线的 Steer 式 composer + 消息区直接渲染 AHP reducer 折叠态）；pi 侧 composer 重设计
为 ZCode 气泡式；除此之外壳与基础设施全 harness 共享，pi 线按 v2 架构并行推进。

## 1. 原则

1. **壳零 harness 语义**：harness 词汇只允许出现在 `app/harness/{pi,manox}/` 与 `contracts/`。
2. **pack 互不 import**，共享层不 import pack；装配点唯一（`App.tsx`）。
3. **对话层完全分家**：消息区与 Composer 的组件、状态、视觉全归各 pack。跨 harness 共享的只有
   壳与 `ui/` 的**无状态**呈现原语（TextView/Markdown/代码块——manox/pi 消息区都可复用，但消息区
   结构与状态绑定各是各的实现）。
4. **范围纪律**：manox 边界 = 「能对话」（附录 A）；之外的通道与 Steer 产品能力不做、不预留结构。

**门禁**：依赖方向单向（pack → 共享层）；`nsh check` 加依赖规则检查。

## 2. 资产映射

| 仓 | 角色 |
|---|---|
| nsh-pi `app/`（34k TSX） | 壳 + pi 面的家；manox 面只加一个 pack（§3.1） |
| nsh-pi `native/` | 既有域（fs/git/instance/lsp/picker/pty）不变；acp 泵与 `native/manox` 泵都是**交付物**而非既有（分别属 v2 P 线与 M 线） |
| nsh-pi `pi-harness/` | pi distro（v2），不变 |
| dspo/manox（181k，gpui-free） | git 依赖原样消费；AHP 宿主半边已在其仓建成 |
| dspo/manox-app | 冻结参考；`cx`/`cx-cli` 原样独立保留；其余不搬（死刑清单 = 不搬代码，仍可作能力语义抽取源） |
| ZCode（github/ZCode） | pi composer 的视觉参照（`ChatPromptEditor` 气泡壳）；仅作设计参照，不引代码 |

## 3. 架构

### 3.1 分层与 pack

```
App.tsx（装配点）
└─ 壳
   ├─ shell/ canvas/          Workbench 与 sheet registry（零 harness 语义）
   ├─ 共享 stores/            fs/editors/file-tree/git/lsp/terminals/browser/settings/
   │                          notifications/updates/projects（容器组织，两腿共用）
   └─ ui/                     无状态呈现原语：TextView/Markdown/代码块…（两腿消息区可复用）
├─ app/harness/pi/            acp.ts/jsonrpc.ts + pi stores + chat-view（pi 转录）
│                             + **composer-bubble**（ZCode 复刻：圆角气泡、纯白底）+ 投影
└─ app/harness/manox/         ahp.ts（连接/订阅/reducer 折叠/dispatch）+ threads/chats store
                              + **conversation.tsx**：manox 会话 sheet（自己的消息区
                              + **composer-hairline**：无边框 + 单分割线，Steer 复刻——
                              即现有 ChatComposer 组件随 pack 迁入）
                              + 侧栏投影贡献
native/manox/                 新 crate：manox-ahp 宿主半边 in-proc 单例 + 帧泵（Rust 零协议语义）
contracts/ahp/                vendored AHP TS types + reducers（pin + sync 脚本）
contracts/acp-xzu/            pi 线共享词汇（v2）
```

### 3.2 对话层分家的两条 composer 规格

| | pi：composer-bubble | manox：composer-hairline |
|---|---|---|
| 视觉 | 圆角矩形气泡（`rounded-2xl` 量级）、底色纯白（浅色模式；深色映射 Zu token 的浮面/卡色）、独立浮面无外框 | 无边框、透明底，与消息区域之间仅一条 hairline 分割线 |
| 参照 | ZCode `ChatPromptEditor`（DESIGN.md：输入壳 rounded-2xl、独立浮面） | Steer.app Composer（Zu 现有 ChatComposer 的 hairline 设计——Q91 已对齐，**迁移而非新写**） |
| 归属 | pi pack 新写 | manox pack（现有组件随 pack 迁入） |
| 行为 | 发送/停止、流式态、斜杆候选、footer（模型/档位）——按 pi 现有交互 | 发送/停止、流式态、排队车道提示——按能对话最小集 |

**复刻保真守门**：两套 composer 的验收是「对照参照应用的截图走查」（light/dark，落 `docs/evidence/`）；
视觉 token 全部取自 Zu `DESIGN.md`，不引入 ZCode/Steer 的样式代码或 token。

### 3.3 容器与 sheet

- manox 容器 = `manox:{threadId}`；会话 sheet = `manox-chat:{threadId}:{chatId}`——独立 kind，body 是
  manox conversation 视图（自己的消息区 + composer-hairline）。
- 容器生命周期全走壳既有机制：布局 stash、无 sheet 自动归档、未读回执、通知策略、Hero 首页（动作行按
  pack 贡献）。组织走壳 projects store（`isArchivedChanged` → archived 位；pin/手工排序不接）。

### 3.4 协议适配面（两条腿）

| | pi 腿 | manox 腿 |
|---|---|---|
| 传输 | 轮级子进程 stdio（`zu/acp` 泵） | **in-proc**（`native/manox`：宿主半边单例 + typed 帧泵，Rust 零协议语义） |
| 客户端半边 | `acp.ts` + `jsonrpc.ts` | `ahp.ts`：initialize/subscribe/dispatchAction{clientSeq}/reconnect；**消息区直接绑定 vendored reducers 折叠态**——零翻译层 |
| 通道范围（能对话） | v2 §5 | **root**（createSession 幂等铸 channel、models 表）+ **ahp-session**（thread 状态、isArchived）+ **ahp-chat**（turnStarted/turnCancelled、responseParts 流、toolCall(Update)、toolCallReady/Confirmed、elicitation 三动作（最小应答）、pendingMessageSet/Removed、error） |
| 生命周期 | 轮级 + 预热（v2 §7） | 应用内单例，无独立进程 |

**能对话的最小完整回路**：发送（`dispatchAction{chat/turnStarted}`）→ 流式（`responsePart`）→ 工具
可见（toolCall 卡）→ 阻塞路径最小应答（`toolCallConfirmed`/elicitation——agent 停下来问就必须能答）
→ settle/取消。审批/询问 UI 从简（对话流内最小卡）。

**in-proc 腿的三项工程边界（v1.5 吸纳评审）**——§3.4「同一哲学」之下必须写明的不对称：

- **崩溃隔离不对称（本架构最大的固有代价）**：pi 腿的崩溃隔离是进程边界（架构特性）；manox 腿是
  应用内单例——宿主半边（181k 行、v3 重构中）一旦 panic 会带走整个壳与所有会话面。缓解：
  `native/manox` 泵边界 `catch_unwind`，宿主半边 panic 转为 TS 侧 transport 错误，走重连/重建恢复
  路径，**不杀壳**；T0-manox 以可注入 panic 的测试桩验收「panic 不杀壳、UI 可恢复」。
- **线程模型**：manox 是 tokio + async_channel；`native/manox` 拥有**独立的 tokio runtime 线程**，
  宿主半边与泵跑其上，帧经 `Callback::post` 推 TS。线程归属与关停顺序在 T0-manox 定稿并验证。
- **构建与体积**：manox crate 链（ahp/ahp-runtime/session-core/journal）经 git 依赖进 zu-native
  构建图；T0-manox 量化构建时间与产物体积增量并记入 evidence。

### 3.5 读面权威与折叠对账门禁

durable 权威都在磁盘（`~/.pi` JSONL / `~/.manox` journal），零活进程可读——harness 准入条件。
manox：订阅快照毫秒级 → 立即渲染 → journal 索引异步扫（mtime 水位沿用）。**折叠对账门禁**：
同一 chat 的快照腿与 journal 重放腿喂同一份 vendored reducer，最终状态必须相等。

**跨实现一致性（v1.5 吸纳评审）**：折叠对账证明的是 TS 两腿等价，不覆盖 TS vendored reducers 与
宿主侧 Rust reducers 的漂移——漂移时客户端乐观状态偏离宿主真相，直到重连快照才纠正。门禁：
spec 仓 `types/reducers.test.ts` 的 fixtures 同跑于 manox Rust 侧（ahp crate 的 reducer 测试消费同一
组 fixtures），漂移在 CI 现形而非线上。

## 4. 产品 UI 与交互

### 4.1 壳一致，对话 sheet 各自完整

侧栏/画布/页签/顶栏/设置/容器生命周期：跨 harness 一套。会话 sheet 内部（消息区 + Composer）：
**每家一套完整实现**——pi = chat-view + composer-bubble（ZCode 气泡），manox = conversation +
composer-hairline（Steer hairline）。用户切容器时感知到的是两种对话界面；共享的只有壳与呈现原语。

### 4.2 术语对照

| Steer/AHP | nsh-pi |
|---|---|
| thread（`ahp-session`） | manox 容器（侧栏一行） |
| chat（`ahp-chat`） | manox 会话 sheet（`manox-chat:` kind） |
| turn / responsePart / toolCall | 回合 / 响应部件 / 工具卡 |
| pending{steering/queued} | 引导 / 排队车道 |
| toolCallReady / elicitation | 审批 / 询问（最小卡） |

### 4.3 pi 面变更与 manox 面

- **pi composer 重设计**（本设计给 pi 面带来的唯一 UI 变更）：现有 Steer 风格 composer 替换为
  ZCode 气泡式复刻（新写 `composer-bubble`；斜杆候选、footer、流式停止等交互语义保留，视觉与容器
  形状按 ZCode 规格）。设计规格落 `docs/DESIGN.md`，截图落 evidence。
- **manox composer 即现有组件**：`ChatComposer`（hairline 设计已对齐 Steer）随 pack 迁入 manox，
  manox 无 composer 新写工作。
- manox 消息区：§3.4 回路的数据 → manox 自己的排版（回合边界、流式部件、工具卡、最小审批/询问卡、
  错误行），可复用 `ui/` 无状态原语。

### 4.4 明确不做（本阶段；未来按价值另开提案）

审批/询问的 Steer 式瀑布体验、草稿持久化、compact、`fetchTurns` 深分页、模型/档位切换控件、
plan/work/changesets/automations/metrics/annotations/modelchat、workspaces 同步与 pin/手工排序、
AHP terminal 独立终端面（工具输出以工具卡呈现；未来若接，落点为共享 `terminal:` kind 内按容器 kind
选后端，不新增 kind）、createChat fork/sideChat、ext-agents、
browser suites、`resource*`/`invokeTool`、manox-ahp 的 WS 对外面。

## 5. 里程碑

| 阶段 | 内容 | 验收 |
|---|---|---|
| **T0 双原型（最先，spike 级）** | **T0-pi**：distro 最小链路（spawn+initialize+new+prompt 流式+cancel）打通现有 chat-view（composer 沿现状，重设计走 U0 并行批）。**T0-manox**：`native/manox` 泵 + `ahp.ts` + manox conversation 视图 + composer-hairline（现有组件迁入）——宿主半边未就绪时以进程内桩先行；**同时定稿 tokio 线程模型并验证 panic 注入不杀壳（§3.4）** | 两条腿各完成一个真实流式 turn（含工具卡与一次最小审批）；manox sheet 是独立实现且 composer 为 Steer 风格；宿主半边注入 panic 不杀壳、UI 走恢复路径；构建时间/体积增量记入 evidence |
| **S0 壳泛化** | pack 装配模型；pi 面迁入 `app/harness/pi/`；适配器按容器 kind 分发；依赖规则进门禁 | 现有门禁全绿；依赖规则零违例 |
| **U0 pi Composer 重设计（与 T0/S0 并行）** | ZCode 气泡式 composer 设计规格（落 DESIGN.md）+ `composer-bubble` 实现 + 接入 pi 会话 sheet；现有 hairline 组件迁出至 manox pack | 对照 ZCode 截图走查（light/dark）通过；pi 会话交互语义不变 |
| **P0–P4** | v2 §12 原样；T0-pi 毕业为 P0 底座 | v2 各阶段验收 |
| **M1 manox 对话真实现** | 桩换真（前置：manox v3 W4）；vendored types/reducers sync+pin；能对话回路全量（附录 A 打点）；容器/侧栏/归档/projects 接线；折叠对账门禁 | 真实 thread 完成含工具与最小审批的完整对话；**断连演练两案可测**：①泵传输重置（TS 重建 transport 走 reconnect 腿）②宿主半边 panic（catch_unwind 恢复）——两案后对话均可继续；对账双源等价 |
| **M2 加固收尾** | 断连/溢出演练、大 journal fold、未读/通知接线 | 附录 A 全清；M 线完成 |

依赖：T0 → S0 → (P0、M1)；U0 独立并行；M1 换真依赖 manox v3 W4（T0-manox 桩不受限）。P 线与 M 线
并行互不阻塞。**M 线是可独立冻结执行的单线**（T0-manox → S0 → M1 → M2 不依赖 P 线任何阶段）——
最小交付路径：manox 对话 sheet 本身即可先行上线。

## 6. 风险

1. **崩溃隔离不对称（v1.5 新增，in-proc 最大的固有代价）**：manox 宿主半边 panic 的爆炸半径 = 整个
   应用（对比 pi 腿的进程隔离）。守门：泵边界 catch_unwind + panic 注入测试（§3.4）；恢复路径演练
   进 T0/M1。
2. **复刻保真**：两套 composer 的视觉/交互对照参照应用走样。守门：截图走查进验收（U0/MM 批次，
   light/dark）；token 只取 Zu DESIGN.md，不引参照仓代码。
3. **manox v3 W4 进度**：M1 换真的硬前置；T0 桩不受阻。
4. **TS reducer 在 QuickJS 的适配**：reducers 纯函数，预期无平台依赖；TS 侧 connection 自实现。
   T0-manox 首个门禁验证。
5. **对账与跨实现漂移**：折叠对账双源等价 + spec fixtures 跨实现一致性门禁（§3.5）。
6. **构建与体积**：manox crate 链进构建图的增量，T0-manox 量化（§3.4）。
7. **品牌与发布**（非阻塞，后期裁决）；**cx 共存**：同一 `~/.manox` 状态根上的宿主单例边界 M1 裁决。

## 附录 A：manox「能对话」验收清单（R2 对照面）

- **root**：`initialize`；`createSession{channel: 客户端铸 uuid}`（幂等）；`listSessions` + 增量。
- **ahp-session**：thread 状态订阅；`isArchivedChanged`。
- **ahp-chat**：`dispatchAction{chat/turnStarted}`（乐观对账、rejection 回报）；`chat/responsePart`
  流式；`chat/toolCall(Update)`；`chat/toolCallReady` + `chat/toolCallConfirmed`（最小审批）；
  elicitation 三动作（最小输入应答）；`chat/pendingMessageSet/Removed`（steering/queued）；
  `chat/turnCancelled`；`chat/error`。
- **回路断言**：发送 → 流式 → 工具 → 应答 → settle 全链路；断连演练两案（§5 M1：泵传输重置 /
  宿主半边 panic）后对话均可继续；折叠对账双源等价（§3.5）；vendored types sync。

**明确不做**：§4.4 清单——不是遗漏，是范围裁决。
