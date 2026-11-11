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
| `session.*` | `list`、`create`、`open`、`info`、`extensions`、`tools`、`prompt`、`steer`、`followUp`、`abort`、`close` | engine（pi） | `open` 按 path 幂等；`create`/`prompt`/`steer`/`followUp` 非幂等 |
| `subagent.*` | `list`、`transcript`、`dispatch`、`abort` | engine（Zu 调度面） | `dispatch` 非幂等；其余幂等 |
| `project.*` | `list`、`create`、`update`、`setMembership` | engine（Zu 状态） | `create` 非幂等；其余幂等 |
| `container.*` | `list`、`create`、`show`、`attachSession`、`archive`、`unarchive` | engine（Zu 状态） | `create` 非幂等；其余幂等 |
| `layout.*` | `get`、`put` | engine（Zu 状态） | 是（last write wins） |
| `state.*` | `snapshot`、`subscribe` | engine（Zu 状态） | 是 |
| `ui.*` | 扩展 UI 的请求/应答（`ui.request` / `ui.response`） | UI（nsh 对话框） | 请求带超时，超时即 resolve 默认值 |

**PTY 不经 wire**：字节流不过 JSON/WS，`zu/pty` 的 `Callback::post` 直接推给 TSX 的 Terminal（§3.6）。

**事件**（全部带 `sessionId`，除 `engine.*`）：`subagent.started`、`subagent.settled`、`subagent.note`、`engine.heartbeat`（每 5 s）、`session.info`（名称/thinking/文件路径变更）、`message.delta`、`message.complete`、`agent.state`（M2 只发 `running`/`idle`；更细的 thinking/executing/awaiting 留给后续）、`tool.start`、`tool.end`、`tool.update`、`queue.update`（steering/followUp 排队）、`compaction.start/end`、`retry.start/end`、`ui.request`、`ui.notify`、`ui.status`、`ui.title`、`ui.unsupported`、`error`。完整表见 `contracts/protocol.md`。

**回合终点**：`agent_settled`（`agent_end` 只是一次低层 run 结束）。**完成态权威**：`message_end` 与 pi 会话文件是唯一真相；UI 的渲染 = 文件投影 + 事件增量加速，所以切容器、重连、崩溃恢复是同一套重建逻辑。

**重连**：UI 连上后先 `state.subscribe`（它既登记订阅、又返回 `state.snapshot`：容器、打开会话、活跃 run、未读、engine `generation`），此后收增量。协议版本 `v` 与 pi 版本在握手返回；`v` 不匹配即拒连并提示升级，不猜语义。`generation` 每次引擎进程启动递增并持久化在 `~/.pi/zu/engine.generation`；UI 据此区分「重启」与「socket 抖动」，决定是否显示「已恢复」。

### 3.4 能力面（`nsh.json`）

```json
"capabilities": {
  "network": { "hosts": ["127.0.0.1"] }
}
```

WebSocket 按 `hosts` 授权（`sockets` 只给 `net.connect` 的裸 TCP，且只接受精确 `host:port`）。M12 起 `capabilities.notifications: true` 是合法能力键（nsh 0.4.0 的 `Notifications` 模块需要它；系统权限仍由系统询问一次）；headless 里通知先由窗口探测短路，不发也不报错。`zu/native` 的 `Instance` 不需要能力：它只碰 app 状态目录里的一个锁文件，不是通用 fs 面。

**port 与 token 由 native module 提供**：`Engine.port()` / `Engine.token()`（§3.6），UI 不读文件、不猜端口。端口是固定常量 `47823`——第二个实例会撞端口，所以桌面启动在 `bootShell()` 之前先 `Instance.claim()`（§3.6、§4.6）；`Engine.portAvailable()` 让「端口被别人占着」与「sidecar 起了但没握手」显示成两句不同的话。

**浏览器授权（Q32）**：`capabilities.webview.hosts: ["*"]`——地址栏意味着任意站点；UI 在地址栏旁标明「任意站点」，页面消息不进 wire、不进 agent 上下文（§8.12）。M10 只加了这一项：没有 `webview.input`（不给页面可信输入）、没有 `openUrl`（nsh 0.4.0 没有链接外开/新窗口回调），也没有 `fs`/`process.execute`；`.nsh/out/capabilities.json` 是这条声明的事实。

**威胁模型（写清楚边界）**：能力面保护的是 **UI/TSX 代码**被攻破时的爆炸半径；**agent 的动作不受它约束**——pi 的 bash 与工具仍以用户权限运行，由 pi 自己的权限模型负责。不要把「最小能力面」读成「agent 沙箱」。

UI **不持 fs、不持 process**：全部用户状态经 wire 落 `~/.pi/zu/`，进程操作由 Rust native module 代劳（见 §3.6）。这是**自选策略**而非平台限制（nsh 的 `Storage` 不需要能力，`fs`/`process` 也可授予）——换来单一写入点，代价是 engine 不在时无法落盘。M8 的编辑器和文件树沿用同一条：读写只经 `zu/fs`，`capabilities` 仍不出现 `fs`（Q56）。

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
| `zu/pty` | `portable-pty` 创建/读写/缩放/kill；读线程 → channel → 引擎线程任务 → `Callback::post` 推给 TSX（字节不过 wire）；TSX 侧按 external 容器持 handle | 容器 |
| `zu/lsp` | 起语言服务器（argv、显式 cwd、无 shell）、`Content-Length` 帧、消息/ stderr / exit 回调；ID/超时/取消在 TS。一个进程 = 一个容器的语言族 | 容器 × 语言族 |
| `zu/git` | shell out `git`（status/diff/log/branches/stage/unstage/commit/checkout/createBranch/init/setIdentity），根/路径策略与错误码在 Rust 侧 | 一次性调用 |
| `zu/fs` | `list/stat/read/write/mkdir`：编辑器与文件树的读写面；每次调用显式传工作区根（active container cwd），Rust 侧 canonicalize 后拒绝 `..`、根外绝对路径与越界 symlink，并做 2 MiB/1000 项上限、原子写与 stale 检测 | 一次性调用 |
| `zu/instance` | `claim/release/lockPath`：app 状态目录的单实例锁；独占创建 + pid 判活 + 死锁回收；`claim` 同进程幂等 | 进程级单例 |

