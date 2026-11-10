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

### 3.3 wire（`contracts/`）

UI 与引擎之间唯一的共享面：TS 类型 + 小纯运行时，带协议版本（握手返回 `{ engine, pi, protocol }`，feature gate 按 `protocol` 不按 pi 版本）。

- **命令**：`container.list/open/archive`、`session.prompt/steer/followUp/abort/resume/fork`、`pty.open/resize/write/close`、`state.get/set`、`engine.info`
- **事件**：`message.delta/complete`、`tool.update`、`agent.state`（thinking→executing→awaiting）、`cost.update`、`container.updated`（含未读）、`resource.gone`、`error`
- **回合终点锚 `agent_settled`**（`agent_end` 只是一次低层 run 结束，retry/compaction/steering 之后仍会继续）；prompt 响应的 `disposition` 区分 started/handled。

### 3.4 能力面（`nsh.json`）

```json
"capabilities": {
  "network": { "hosts": ["127.0.0.1"] }
}
```

WebSocket 按 `hosts` 授权（`sockets` 只给 `net.connect` 的裸 TCP，且只接受精确 `host:port`）；`notifications` 不是合法能力键，通知在 M10 用 nsh 的 desktop 模块。

UI **不持 fs、不持 process**：全部用户状态经 wire 落 `~/.pi/zu/`，进程操作由 Rust native module 代劳（见 §3.6）。这是**自选策略**而非平台限制（nsh 的 `Storage` 不需要能力，`fs`/`process` 也可授予）——换来单一写入点，代价是 engine 不在时无法落盘。

### 3.5 存储布局（路径即关系）

```
~/.pi/agent/sessions/--{encodedCwd}--/{timestamp}_{sessionId}.jsonl
    # captain：pi 原生位置。pi CLI 可见、可 --session 打开、可 resume
~/.pi/zu/
  registry.json                          # 容器注册表（JSON 快照 + 原子 rename + 启动对账）
  projects.json                          # Project + membership
  layouts/{containerId}.json             # 视图 stash（含 zoom）
  settings.json                          # Zu 自己的偏好（pi 的 settings 只读）
  agents/{builtin,personal,project}/     # 子代理定义（markdown + frontmatter）
  subagents/{captainId}/{timestamp}_{runId}.jsonl   # 1 级子会话
```

子会话的三重自证：路径（父容器）＋ 文件名（runId）＋ header（`{ id: runId, parentSession: <captain 路径> }`）。

### 3.6 Rust native module（重型集成的地基）

mixed 模板（`nsh.json` 的 `"rust": "."`），按域拆注册面，共用一个 `zu-native` crate：

| 模块 | 职责 | 生命周期 |
|---|---|---|
| `zu/engine` | 定位并 spawn `Contents/Helpers/pi-engine`，回收 | 进程级单例 |
| `zu/pty` | `portable-pty` 创建/读写/缩放/kill；输出经 `Callback::post` 推给 TSX | 容器 |
| `zu/lsp` | 起语言服务器、stdio JSON-RPC、诊断/hover/补全 | workspace |
| `zu/git` | shell out `git`（status/diff/log/branch/stage/commit） | 一次性调用 |

**为什么必须有它**：nsh 的 `capabilities.process.execute` 只接受裸命令名或绝对路径、且精确字符串比对（不支持 `${dataDir}` 等变量），bundle 路径随安装位置变化，TSX 无法直接执行 sidecar。

### 3.7 分发与版本

- **sidecar 位置**：`Zu.app/Contents/Helpers/pi-engine`，直接执行、不释放到 dataDir（签名与公证覆盖最干净）。
- **pi 版本自管**：`engine/package.json` 精确 pin + `bun.lock` 进 git；升级 = 改 pin 的 PR（引擎测试 + TUI 冒烟 + 兼容性台账）；sidecar 内禁 `pi update`。
- **兼容性台账**：每个绕过 pi 缺口的适配登记「上游什么条件下可删」。
- **自更新**：GitHub Releases（nsh/updater）；仓库公开。
- **签名**：嵌套签名 + hardened runtime + Bun JIT entitlement（`com.apple.security.cs.allow-jit`）+ 公证。
- **遥测**：支持 pi-telemetry，但不在早期里程碑；默认不上报。

### 3.8 构建回路

- `engine/build.ts`：`bun install --frozen-lockfile` → `bun build --compile --target=bun-darwin-arm64` → `dist/`（pi 上游同路径：`isBunBinary` / `copy-binary-assets` 的 WASM 资产布局）。
- 开发：engine `bun run engine/src/server.ts`（热重启）+ UI `nsh dev`（热重载）两条循环并行。

## 4. 前端：轮廓与画布

### 4.1 分工

**轮廓与内嵌对象分离**：壳（rail、项目侧栏、工具栏、状态条）零领域状态；画布是受控的 `nsh/base DockArea`。

### 4.2 panel 与 sheet

- **panel** 是带页签条的容器，可任意多个，可拖手调宽、拖拽停靠重排、zoom。
- **sheet** 是页签内容：Pi 会话（含 subagents/后台任务/轨迹/统计等派生视图）、终端、各 agent TUI（Claude/Codex/Copilot）、webview、编辑器、Diff。
- sheet 可跨 panel 拖拽（移动语义），**状态不丢**（`renderPanel` 按 key 渲染一次）。
- **单容器画布、单窗口**：侧栏一行 = 一个容器 = 一组面板的入口；切换行 = stash 当前布局 + restore 目标布局。多窗口不在设计中。

### 4.3 布局与状态

