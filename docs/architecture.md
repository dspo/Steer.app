# 架构

> 决策文档。记录 Zu 的最终架构形态；决策的来龙去脉见 [decisions.md](decisions.md)（台账）与 [evidence/](evidence/)（依据）。
> 本文只写「是什么」与「为什么这样定」，不写讨论过程。

## 0. 一句话

**Zu 是 pi 的桌面端**：UI 是 nsh 的 TSX 应用（macOS AppKit 渲染），引擎是随 app 分发的 pi sidecar（Bun 单文件），两者只经 loopback WebSocket 上的 `EngineConnection` 说话；pi 的会话存储（`~/.pi`）是唯一权威，Zu 的增强状态住在 `~/.pi/zu/`。

## 1. 第一性约束

1. **pi 是 Node 生态的 JS 引擎**：它需要 `node:module`、动态 `require`、原生与 WASM 资产，以及一个能写 `~/.pi` 的进程。nsh 的 TSX 运行时虽是 QuickJS（可解析 npm 包、有 Node 子集），但这些不在其能力面内 → pi 不能进 UI 进程。
2. **Zu 自管 pi 版本并经 pi 扩展机制定制** → 引擎必须随 app 携带，不依赖用户系统安装。
3. **nsh 有能力沙箱** → UI 进程保持最小能力面（回环 + 通知），文件与进程访问全在引擎/native module 侧。

## 2. 核心原则

| 原则 | 内容 |
|---|---|
| **兼容方向不对称** | pi → Zu 是硬约束：pi 原生产生的任何会话，Zu 必须能列出、显示、打开、加载、预览、继续。Zu → pi 允许增强部分不可见：captain 会话住 pi 原生存储（pi CLI 可见），subagents 与 Zu 状态住 `~/.pi/zu/`（pi 视而不见）。 |
| **三类对象** | 会话（durable，settle ≠ 死）/ 资源（进程生命周期）/ 视图（无生命周期，开关不影响前两类）。 |
| **工作上下文不可变** | 容器的 cwd 与根组在创建时快照，此后无 GUI 更改手势；可变的是组织归属（membership）。 |
| **单一入口 / 单点** | 容器只有一个创建入口、一个 teardown 点；UI 与引擎之间只有一个 `EngineConnection`。 |
| **文件是事实** | 注册表与文件不一致时路径优先；归档只是视图态度，外部改动优先复活。 |

## 3. 后端：引擎 sidecar

### 3.1 拓扑

```
┌──────────────────────────┐        ┌──────────────────────────────┐
│ Zu.app（nsh TSX，AppKit）│  wire  │ pi-engine（Bun 单文件）      │
│  screens → stores →      │        │  SessionManager              │
│  EngineConnection ───────┼──WS──▶ │   ├─ AgentSession ×N         │
│  load：storage 无、      │loopback│   ├─ 内置扩展（dispatch 等） │
│  execute 由 native module│ +token │   ├─ 用户 extensions/skills  │
│  代劳                    │        │   └─ state: ~/.pi/zu/        │
└──────────┬───────────────┘        └──────────────────────────────┘
           │ native module（Rust）
           │  spawn / PTY / LSP / git
           ▼
      Contents/Helpers/pi-engine + 用户进程
```

### 3.2 引擎形态

- **单进程多会话**：一个 sidecar 进程内 `createAgentSession` × N + `AgentSessionRuntime`（`newSession`/`switchSession`/`fork`）。pi 的 `--mode rpc` 是长生命周期的单会话进程（支持 `new_session`/`switch_session`/`fork`），但**不支持多会话并发**（事件无 sessionId），故不用它；官方指定进程内集成用 SDK。
- **会话回收是内存策略**：`session.dispose()` + LRU；resume 是按 pi 会话文件重建，不涉及进程管理。进程数恒为 1。
- **派发不另起进程**：需要隔离时在引擎内 fork `AgentSessionRuntime`，wire 协议对 UI 透明。

### 3.3 wire 契约（`contracts/`）