**为什么是 `zu/fs` 而不是给 UI 开 `capabilities.fs`**：编辑器与文件树需要真实的读写，而 UI 的能力面要保持最小；`zu/fs` 让文件访问与 agent 的工具权限分开，LSP 的 `didOpen/didChange` 也能复用同一份内容（避免编辑器与 LSP 各读一遍）。M8 的落点：`src/fs.rs` 的错误带 `code`（`ERR_FS_ESCAPE`/`ERR_FS_BINARY`/`ERR_FS_TOO_LARGE`/`ERR_FS_STALE`/…）；保存走同目录临时文件 + `rename`，保留 mode 与 UTF-8 BOM；`write` 的 `expected {mtimeMs,size}` 不匹配即 `ERR_FS_STALE`，编辑器据此转只读直到 reload。UI 侧只有 `fs.ts`（类型面）与 `editors.ts`（文档/保存/校验），不持 `capabilities.fs`。**四域失败隔离**：engine、pty、lsp、git、fs 各自失败不影响其余；一个域的崩溃不能让 UI 失去所有能力。

**M9 落点**：`src/git.rs` 的 `zu/git` 是 module 而非 class（一次性调用，无跨调用状态）。每次调用先 canonicalize 工作区根并用 `git rev-parse --show-toplevel` 校验「根即仓库顶层」——容器 cwd 是仓库子目录时返回 `ERR_GIT_NOT_REPO`，因为 porcelain 会把根外路径写成 `../x`，显示一半状态比拒绝更糟；路径只接受根内相对路径，拒绝 `..`、绝对路径、pathspec magic（`:` 开头）与 `-` 开头。`git` 以 argv 数组、`current_dir(root)` 执行，永不经过 shell，并清掉 `GIT_DIR`/`GIT_WORK_TREE`/`GIT_INDEX_FILE` 等会把命令重定向到别的仓库的变量；没有任何 fetch/pull/push/remote 子命令。status 用 `--porcelain=v2 --branch --untracked-files=all -z`（NUL 记录；rename 的旧路径是下一个字段）；diff 固定 `--no-color --no-ext-diff --no-textconv --unified=3`，untracked 文件用 `git diff --no-index /dev/null <path>`（仍是 git 自己的补丁），补丁超过 2 MiB 返回 `ERR_GIT_TOO_LARGE`；log 用控制字符分隔字段/记录；commit 先用 `git var GIT_AUTHOR_IDENT/GIT_COMMITTER_IDENT` 检查身份，缺失返回 `ERR_GIT_IDENTITY`，身份对话框只写该仓库的 `.git/config`（`--local`），全局配置不动。命令失败一律带 `exit` 与 `stderr`（`ERR_GIT_COMMAND`）。UI 侧 `git.ts` 是类型面与每容器投影，`git-ui.tsx` 是两个 sheet；工作区 diff 复用 M8 的 `DiffView` 的 `patch` 模式，没有第二个 diff 组件。

**M12 落点（单实例）**：`src/instance.rs` 的 `Instance` 把锁放在 `~/.pi/zu/instance.lock`（`ZU_STATE_DIR` 同样生效）。创建不是 `create_new` + `write`：锁的字节先写进同目录临时文件，再用 `fs::hard_link` 原子地挂成锁名——`link` 在目标已存在时失败（不会覆盖），读者也永远看不到半截内容。锁内容两行：pid 与创建时间（毫秒）；pid 用 Unix 的 `kill(pid, 0)` 判活（`EPERM` 也算活着），死进程或截断文件在下一轮回收（回收前重读一次，避免误删别人刚替换的新锁）。同一进程的第二次 `claim` 返回 `acquired: true, already: true`，`startLifecycle` 因此可重入；`release` 只删 pid 还是自己的锁。非 Unix 没有可靠的 pid 探测，已有锁一律当活的（宁可不抢），Zu 只发 macOS。**headless 不 claim**：`startLifecycle` 先看 `nsh/desktop` 的 `isAvailable`。
**失败隔离**：锁文件读写失败返回 `Err`，UI 视为“没有 claim”（不把用户锁在门外），启动继续；锁只影响启动顺序，不参与 engine/PTY/fs/git/LSP 的任何调用。

