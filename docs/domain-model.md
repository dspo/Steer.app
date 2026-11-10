# 关系对象模型（Project · SessionContainer · 资源 · 视图）

> 状态：设计定稿（2026-11-10 讨论定稿）。参考系：dspo/manox-app 的三份定稿——PLAN-SESSION-CONTAINER、PLAN-PROJECTS-AND-NEW-ENTRY、PLAN-INITIAL-CWD-AND-PROJECT-VISIBILITY（下文以「Steer D 编号」引用其决策）。开放问题见文末。

## 0. 一句话

**Project 与 membership 归 UI 侧（Storage 持久化），SessionContainer 注册表归 engine sidecar（它拥有全部进程生命周期），pi 只做会话权威（session 文件）**；pi 扩展机制被用在它真正擅长的地方（captain 调度工具与上下文注入），所有权与生命周期这类跨会话关系永远住在比会话长寿的那一层。

## 1. 从 Steer 继承的三条原则

| Steer 决策 | 内容 | 本文采纳 |
|---|---|---|
| SESSION-CONTAINER §2.1 三类对象 | **会话**（idle/running，settle≠死）/ **资源**（本次 runtime，容器死⇒全回收）/ **视图**（无生命周期语义，开关不影响前两类） | §2 对象清单的「类」列；panel/sheet 布局 = 视图类 |
| PROJECTS §2.1 Project 实体 | 多根、**恰一根 primary**；membership 显式（container→project），**绝不按 cwd 猜归属** | §3 同形 |
| INITIAL-CWD D8 双词汇分离 | 创建时工作上下文（不可变：cwd/根组）vs 组织分组（可变：membership/拖行） | §4 属性语义；拖行换项目不触碰会话 cwd |

## 2. 对象清单与归属裁决

| 对象 | 类 | 权威持有者 | 持久化 | Steer 对应 |
|---|---|---|---|---|
| Project（roots/primary/name/position） | 组织 | **UI 侧** store | nsh Storage JSON | `projects.rs` |
| membership（container→project） | 组织 | UI 侧，**活读** | 同上 | `[project_membership]` |
| SessionContainer 注册表 | 组织/生命周期 | **engine sidecar** | sidecar 状态目录（格式见 Q3） | `container.rs`（宿主侧对象，runtime 零污染） |
| Pi Session 转录 | 会话 | **pi** | pi session JSONL 文件 | manox journal 位 |
| 资源（PTY、webview） | 资源 | engine | **不持久**（本次 engine 进程） | 资源类（D6） |
| 视图（panel/sheet 布局） | 视图 | UI | nsh Storage（按容器 stash） | dock_stash 按容器 id（A2） |
| unread/attention | 会话的投影 | engine 事件 | 无 UI 本地镜像 | unread 是协议状态 |

## 3. Project 模型（你的第 1 点）

```ts
Project {
  id: string
  name: string              // 空 = 未自定义，显示 basename(primary)
  nameOverridden: boolean   // 改过即固定，primary 换根不跟随改名
  roots: { path: string; primary: boolean }[]   // 恰一根 primary；存在且为目录；嵌套允许；去重静默
  position: number          // 侧栏拖拽序
}
membership: Record<containerId, projectId>   // 归属唯一事实源，活读；无 membership 的容器落 Chats 桶
```

- **cwd 语义**：容器创建那一刻 `cwd = primary 根`（快照，此后不可变）；根组编辑只影响**以后**创建的容器（Steer D7）；创建页从项目组头进入时目标锁死（Steer D2），已开始对话不提供任何目标更改手势（Steer D1）。
- **多根的诚实边界**（对齐 Steer PROJECTS §2.6）：pi 是**单 cwd 引擎**，没有 manox 那种 `working_directories` 多根授权面。多根只承载**组织与终端 cwd**；对 pi 会话只有 primary 进 `createAgentSession({ cwd })`，其余根不产生授权语义。同 Steer 对外部 CLI「多根不进 TUI」的处理。
- 创建/编辑对话框复刻 Steer 形态：名称跟随 basename(primary)、「设为主要」徽章、缺失根红字阻断；项目删除 = 删实体 + membership，容器全数落回 Chats（非软删，轻量确认）。

## 4. SessionContainer 模型（你的第 2 点）

```ts
SessionContainer {
  id: `pi:{sessionId}` | `external:{agent}:{uuid}`     // Steer D2 同形
  kind: "Pi" | "Terminal" | "Claude" | "Codex" | "Copilot"  // 0号决定类型；类型即能力集（仅 Pi 型可有 1 级子会话）
  cwd: string                 // 创建时快照
  projectId?: string          // 活读
}
// 成员：
//   captain:   0号（Pi 型 = captain AgentSession；external 型 = PTY 一号进程）
//   subagents: 1级（仅 Pi 型；engine 创建的子 AgentSession；只两级，Steer D3）
//   resources: pty[] / webview[]（本次 runtime；owner = 容器）
```