UI 与引擎之间唯一的共享面：TS 类型 + 运行时校验 + `protocol.md`。**信封固定**：

```ts
{ v: 1, id: string, sessionId?: string, type: string, payload: unknown }
// 回复：{ v, id, type: "reply", payload: { command, ok, data?, error?, code? } }
// 事件：{ v, type: <event>, sessionId?, data }
// 引擎→UI 的请求（扩展 UI）：{ v, id, type: "ui.request", sessionId?, data: { method, params, timeoutMs } }
// UI 的应答：{ v, id, type: "ui.response", payload: { ok, result?, error? } }
```

**命令按域分组，归属明确**：

| 域 | 命令 | 执行者 | 幂等 |
|---|---|---|---|
| `engine.*` | `ping`、`info`、`health` | engine | 是 |
| `session.*` | `list`、`create`、`open`、`info`、`extensions`、`prompt`、`steer`、`followUp`、`abort`、`close` | engine（pi） | `open` 按 path 幂等；`create`/`prompt`/`steer`/`followUp` 非幂等 |
| `container.*` | `list`、`create`、`show`、`attachSession`、`archive`、`unarchive` | engine（Zu 状态） | `create` 非幂等；其余幂等 |
| `layout.*` | `get`、`put` | engine（Zu 状态） | 是（last write wins） |
| `state.*` | `snapshot`、`subscribe` | engine（Zu 状态） | 是 |
| `ui.*` | 扩展 UI 的请求/应答（`ui.request` / `ui.response`） | UI（nsh 对话框） | 请求带超时，超时即 resolve 默认值 |

**PTY 不经 wire**：字节流不过 JSON/WS，`zu/pty` 的 `Callback::post` 直接推给 TSX 的 Terminal（§3.6）。

**事件**（全部带 `sessionId`，除 `engine.*`）：`engine.heartbeat`（每 5 s）、`session.info`（名称/thinking/文件路径变更）、`message.delta`、`message.complete`、`agent.state`（M2 只发 `running`/`idle`；更细的 thinking/executing/awaiting 留给后续）、`tool.start`、`tool.end`、`tool.update`、`queue.update`（steering/followUp 排队）、`compaction.start/end`、`retry.start/end`、`ui.request`、`ui.notify`、`ui.status`、`ui.title`、`ui.unsupported`、`error`。完整表见 `contracts/protocol.md`。

**回合终点**：`agent_settled`（`agent_end` 只是一次低层 run 结束）。**完成态权威**：`message_end` 与 pi 会话文件是唯一真相；UI 的渲染 = 文件投影 + 事件增量加速，所以切容器、重连、崩溃恢复是同一套重建逻辑。

**重连**：UI 连上后先 `state.subscribe`（它既登记订阅、又返回 `state.snapshot`：容器、打开会话、活跃 run、未读、engine `generation`），此后收增量。协议版本 `v` 与 pi 版本在握手返回；`v` 不匹配即拒连并提示升级，不猜语义。`generation` 每次引擎进程启动递增并持久化在 `~/.pi/zu/engine.generation`；UI 据此区分「重启」与「socket 抖动」，决定是否显示「已恢复」。

### 3.4 能力面（`nsh.json`）

```json
"capabilities": {
  "network": { "hosts": ["127.0.0.1"] }
}
```

WebSocket 按 `hosts` 授权（`sockets` 只给 `net.connect` 的裸 TCP，且只接受精确 `host:port`）；`notifications` 不是合法能力键，通知在 M10 用 nsh 的 desktop 模块。

**port 与 token 由 native module 提供**：`Engine.port()` / `Engine.token()`（§3.6），UI 不读文件、不猜端口。端口是固定常量 `47823`——第二个实例会撞端口，由「单实例」与明确错误文案兜底（§7）。

**浏览器授权（Q32）**：`capabilities.webview.hosts: ["*"]`——地址栏意味着任意站点；UI 在地址栏旁标明，页面消息不进 wire、不进 agent 上下文（§8.11）。`webview` 授权在 M10 前一次性写进 `nsh.json`。