**M11 落点**：`src/lsp.rs` 的 `Lsp` 是 class（一个实例 = 一个语言服务器进程）。`Lsp.start(options, onMessage, onStderr, onExit?)` 以 argv 数组、显式且 canonicalize 过的 `cwd` 启动，绝不经过 shell；子进程进入自己的进程组，`stop()`/`Drop` 杀掉整个组，读/写/stderr/等四线程 + `Callback::post` 把完整消息、stderr 片段与 exit 推给 TSX。stdout 的帧解析在 Rust（`Content-Length`、header/消息上限；JSON 由 TS 解析），读线程不会无界增长：header > 8 KiB 或 body > 8 MiB 即报错并放弃该流；stdin 队列 > 8 MiB 时 `send` 失败。命令名在 `PATH` 与常见安装目录（`/opt/homebrew/bin`、`/usr/local/bin`、`~/.cargo/bin`、`~/go/bin`…）中解析，但**不 canonicalize**：`~/.cargo/bin/rust-analyzer` 是 `rustup` 的 symlink，resolver 会把 `argv[0]` 变成 `rustup`，于是它打印 rustup 帮助而不是说 LSP（本轮实测踩到并修正，见 evidence）。`lsp.ts` 每容器/语言族一个客户端：`initialize`（rootUri/workspaceFolders、客户端能力）、`initialized`，然后 `didOpen/didChange/didSave/didClose`；**全文同步**（`didChange` 的 `contentChanges` 只有 `{ text }`，不是增量 range），输入停顿 180 ms 后发送；请求 id/超时/`$/cancelRequest`/陈旧应答丢弃都在 TS。只接受容器根内、且已打开文件的 `publishDiagnostics`；服务端请求（`workspace/configuration`、`registerCapability`、`workDoneProgress/create` 等）一律应答，避免 rust-analyzer 等待。诊断映射为 `EditorDiagnostic`（0-based line/character → `EditorRange`），hover 的 MarkupContent/MarkedString 转 Markdown 给 `TextView`，definition 只接受根内 `Location`/`LocationLink`，completion 映射 kind/detail/documentation/insertText/textEdit。**失败隔离**：LSP 进程死、协议错、stderr 洪水都只把该 server 标为 error；engine/PTY/git/fs 不受影响。

**PTY 的归属与清理**：PTY 是 native module 的资源，不是 sheet 的。`terminals.ts` 按 external 容器 id 持一个 `Pty` handle；sheet 只 `attachTerminal` 一个 sink，切容器/隐藏标签不杀 shell。归档容器时 shell 先 `closeTerminal` 再切走；JS handle 被 GC/`dispose()` 时 Rust `Drop` 再兜底 kill。应用重启不恢复 PTY（§5.5），external 容器按布局重新开一个新 shell/TUI。`Terminal` 组件始终挂载（即使标签隐藏），因为 alt screen 与 scrollback 必须留在 emulator 里；容器切换才卸载 sheet，此时靠 store 的 replay buffer 重建屏幕。

**为什么必须有它**：nsh 的 `capabilities.process.execute` 只接受裸命令名或绝对路径、且精确字符串比对（不支持 `${dataDir}` 等变量），bundle 路径随安装位置变化，TSX 无法直接执行 sidecar。

### 3.7 分发与版本

- **sidecar 位置**：`Zu.app/Contents/Helpers/pi-engine`，直接执行、不释放到 dataDir（签名与公证覆盖最干净）。
- **pi 版本自管**：`engine/package.json` 精确 pin + `bun.lock` 进 git；升级 = 改 pin 的 PR（引擎测试 + TUI 冒烟 + 兼容性台账）；sidecar 内禁 `pi update`。
- **兼容性台账**：每个绕过 pi 缺口的适配登记「上游什么条件下可删」。
- **自更新**：`nsh/updater`（GitHub Releases 或自托管 manifest）。**本仓库当前没有 `nsh.json` 的 `"updater"`**：没有真实 source、公钥和 release，按 M12 的约束不伪造。发布时二选一：GitHub Releases 写 `"updater": { "github": "dspo/nsh-pi" }`（公开仓库的 manifest 不签也行，但建议配 `publicKey`），或自托管写 `"updater": { "url": "https://…/latest.json", "publicKey": "<keygen 出来的公钥>" }`，私钥只留在发布机/CI。**更新包必须包含 `Contents/Helpers`**——`nsh/updater` 替换整个 `.app`，漏掉即引擎消失；`script/bundle-mac.sh` 在打包后断言三个文件都在，`NSH_UPDATE_ARCHIVE=1` 时打的 `tar.gz` 是整个 `.app`，因此天然包含。`nsh update-manifest` + `nsh package --target macos` 的发布步骤与“本机不可端到端验证安装”的事实写在 [evidence/m12-lifecycle.md](evidence/m12-lifecycle.md)。
- **签名**：nsh 的 `nsh package --target macos` 只做 **ad-hoc** 签名、且不认识 `Contents/Helpers`；其余是我们的活（`script/bundle-mac.sh`）：拷 sidecar 与两个 WASM（**必须与 sidecar 同目录**，photon 用 `process.execPath` 兜底）→ 逐个 `codesign --options runtime`（sidecar 带 `com.apple.security.cs.allow-jit`）→ 签 app → `notarytool` → `stapler`。ad-hoc 打包从 M0 起每轮冒烟，别把未知量留到正式签名那天。
- **遥测**：支持 pi-telemetry，但不在早期里程碑；默认不上报。

### 3.8 构建回路

