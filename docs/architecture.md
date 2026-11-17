# 架构

> 决策文档：记录 Zu 的当前架构形态与「为什么这样定」。决策的来龙去脉见 [decisions.md](decisions.md)。
> 文档分工：**本文 = 当前系统**；[sheet-module-ARCHITECTURE.md](sheet-module-ARCHITECTURE.md) = 扩展机制；
> [pi-acp-IMPLEMENTATION.md](pi-acp-IMPLEMENTATION.md) = pi 模块的 ACP 实现（A0–F0 已落地）；
> [pi-acp-PROTOCOL.md](pi-acp-PROTOCOL.md) = ACP 协议映射与历史裁决。
> 视觉规格见 [DESIGN.md](DESIGN.md)；执行计划见 [plan.md](plan.md)。

## 0. 一句话

**Zu 是 nsh（AppKit）写的桌面工作台，会话来源是两种 harness**：pi 是一会话一持久 ACP 进程（`pi-acp`），
manox 是进程内 AHP 宿主（`native/manox`）。两者都只是容器里的一种 sheet；壳与容器模型零 harness 语义，
会话的 durable 权威都在磁盘（`~/.pi` 会话文件 / `~/.manox` journal），零活进程可读。

## 1. 第一性约束

1. **pi 是 Node 生态的 JS 引擎**：需要 `node:module`、动态 `require`、原生/WASM 资产与可写的 `~/.pi`。
   nsh 的 TSX 运行时是 QuickJS，这些不在能力面内 → pi 不能进 UI 进程。
2. **Zu 自管 pi 版本**：引擎随 app 携带（`pi-harness/` 精确 pin pi 1.5.0），不依赖用户系统安装。
3. **nsh 有能力沙箱**：UI 进程保持最小能力面；文件与进程访问在 Rust native 侧。
4. **manox 是 Rust 内核**：只能经 native 边界（`native/manox`）进入，不能进 TSX。
5. **版本确定性**：Zu 的行为对「哪个 pi / 哪个 manox」可复现；升级 = 改 pin 的 PR。

## 2. 核心原则

| 原则 | 内容 |
|---|---|
| **兼容方向不对称** | pi → Zu 是硬约束：pi 原生产生的会话必须能列出、显示、打开、续跑。Zu → pi 允许增强部分不可见（subagents 与 Zu 状态住 `~/.pi/zu/`）。 |
| **三类对象** | 会话（durable，settle ≠ 死）/ 资源（进程生命周期）/ 视图（无生命周期，开关不影响前两类）。 |
| **关系模型只有三层** | Project → Container → Sheet。Container 是组织单元（cwd、项目归属、布局），**没有 harness 身份**；harness 属于 sheet 的 kind。 |
| **壳零模块语义** | 壳只渲染注册表，不解释 kind 的业务含义；目标契约见 [sheet-module-ARCHITECTURE.md](sheet-module-ARCHITECTURE.md)。 |
| **工作上下文不可变** | 容器 cwd 与项目归属在创建时快照；可变的是组织归属（membership）。 |
| **单一入口 / 单点** | 容器一个创建入口、一个 teardown 点；布局一个写者。 |
| **文件是事实** | 注册表与磁盘不一致时路径优先；外部改动优先复活。 |

## 3. 会话后端

### 3.1 拓扑

```
Zu.app（nsh TSX / AppKit）
├─ core/ + shell/ + canvas/   关系模型与外壳（零 harness 语义）
├─ modules/pi           pi 模块：ACP client（JSON-RPC over ndjson stdio）
│    └─ 每个会话一个持久 pi-acp ──▶ pi 1.5.0（Bun 单文件）
│         durable: ~/.pi/agent/sessions/*.jsonl
├─ modules/manox        manox 模块：AHP client（vendored reducers 折叠）
│    └─ zu/native 的 Manox 单例 ──▶ in-proc 宿主半边（manox v0.12.0）
│         durable: ~/.manox/core/*（journal）
└─ domains/ ──▶ zu/native（Rust）：acp / fs / git / lsp / pty / state / pimodels / picker / instance，
                terminal（自绘 ghostty 组件）
```