**威胁模型（写清楚边界）**：能力面保护的是 **UI/TSX 代码**被攻破时的爆炸半径；**agent 的动作不受它约束**——pi 的 bash 与工具仍以用户权限运行，由 pi 自己的权限模型负责。不要把「最小能力面」读成「agent 沙箱」。

UI **不持 fs、不持 process**：全部用户状态经 wire 落 `~/.pi/zu/`，进程操作由 Rust native module 代劳（见 §3.6）。这是**自选策略**而非平台限制（nsh 的 `Storage` 不需要能力，`fs`/`process` 也可授予）——换来单一写入点，代价是 engine 不在时无法落盘。

### 3.5 存储布局（路径即关系）

```
~/.pi/agent/sessions/--{encodedCwd}--/{timestamp}_{sessionId}.jsonl
    # captain：pi 原生位置。pi CLI 可见、可 --session 打开、可 resume
~/.pi/zu/
  registry.json                          # 容器注册表（JSON 快照 + 原子 rename + 启动对账）
  projects.json                          # Project + membership
  layouts/{containerId}.json             # 视图 stash（zoom 单独存，§4.3）
  settings.json                          # Zu 自己的偏好（pi 的 settings 只读）
  agents/{builtin,personal,project}/     # 子代理定义（markdown + frontmatter）
  subagents/{captainId}/{timestamp}_{runId}.jsonl   # 1 级子会话
```

子会话的三重自证：路径（父容器）＋ 文件名（runId）＋ header（`{ id: runId, parentSession: <captain 路径> }`）。

**版本化**：每个持久文件顶层带 `{ "v": 1, ... }`。读到 `v > 当前` 时只读打开并提示；`v < 当前` 走迁移链；迁移失败不阻塞启动（与不变量 1 一致）。

**Project 只由用户显式创建**：自动纳入的会话落 Chats 桶，不按 cwd 生成项目（真实数据里 276 个 cwd 目录大多是 worktree 名，按目录建项目会产生大量无意义的组）。

**对账是增量的**：记录上次扫描的 mtime 水位，`listAll` 只在首启或水位变化时全量；侧栏按「工作区 → 分组 → 会话」两层聚合 + 虚拟化，不做 660+ 行平铺。

### 3.6 Rust native module（重型集成的地基）

mixed 模板（`nsh.json` 的 `"rust": "."`），按域拆注册面，共用一个 `zu-native` crate：

| 模块 | 职责 | 生命周期 |
|---|---|---|
| `zu/engine` | 定位并 spawn `Contents/Helpers/pi-engine`，回收 | 进程级单例 |
| `zu/pty` | `portable-pty` 创建/读写/缩放/kill；输出经 `Callback::post` 推给 TSX | 容器 |
| `zu/lsp` | 起语言服务器、stdio JSON-RPC、诊断/hover/补全 | workspace |
| `zu/git` | shell out `git`（status/diff/log/branch/stage/commit） | 一次性调用 |
| `zu/fs` | `read/write/stat/list`：编辑器与文件树的读写面；路径策略在 Rust 侧（工作区根 + 显式 grant） | 一次性调用 |

**为什么是 `zu/fs` 而不是给 UI 开 `capabilities.fs`**：编辑器与文件树需要真实的读写，而 UI 的能力面要保持最小；`zu/fs` 让文件访问与 agent 的工具权限分开，LSP 的 `didOpen/didChange` 也能复用同一份内容（避免编辑器与 LSP 各读一遍）。**四域失败隔离**：engine、pty、lsp、git、fs 各自失败不影响其余；一个域的崩溃不能让 UI 失去所有能力。

**为什么必须有它**：nsh 的 `capabilities.process.execute` 只接受裸命令名或绝对路径、且精确字符串比对（不支持 `${dataDir}` 等变量），bundle 路径随安装位置变化，TSX 无法直接执行 sidecar。

### 3.7 分发与版本