- `engine/package.json` 的 `build`：`check-version`（`src/version.ts` 必须等于 pin）→ `bun build --compile --target=bun-darwin-arm64` → `cp` 两个 WASM 到 `dist/`（pi 上游同路径：`isBunBinary` / `copy-binary-assets` 的资产布局）。
- `script/bundle-mac.sh`：sidecar → `nsh package` → Helpers（**断言** `pi-engine` 与两个 WASM 都在，缺一即失败）→ 嵌套 ad-hoc 签名 → dmg；`NSH_UPDATE_ARCHIVE=1` 追加整个 `.app` 的 `tar.gz`（更新包必须含 Helpers）。
- 开发：engine `bun run src/server.ts`（热重启）+ UI `nsh run .`（热重载）两条循环并行；UI 侧热更新在 mixed 模板下不可用（`nsh hot: no module zu/native`），改 TSX 需重启。
- **编译产物冒烟**：`dist/pi-engine` 起得来、握手成功、`session.list` 返回——每次改 engine 都跑（已由 `engine.test.ts` 的 freshEngine 覆盖）。

## 4. 前端：轮廓与画布

### 4.1 分工

**轮廓与内嵌对象分离**：壳（项目侧栏、顶栏、页签条、状态条）零领域状态；画布是受控的 `nsh/base DockArea`。**常驻的外壳**归 `lifecycle.ts`（claim/启动决策/退出）与 `lifecycle-ui.tsx`（托盘、关窗、应用菜单）；`App.tsx` 只按 `primary`/**`duplicate`**/headless 三态选 `Workbench` 还是第二实例提示。

### 4.2 panel 与 sheet

- **panel** 是带页签条的容器，可任意多个，可拖手调宽、拖拽停靠重排、zoom。
- **sheet** 是页签内容：Pi 会话（含 subagents/后台任务/轨迹/统计等派生视图）、终端、各 agent TUI（Claude/Codex/Copilot）、webview、编辑器、Diff。
- sheet 可跨 panel 拖拽（移动语义），**状态不丢**（`renderPanel` 按 key 渲染一次）。
- **单容器画布、单窗口**：侧栏一行 = 一个容器 = 一组面板的入口；切换行 = stash 当前布局 + restore 目标布局。多窗口不在设计中。M4 的侧栏按 Project → 容器分组，无归属容器落 Chats；「全部会话」用虚拟化 `List` 放在底部，打开会话即归入当前容器。

### 4.3 布局与状态

- 布局是**纯数据**：app 持有 `DockAreaLayout`，`onLayoutChange` 回报整份新布局传回。
- **sheet 身份 = 稳定 id**（`kind:instance`，如 `session:{sessionId}`、`terminal:{containerId}`、`files:{containerId}`、`editor:{containerId}:{base64url path}`、`diff:{containerId}:{base64url old~new}`、`webview:{containerId}:{n}`、`problems:{containerId}`）；布局树只存 id，内容由 `sheets.tsx` 注册表解析。编辑器的未保存文本存在 `editors.ts` 的 store 里（不随 sheet 卸载丢失），M8 起布局 stash/restore 与容器切换都能恢复同一个文件。浏览器页的 URL/标题/loading/error/消息日志存在 `browser.ts` 的 store（内存态）：切容器或隐藏页签后保留，重挂载时按 URL 重新加载；页面运行时状态（滚动、表单、SPA 内存）会丢。应用重启只恢复 `webview:*` 页签 id，store 为空，因此是新标签页（§5.5）。
- **按容器 stash**：`layouts/{containerId}.json`；zoom **不在 `DockAreaLayout` 里**（它是内部 signal + `onZoomChange` 事件），要单独存，恢复后用 ref 的 `groupOf`/`toggleZoom` 灌回。`onLayoutChange` 高频，debounce 后保存；切容器前先 flush，恢复时先离开现有 zoom 再按 panel id 找 group 灌回。布局与 zoom 的读写经 `layout.get/put`，UI 仍不持文件系统。
- **启动恢复上次活跃容器**；恢复时**静默移除**指向已死资源的 sheet。
- **canvas 空态 = Launcher**（项目 chip + composer + agent 动作行）。Launcher 的「浏览器」与顶栏 `open-browser` 都在当前容器打开一个 browser sheet；每容器的实例号递增（`n`），可同时开多个。
- **浏览器降级**：nsh 的 `WebView` 没有 pause prop，因此非可见 browser sheet 不用「暂停」：`BrowserBody` 读 `visiblePanels()`，不可见时卸载 `WebView`（显示占位文案），再次可见时按 store 的 URL 重挂载。这是唯一诚实的实现，不声称存在 pause API。

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

### 4.6 常驻、单实例与通知

- **关窗即收起**（无确认）：`nsh.json` 的 `window.closeOnPress: false`，`LifecycleHost` 在 `closePress` 里 `hide()`。窗口关闭不触发 engine/PTY 的 teardown：turn、子代理、终端继续跑；托盘 Show、主键点击或 `⌘0`（Window 菜单）恢复同一个窗口。真正退出只有托盘/应用菜单的 Quit（`quitApp`）——先 `Instance.release()`，再 `Application.quit()`；系统级退出（Dock Quit、`osascript`）不经过这里，留一张死 pid 的锁，下次启动按 pid 判活回收。
- **单实例强制**：桌面启动先 `Instance.claim()`；已有一个活进程时**不 boot 引擎**，窗口显示「Zu 已在运行」（owner pid + 锁路径 + Quit），并提示从 Dock/菜单栏回到第一个实例。nsh 没有跨进程“show 已有窗口”的原语，所以不提供假的 Show 按钮。锁按状态目录算：开发实例要用 `ZU_STATE_DIR`/`ZU_PORT` 与正式实例分开（否则会被当成第二实例——这正是 `47823` 固定端口的正确行为）。
- **不做登录自启**（M12 的裁决）。
- **通知**：只有主窗口**不在前台**（不可见或未聚焦）才发。turn settle（`agent.state` 的 running→idle 边沿，重连快照补记 running，断线清空）与子代理 settle（`subagent.settled`）各发一条；id 是 `zu:session:<sessionId>` / `zu:subagent:<runId>`，同 id 由系统替换，相同正文 5 s 内不重复；权限第一次需要时申请一次，被拒不再弹。按下通知：关闭该条、显示并聚焦主窗口，按 id 排队等 engine/registry 就绪后打开会话 sheet 或子代理名册（冷启动也成立，最多重试 20 次）。**headless/无能力时全是 no-op**：窗口探测为 null 即返回，权限/系统错误只记录状态，不抛给渲染。首版的范围是 turn 与子代理（不是每条消息、每个工具），后续按反馈做减法。
- **更新**：Updates 对话框（托盘 Check for Updates… / 顶栏齿轮）先报本 run 的包装状态，再报 release：development / 未配置 updater / 可检查，三态分开说；`canInstall: false` 只显示 URL（没有 `openUrl` 能力）；安装成功会退出进程，所以 promise resolve 后 UI 保持「正在安装」，不声称装好。