### 3.2 pi 线（ACP，默认）

- **传输是一会话一进程**：`native/src/acp.rs` 负责进程与字节，TS 侧
  `app/modules/pi/acp/{jsonrpc,acp}.ts` 负责 JSON-RPC id、超时与事件分派；`host.ts` 持有进程注册表。
  握手 `initialize` → `session/new|load|resume` → 多次 `session/prompt` → `session/update` 流；
  会话 sheet/容器归档/退出 app 才关闭进程。
- **崩溃 = 中断**：ACP 没有「重连」；进程意外退出让 pending turn 失败，UI 标中断，下一次用户动作
  `session/resume`，不自动重放。
- **看门狗**：60 s 内未 ready 的 harness 视为启动失败，带 stderr 报错。
- **读面**：`zu/state` 的 `scan_sessions(watermark)` 扫 `~/.pi` 会话目录（只读 header/名字/首条用户文本/消息数），
  UI 侧 fold 成会话视图；没有活引擎也能浏览。
- **只有一条传输**：旧 loopback engine（`contracts/protocol.ts`、`stores/engine.ts`、`pi-engine` 入口）
  已在 P4 删除；`ZU_PI_TRANSPORT` 不再存在。
- **进程**：一会话一持久 `pi-acp`，跨 turn 保留；关 sheet/归档容器/退出 app 才结束。崩溃 → 会话
  中断，下一次用户动作 `session/resume`；无 cap/TTL/RSS 回收（D1）。
- **官方配置 parity**：`createAgentSessionServices` 装配；CLI 的 builtin（codemode/tool-search/mcp）
  以 `builtin:true` 复刻，`mcp.json`/packages/skills/prompts 走同一 loader；项目信任用 ACP elicitation
  在 `session/new` 期间询问；ACP `mcpServers` 也注册进 MCP 扩展。漂移测试守住 builtin 名单。
- **模型/档位/命令/用量/审批**：协议状态。`session/new|resume|load` 回 `configOptions`/`modes`，
  `session/set_config_option`、`session/set_mode` 切换；`available_commands_update`、
  `usage_update`、`session_info_update`、`compaction_update`、`notice` 投影进 `SessionView`。
  Hero 的预选在会话建立后经 `set_config_option` 应用，不再有 spawn env。
- **容器 ↔ 会话**：`pi` 模块维护自己的 `containerId → sessionIds` 投影（不再写进容器记录）；
  容器记录只存 `sheetOrder`（标题序，可持久化）。
- 协议映射与 P0–P4 的历史裁决见 [pi-acp-PROTOCOL.md](pi-acp-PROTOCOL.md)。
- **已落地**：持久进程、`configOptions`/`set_config_option`、`resume`/`close`、权限/elicitation、
  命令表与子代理；见 [pi-acp-IMPLEMENTATION.md](pi-acp-IMPLEMENTATION.md)。

### 3.3 manox 线（in-proc AHP）

- **单例宿主**：`native/manox` 把 manox 的宿主半边（`manox-ahp` + `manox-ahp-runtime` + `manox-session-core`）
  在进程内装配，独占一条 `manox-host` tokio 线程；帧经 `Callback::post` 推给 TSX。
- **崩溃隔离不对称**：宿主半边 panic 的爆炸半径是整壳；泵边界 `catch_unwind` 把 panic 转成
  `transport-error`，UI 走 `Manox.restart` + `reconnect`。这是结构性的缓解，不是进程隔离。
- **客户端零翻译**：`contracts/ahp/` 是 vendored 的 AHP 类型 + reducers；消息区直接绑定折叠态。
- **模型目录共用（Q104）**：`native/manox` 的 boot 把 `~/.pi` 的 `models.json`/`auth.json` 翻译成内核的
  provider 注册（`register_providers_yaml`），app 侧把 pi ref 组合成 registration-qualified
  `{provider}-{wire}/{model}`；两条 harness 用同一份模型列表，不再各养一套。