- **sidecar 位置**：`Zu.app/Contents/Helpers/pi-engine`，直接执行、不释放到 dataDir（签名与公证覆盖最干净）。
- **pi 版本自管**：`engine/package.json` 精确 pin + `bun.lock` 进 git；升级 = 改 pin 的 PR（引擎测试 + TUI 冒烟 + 兼容性台账）；sidecar 内禁 `pi update`。
- **兼容性台账**：每个绕过 pi 缺口的适配登记「上游什么条件下可删」。
- **自更新**：GitHub Releases（nsh/updater）；仓库公开。**更新包必须包含 `Contents/Helpers`**——`nsh/updater` 替换整个 `.app`，漏掉即引擎消失。
- **签名**：nsh 的 `nsh package --target macos` 只做 **ad-hoc** 签名、且不认识 `Contents/Helpers`；其余是我们的活（`script/bundle-mac.sh`）：拷 sidecar 与两个 WASM（**必须与 sidecar 同目录**，photon 用 `process.execPath` 兜底）→ 逐个 `codesign --options runtime`（sidecar 带 `com.apple.security.cs.allow-jit`）→ 签 app → `notarytool` → `stapler`。ad-hoc 打包从 M0 起每轮冒烟，别把未知量留到正式签名那天。
- **遥测**：支持 pi-telemetry，但不在早期里程碑；默认不上报。

### 3.8 构建回路

- `engine/package.json` 的 `build`：`check-version`（`src/version.ts` 必须等于 pin）→ `bun build --compile --target=bun-darwin-arm64` → `cp` 两个 WASM 到 `dist/`（pi 上游同路径：`isBunBinary` / `copy-binary-assets` 的资产布局）。
- `script/bundle-mac.sh`：sidecar → `nsh package` → Helpers → 嵌套 ad-hoc 签名 → dmg。
- 开发：engine `bun run src/server.ts`（热重启）+ UI `nsh run .`（热重载）两条循环并行；UI 侧热更新在 mixed 模板下不可用（`nsh hot: no module zu/native`），改 TSX 需重启。
- **编译产物冒烟**：`dist/pi-engine` 起得来、握手成功、`session.list` 返回——每次改 engine 都跑（已由 `engine.test.ts` 的 freshEngine 覆盖）。

## 4. 前端：轮廓与画布

### 4.1 分工

**轮廓与内嵌对象分离**：壳（rail、项目侧栏、工具栏、状态条）零领域状态；画布是受控的 `nsh/base DockArea`。

### 4.2 panel 与 sheet

- **panel** 是带页签条的容器，可任意多个，可拖手调宽、拖拽停靠重排、zoom。
- **sheet** 是页签内容：Pi 会话（含 subagents/后台任务/轨迹/统计等派生视图）、终端、各 agent TUI（Claude/Codex/Copilot）、webview、编辑器、Diff。
- sheet 可跨 panel 拖拽（移动语义），**状态不丢**（`renderPanel` 按 key 渲染一次）。
- **单容器画布、单窗口**：侧栏一行 = 一个容器 = 一组面板的入口；切换行 = stash 当前布局 + restore 目标布局。多窗口不在设计中。M3 的过渡侧栏在容器行之下保留「全部会话」，M4 改为项目/分组聚合。

### 4.3 布局与状态

- 布局是**纯数据**：app 持有 `DockAreaLayout`，`onLayoutChange` 回报整份新布局传回。
- **sheet 身份 = 稳定 id**（`kind:instance`，如 `session:{containerId}`、`terminal:{containerId}:{n}`）；布局树只存 id，内容由 `sheets.tsx` 注册表解析。
- **按容器 stash**：`layouts/{containerId}.json`；zoom **不在 `DockAreaLayout` 里**（它是内部 signal + `onZoomChange` 事件），要单独存，恢复后用 ref 的 `groupOf`/`toggleZoom` 灌回。`onLayoutChange` 高频，debounce 后保存；切容器前先 flush，恢复时先离开现有 zoom 再按 panel id 找 group 灌回。布局与 zoom 的读写经 `layout.get/put`，UI 仍不持文件系统。
- **启动恢复上次活跃容器**；恢复时**静默移除**指向已死资源的 sheet。
- **canvas 空态 = Launcher**（项目 chip + composer + agent 动作行）。

