# 关系对象模型（Project · SessionContainer · 资源 · 视图）

> 状态：设计定稿（2026-11-10 讨论定稿）。参考系：dspo/manox-app 的三份定稿——PLAN-SESSION-CONTAINER、PLAN-PROJECTS-AND-NEW-ENTRY、PLAN-INITIAL-CWD-AND-PROJECT-VISIBILITY（下文以「Steer D 编号」引用其决策）。开放问题见文末。

## 0. 一句话

**Project 与 membership 逻辑上归 UI（内容权威在 UI store，写面经 engine wire 落 `~/.pi/zu/`），SessionContainer 注册表归 engine sidecar（它拥有全部进程生命周期），pi 只做会话权威（原生会话文件，与 pi CLI 完全双向兼容）**；pi 扩展机制被用在它真正擅长的地方（captain 调度工具与上下文注入），所有权与生命周期这类跨会话关系永远住在比会话长寿的那一层。

## 1. 从 Steer 继承的三条原则

| Steer 决策 | 内容 | 本文采纳 |
|---|---|---|
| SESSION-CONTAINER §2.1 三类对象 | **会话**（idle/running，settle≠死）/ **资源**（本次 runtime，容器死⇒全回收）/ **视图**（无生命周期语义，开关不影响前两类） | §2 对象清单的「类」列；panel/sheet 布局 = 视图类 |
| PROJECTS §2.1 Project 实体 | 多根、**恰一根 primary**；membership 显式（container→project），**绝不按 cwd 猜归属** | §3 同形 |
| INITIAL-CWD D8 双词汇分离 | 创建时工作上下文（不可变：cwd/根组）vs 组织分组（可变：membership/拖行） | §4 属性语义；拖行换项目不触碰会话 cwd |

## 2. 对象清单与归属裁决

| 对象 | 类 | 权威持有者 | 持久化 | Steer 对应 |
|---|---|---|---|---|
| Project（roots/primary/name/position） | 组织 | **UI 侧**（内容权威；写面经 engine wire） | `~/.pi/zu/`（E11） | `projects.rs` |
| membership（container→project） | 组织 | UI 侧，**活读** | 同上 | `[project_membership]` |
| SessionContainer 注册表 | 组织/生命周期 | **engine sidecar** | `~/.pi/zu/registry.json`（JSON 快照，§9） | `container.rs`（宿主侧对象，runtime 零污染） |
| Pi Session 转录 | 会话 | **pi** | pi 原生会话存储（`~/.pi` 默认布局，完全兼容，Q7/Q10） | manox journal 位 |
| 资源（PTY、webview） | 资源 | engine | **不持久**（本次 engine 进程） | 资源类（D6） |
| 视图（panel/sheet 布局） | 视图 | UI | `~/.pi/zu/`（按容器 stash，经 engine wire） | dock_stash 按容器 id（A2） |
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

### 4.4 子会话的存储与身份（Q1 + Q7/Q10 联合裁决）

**与原生 pi 完全兼容优先（Q7）**：全部会话文件（captain 与子会话）住 **pi 原生会话存储（`~/.pi` 默认布局）**——Zu 不隔离、不另设目录；Zu 打开时自然加载全部 sessions（不问出处），pi CLI 同样看得到（Q10 双向互通）。

关系边（parent→child）的承载，按「不言自明」要求分两层：

1. **注册表为权威**：dispatch 创建时在 `~/.pi/zu/registry.json` 记 `parent→child` 边（名册面的数据源）——pi 视而不见的命名空间（spike ③ 验证容忍度）。
2. **pi 可见的归属线索**：子会话的 pi 会话名（`--name` / SessionManager name）采用约定词汇 **`zu:{captainShortId}:{runId}`**——pi CLI 的会话列表里自带归属前缀；若 spike ③ 证实 pi 会话文件支持自定义条目且原生 pi 忽略未知条目，再向子会话文件追加 `zu` 元数据条目，让关系自证据到文件内。

原「目录隔离 + 路径即关系」方案随 Q7 **撤销**——它与「完全兼容、双向互通」结构性冲突；「不言自明」的载体从路径改为「命名约定 + 注册表（+ 文件内元数据，待证）」。人类接触子会话的唯一入口仍是名册 UI（不变量 7），但 pi CLI 直开子会话文件是允许的（它自己报兼容错，Q10 原话）。

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