### 4.1 GUI ↔ 模型映射

| GUI | 模型身份 |
|---|---|
| 侧栏一行 | 一个 SessionContainer |
| 选中容器后的 canvas 布局 | 该容器的**视图 stash**（切容器 = stash/restore） |
| 主对话 sheet | captain 转录投影 |
| subagents/后台任务/轨迹/统计 sheets | 容器成员的**投影视图**（视图类，非独立后端对象） |
| 容器语境里开的终端/TUI sheet | **资源**：`terminal:{containerId}:{n}` |
| Launcher/侧栏直接拉起的终端/TUI | **独立外部容器**（Steer D6 双语义：只有左侧栏拉起的是容器，容器内拉起的是资源） |

### 4.2 生命周期（Steer D7 四件套）

- **alive(container)**：Pi 型读 engine 注册表的 archived 位；external 型读 PTY 存活。谓词翻转 ⇒ 统一 teardown：回收全部资源 → 级联归档子会话 → 摘行 → 剪 membership（external；native 保留以备 unarchive 整树复活）。
- **settle ≠ 死**：容器只有 idle/running；settle 留册可续跑；「Settled shelf」= 每项目下 settled 容器的归置投影。
- **stop** = 杀容器全部活跃 run（用户显式动作）。
- **archive** = 容器死亡（有活跃子代理/后台任务先弹确认）。
- **fork** = 新容器只复制 0 号前缀，不带成员与资源（Steer D5；pi SDK `AgentSessionRuntime.fork` 天然满足）。
- **boot rehydrate**：engine 重启后 Pi 会话按需从文件重建；PTY 资源全灭——布局恢复时死资源 sheet 显示占位（见 ui-architecture Q4-②）。
- **外部容器即进程**（Steer D8）：0 号进程 exit 即死、即摘行、即剪 membership；关闭容器 = kill，无 archive 手势。

### 4.3 调度面（pi 扩展机制的用途一）

对齐 Steer D13 的单工具形状：sidecar 内置扩展在 captain 会话内注册调度工具，实现闭包持有 engine 的 SessionManager：

| 动词 | 语义 | 对应 Steer |
|---|---|---|
| `dispatch`（spawn=定义名） | 创建子会话（1 级），ack 回带 run id | Steer Dispatch |
| `dispatch`（addr=run id） | 续跑 settled 子会话 | Steer Dispatch + run id |
| `inject`（addr=live run） | 运行中引导 | Steer Inject |
| `abort`（addr=run id） | 停止 | Steer Abort |
| `list_agents`（只读） | 子会话清单 + 健康 verdict（live + settled 常驻） | Steer ListAgents / U2 名册面 |

## 5. pi 扩展机制的裁决（你的第 2 点后半）

**承载「调度面」与「会话内上下文」，不承载「所有权注册表」。**

- ✓ **调度工具**（§4.3）：扩展跑在 sidecar 进程内，工具实现可闭包持有 engine 的 SessionManager——pi 扩展机制在这里是模型面的自然载体。
- ✓ **上下文注入**：`list_agents` 只读工具；project 根组写进工具可读上下文。
- ✗ **所有权/成员关系持久化**：pi 扩展活在**单个会话的运行时**里，随会话生灭；容器注册表**跨多个会话、跨会话死亡**（archive/unarchive、engine 重启整树复活）。所有权关系必须活在比会话长寿的层——engine 注册表。硬塞进扩展会制造「0 号会话一死注册表全丢」的结构性 bug。

## 6. 其他关系模型（你的第 3 点）

1. **unread 是协议态**：engine 在 `container.updated` 事件里带未读计数；UI 纯投影零镜像；切走容器后台跑的会话积累未读，回来看见即清。
2. **Launcher 后铸**（Steer PROJECTS §3.3）：先 composer 后容器——canvas 空态 = 发射台（项目 chip + composer + agent 动作行）；发送那一刻才 `create_container`，首条消息随创建 flush；反复 New 不产生空容器。
3. **工作上下文不可变**（Steer INITIAL-CWD D1/D8）：创建后删除一切换 cwd/换项目手势；两条词汇分离——拖行换项目（membership 可变）不触碰会话 cwd（工作上下文不可变）。
4. **不收编**（Steer D9 类比）：GitHub Copilot 等 TUI 一律走 external 容器臂，不为任何外部 agent 在 Pi 型里开特例。

## 7. 不变量清单（验收即不变量）

1. 容器的 cwd == 创建时 GUI 确认的目标（首个 `pwd` 可观测）。
2. 归属猜测为零——membership 永远显式。
3. 容器死亡 ⇒ 资源全回收 ⇒ 子会话级联归档 ⇒ 摘行；unarchive 整树复活。
4. 视图操作永不触碰会话与资源两类对象。
5. 单一创建入口 `create_container(kind, attrs)`；单一 teardown 点。
6. fork 不携带成员与资源。
7. 子会话只收 captain 的消息，GUI 不开人类直连入口（协议层不拦截，Steer D4 同语义）。