### 4.4 键盘与焦点

v1 最小集：`⌘W` 关闭 sheet、`⌘1-9` 切 sheet、`⌘K` 命令面板（承载打开/切换/zoom/重置等全部动作）。panel 获焦高亮。

### 4.5 扩展宿主契约（Q23 的机制）

**不是"设 `hasUI = true`"就完了**：pi 默认给扩展一个 no-op 的 UI 上下文（`confirm` 静默 `false`、`notify` 静默丢弃），扩展与用户都不会察觉——这是最坏的"看起来加载了、实际什么都没发生"。契约：

1. **显式绑定**：engine 用 `bindExtensions({ uiContext, mode: "rpc" })` 装配（Q33）。`"rpc"` 是 pi 已有的语义，扩展按 `ctx.mode !== "tui"` 自我降级——不住创 `"gui"`；ThinkRail 的 `bindExtensions({ mode: "rpc", uiContext })` 是同一先例。
2. **UI 方法矩阵**：

| 方法 | 处理 |
|---|---|
| `confirm` / `select` / `input` | `ui.request` → nsh `AlertDialog` / `Picker` / `Input`，应答 `ui.response`；超时按 pi 的默认值 resolve |
| `editor` | 多行 `Input`（纯文本，无语法高亮） |
| `notify` | 系统通知（M11 前为状态条 Toast） |
| `setStatus` / `setTitle` | 状态条 / 窗口标题 |
| `custom` / `setWidget` / `setFooter` / `setHeader` / `onTerminalInput` | **no-op 并记日志**（不静默） |

3. **project trust**：项目有受保护资源时，Zu 弹一次「信任此项目」并写 pi 的 trust 面；否则 Q23 的"全量加载"在项目级不成立。信任状态与 Q24 的"写独立"不冲突：trust 是 pi 的语义，Zu 只触发它。
4. **验收**：用本机 `~/.pi/agent/extensions` 里的真实扩展跑一次（加载、`confirm` 弹窗、`notify` 到达），不需要模型。

### 4.6 常驻与通知

关窗即收起（无确认，后台 run 继续）、单实例强制、不做登录自启；turn settle / 子会话交付发系统通知（首版激进，后续按反馈做减法）；托盘菜单提供显示/退出。

## 5. 对象模型

### 5.1 对象与归属

| 对象 | 权威 | 存储 |
|---|---|---|
| Project（多根、恰一根 primary） | UI store（内容权威），写面经 engine | `~/.pi/zu/projects.json` |
| membership（container → project） | UI，活读 | 同上 |
| 容器注册表 | engine sidecar | `~/.pi/zu/registry.json` |
| Pi 会话转录（captain + subagents） | pi | §3.5 |
| 资源（PTY、webview） | engine / native module，**不持久** | — |
| 视图（panel/sheet 布局） | UI | `layouts/{containerId}.json` |
| 未读 | 协议态，UI 不镜像 | — |

### 5.2 Project

`{ id, name, nameOverridden, roots: [{ path, primary }], position }`；恰一根 primary；根存在且为目录；嵌套允许；去重静默。

- 容器创建时 `cwd = primary`（快照，此后不可变）；根组编辑只影响以后创建的容器。
- **归属显式**：`membership` 是唯一事实源，不按 cwd 猜；无归属落 Chats 桶。
- 名称未自定义时跟随 `basename(primary)`，改过即固定。
- 多根对 pi 只承载组织与终端 cwd——pi 是单 cwd 引擎，没有多根授权面。

### 5.3 SessionContainer

```ts
{ id: `pi:{sessionId}` | `external:{agent}:{uuid}`,
  kind: "Pi" | "Terminal" | "Claude" | "Codex" | "Copilot",
  cwd, projectId }
// 成员：captain（0 号）/ subagents（1 级，仅 Pi 型）/ resources（pty、webview）
```