## 8. 已裁决（2026-11-10 两轮）

**第一轮（Q1–Q3）**
- **Q1 子会话转录归属**：注册表为权威 + 关系不言自明（§4.4；载体经 Q7 修订为命名约定 + 注册表）。
- **Q2 跨容器画布**：**永久不做**；跨容器需求走多窗口，每窗一个容器（ui-architecture U10）。
- **Q3 注册表格式**：JSON 快照 + 原子 rename + 启动对账；配套 §9 状态生命周期分级。

**第二轮（Q7–Q15）**
- **Q7 持久化根**：**全部用户状态落 `~/.pi`，与原生 pi 完全双向兼容**——pi 的持久化逻辑我们完全兼容；我们的增强要么 pi 不看、要么我们对 pi 视而不见（→ engine E11；§4.4 随之改写）。**凭据天然共享**，无需导入。
- **Q8 品牌名**：**Zu**（祖冲之，纪念其对 π 的贡献）；logo 开发期暂用 `<Z>`（Steer `<->` 同款构型）→ engine E10，已落码。
- **Q9 界面语言**：对齐 Steer——zh-CN 第一 + en fallback，键表第一天立住（→ ui U11）。
- **Q10 双向互通**：目标即「pi 的 desktop 端」——Zu 自然加载全部 sessions、不问出处；pi CLI 同样。若 Zu 的增强（自定义工具、沙箱访问 vs 完全访问）导致个别会话不兼容，**由打开方自行报错**（pi 原话语义）。**兼容包络细则留下一轮讨论**（open-questions Q10）。
- **Q11 归档可见性**：**v1 暂不考虑**；未来候选为设置页「归档管理」子页（列入明确不做）。
- **Q12 托盘与通知**：**C——托盘 + 系统通知**（→ engine E12、ui U12）；生命周期语义细则留下一轮（open-questions Q16）。
- **Q13 子代理定义体系**：**下一轮继续**（open-questions Q13，已附 ThinkRail 调研：markdown + frontmatter 定义文件，builtin/personal/project 三源，字段含 tools/model/thinking/maxTurns/skills）。
- **Q14 自更新**：GitHub Releases，与 Steer 同款（→ engine E13）。
- **Q15 外部容器种类**：**只做四类**（Terminal / Claude / Codex / Copilot TUI）；VS Code / ChatGPT 等 GUI 直发不做。

## 9. 状态生命周期分级（Q3 配套裁决）

**原则：转录与关系持久；进程与资源易失。**

| 层 | 对象 | 载体 | 跨重启 |
|---|---|---|---|
| 持久 | Project / membership | `~/.pi/zu/`（经 engine wire，E11） | ✓ |
| 持久 | 容器注册表（Pi 型容器、archived 位、成员边） | `~/.pi/zu/registry.json` | ✓ |
| 持久 | pi 会话转录（captain + 子会话） | pi 原生会话存储（`~/.pi`，完全兼容） | ✓ |
| 持久 | 视图布局 stash（按容器）+ 上次活跃容器指针 | `~/.pi/zu/`（经 engine wire） | ✓ |
| 易失 | **PTY 终端 / webview 页面** | engine 进程 | ✗（**应用重启不恢复终端**——2026-11-10 拍板） |
| 易失 | 进行中的 run / 排队中的消息 / 未读计数 | engine 进程 | ✗（转录已落盘部分保留；未读启动归零） |

对账语义：boot 时注册表指向的 captain 文件缺失 → 该容器标记 dead（可清理）；资源 sheet 在布局恢复时静默移除（ui-architecture U8）。新对象入库时先回答「它属于哪一层」，不允许出现未分级的持久化写面。

## 10. 明确不做（non-goals）

- 跨容器画布（Q2，永久）。
- 归档容器的可见性/恢复入口（Q11：v1 不做；未来候选 = 设置页「归档管理」子页）。
- 会话中根集的 live 刷新、项目名进提示词（Steer INITIAL-CWD 同款边界）。
- 子会话的 GUI 人类直连入口（不变量 7 保留语义）。