- **折叠对账门禁**：同一 chat 的「快照腿」与「journal 重放腿」喂同一份 reducer，最终状态必须相等；
  TS 与 Rust reducers 的漂移用同一组 fixtures 在两侧测试（`app/tests/manox.test.ts` + manox 仓的 reducer 测试）。
- **范围**：「能对话」最小回路（发送 → 流式 → 工具卡 → 最小审批/elicitation → settle/取消）；
  之外的 Steer 产品面不做。

### 3.4 契约面

| 面 | 位置 | 归属 |
|---|---|---|
| Sheet 模块契约 | `contracts/module.ts`（SheetKindSpec、SheetModule、意图/贡献） | 核心 |
| AHP | `contracts/ahp/`（PIN.md 记录上游版本与同步脚本） | manox 模块 |
| ACP 词汇 | `app/modules/pi/acp/` 内的窄类型 + `app/modules/pi/protocol.ts` | pi 模块 |
| Zu 状态与布局 | `app/domains/state.ts` 的 TS 形状 | 核心（`zu/state` 只做读写） |

壳不 import 任何一侧的协议类型；`contracts/` 只留跨模块词汇。

### 3.5 能力面（`nsh.json`）

当前声明：`webview.hosts: ["*"]`（浏览器）、`notifications: true`、`statusBar: true`、
`openUrl.schemes: ["vscode"]`、`process.env` 白名单（`ZU_PORT`、`ZU_STATE_DIR`、`MANOX_RUN_LIVE`、
`ZU_SKIP_LIVE`、`ZU_MANOX_GATE`、`BUN`：fixtures 起 JS 运行时的入口只认这一个环境变量，未授予则
`js-runtime.ts` 永远走默认值）。旧引擎的回环网络能力已随 wire 删除。

**威胁模型**：能力面保护的是 **UI/TSX 代码**被攻破时的爆炸半径；**agent 的动作不受它约束**——
harness 的 bash/工具仍以用户权限运行，由各自引擎的权限模型负责。不要把「最小能力面」读成「agent 沙箱」。

UI 不持 fs / process：文件读写只经 `zu/fs`，进程只经 native 域。这是自选策略（换取单一写入点）。

### 3.6 存储布局

```
~/.pi/agent/sessions/--{encodedCwd}--/{timestamp}_{sessionId}.jsonl   # pi 会话（pi CLI 可见）
~/.manox/                                                             # manox 内核状态（journal）
~/.pi/zu/
  registry.json        # 容器注册表（UI 写，读时兼容旧形状）
  projects.json        # Project + membership
  layouts/{id}.json    # 每容器布局与 zoom
  settings.json        # 壳的偏好（侧栏宽等）
  agents/、subagents/  # pi 的子代理定义与子会话（1 级）
```

工作区侧还有一个引擎产的目录：`<cwd>/.zu/artifacts/` 是 agent 产出物的家（报告/图表/mockup），
由 pi-harness 的 artifacts 守卫（见 `docs/pi-acp-IMPLEMENTATION.md` §19）首次写入时创建，
并以 `.zu/.gitignore`、`.zu/artifacts/.gitignore`（内容均为 `*\n`）自忽略；
它不属于上面的 UI 状态面，写者只有 harness 守卫，UI 只读（files 面板照常显示）。

**写者反转（v2）**：这些文件只由 UI 经 `zu/state` 完成读写（`read`/`write`/`scan_sessions`）；
没有引擎子目录、没有第二个写者。
`zu/state` 的 `write` 是临时文件 + rename，并拒绝 `v` 更新的覆盖（`ERR_STATE_STALE`）。

**版本化**：每个持久文件顶层 `{ "v": 1, ... }`；高版本只读打开，迁移失败不阻塞启动。

**对账是增量的**：会话索引按 mtime 水位跳过解析；侧栏虚拟化，不做全量平铺。

### 3.7 Rust native 域

一个 crate（`native/`）一个注册面 `zu/native`；manox 另有 `manox/native`。