M3 落地的注册表记录（`registry.json` 的 `containers[]`）：

```ts
{ id: `pi:${sessionId}`, kind: "Pi", cwd, archived: boolean,
  createdAt, updatedAt,
  sessions: [{ sessionId, path, name? }] }   // sessions[0] = captain
```

`runs[]` 记活跃 run（`{ id, containerId, sessionId, startedAt }`），进程启动时清空；`activeContainerId` 记上次活跃容器。

- **类型由 0 号决定**：Pi 型 = captain AgentSession；external 型 = PTY 一号进程。
- **GUI 映射**：侧栏一行 = 容器；主对话 sheet = captain 转录投影；subagents/统计等 = 成员投影（视图类）；容器内拉起的终端 = 资源；侧栏/Launcher 直接拉起的终端 = 独立 external 容器。
- **只两级对话树**：captain + subagents；子会话只收 captain 的消息，GUI 不开人类直连入口。

### 5.4 生命周期

- **alive()**：Pi 型读注册表 archived 位；external 型读 PTY 存活。翻转 ⇒ teardown：回收资源 → 级联归档子会话 → 摘行 → 剪 membership（external）。
- **settle ≠ 死**：容器只有 idle/running；settle 留册可续跑。
- **stop** = 杀容器全部活跃 run；**archive** = 容器死亡（有活跃子代理/后台任务先确认）。M3 的 `container.archive` 是唯一 teardown：abort/dispose 容器内引擎会话、丢 runs、把 `activeContainerId` 移到最近的活容器；记录、会话文件与布局保留，unarchive 原样恢复。
- **fork** = 新容器只复制 0 号前缀，不带成员与资源。
- **外部容器即进程**：进程 exit 即死、即摘行；关闭容器 = kill。
- **外部改动复活**：归档容器的 captain 文件被 pi CLI 继续后，下次启动对账复活并提示。

### 5.5 状态生命周期分级

| 层 | 对象 | 跨重启 |
|---|---|---|
| 持久 | Project / membership / 容器注册表 / 会话转录 / 视图 stash / 上次活跃容器 | ✓ |
| 易失 | **PTY 终端与 webview 页面**（应用重启不恢复终端） | ✗ |
| 易失 | 进行中的 run / 排队消息 / 未读计数 | ✗ |

新对象入库先回答「属于哪一层」，不允许未分级的持久化写面。

### 5.6 调度面（pi 扩展）

sidecar 内置扩展在 captain 会话内注册工具，实现闭包持有 `SessionManager`：

| 动词 | 语义 |
|---|---|
| `dispatch`（spawn=定义名） | 创建子会话，ack 回带 run id |
| `dispatch`（addr=run id） | 续跑 settled 子会话 |
| `inject`（addr=live run） | 运行中引导 |
| `abort`（addr=run id） | 停止 |
| `list_agents`（只读） | 子会话清单（live + settled + verdict） |

**扩展机制只承载调度面与会话内上下文，不承载所有权注册表**（扩展随会话生灭，容器跨会话长寿）。

**按会话角色门控**：`dispatch` 只在 captain 会话注册，subagent 会话不注册——否则全量加载扩展会让子会话递归派发，破坏「只两级」。三级以上在工具层直接拒绝并返回明确错误。

**run 的注册面**：`registry.json` 里加 `runs[]`（`runId`、`captainId`、定义名、状态）。**live 的 run 只在内存，settled 的 run 只在文件**；级联归档 = 归档 captain 时把 `runs[]` 中标为 settled 的条目保留、live 的中断并标注。`list_agents` 的 verdict 由两处合并：内存（live）+ 文件扫描（settled）。

**子代理定义**：markdown + YAML frontmatter（`name/description/tools/model/thinking/maxTurns/skills`，正文即 system prompt），三来源 builtin / personal / project（`.pi/agents/`），persona 认 `skills` 字段，定义变更热生效。

### 5.7 调度事件写入