- 布局是**纯数据**：app 持有 `DockAreaLayout`，`onLayoutChange` 回报整份新布局传回。
- **sheet 身份 = 稳定 id**（`kind:instance`，如 `session:{containerId}`、`terminal:{containerId}:{n}`）；布局树只存 id，内容由 `sheets.tsx` 注册表解析。
- **按容器 stash**：`layouts/{containerId}.json`；zoom **不在 `DockAreaLayout` 里**（它是内部 signal + `onZoomChange` 事件），要单独存，恢复后用 ref 的 `groupOf`/`toggleZoom` 灌回。`onLayoutChange` 高频，debounce 后保存。
- **启动恢复上次活跃容器**；恢复时**静默移除**指向已死资源的 sheet。
- **canvas 空态 = Launcher**（项目 chip + composer + agent 动作行）。

### 4.4 键盘与焦点

v1 最小集：`⌘W` 关闭 sheet、`⌘1-9` 切 sheet、`⌘K` 命令面板（承载打开/切换/zoom/重置等全部动作）。panel 获焦高亮。

### 4.5 扩展 UI 桥

engine 侧 `ctx.hasUI = true`；扩展的 `ctx.ui.confirm/select/input` 经 wire 转成 nsh 原生 `AlertDialog` / `Picker` / `Input`；`ctx.ui.editor` 与 `ctx.ui.custom` 降级为纯文本并记录。

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

- **类型由 0 号决定**：Pi 型 = captain AgentSession；external 型 = PTY 一号进程。
- **GUI 映射**：侧栏一行 = 容器；主对话 sheet = captain 转录投影；subagents/统计等 = 成员投影（视图类）；容器内拉起的终端 = 资源；侧栏/Launcher 直接拉起的终端 = 独立 external 容器。
- **只两级对话树**：captain + subagents；子会话只收 captain 的消息，GUI 不开人类直连入口。

### 5.4 生命周期

- **alive()**：Pi 型读注册表 archived 位；external 型读 PTY 存活。翻转 ⇒ teardown：回收资源 → 级联归档子会话 → 摘行 → 剪 membership（external）。
- **settle ≠ 死**：容器只有 idle/running；settle 留册可续跑。
- **stop** = 杀容器全部活跃 run；**archive** = 容器死亡（有活跃子代理/后台任务先确认）。
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
8. 子会话只收 captain 消息，GUI 无人类直连入口。

## 6. 技术选型

| 领域 | 选型 | 依据 |
|---|---|---|
| UI 框架 | nsh（TSX root，AppKit 后端） | 原生文本输入/滚动物理/无障碍；DockArea/TextView/Editor/DiffView 现成 |
| 引擎 | pi `1.5.0`（精确 pin），Bun `--compile` 单文件 | pi 官方支持 bun 二进制分发 |
| UI↔引擎 | loopback WS + token，`EngineConnection` 唯一边界 | 进程隔离 + 能力沙箱 |
| 重型集成 | Rust native module（mixed 模板），按域拆 | Q28/Q31 |
| 终端仿真核 | **先 nsh 内置 `VtEmulator`**；Ghostty + 扩 trait 作为条件性里程碑 | trait 上限锁死换核收益（见 evidence/terminal-emulator.md） |
| 浏览器 | nsh `WebView`（原生 WKWebView，嵌布局可裁剪） | 无需自研 |
| 编辑器 | nsh `Editor` + 自研 LSP 客户端（Rust） | 组件齐备，LSP 是唯一缺口 |
| Diff | nsh `DiffView`（split/unified、hunk 操作） | 无需自研 |
| Git | shell out `git`（不引入 libgit2） | 零依赖、与 pi 工具行为一致 |
| 语言 | zh-CN 第一 + en fallback，Fluent 键表 | 与 Steer 一致 |

## 7. 实现状态（2026-11-10）

- **M0 完成**：`engine/`（Bun + pi 1.5.0）+ mixed 模板（`Cargo.toml`、`src/lib.rs` 的 `zu/engine`）+ sidecar 编译（75 MB 单文件，WASM 资产同目录）+ WS 握手。
- **M1 完成**：`engine.ts`（连接/请求/事件）、`sessions.ts`（会话 store）、`sheets.tsx` 的会话 sheet（历史 + 流式 + composer）、`App.tsx` 的会话侧栏与引擎状态条。
- **已知问题**：开发期热更新（`nsh run` 的 hot reload）在 TSX 变更后报 `nsh hot: no module zu/native`——native module 在 hot bundle 期间不可解析。重启 app 即可；不影响运行期。正式打包不受影响（无 hot reload）。
- **打包**：`script/bundle-mac.sh`——`nsh package` 出 `.app`，sidecar 拷进 `Contents/Helpers`，嵌套 ad-hoc 签名，`hdiutil` 出 dmg（127 MB app / 50 MB dmg）。打包后 app 优先用包内 sidecar（仓库的构建不能遮蔽它）。

## 8. 已知风险（非决策）

1. `createAgentSession` 的真实运行（WASM 运行期加载）未验证。
2. `parentSession` 在 pi CLI 里的 fork 观感。
3. pi 升级对 `~/.pi/agent/sessions` 布局的影响（台账登记）。
4. Zu engine 与终端 pi CLI 对同一 captain 的并发写：pi 的会话写入是裸 `appendFileSync`，**没有锁**（`proper-lockfile` 只护 `auth-storage` 与 `settings-manager`），两个写者会各自推进 leaf——风险比初版描述更高。
5. 签名/公证：嵌套签名 + JIT entitlement 的实际可行性。
6. 用户扩展在 `ctx.hasUI = true` 下经 wire 桥的正常工作。

## 9. 文档

- [decisions.md](decisions.md)：Q1–Q31 决策台账（问题 → 裁决 → 落点 → 理由）。
- [roadmap.md](roadmap.md)：产品目标与里程碑。
- [evidence/](evidence/)：spike 实测、可行性分析、终端仿真核对比、决策过程记录。