## 5. 对象模型

### 5.1 对象与归属

| 对象 | 权威 | 存储 |
|---|---|---|
| Project（多根、恰一根 primary） | UI store（内容权威），写面经 engine | `~/.pi/zu/projects.json` |
| membership（container → project） | UI，活读 | 同上 |
| 容器注册表 | engine sidecar | `~/.pi/zu/registry.json` |
| Pi 会话转录（captain + subagents） | pi | §3.5 |
| 资源（PTY、webview） | PTY 归 engine/native module；webview 是 nsh UI 的原生视图（URL/标题在 UI store），**不持久** | — |
| 视图（panel/sheet 布局） | UI | `layouts/{containerId}.json` |
| 未读 | 协议态，UI 不镜像 | — |

### 5.2 Project

`{ id, name, nameOverridden, roots: [{ path, primary }], position, createdAt, updatedAt }`；恰一根 primary；根存在且为目录；嵌套允许；去重静默。落 `~/.pi/zu/projects.json` 的 `{ v, projects, membership }`；`membership` 是容器归属的唯一事实源（缺省 = Chats）。M4 的 `project.create` 校验绝对路径/目录/唯一 primary，`project.setMembership` 显式移动；侧栏支持菜单与拖行两种移动方式。

- 容器创建时 `cwd = primary`（快照，此后不可变）；根组编辑只影响以后创建的容器。
- **归属显式**：`membership` 是唯一事实源，不按 cwd 猜；无归属落 Chats 桶。
- 名称未自定义时跟随 `basename(primary)`，改过即固定。
- 多根对 pi 只承载组织与终端 cwd——pi 是单 cwd 引擎，没有多根授权面。

### 5.3 SessionContainer