| 域 | 职责 | 形态 |
|---|---|---|
| `Acp` | 每个会话的 `pi-acp` 子进程：argv、cwd、进程组、有界帧（32 MiB） | class（一会话一个） |
| `State` | `read`/`write`（原子、版本拒绝）、`scan_sessions`（mtime 水位） | module |
| `Fs` | 显式根、越界/符号链接拒绝、2 MiB 读、原子写、`ERR_FS_STALE` | module |
| `Git` | shell out、根必须为仓库顶层、porcelain v2、无网络/无全局配置 | module |
| `Lsp` | 每容器×语言族一个进程、有界 `Content-Length` 帧、无 shell | class |
| `Pty` | `portable-pty`、reader/writer/waiter、`Callback::post`、`Drop` 兜底 kill | class |
| `TerminalSession` | 程序 + PTY + libghostty-vt 仿真器：PTY 读线程在会话锁下喂仿真器，屏幕/历史/模式随会话存活（不随视图）；标题、OSC 52、OSC 9/777 通知、OSC 9;4 进度、退出经一个事件回调到 TSX；文本、查找、选择可无视图读取 | class |
| `zu.terminal` | macOS 原生组件（`native/src/term_view`）：按 id 附着会话，自有 NSView 以 CoreText 逐格绘制（方框/块/盲文/Powerline 按几何画），自身是 `NSTextInputClient`；鼠标上报、选择手势、链接、查找高亮、滚动条、闪烁、焦点上报都在视图内；剪贴板、链接（开进浏览器 sheet）、查找栏出到 TSX | native component |
| `Instance` | 单实例锁：临时文件 + `hard_link`、pid 判活、死锁回收 | module |
| `Picker` | Finder 目录选择 | module |
| `PiModels` | 模型目录（`~/.pi`）+ 无模型原因 | module |
| `Manox` | AHP 宿主单例 + 帧泵 + `restart` | module（另一注册面） |

重型集成一律在 native 侧；TS 侧只做协议与 UI。

### 3.8 分发与构建

- **构建**：`pi-harness/package.json` 的 `build` 产出 `dist/pi-acp` 与两个 WASM 资产（photon/QuickJS）。
- **打包**：`bun script/tasks.ts bundle` 把 `.app`、`Contents/Helpers/pi-acp`（含两个 WASM）与 ad-hoc 签名串起来，
  并断言三个文件都在。
- **签名**：nsh 只做 ad-hoc；正式发布需 Developer ID + 嵌套签名 + JIT entitlement + 公证（未做，M13）。
- **更新**：`nsh/updater` 未配置（无 release/公钥）；`updates.ts` 诚实区分 development/未配置/可检查，
  不伪造更新源。

## 4. 前端

### 4.1 分层

```
App.tsx（装配点：startModules() + 跟随系统语言 + lifecycle）
└─ core/       registry、containers、dock、projects、lifecycle、shell-actions、types
   shell/      workbench、sidebar、titlebar、tab-plus、lifecycle-ui、project-dialog、settings/search/updates
   canvas/     sheet 解析（registry 查找）与容器标题、`+` 覆盖层
   modules/    home、browser、files、git、terminal、problems、pi、manox
   domains/    能力型面（唯一 import zu/native 的地方）
   ui/         无状态原语、token、图标、i18n
```

依赖自上而下：`modules → core/domains/ui`，`shell → core/ui`，`core`/`shell` 不 import 模块；
装配点 `App.tsx` 是唯一 import 模块的地方。规则由 `bun script/check-layers.mjs` 守卫。

### 4.2 panel 与 sheet

- **sheet 身份 = 稳定 id**（`kind:instance`）：`home:{containerId}`、`home:scratch`、`session:{sessionId}`、
  `manox-chat:{threadId}:{chatId}`、`terminal:{containerId}:{n}`、`webview:{containerId}:{n}`、
  `files:{containerId}`、`editor:{containerId}:{b64 path}`、`diff:{containerId}:{b64 old~new}`、
  `changes/history/problems:{containerId}`、`subagents:{containerId}`。