调度事件（dispatch/inject/delivered）以 **`CustomEntry`**（`appendCustomEntry("zu.*", data)`）写入 captain 会话：不参与 LLM 上下文、pi 加载器容忍、用户可选装 Zu 的 pi 扩展在 CLI 渲染。`CustomMessageEntry` 因污染上下文而不用。

### 5.8 不变量

1. **pi → Zu 兼容最高优先**：pi 的任何会话都能列出/显示/打开/加载/预览/继续；解析失败不阻塞启动。
2. 容器 cwd == 创建时确认的目标。
3. 归属猜测为零。
4. 容器死亡 ⇒ 资源全回收 ⇒ 子会话级联归档 ⇒ 摘行。
5. 视图操作永不触碰会话与资源。
6. 单一创建入口、单点 teardown。
7. fork 不携带成员与资源。
8. 子会话只收 captain 消息，GUI 无人类直连入口；`dispatch` 只在 captain 注册。
9. **完成态权威**：`message_end` 与 pi 会话文件是唯一真相；UI 渲染 = 文件投影 + 事件加速。
10. **写者唯一性**：打开会话记录 `(path, size, mtime, leafId)`，写前校验；不一致转只读，不分叉。
11. **持久文件带版本**：未知的高版本只读打开，迁移失败不阻塞启动。

## 6. 技术选型

| 领域 | 选型 | 依据 |
|---|---|---|
| UI 框架 | nsh（TSX root，AppKit 后端） | 原生文本输入/滚动物理/无障碍；DockArea/TextView/Editor/DiffView 现成 |
| 引擎 | pi `1.5.0`（精确 pin），Bun `--compile` 单文件 | pi 官方支持 bun 二进制分发 |
| UI↔引擎 | loopback WS + token，`EngineConnection` 唯一边界 | 进程隔离 + 能力沙箱 |
| 重型集成 | Rust native module（mixed 模板），按域拆 | Q28/Q31 |
| 终端仿真核 | **先 nsh 内置 `VtEmulator`**；Ghostty + 扩 trait 作为条件性里程碑 | trait 上限锁死换核收益（见 evidence/terminal-emulator.md）；解析正确性由冒烟决定，不是已知缺陷 |
| 浏览器 | nsh `WebView`（原生 WKWebView，嵌布局可裁剪） | 无需自研 |
| 编辑器 | nsh `Editor` + 自研 LSP 客户端（Rust） | 组件齐备，LSP 是唯一缺口 |
| Diff | nsh `DiffView`（split/unified、hunk 操作） | 无需自研 |
| Git | shell out `git`（不引入 libgit2） | 零依赖、与 pi 工具行为一致 |
| 语言 | zh-CN 第一 + en fallback，类型化键表（`i18n.ts` + `locales/*.ts`） | nsh 0.4.0 运行时尚未导出 `nsh/i18n` 与 `localeSettings`，键表契约改为纯 TS（Q39），parity 由 `nsh test` 覆盖 |
| nsh | `Cargo.toml` 的 `nsh-core`/`nsh-base = "0.4.0"` + `Cargo.lock`；CLI 用与它同版本的构建 | nsh 比 pi 更不稳定（0.4.0、trait `#[non_exhaustive]`），升级需跑 `nsh check`/`nsh test` + 终端与 DockArea 冒烟 |

## 7. 实现状态（2026-11-10）