```ts
{ id: `pi:{sessionId}` | `external:{kindLower}:{uuid}`,
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
- **外部容器即进程**：进程 exit 即死、即摘行；关闭容器 = kill。v1 由 shell 在 `container.archive` 成功后显式 `closeTerminal`（PTY 不持久，重启后按布局新开），engine 只存 `archived` 位；PTY 的存活不由 engine 轮询。
- **外部改动复活**：归档容器的 captain 文件被 pi CLI 继续后，下次启动对账复活并提示。

### 5.5 状态生命周期分级

| 层 | 对象 | 跨重启 |
|---|---|---|
| 持久 | Project / membership / 容器注册表 / 会话转录 / 视图 stash / 上次活跃容器 | ✓ |
| 易失 | **PTY 终端与 webview 页面**（应用重启不恢复终端） | ✗ |
| 易失 | **语言服务器进程与诊断**（按打开的文件重建，archive 即停） | ✗ |
| 易失 | 进行中的 run / 排队消息 / 未读计数 | ✗ |

新对象入库先回答「属于哪一层」，不允许未分级的持久化写面。

### 5.6 调度面（pi 扩展）

**M5 实现**：engine 内置 `dispatchExtension` 只作为 captain 会话的 `extensionFactories` 注册。工具为 `dispatch`（spawn/resume/inject/abort，`wait` 可选）与 `list_agents`。子会话由 `SubagentManager` 在进程内创建（不走 `pi` 子进程），用独立 `SessionManager` 落 `zu/subagents/{captainId}/`、`parentSession` 指向 captain、继承 captain 的 model/thinking，且 `noExtensions`，因此子会话没有 dispatch 工具。live run 只在内存，settled 写 `registry.json.subagentRuns[]`；archive captain 会 `archiveCaptain` 中断 live 并保留 settled。名册/只读转录走 `subagent.list/transcript`，dispatch/delivery 同时写 captain 的 `zu.dispatch`/`zu.delivery` custom entry 与 `subagent.note` 事件。

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
| nsh | `Cargo.toml` 的 `nsh-core`/`nsh-base` **git pin `506b5392`（版本 0.4.0）** + `Cargo.lock`；CLI 用 checkout 构建 | 发布版 0.4.0 没有 `nsh/base Terminal`（`term` 在发布后进 checkout），M7 必须用 checkout；nsh 比 pi 更不稳定，升级需跑 `nsh check`/`nsh test` + 终端与 DockArea 冒烟 |

## 7. 实现状态（2026-11-11）

- **M0 完成**：`engine/`（Bun + pi 1.5.0）+ mixed 模板（`Cargo.toml`、`src/lib.rs` 的 `zu/engine`）+ sidecar 编译（75 MB 单文件，WASM 资产同目录）+ WS 握手。
- **M1 完成**：`engine.ts`（连接/请求/事件）、`sessions.ts`（会话 store，16 ms 批 flush）、`sheets.tsx` 的会话 sheet（`TextView` 流式 Markdown、工具卡、composer）、`App.tsx` 的会话侧栏与引擎状态条。turn 结束时 engine 写 `zu.turn` custom entry；流式中停止会广播 idle 并保留已生成文本；引擎重启后用 `session.info` 拿到的文件路径续聊。
- **M2 完成**：`contracts/protocol.ts` + `protocol.md`（信封、命令/事件表、幂等/重放、UI 矩阵）；`engine.ts` 的快照重连与监督（心跳、指数退避、`generation`）；`ui-host.tsx`（confirm 的 `AlertDialog`、select/input/editor 的 Dialog、toast/status/title）；`i18n.ts` + `locales/*.ts`（Q39）。门禁 22/22。
- **M3 完成**：`registry.json`/`layouts/`、容器生命周期与 archive 单点 teardown、按需 rehydrate 与 LRU、`containers.ts` 的按容器布局/zoom、`sessions.ts` 的多会话视图、可见性节流；侧栏容器 + 全部会话过渡形态。门禁 35/35。
- **M4 完成**：`projects.json` + `project.*` 命令、Launcher（composer 先行、项目 chip、锁定目标）、项目/拖拽归属、虚拟化全部会话 `List`、会话索引按 mtime 水位缓存。门禁 45/45。
- **M6 完成（有记录差异）**：Steer 对齐的 token/几何/表面/动效，`docs/DESIGN.md`；2026-11-11 目视返工补齐顶栏/侧栏/起始页/composer；198/198。
- **M5 完成**：进程内 `SubagentManager`、仅 captain 注册的 `dispatch`/`list_agents`、`zu/subagents` 存储与 `parentSession`、live/settled 名册、只读转录、captain note、archive 级联。门禁 50/50。
- **M7 实现完成，验收未全过**：`src/pty.rs`（`portable-pty`，reader/writer/waiter 三线程，`Callback::post`，`Drop`/`close` 双保险）导出 `zu/native` 的 `Pty`；engine 的 `container.create` 接受 `kind` 与 cwd，external id 为 `external:{kindLower}:{uuid}`、`sessions: []`，注册表/布局/成员关系沿用；`terminals.ts` 按外部容器持 PTY 与 replay buffer；`TerminalBody` 接 `onData`/`onResize`/`onTitleChange`；Launcher 动作行创建四类容器；归档走 `closeTerminal`。门禁 67/67。**未达成**：Claude Code 真实对话（本机 API error，只验证 TUI + Ctrl+C）、`VtEmulator` 缩小不重排（实测缺陷，见 evidence §8）；因此 M7 不标完成。
- **M8 实现完成，验收一半（其 git diff 一项由 M9 补齐）**：`src/fs.rs` 导出 `zu/native` 的 `Fs`（`list/stat/read/write/mkdir`；显式根、`..`/绝对越界/symlink 逃逸拒绝、2 MiB 与 1000 项上限、临时文件 + rename 原子写、保留 mode/BOM、`ERR_FS_STALE` 带当前版本、二进制/非 UTF-8 拒绝）；`fs.ts` 是类型面，`editors.ts` 按稳定 sheet id 持文档并做 `stat → write(expected) → read-back`；`files.tsx` 提供文件树 sheet（`files:{containerId}`，懒加载、目录优先、空/加载/错误态）、真 `Editor` sheet（语言高亮、折叠、查找/替换、脏标记、Save/Mod+S、冲突只读、reload/close）与两文件 `DiffView` sheet（split/unified、真实 hunk 统计）。`files.ui.test.tsx` 打开真实 `/tmp` 文件 → 编辑 → Mod+S → 用 `zu/fs` 读回磁盘一致；外部改写后保存被拒并转只读，reload 恢复；两真实文件的 `DiffView` 统计 `+2 −1 · 1`。门禁 99/99。**未达成**：M8 验收里的 git diff——无 `zu/git`，不做伪造 worktree diff；M9 补（Q57）。
- **M9 完成**：`src/git.rs`（`zu/git`：`status/diff/log/branches/stage/unstage/commit/checkout/createBranch/init/setIdentity`；porcelain v2 `-z` 解析、根必须为仓库顶层、路径越界拒绝、2 MiB 补丁上限、无 shell/无网络/无全局 git 配置、命令失败带 `exit`/`stderr`、缺身份 `ERR_GIT_IDENTITY`）；`git.ts` 按容器持 status/log/branches 与动作状态；`git-ui.tsx` 的 Changes sheet（`changes:{containerId}`：staged/工作区/未跟踪/冲突分组、单文件与全部 stage/unstage、`DiffView` 的 `patch` 模式显示真实 `git diff`、提交行、身份对话框、未初始化仓库态）与 History sheet（`history:{containerId}`：真实 log、分支菜单 checkout、新建分支对话框）；顶栏 `open-changes`/`open-history`；checkout 后重读两表并 reload 该容器中没有未保存改动的编辑器。`git.test.ts`（7 条，测试自建真实临时仓库）与 `git.ui.test.tsx`（3 条，真实 `Workbench`）覆盖「改文件 → Changes 显示 → stage → 提交（`git log` 验证）→ 切分支」，M8 的「看一次 git diff」由此补齐。门禁 122/122。
- **M10 实现完成，验收达成一半**：`browser.ts`（每 sheet 的 URL/标题/loading/canGoBack/canGoForward/error/页面消息日志；地址规范化；`webview:{containerId}:{n}` 的实例分配；`WebView.available()` 探测）与 `browser-ui.tsx`（一个 `WebView` + 地址栏 + 后退/前进/刷新/停止 + loading 轨道/文字 + 页签标题 + 错误码面板 + 默认页 + 仅 UI 的页面消息日志）；顶栏 `open-browser`、Launcher「浏览器」；`nsh.json` 只加 `webview.hosts: ["*"]`。真实 macOS 宿主加载 `example.com`/IANA 文档页/DuckDuckGo Lite 搜索并跑通后退/前进（标题 `Example Domain` → `Example Domains` → `native shell at DuckDuckGo`）；headless 没有 web view，默认测试只覆盖状态机。门禁 130/130（`ZU_PORT=47834`；+7 TS、+1 Rust）。**未达成**：`target=_blank`/`window.open` 在 nsh 0.4.0 无打开回调，未授予 `openUrl`，所以「外部打开」没有实现；页内链接点击与页内搜索框输入未自动化。证据见 [evidence/m10-browser.md](evidence/m10-browser.md)。
- **M11 实现完成，验收达成（Rust 真实、TS/Go 未实跑）**：`src/lsp.rs`（`Lsp` class：argv/显式 cwd/无 shell、进程组、`Content-Length` 有界帧、reader/writer/stderr/waiter 四线程、`Callback::post`、`Drop`/`stop` 双保险、coded errors；命令解析保留 rustup symlink）与 `lsp.ts`（每容器/语言族一个客户端；`rust-analyzer`、`typescript-language-server --stdio`、`gopls`；全文同步；初始化/文档同步/诊断/hover/definition/completion；请求 id、超时、取消与陈旧丢弃；URI↔path、根内过滤；服务端请求应答；`$/progress`）。`files.tsx` 的 Editor 接 `diagnostics`、`onHover`/`onHoverEnd`（`Overlay` + `TextView` 卡片）、`onDefinitionRequest`（F12/Mod-click/悬停下划线，打开目标 sheet 并 `revealPosition`，导航后聚焦）、`onCompletionRequest`/`presentCompletions`（Ctrl+Space 也可触发）；`lsp-ui.tsx` 的 Problems sheet（`problems:{containerId}`）按严重度/文件/行列出打开文件的诊断、点击打开并 reveal、显示 server 状态/索引进度/错误与重启；顶栏 `open-problems`；归档容器 `stopLspContainer`。真实 `rust-analyzer 1.99.1`：initialize 42 ms、diagnostics 697 ms（`E0308 expected i32, found &'static str`）、hover（`pub fn add(left: i32, right: i32) -> i32`）、definition（`src/lib.rs`，selection `0:7–0:10`）、completion（`value: i32`、`add: fn(i32, i32) -> i32`）。headless UI（真实 `Workbench` + 真实 `zu/lsp` + 受控 fake server）验证诊断/Problems/reveal/F12/补全/重启。门禁 141/141（104 TS + 37 Rust，`ZU_PORT=47835`）。**未达成**：TS/Go 只用映射未用真实 server 验收；headless 无法驱动 Editor 内部 rows 的 hover 指针路径（UI 测试只渲染同一个 `HoverCard`）；诊断仅打开文件；无全工作区索引；重启/归档不恢复 server。
- **M12 实现完成，桌面端到端未验证**：`src/instance.rs` 的 `Instance`（状态目录锁、`hard_link` 独占创建、pid 判活、死锁回收、同进程幂等；6 条 Rust 测试）、`instance.ts`、`lifecycle.ts`（桌面 claim 后决定 boot；`duplicate` 不 boot）、`lifecycle-ui.tsx`（`LifecycleHost`：close→hide、托盘 Show/Hide/Updates/Quit、应用菜单含 Edit roles 与 Window `⌘0`/Close；`AlreadyRunning` 提示）、`notifications.ts`（隐藏/失焦才通知、per-session id 替换、5 s 正文去重、权限只问一次、按开恢复窗口并按 id 打开）、`updates.ts`/`updates-ui.tsx`（dev/未配置/可检查三态，check→progress→ready→install，`canInstall:false` 只给 URL，resolved install 保持“installing”）、`Engine.portAvailable()` 与「端口被占用」文案、`nsh.json` 的 `notifications: true` 与 `closeOnPress:false`、`script/bundle-mac.sh` 的 Helpers 断言与可选更新归档。headless 真窗口模型验证关窗隐藏/`⌘0` 恢复/再次隐藏；`⌘Q` handler 释放 claim 有测试。**未验证**：托盘点击、真实通知投递、第二进程实拦、真实 updater 安装；见 roadmap M12 台账与 evidence。
- **外部审计**：2026-11-10 的一轮事实审计与架构评审，成立的 P0/P1 已并入本文；其中「alt screen 污染 scrollback」一条被证伪并撤回（`push_scrollback` 有 `primary.is_some()` 守卫），教训记在 [evidence/terminal-emulator.md](evidence/terminal-emulator.md)。审计材料已随收敛删除。
- **已知问题**：开发期热更新（`nsh run` 的 hot reload）在 TSX 变更后报 `nsh hot: no module zu/native`——native module 在 hot bundle 期间不可解析。重启 app 即可；不影响运行期。正式打包不受影响（无 hot reload）。另：headless 测试运行器没有帧循环，`requestAnimationFrame` 不跑，流式批 flush 因此用 `setTimeout(16)`。
- **打包**：`script/bundle-mac.sh`——`nsh package` 出 `.app`，sidecar 拷进 `Contents/Helpers`，嵌套 ad-hoc 签名，`hdiutil` 出 dmg（134 MB app / 53 MB dmg）。打包后 app 优先用包内 sidecar（仓库的构建不能遮蔽它）。

## 8. 已知风险（非决策）

1. `createAgentSession` 的完整真实会话（WASM 运行期加载）在扩展与 MCP 路径上仍未跑到。
2. `parentSession` 在 pi CLI 里的 fork 观感。
3. pi 升级对 `~/.pi/agent/sessions` 布局的影响（台账登记）。
4. **并发写**：pi 的会话写入是裸 `appendFileSync`，没有锁；两个写者会各自推进 leaf。按不变量 10 处理（检测 + 转只读）。
5. 签名/公证：嵌套签名 + JIT entitlement 的实际可行性（M0 的 ad-hoc 打包已冒烟，正式签名未验）。
6. **协议面**：`contracts/` v1 已冻结（`protocol.ts` + `protocol.md`）；后续只允许加可选字段，破坏性改动递增 `v`。
7. **引擎单点**：`generation`、心跳、退避重启、`state.snapshot` 已实现；崩溃时未完成回合的**内容**仍由 pi 会话文件兜底，但引擎内未落盘的 streaming 增量会丢，UI 标为中断。
8. **单实例与固定端口**：已由 `zu/instance` 的锁文件（状态目录、pid 判活、死锁回收）在桌面启动前处理；第二实例不 boot 引擎。端口仍是常量 `47823`，`Engine.portAvailable()` 给出明确文案。**未自动化**：真实两个进程同时启动（会与正在运行的用户 app 抢端口），只有 Rust 的并发/活 owner 测试与第二实例 UI fixture。
9. **`~/.pi/zu/` 的清理**：归档容器、死 subagent 文件、旧 layout 会增长；启动时清理孤儿 layout（容器已不在注册表）。
10. **视图全量挂载**：DockArea 会把所有 panel 放进树（只有当前 tab 显示）；20 个 sheet（含 WebView/Editor/Terminal）同时存活时要「非可见 sheet 降级」。M10 已落 webview：没有 pause prop，非可见时卸载 `WebView`、可见时按 store URL 重挂载（Q62）；editor 释放 rope 仍未做，terminal 按 Q55 保留。
11. **nsh git pin 的 Menu 崩溃日志**：pin 到 `506b5392` 后，Menu popup 的 owner 被卸载时 `nsh-base/src/menu.rs` 会 panic（"signal read or written after its owner was disposed"）。`projects.ui` 测试在 app 关闭时打 3 条日志但测试仍通过；真实用户在菜单打开时切容器也可能命中。属上游运行时缺陷，待 nsh 修复或改为自绘 popover；不影响数据面。
12. **WebView 信任边界**（浏览器里程碑）：页面 `postMessage` 只进 `browser.ts` 的 UI 日志（`onMessage` → `logBrowserMessage`），不进 wire、不进 agent 上下文；实现里完全不用 `injectJavaScript`。能力面只有 `webview.hosts: ["*"]`，没有 `webview.input`/`openUrl`。已知限制：nsh 0.4.0 的 WKWebView 不处理 `target=_blank`/`window.open`（点击无反应），且深色模式下依赖 `color-scheme` 的页面可能仍用黑字（example.com 的 evidence 截图），属 web view 上游行为。
13. **LSP 的成本与边界**：每容器 × 语言族一个进程，rust-analyzer 在大仓库的索引内存/CPU 不在 Zu 的控制内；诊断只保留打开文件（Problems 不是全工作区索引），关闭 sheet 即 `didClose` 并清掉该文件的诊断；全文 `didChange` 在每次停顿发送整份文本（2 MiB 上限内），不是增量；`snippetSupport: false`，补全插入普通文本；headless 的 `app.hover` 只在 selector 自身派发 `MouseMove`，无法驱动 Editor 内部 rows 的 hover（真实 macOS 指针路径未自动化）；语言服务器启动依赖 PATH/常见目录，GUI 进程的 PATH 可能仍缺用户自定义安装位置（错误会显示在 Problems 的 server 状态）。
14. **更新未端到端验证**：仓库无 `nsh.json` 的 `"updater"`、公钥和 release；`checkForUpdate` 在 dev 返回 null，真实下载/签名校验/替换 `.app` 没有跑过。UI 状态机用 fake service 覆盖，发布前的配置步骤在 evidence/m12-lifecycle.md。`canInstall:false` 没有 `openUrl` 能力，只显示 URL。
15. **通知未真机投递**：headless 的 `Notifications` 不产生系统横幅；开发运行的 macOS app 不是 signed bundle，`permission()` 会是 `unavailable`。真实通知需要打包签署后的 app，且本轮没有重启用户正在使用的 app。策略/权限/按开的逻辑有 8 条单测，真实 banner/点击列在 evidence 的未验证项。

## 9. 文档

- [decisions.md](decisions.md)：Q1–Q57 决策台账（问题 → 裁决 → 落点 → 理由）。
- [roadmap.md](roadmap.md)：产品目标与里程碑。
- [evidence/](evidence/)：spike 实测、可行性分析、终端仿真核对比、决策过程记录。