- **容器标题 = 存活的最早创建 sheet 的 `title()`**（`sheetOrder` 创建序）；Hero 不参与。
- **Hero 是容器起始页**：项目 chip、composer、harness 选择与动作行；在容器内提交/选动作会就地替换 Hero。
- **scratch 画布**：无 cwd/进程/注册表/持久化；提交后铸真实容器并迁移 sheet。
- **终端是容器资源**：一个容器可多个 `terminal:{containerId}:{n}`，PTY 按资源 id 记账；归档杀全部。
- **浏览器**：每 sheet 一个 `WebView`；不可见时卸载、按 store URL 重挂载（nsh 没有 pause API）。

### 4.3 布局与状态

- 布局是纯数据（`DockAreaLayout`），app 持有；`onLayoutChange` 回传整份。
- 按容器 stash 到 `layouts/{id}.json`；zoom 单独存并在恢复后灌回。
- `visiblePanels()` 由布局的 active tab（或 zoom）算出，非可见 sheet 只画占位。
- 启动顺序：读容器注册表 → 切容器（布局 + hydrate）→ 扫描会话索引；画布不等全量索引。
- 所有画布意图取 ticket，迟到的应答不得覆盖新意图。

### 4.4 键盘

`⌘W` 关闭 sheet、`⌘1-9` 切 sheet、`⌘K` 命令面板（后续）、`⌘0` 显示主窗口。焦点/zoom 由 DockArea 处理。

### 4.5 扩展宿主（pi，ACP）

旧引擎的扩展 UI 桥（`bindExtensions`、confirm/select/input/editor、notify/status/title）已随 P4 删除，
在 distro 内以 ACP 桥重建：confirm/select/input/editor → `elicitation/create`，
notify/status/title → `notice`/`session_info_update`，工具审批 → `session/request_permission`。
rich presentation（widget/footer/custom…）没有 ACP 等价面，降级为一条 warning notice。
见 [pi-acp-IMPLEMENTATION.md](pi-acp-IMPLEMENTATION.md) §6–§9。

### 4.6 常驻、通知与更新

- 关窗收起不退出；托盘 Show/Hide；`⌘Q` 先释放单实例锁再退出。
- 单实例锁在状态目录（`~/.pi/zu/instance.lock`），pid 判活；第二实例只显示提示、不启引擎。
- 通知只在主窗口不可见/失焦时发；pi 的 turn settle 由模块调用 `core/notifications.notifySettled`
  （以 sheet id 为单位），按 id 替换、5 s 去重；按下恢复窗口、切到该 sheet 的容器并打开它。
- 更新三态（development / 未配置 / 可检查）；安装成功即退出进程，UI 保持「正在安装」。

## 5. 对象模型

### 5.1 归属

| 对象 | 权威 | 存储 |
|---|---|---|
| Project / membership | UI store（读写成对） | `~/.pi/zu/projects.json` |
| 容器注册表 | UI（经 `zu/state`） | `~/.pi/zu/registry.json` |
| pi 会话转录 | pi | `~/.pi/agent/sessions/` |
| manox thread/chat | manox | `~/.manox/` journal |
| 资源（PTY / webview / LSP） | native 域 / nsh UI | 不持久 |
| 视图布局 | UI | `layouts/{id}.json` |
| 未读 / 活跃 run | 运行时 | 不持久 |

### 5.2 Project

`{ id, name, nameOverridden, roots: [{ path, primary }], position, createdAt, updatedAt }`；恰一根 primary；
根存在且为目录；多根允许；`membership` 是容器归属的唯一事实源（缺省 = Chats）。
容器 cwd = 创建时的 primary 快照；改根不移动活容器。

### 5.3 SessionContainer

```ts
{ id, cwd, projectId?, archived, createdAt, updatedAt, sheetOrder?: string[] }
```

容器**没有 harness 身份**：`kind`、`sessions[]` 已删除（S3）。哪些 sheet 属于它由布局与
`sheetOrder` 表达；「这个容器的会话是哪些」是 pi 模块自己的 `containerId → sessionIds` 投影。
新建容器的模块调用 `createContainerRecord({ id, cwd, projectId, sheets })`；外部终端容器是
terminal 模块的一个 intent。

### 5.4 生命周期

- **settle ≠ 死**：容器只有 idle/running。
- **archive 是唯一 teardown**：结束时序为「更新注册表 → 结束资源（PTY/LSP/连接）→ 摘行」；
  记录、会话文件与布局保留。