- **M0 完成**：`engine/`（Bun + pi 1.5.0）+ mixed 模板（`Cargo.toml`、`src/lib.rs` 的 `zu/engine`）+ sidecar 编译（75 MB 单文件，WASM 资产同目录）+ WS 握手。
- **M1 完成**：`engine.ts`（连接/请求/事件）、`sessions.ts`（会话 store，16 ms 批 flush）、`sheets.tsx` 的会话 sheet（`TextView` 流式 Markdown、工具卡、composer）、`App.tsx` 的会话侧栏与引擎状态条。turn 结束时 engine 写 `zu.turn` custom entry；流式中停止会广播 idle 并保留已生成文本；引擎重启后用 `session.info` 拿到的文件路径续聊。
- **M2 完成**：`contracts/protocol.ts` + `protocol.md`（信封、命令/事件表、幂等/重放、UI 矩阵）；`engine.ts` 的快照重连与监督（心跳、指数退避、`generation`）；`ui-host.tsx`（confirm 的 `AlertDialog`、select/input/editor 的 Dialog、toast/status/title）；`i18n.ts` + `locales/*.ts`（Q39）。门禁 22/22。
- **M3 完成**：`registry.json`/`layouts/`、容器生命周期与 archive 单点 teardown、按需 rehydrate 与 LRU、`containers.ts` 的按容器布局/zoom、`sessions.ts` 的多会话视图、可见性节流；侧栏容器 + 全部会话过渡形态。门禁 35/35。
- **外部审计**：2026-11-10 的一轮事实审计与架构评审，成立的 P0/P1 已并入本文；其中「alt screen 污染 scrollback」一条被证伪并撤回（`push_scrollback` 有 `primary.is_some()` 守卫），教训记在 [evidence/terminal-emulator.md](evidence/terminal-emulator.md)。审计材料已随收敛删除。
- **已知问题**：开发期热更新（`nsh run` 的 hot reload）在 TSX 变更后报 `nsh hot: no module zu/native`——native module 在 hot bundle 期间不可解析。重启 app 即可；不影响运行期。正式打包不受影响（无 hot reload）。另：headless 测试运行器没有帧循环，`requestAnimationFrame` 不跑，流式批 flush 因此用 `setTimeout(16)`。
- **打包**：`script/bundle-mac.sh`——`nsh package` 出 `.app`，sidecar 拷进 `Contents/Helpers`，嵌套 ad-hoc 签名，`hdiutil` 出 dmg（127 MB app / 51 MB dmg）。打包后 app 优先用包内 sidecar（仓库的构建不能遮蔽它）。

## 8. 已知风险（非决策）

1. `createAgentSession` 的完整真实会话（WASM 运行期加载）在扩展与 MCP 路径上仍未跑到。
2. `parentSession` 在 pi CLI 里的 fork 观感。
3. pi 升级对 `~/.pi/agent/sessions` 布局的影响（台账登记）。
4. **并发写**：pi 的会话写入是裸 `appendFileSync`，没有锁；两个写者会各自推进 leaf。按不变量 10 处理（检测 + 转只读）。
5. 签名/公证：嵌套签名 + JIT entitlement 的实际可行性（M0 的 ad-hoc 打包已冒烟，正式签名未验）。
6. **协议面**：`contracts/` v1 已冻结（`protocol.ts` + `protocol.md`）；后续只允许加可选字段，破坏性改动递增 `v`。
7. **引擎单点**：`generation`、心跳、退避重启、`state.snapshot` 已实现；崩溃时未完成回合的**内容**仍由 pi 会话文件兜底，但引擎内未落盘的 streaming 增量会丢，UI 标为中断。
8. **单实例与固定端口**：端口是常量 `47823`，第二个实例会撞端口；nsh 没有单实例原语，需锁文件或 `NSRunningApplication`，并给「端口被占用」明确文案。
9. **`~/.pi/zu/` 的清理**：归档容器、死 subagent 文件、旧 layout 会增长；启动时清理孤儿 layout（容器已不在注册表）。
10. **视图全量挂载**：DockArea 会把所有 panel 放进树（只有当前 tab 显示）；20 个 sheet（含 WebView/Editor/Terminal）同时存活时要「非可见 sheet 降级」（webview 暂停、editor 释放 rope、terminal 保留）。
11. **WebView 信任边界**（浏览器里程碑）：页面 `postMessage` 进 UI 代码；定为「页面消息不进 wire、不进 agent 上下文」，`injectJavaScript` 只做日志回传。

## 9. 文档

- [decisions.md](decisions.md)：Q1–Q31 决策台账（问题 → 裁决 → 落点 → 理由）。
- [roadmap.md](roadmap.md)：产品目标与里程碑。
- [evidence/](evidence/)：spike 实测、可行性分析、终端仿真核对比、决策过程记录。