## 8. 开放问题（需要拍板，附机制解释）

### Q1：子会话（subagent）的转录文件放在哪、归谁枚举？

**背景（机制讲清楚）**：pi 把**每一个**会话存成一个 JSONL 文件放在会话目录里——captain 是一个文件，我们用 dispatch 工具创建的每个子会话也会是**完整的 pi 会话**，同样生成文件。这带来三个连锁问题：① 如果子会话文件和 captain 混在同一目录，pi 自己的会话枚举/恢复入口（比如 `pi --resume`）会把它们当独立会话列出来——用户会看到一堆来历不明的「会话」；② 「谁是父、属于哪个容器」这条边存在哪——pi 会话文件格式有没有可用的自定义元数据条目待查（spike），不能赌；③ engine 要回答「某容器的全部子会话」（名册面），如果文件是权威就得扫描 + 解析文件元数据，如果注册表是权威，dispatch 工具创建那一刻顺手记边即可（子会话文件只是转录缓存）。

pi SDK 的 `createAgentSession` 接受 `sessionManager` 注入（文档确认有 `SessionManager.inMemory()`），意味着**子会话的存储位置是可以被我们定向的**——比如独立子目录 `<appData>/pi/sessions/subagents/`。

**选项**：
- **A：engine 注册表为权威 + 子会话文件隔离**。dispatch 创建时在注册表记 `parent→child` 边（这是名册面的数据源）；子会话的 SessionManager 定向到独立子目录（pi 原生枚举看不见）。人类恢复子会话的唯一入口是我们的名册 UI。
- **B：pi 文件为权威**。子会话与 captain 同目录，靠文件内自定义条目标 parent（赌 session-format 支持自定义条目），engine 名册面扫描目录聚合。

**建议 A**：边在创建时刻自然可得（dispatch 的 ack 就带 run id），扫描方案把确定性问题（树的形状）变成文件系统考古；隔离目录让 pi 原生入口不被污染。待验证点并入 spike ②（`SessionManager` 自定义目录的实际形态）。

**需要你回答**：接受 A（子会话对 pi 原生 resume 不可见，名册是唯一入口）吗？

### Q2：画布是「一次一个容器」还是允许跨容器并置？

**背景**：当前交互设计是——侧栏选中一个容器，canvas 显示该容器 stash 的布局；切换 = stash 当前 + restore 目标。问题是：要不要允许**两个容器的内容同屏**？比如左边是容器 A 的对话 sheet，右边拖进了容器 B 的终端 sheet。

**为什么不是白送的**：sheet id 目前带容器命名空间（`terminal:{containerId}:{n}`），画布按容器 stash——跨容器并置意味着「sheet 属于容器 A，但显示在容器 B 的画布」：① stash/restore 时跨容器引用的 sheet 跟着谁的布局走；② 容器 A teardown 时，它名下被拖到别处显示的 sheet 要全局清理，不只是当前画布；③ 未读/焦点语义分叉（你在看容器 B 的画布，容器 A 的 sheet 有动静算不算已读）。每一处都是所有权矩阵的复杂度。

**选项**：
- **A：v1 单容器画布**（Steer 同款：一次一个工作区），跨容器需求用「新开窗口」（nsh 多窗口，每窗一个容器）兜底——窗口天然是所有权边界。
- **B：sheet 全局化**，画布可混排任意容器的 sheet，teardown 改为全局清扫。

**建议 A**，B 挂账（真出现高频需求再做，届时以窗口方案优先验证）。

**需要你回答**：v1 接受单容器画布（跨容器需求先走多窗口）吗？

### Q3：engine 容器注册表的持久化格式

**背景**：容器注册表要跨 engine 重启存在（archive 位、容器↔成员边、资源句柄表）。这份状态不大（容器数百级、每容器几条边），但有两种持久化哲学：

- **A：JSON 快照**。每次变更整份序列化 + 原子 rename（临时文件 + rename 保证崩溃时不留半截）。实现一个函数，调试直接 cat。
- **B：append-only JSONL 日志**。每条变更追加一行，崩溃只丢最后一行；但需要定期 compaction（日志无限涨）、读时要重放全量。

**本仓激进纪律的影响**：我们不维护版本迁移、不留兼容读——注册表损坏时允许**对账重建**：注册表里大部分字段可从外部事实推导（captain session 文件在不在、PTY 死没死、membership 在 UI 侧注册表里），不可推导的只有 archived 位和成员边。所以 A + 启动对账（注册表指向的会话文件不存在 → 该容器标记 dead 并显示占位）已经覆盖故障面；B 的崩溃安全收益在快照原子 rename 下并不显著。

**建议 A**（快照 + 原子 rename + 启动对账），代码量约为 B 的三分之一。

**需要你回答**：接受 A 与「注册表损坏 = 部分容器降级重建」的纪律吗？

### Q4 / Q5 在 ui-architecture.md 文末（布局 stash 三语义点、键盘范围）。