- **无 sheet 自动归档**：容器的 `sheetCount` 归零时切到相邻容器再 archive（Hero 也计入）。
- **外部进程即容器**（现状）：进程退出 → sheet 关 → 容器归档。
- **外部改动复活**：归档容器的会话文件被 CLI 继续后，下次对账复活并提示。

### 5.5 状态生命周期

| 层 | 对象 | 跨重启 |
|---|---|---|
| 持久 | Project / membership / 容器注册表 / 会话转录 / 布局 + zoom / 上次活跃容器 | ✓ |
| 易失 | PTY 终端、webview 页面、LSP 进程与诊断、进行中的 run、排队消息、未读 | ✗ |

新对象先回答「属于哪一层」，不允许未分级的持久化写面。

### 5.6 子代理（pi 模块）

`dispatch` 扩展在 ACP 进程内恢复（只注册进 captain；子会话 `noExtensions`），名册/转录/派发/中止走
`_zu/subagents/{list,transcript,dispatch,abort}`。live run 只在内存，settled 索引落
`~/.pi/zu/subagents/index.json`，重启后经一个 resume 的 captain 读取。见
[pi-acp-IMPLEMENTATION.md](pi-acp-IMPLEMENTATION.md) §7–§9.8。

### 5.7 不变量

1. pi → Zu 兼容最高优先；解析失败不阻塞启动。
2. 容器 cwd == 创建时确认的目标。
3. 归属猜测为零。
4. 容器死亡 ⇒ 资源回收 ⇒ 子会话级联归档 ⇒ 摘行。
5. 视图操作不触碰会话与资源。
6. 单一创建入口、单点 teardown。
7. 子会话只收 captain 消息；`dispatch` 只在 captain 注册。
8. **完成态权威**：pi 会话文件 / manox journal 是唯一真相；UI 渲染 = 文件投影 + 事件加速。
9. 写者唯一：会话写入前校验 `(path, size, mtime, leafId)`，不一致转只读。
10. 持久文件带版本；高版本只读。

## 6. 技术选型

| 领域 | 选型 | 依据 |
|---|---|---|
| UI | nsh（TSX root，AppKit 后端） | 原生输入/滚动/无障碍；DockArea/TextView/Editor/DiffView 现成 |
| pi | 精确 pin `1.5.0`，Bun `--compile` 单入口 `pi-acp` | 官方支持 bun 二进制分发 |
| pi 传输 | ACP over stdio，一会话一持久进程 | 进程隔离、公共协议、崩溃后 resume |
| manox | git pin `v0.12.0`，in-proc AHP | 内核即宿主，零进程；接受崩溃域不对称 |
| 重型集成 | Rust native module，按域拆注册面 | Q28/Q31 |
| 终端核 | `TerminalSession`（libghostty-vt，Rust 侧随 PTY 存活）+ 原生组件 `zu.terminal` | 网格与输入法是元素层给不了的保证（Q114）；输出与按键不经 TSX（Q115） |
| 浏览器 | nsh `WebView` | 无需自研 |
| 编辑器 / Diff | nsh `Editor` / `DiffView` + 自研 LSP 客户端 | 组件齐备 |
| Git | shell out `git` | 零依赖、行为与 pi 工具一致 |
| 语言 | 跟随系统 `locale()`；类型化键表 | 无 UI 入口 |
| 字体 | Geist（正文）+ Geist Mono（代码面）仅 sheet 内容（crate `assets!()`）；Lilex 已废止（Q110） | 轮廓保持系统字体 |
| nsh | git pin `f4d68f7`（0.5.0）+ `Cargo.lock`，CLI 同步 `.cnb.yml` | 组件/滚动/终端 API 与 pin 一致 |

## 7. 状态与已知问题（2026-11-13）

**已交付**：M0–M12（地基、对话、契约、容器、项目、轮廓、终端、编辑器、Git、浏览器、LSP、常驻/通知/更新）；
**ghostty 终端（Q113→Q114，2026-11-17）**：替换 nsh `<Terminal>`/`VtEmulator`，PTY 保留；终端是 macOS 原生组件；
Casing II；C8 三包布局；ACP cutover（P0–P4：distro ACP 入口、`zu/acp` 泵、UI 读写反转、控制面切换、
旧 wire 删除）；manox 真宿主（M1）；**sheet 模块化 S0–S3**（注册表、domains、工作台与 harness 模块、
容器去 harness 身份、通知按 sheet id）；**Pi × ACP 会话运行时 A0–F0**（持久进程、协议配置/命令/用量、
权限与 elicitation、扩展 UI、子代理、sheet/容器/退出生命周期）。

**待做**：

1. **打包产物真机启动**：脚本已绿；发布前跑一轮真实 turn。

**Pi × ACP 真机 live 验收（2026-11-13）**：模型/档位切换与 resume 保留、`/compact`（151k→46k）、
审批放行/拒绝、扩展 confirm/select/input、子代理 settle/abort/重启读转录、SIGKILL 后 resume、
进程收尾、冷启动/首 token/RSS 记录均通过。记录见
[evidence/pi-acp-live-2026-11-13.md](evidence/pi-acp-live-2026-11-13.md)；
验收项见 [pi-acp-IMPLEMENTATION.md](pi-acp-IMPLEMENTATION.md) §11。

**已知问题（非决策）**：

- **并发写**：pi 的会话写入无锁；两个写者各自推进 leaf。按不变量 9 检测并转只读。
- **签名/公证**：嵌套签名 + JIT entitlement 未用真 Developer ID 验证（M13）。
- **更新**：仓库无 updater 源/公钥/release，真实下载、签名校验、替换 `.app` 未跑过。
- **通知**：headless 不产生系统横幅；未签名的开发 app `permission()` 为 unavailable。
- **托盘/通知点击/第二进程实拦**：未真机验证。
- **nsh 菜单崩溃**：pin 的 nsh 在菜单 owner 被卸载时 panic（`signal read or written after its owner was disposed`）；
  测试打日志但通过，属上游缺陷。
- **WebView**：`target=_blank`/`window.open` 无回调（nsh 0.4.0）；深色页面可能仍用黑字。
- **LSP**：每容器×语言族一个进程；诊断只保留打开文件；全文 `didChange`；命令解析保留 rustup symlink。
- **malachite-bigint 双版本**：生成的 `.nsh/rust/Cargo.lock` 需 `cargo update -p malachite-bigint@0.14.0 --precise 0.12.0`
  （`native/manox/Cargo.toml` 有注释）。
- **manox provider 路径**：上游直查 `~/.manox`（`MANOX_HOME` 可覆盖），测试隔离需 `MANOX_HOME`+`MANOX_CLAUDE_HOME`+`HOME` 三变量。
- **审批通知**：审批卡在会话内渲染；窗口不在前台时的系统通知（设计 §9.7）尚未接线。
- **审批快捷键/页签圆点**：`⏎/⌘⏎/Esc` 与容器行/页签的 `waiting_user` 圆点未做。
- **子代理名册**：live run 只在内存；重启后需先 resume 一个 captain 才能读 settled 索引。

## 8. 文档

| Doc | 内容 |
|---|---|
| [sheet-module-ARCHITECTURE.md](sheet-module-ARCHITECTURE.md) | 扩展机制：sheet 模块契约、能力域、S0–S3 落地 |
| [pi-acp-IMPLEMENTATION.md](pi-acp-IMPLEMENTATION.md) | **已落地（A0–F0）**：Pi × ACP 的会话运行时、协议面、UI/UX、验收 |
| [pi-acp-PROTOCOL.md](pi-acp-PROTOCOL.md) | pi 模块：ACP 协议映射与历史裁决（P0–P4） |
| [DESIGN.md](DESIGN.md) | 视觉规格：token、外壳几何、表面、动效、各 sheet |
| [decisions.md](decisions.md) | 决策台账（Q1–Q115） |
| [plan.md](plan.md) | 执行计划与门禁 |
| [evidence/](evidence/) | 可再生的验证产物（截图、实测记录） |
