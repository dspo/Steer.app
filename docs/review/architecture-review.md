# 架构与技术评审

> 2026-11-10。对象：[architecture.md](../architecture.md)、[decisions.md](../decisions.md)、[roadmap.md](../roadmap.md) 及其证据文档。
> 视角：架构（边界、归属、演进、失效模式）与技术（能否按此落地、哪里会返工）。事实核对见 [fact-audit.md](fact-audit.md)，本文不重复证据细节。

## 0. 总体判断

**这套文档的决策质量高于绝大多数同类设计**：对象分三类（会话/资源/视图）、生命周期分级、"settle ≠ 死"、"兼容方向不对称"、"单一创建入口/单点 teardown"、把 pi 的状态当唯一权威并把 Zu 的增强放进 `zu/`——这些不是漂亮话，而是能让实现不跑偏的约束。Q1–Q31 的台账纪律、evidence 与决策分离，也是可以长期维护的形态。

**审计期间工作区在推进**：17:03–17:07 出现了 `Cargo.toml`、`src/lib.rs`、`engine.ts`、`sessions.ts`，引擎重建后可起、可 `session.list`，`/tmp/zu-e2e` 里已有一条真实模型回合。实现**已经走在文档前面**（它用了 arch 里没有的 `session.list/open/prompt/abort`，用了正确的能力写法 `network.hosts`，也从 native module 拿到了 port/token）。这既是好消息（M0 的核心假设被验证），也是本评审第一个结构的证据：**文档没有跟上实现的机制**。下面的判断按"文档仍是唯一共享面"来评；若实现继续跑在前面，`contracts/` 与架构会变成追认。

**问题不在严谨度，在两处边界**：

1. **归属边界**：文件、进程、PTY、协议面——文档在"谁拥有"上留下了 4 个空洞（PTY 双头、编辑器文件读写无主、wire 不完整、扩展 UI 无通道）。这些空洞不会在评审时暴露，会在 M1/M3/M6 的第一天变成"两套实现"或"临时发明协议"。
2. **宿主语义**：Zu 不是"另一个前端"，而是 **pi 的第二个宿主**。宿主契约（`ctx.mode`/`ctx.ui`/`bindExtensions`/project trust/扩展错误）比 wire 协议更容易被低估，而它恰好是 Q23 的全部动机所在。

一句话：**结构是对的，边界要补齐；少数承重事实要重写（见事实审计 F1–F5）。其中 F1/F3 已经在代码里被绕过——文档还错着，这才是当下的风险；F4/F5 会直接卡住 M1 与 M3。**

## 1. 架构问题

### P0-1 协议面（`contracts/`）没有被真正冻结

**现象**：`architecture.md:51-57` 把 `contracts/` 定义为"唯一共享面"，但命令/事件清单在四个方向上不够用：

- M1 需要的 `session.list/create/close` 不在表里（`roadmap.md:52` 却在用）；
- 模型与 thinking 的读写不在表里，而 Q24 明确要求"模型选择写回共享 settings"、M2 侧栏要显示模型/cost；
- 扩展 UI 需要**服务端发起的请求**（pi 的对话框是 engine → UI、带 `id` 与 `timeout` 的阻塞式请求，见 `docs/rpc-extension-ui.md`），而 wire 只有“客户端命令 → engine 回复”，没有反向的请求/应答；
- 重连/重放没有：UI 重载、engine 重启后，UI 如何拿到"当前打开了哪些会话、哪些在跑、未读是多少"——`state.get` 三个字不足以定义。

事件侧同样缺：`queue_update`（steering/followUp 排队）、`compaction_*`、`auto_retry_*`（用户最需要看到的"正在重试"）、`session_info_changed`、模型/thinking 变更；`tool.update` 与 pi 的 `tool_execution_update` 连命名都没对齐。

**这已经不是推演**：工作区的 `sessions.ts` 已经在用 `session.list/open/prompt/abort`，而 §3.3 里没有它们；`src/lib.rs` 已经在导出 `port()`/`token()`，而 §3.3 没写 UI 如何拿到。协议正在被实现临时定义。

**后果**：M1 会在实现中途发明协议；M2 再改一次；`contracts/` 从"唯一共享面"退化为"事后描述"。这是最容易被低估、返工最贵的 P0。

**建议**：
1. 在 M0 结束前把 `contracts/` 写成可执行的契约（TS 类型 + zod 风格校验 + 一份 `protocol.md`），每个命令标注：**幂等性、错误码、归属域、是否需要在重连后重放**。
2. 命令按域分组，明确"谁执行"：`engine.*`（pi）、`pty.*`（native module）、`fs.*`（见 P0-5）、`ui.*`（扩展 UI 请求/响应）、`state.*`（Zu 自己的持久状态）。
3. 定义 `wire` 信封：`{ v, id, sessionId?, type, payload }`——现在连事件是否带 sessionId 都没写。
4. 把 `engine.info` 与握手统一（现在握手叫 `welcome`、命令叫 `engine.info`，两份数据）。

### P0-2 扩展宿主契约（Q23 的真正内容）

**现象**：`architecture.md:140` 的"`ctx.hasUI = true` + 三桥两降级"是一个**结论**，不是一个**机制**。事实是：默认 `noOpUIContext`、`hasUI=false`、`mode="print"`；要显式 `bindExtensions({ uiContext, mode })`。`ctx.ui` 有 20+ 方法；no-op 下 `confirm` 静默 `false`、`notify` 静默丢弃——扩展与用户都不会察觉。

**后果**：用户带着 `~/.pi/agent/extensions` 里的真实扩展（本机有两个，且都 `import node:fs`/`node:child_process`）进入 Zu，会得到"看起来加载了、实际什么都没发生"的最坏结果：审批类扩展静默拒绝、状态类扩展静默消失、`custom()` 类扩展静默降级。这正是 Q23 想避免的"同一会话两前端行为分叉"，只是更隐蔽。

**建议**（按 pi 自己的先例做，不要自创）：
1. 设 `mode: "rpc"`（或与上游商量新增 `"gui"`），让扩展用 `ctx.mode === "tui"` 自我降级——这是 pi 已经设计好的扩展写法。
2. UI 上下文**完整实现**：`select/confirm/input/editor` 走对话框；`notify` 走系统通知/Toast；`setStatus/setTitle` 走状态条与窗口标题；`setWidget/setFooter/setHeader/onTerminalInput/custom/…` 明确 no-op 并**记日志**（不要静默）。
3. 照抄 `rpc-extension-ui.md` 的请求-响应语义（含 `timeout` 自动 resolve），把它写进 `contracts/`。
4. **project trust** 补一个决策面：项目有受保护资源时，Zu 弹一次"信任此项目"（写 `trust.json` 或 `defaultProjectTrust`），否则 Q23 的"全量加载"在项目级不成立。注意这会与 Q24"写独立"冲突，需要裁决。
5. 用本机这两个真实扩展做一次验收（不用模型也能验证加载与 UI 调用路径）。

### P0-3 引擎是单点：没有监督、没有重连、没有恢复语义

**现象**：`architecture.md:92` 只写"定位并 spawn、回收，进程级单例"；`roadmap.md:36-41` 的 M0 只有 `spawnEngine/stopEngine/engineStatus`。但引擎同时是：全部会话的宿主、全部 Zu 持久状态的唯一写者、全部子代理的调度者。tray 应用会连续运行数天。

工作区已经比文档多走了一步：`src/lib.rs` 的 `Engine.start()` 会 `try_wait()` 检查旧子进程并按需重拉，`status()` 会回收已死的子进程，stderr 落到 `~/.pi/zu/engine.log`，端口是常量（47823）。**缺的不是"能重启"，而是"何时重启 + 重启后状态怎么办"**：没有心跳/退出码上报驱动的自动重启，没有重连快照，也没有"重启前正在跑的回合"的交代。

**后果**：
- 引擎崩溃 = 所有在跑回合消失，UI 只剩一个"连接断了"；用户不知道哪些消息已落盘、哪些没有。
- UI 重载（开发 HMR、崩溃恢复、系统重启 UI 进程）后，引擎里还开着 N 个 `AgentSession`，UI 却不知道——没有 `state.snapshot`，`openSession` 还会重复打开。
- 没有崩溃检测的退避重启策略，"关窗后台跑"这个核心承诺没有可靠性基础。

**建议**：
1. native module 做**监督**：在现有 `start()` 的自愈之上加健康检查（heartbeat）、退出码采集、指数退避重启、重启后 `engine.info` 带上 `generation`。
2. wire 加 `state.snapshot`（容器、打开的会话、活跃 run、未读、engine generation）+ `state.subscribe`；UI 重连先 snapshot 再增量。
3. 定义**幂等**：`session.open` 对同一 path 幂等；`container.open` 幂等；所有写命令带 `idempotencyKey` 或明确"重放会怎样"。
4. 定义"引擎死亡时 UI 的降级"：已落盘的转录仍可只读浏览（UI 无 fs，怎么办？见 P0-5——这也是"UI 不持 fs"的一个隐性代价）。

### P0-4 PTY 的归属是双头

**现象**：`architecture.md:55` 的 wire 有 `pty.open/resize/write/close`；`architecture.md:93` 与 `feasibility.md:110-131` 又把 PTY 放在 Rust native module（`Callback::post` 推流）；`architecture.md:156` 用"engine / native module"含糊过去。

**后果**：M3 第一天要决定"PTY 数据走 WS 还是走 native module 回调"。两条路的延迟模型、背压、生命周期、崩溃行为完全不同；先错一次就要重写终端接线。

**建议**：**PTY 只在 native module**（理由：字节流不该过 JSON/WS；nsh 的 `Callback::post` 就是为这个设计的；engine 不该管进程）。wire 里删掉 `pty.*`，改为 UI 侧 `TerminalResource`（TSX）+ native module 的 `Pty` 对象，并在 §3.3 明说"PTY 不经 wire"。顺带把 §5.1 的"engine / native module"改成单一答案。

### P0-5 文件读写没有归属（M6 直接阻塞）

**现象**：`architecture.md:68` 说 UI 不持 fs；`roadmap.md:132-133` 的 M6 要求"Editor sheet（真文件读写）"、文件树 dock；`architecture.md:88-96` 的 native module 表只有 engine/pty/lsp/git；wire 没有 `fs.*`。谁读文件？没人。

**后果**：M6 无法开工；临时方案会是"给 UI 开 `capabilities.fs`"——那会推翻 §3.4 的整个叙事，且把"编辑器的文件访问"与"agent 的工具访问"混在一个权限面里。

**建议**（三选一，写进 §3.6）：
- **A（推荐）**：`zu/fs`（Rust）提供 `read/write/stat/list/watch`，路径策略在 Rust 侧（工作区根 + 显式 grant），UI 只拿内容；LSP 的 `didOpen/didChange` 复用同一份内容，避免"编辑器与 LSP 各读一遍"。
- B：engine 加 `fs.*` 命令（简单，但把"文件"塞进 pi 的领域，engine 的职责会膨胀）。
- C：给 UI 开 `capabilities.fs`（最省事，但与 §3.4 的"最小能力面"直接冲突，需要重写那节）。

无论选哪个，都要回答：文件变更监听（`fs.watch` 在 276 个目录/大仓库下的成本）、大文件与二进制、编码、外部修改冲突。

### P1-1 并发写：文档给了错误的安心

见事实审计 F5。补充架构层面的建议：把"pi 会话文件的写者唯一性"写成不变量，而不是风险：

- 打开时记录 `(path, size, mtime, leafId)`；
- 写前 stat + 校验 leaf 仍是自己的；
- 不一致 → 只读模式 + 提示"外部已更新"（并禁止继续写入，避免分叉）；
- 在 UI 上给"该会话正被 pi CLI 使用"一个可见状态（mtime 在最近 N 秒内变化）。

这比"依赖 pi 的锁"诚实，也比"不支持并发"好用。

### P1-2 持久化格式没有版本化

`registry.json`、`projects.json`、`layouts/{id}.json`、`settings.json` 都没有 `schemaVersion`。M10 有自更新，意味着**新代码一定会读到旧文件**（且可能读到未来版本的文件——用户降级）。建议：
- 每个文件顶层加 `{ "v": 1, ... }`；
- 读取时 `v > 当前` → 只读打开并提示；`v < 当前` → 迁移函数链；
- 迁移失败不阻塞启动（与不变量 1"解析失败不阻塞启动"一致）。

### P1-3 规模与命名：真实数据不支持"自动纳入 + 一行一容器"

本机真实状态：**276 个 cwd 目录、660+ 个会话、195 MB**；`listAll()` 约 600 ms。按 Q18 自动纳入，会生成 276 个"项目"，名字是 `basename(primary)`——大量是 worktree 名（`feat-provider-request-headers`、`fix-plan-resurface`），既重复又无意义。

**建议**：
- 自动纳入**不自动建 Project**：无主会话落"Chats"桶（`architecture.md:165` 已这么写，但 `listAll` 的分组来源是 cwd 目录，会绕过它）——明确"Project 只由用户显式创建"。
- 侧栏做**两层聚合**（仓库 → 工作树/分组 → 会话）+ 虚拟化 + "最近 7 天/全部"切换；不要把 660+ 行平铺。
- 启动对账做增量（记录上次扫描的 mtime 水位），不要每次全量 `listAll`。
- 明确"孤儿项目"的回收（目录已删除的 cwd）。

### P1-4 派发层级与子会话的存储面

`architecture.md:180` 与不变量 8（`:230`） 说"子会话只收 captain 消息，GUI 无人类直连入口"，但：
- 扩展**全量加载**，所以 subagent 会话里也会注册 `dispatch` 工具 → 可以递归派发，违反"只两级"；
- `subagents/{captainId}/{ts}_{runId}.jsonl` 只是文件，**注册表里没有 run 条目**；"级联归档子会话"到底改什么？没有定义；
- `list_agents` 要列出 live+settled+verdict，这个状态归谁（engine 内存？文件扫描？）也没写。

**建议**：dispatch 扩展按"会话角色"门控（captain 注册，subagent 不注册）；给 run 一个轻量注册面（或在 `registry.json` 里加 `runs[]`），并明确"settled 的 run 只在文件里，live 的 run 只在内存里"；三级以上递归在工具层直接拒绝并返回明确错误。

### P1-5 打包链路：nsh 只做到 ad hoc，剩下全是我们的活

`nsh package --target macos` 产出固定布局（`Contents/MacOS` + `Resources/nsh/...`）、**ad hoc 签名**、**没有额外资源的钩子**（`packaging.md`、`macos.md#packaging`）。而设计要 `Contents/Helpers/pi-engine` + 两个 wasm + 嵌套签名 + hardened runtime + JIT entitlement + 公证。

**建议**：
1. 把"post-package"写成脚本纳入仓库：拷 sidecar + wasm 到 `Contents/Helpers` → `codesign --options runtime` 逐个签（sidecar 带 `com.apple.security.cs.allow-jit`）→ 签 app → `notarytool` → `stapler`。
2. **wasm 必须与 sidecar 同目录**（photon 用 `process.execPath` 兜底）；quickjs.wasm 同理，逐项验证。
3. M0 起就加一个 ad-hoc 打包冒烟（不需要 Developer ID），否则 M11 会一次性暴露全部问题。
4. 明确 `Contents/Helpers` 不在 nsh 的认知里：升级/自更新替换 app 时会不会丢？`nsh/updater` 替换整个 `.app`，所以**更新包必须包含 Helpers**——这条要写进 M10。

### P1-6 capability 声明与两个"动态"

`architecture.md:62-65` 的片段是错的（事实审计 A10）。更深一层：
- **端口是动态的**，`sockets` 无法表达；正确做法是 `hosts`（端口任意）。
- **浏览器（M8）需要 `webview.hosts`**，而地址栏意味着用户可访问任意站点 = `hosts: ["*"]`，与"白名单"自相矛盾。需要裁决：要么"内置浏览器只允许声明过的站点"（那就不该有地址栏），要么承认 `["*"]` 并写清风险。
- capability 是**构建期静态**的：M8 之前加的 `webview` 授权、M10 的通知权限，都要在发布前一次性补齐。建议在 `nsh.json` 旁放一份"capability 需求表"，随里程碑更新，避免上线前才发现漏授。

### P2 其它（值得写进文档，但不阻塞）

1. **"当前状态"没有锚点**：一天之内 README（"引擎未接线"）、§3.4（capability）、§3.3（协议）、§3.8（构建）全部与现实分叉。建议 README 顶部固定一行"as of <commit/日期> + 冒烟结果"，并把"用户可感知的交互"之外的技术状态交给脚本（`nsh check`/构建/冒烟）输出；否则文档会从"唯一共享面"退化成"事后材料"。
2. **安全叙事要诚实**：capability 保护的是 **UI/TSX 代码**，不是 agent 的动作——pi 的 bash/工具仍以用户权限运行。文档把"最小能力面"写得像安全边界，会误导后续评审。建议加一句"威胁模型"：UI 代码被攻破时限制其影响；agent 行为由 pi 的权限模型负责。
3. **WebView 是新的信任边界**（M8）：页面 → `postMessage` → UI 代码；`injectJavaScript` 做日志回传相当于把页面内容带进 UI。建议在 M8 明确"页面消息不进入 wire、不进入 agent 上下文"。
4. **Q22 的"切容器丢弃增量"**：可以丢 delta，但必须写清"**完成态权威**"——`message_end`/文件是唯一真相，切回来从转录重建。否则"后台跑完 → 通知 → 切回去"会看到空对话。建议把渲染路径定义成"文件投影 + 事件增量加速"，而不是"事件流就是状态"。
5. **视图全量挂载**：DockArea 会把所有 panel 都放进树（只有当前 tab 显示）。20 个 sheet（含 WebView/Editor/Terminal）同时存活时，内存与后台活动没有节流策略。M6/M8 前后需要"非可见 sheet 降级"（webview 暂停、editor 释放 rope、terminal 保留）。
6. **nsh 版本不对称**：pi 精确 pin + 台账；nsh 在工作区里是 `Cargo.toml` 的 `0.4.0` + `Cargo.lock`，但**文档从未提及**，也没有升级台账。而 nsh 是行为更不稳定的一侧（0.4.0、`term` 四天前加入、trait `#[non_exhaustive]`），且 TSX 侧还依赖本机 `nsh` CLI 的版本。建议：文档写明 pin 的位置与升级流程（`nsh check`/`nsh test` + 终端冒烟 + DockArea 冒烟），并把 CLI 版本纳入"环境"一节。
7. **`~/.pi/zu/` 的清理**：归档容器、死 subagent 文件、旧 layouts 会无限增长；Q11 说 v1 不做管理 UI，但至少要有一个"启动时清理孤儿 layout"的规则。
8. **单实例与固定端口**：nsh 没有单实例原语；macOS 的 `.app` 天然单实例，但 `nsh run` 与两份拷贝不是。**端口是常量 47823**（`src/lib.rs:19`），第二个实例会撞端口，且 token 不同——现象是"引擎无响应 / bad token"，很难诊断。M10 的"单实例强制"需要明确实现方式（锁文件 / `NSRunningApplication`），并给"端口被占用"一个明确的错误文案。
9. **engine 与 UI 的版本偏斜**：自更新后旧 UI + 新引擎、或反之。`protocol` 握手已有，但缺少"最低/最高协议版本"与降级行为。

## 2. 决策复核

| 决策 | 结论 | 需要补/改的 |
|---|---|---|
| Q1 路径即关系 | **保留** | 加"不反解目录名"（编码非单射）；父边以 header 为准 |
| Q2/Q20 单容器画布、单窗口 | **保留** | 明确"多窗口"未来若需要，扩展点在哪（`capabilities.windows` 是现成的，但窗口与容器的归属要预先想） |
| Q3 JSON 快照 + 原子 rename | **保留** | 加 `schemaVersion`、写前 fsync、启动对账的"半写"处理 |
| Q4 布局 stash | **保留** | zoom 单独存 + 恢复三步（见 A20） |
| Q5 键盘最小集 | **保留** | `⌘K` 是全部动作的入口，需要列一张"命令面板命令表"，否则实现时会漏 |
| Q6 不保留系统 pi 通道 | **保留结论，理由要改** | 不是"1 进程 1 会话"，而是"会失去多会话并发 + 全部 wire 逻辑要维护两遍" |
| Q7 持久化根 `~/.pi` | **保留** | 明确"UI 不持 storage"是策略，并给出 engine 不可用时的降级 |
| Q10 CustomEntry | **保留，证据最硬** | 无 |
| Q11 归档 v1 不做 UI | **保留，但加安全阀** | archive = 死亡且不可见；至少加"隐藏入口/确认框/永不删除"三选一 |
| Q13 子代理定义 | **保留** | 明确 `~/.pi/zu/agents` 与 `.pi/agents` 的关系（现在两处矛盾）；`skills` 字段与 pi 的 skill 解析要对齐 |
| Q14 自更新 | **保留** | 更新包必须含 `Contents/Helpers`；semver + build 递增 |
| Q15 四类外部容器 | **保留** | 无 |
| Q17 不引入授权轴 | **保留** | 安全叙事改写（P2-2） |
| Q18 无主会话自动纳入 | **保留，规模要治** | 不自动建 Project；聚合 + 虚拟化 + 增量对账 |
| Q19 `.pi/agents/` | **保留** | 与 Q13 的存储布局统一 |
| Q21 zoom 持久 | **保留** | 同 A20 |
| Q22 turn 进行中 | **保留** | 写清"完成态权威"，丢弃的只是 delta |
| Q23 扩展全量加载 | **重开（补全，不推翻）** | 宿主契约、UI 面、`ctx.mode`、project trust、扩展 UI 通道 |
| Q24 settings 读写 | **保留，补细节** | 自定义 `SettingsStorage`（读 pi、写 zu）；模型写回共享的实现方式；`trust.json` 归属；删掉"pi 的 settings 只读"这句与 Q24 冲突的话 |
| Q25 macOS 签名/公证 | **保留，补流程** | post-package 脚本、wasm 同目录、Helpers 随更新 |
| Q26 仓库公开 | **保留** | 无 |
| Q27 遥测 | **保留** | 无 |
| Q28 B（native module） | **保留** | 四域分期：M0 只做 engine spawn；PTY/LSP/Git 各自独立、可单独失败 |
| Q29 终端仿真核 | **保留结论，证据重写** | 删掉 alt screen 缺陷；M-tty 触发条件改为"冒烟暴露真实缺陷或需要鼠标/超链接" |
| Q30 LSP 位置 | **保留** | 与 P0-5 的文件读写共用通道 |
| Q31 native module 边界 | **保留，补失败隔离** | 四域共用一个 crate 意味着一个域 panic 会影响整个 app；至少要求"每个域自己 catch + 上报"，并明确 `zu/engine` 不可被其他域阻塞 |

## 3. 里程碑评审

**做得好的**：M1 是唯一不可延后的一环；M2 先于 M3；每个 M 都以"可用"为标准；条件性里程碑机制（M-tty/M-arch/M-web）避免过早投入。

**问题**：

1. **最大的不确定性排得太晚**。产品的两个核心承诺是"看见子代理并行"和"关窗后台跑"，前者在 M5，后者在 M10。而 M1 之后的 M2–M4 都不验证这两个承诺。建议：**在 M2 末尾插入一个"M5 薄切片"**（一个 `dispatch` 工具 + 一次派发 + 名册只读 + custom entry 落盘），把 Q23/Q10/多会话并发/子会话存储这四个风险一起压掉。这不是重排里程碑，是加一个 3–5 天的垂直切片。
2. **M1 的 wire 与架构不一致**（`session.list`），且验收 5 依赖 M5 的 custom entry → 二选一：把 M1 的 wire 写回架构，或把验收 5 移到 M5。
3. **Q9 i18n"键表第一天立住"没有落点**：M0/M1 都没有 i18n 项。要么写进 M0，要么把 Q9 降级为"M2 前"。
4. **Q24 的模型选择没有里程碑**：M2 侧栏要显示模型，但"选模型/改 thinking/写回共享"不在任何 M 的表里。建议并进 M2。
5. **M3 的"给 nsh 提 alt screen PR"要删**（假缺陷）。改成"产出真实缺陷清单 → 决定是否 M-tty"。
6. **M6 依赖未决的 P0-5**（文件读写归属）。在 M6 之前必须裁决，否则 M6 的第一行代码就要违反 §3.4。
7. **M10/M11 的打包细节**：建议 M0 就加"ad-hoc dmg 冒烟（含 Helpers + wasm + 重签）"，把 M11 的未知量提前暴露；否则 M11 会变成"最后一个里程碑推翻前十个"。
8. **缺一条持续项**：`engine` 的崩溃/重启演练（M0 起每 M 一次），以及"协议版本偏斜"的兼容测试。

**建议的里程碑微调（最小改动）**

| 改动 | 内容 | 理由 |
|---|---|---|
| M0 增 | `contracts/` v1 冻结；编译产物冒烟（已有一条真回归）；ad-hoc 打包冒烟；i18n 键表；文档当前状态锚点 | 五个"一次性返工"的源头都在这 |
| M1 增 | `state.snapshot` + 重连；`session.list` 写回架构 | 重连不是 M10 的事，M1 就会遇到（HMR/崩溃） |
| M2 增 | 模型/thinking 选择、扩展 UI 通道、project trust | 都是"不写就永远不做"的横切面 |
| M2 后插 | M5 薄切片（dispatch 单工具） | 把最大不确定性提前 |
| M3 改 | 删假缺陷 PR；改为"缺陷清单 + 结论" | 事实 |
| M6 前 | 裁决文件读写归属（P0-5） | 阻塞项 |
| M11 前 | 从 M0 起累积打包冒烟记录 | 风险前置 |

## 4. 建议的文档改动清单（可直接落笔）

**architecture.md**

1. §1 约束 1 重写：删"无 npm"，改为"pi 需要 Node 全量 API、worker、原生依赖与 WASM 资产；QuickJS 提供的是浏览器取向的子集"。
2. §3.3 补全协议（P0-1），并把 `pty.*` 移出 wire（P0-4）；写清事件信封与 sessionId。
3. §3.4 更正 capability 片段（`network.hosts: ["127.0.0.1"]`），补"UI 如何拿到 port/token"，补威胁模型一段。
4. §3.5 `settings.json` 注释与 Q24 对齐；所有持久文件加 `schemaVersion`；agents 路径与 Q19 统一。
5. §3.6 native module 表加 `zu/fs`（或明确替代方案）；补"四域失败隔离"。
6. §3.7 补"post-package：Helpers + wasm 同目录 + 嵌套签名 + 公证"，并说明 `nsh package` 只做 ad hoc。
7. §3.8 改成真实构建回路（多入口、资产拷贝、`VERSION` 注入、编译冒烟），删掉不存在的 `engine/build.ts`。
8. §4.3 zoom 单独存 + 恢复三步（拆 panel/groupOf/toggleZoom）。
9. §4.5 扩成"扩展宿主契约"：`bindExtensions`、`mode`、UI 方法矩阵（支持/降级/no-op+日志）、`extension_ui_request/response`、trust。
10. §5.4 补"外部写检测"（size/mtime/leafId）与复活判定依据。
11. §5.5 持久层加 `schemaVersion` 与迁移；补"engine 不可用时的降级"。
12. §5.6 dispatch 加"按会话角色门控"；补 run 的注册面/级联归档的落点。
13. §6 终端选型删掉 alt screen 缺陷依据。
14. §7 风险 4 改写（无锁事实）；新增风险：扩展宿主、project trust、引擎单点、协议未冻结。

**decisions.md**

15. 新增待决区（roadmap 承诺过但不存在），把本评审的 P0-5/P0-1/P0-3 登记为待决。
16. Q6/Q29 的理由重写；Q23 补全；Q24 细化；Q3 加版本；Q1 加"不反解目录名"。

**roadmap.md**

17. M1 wire 与架构对齐；M1 验收 5 移到 M5；M2 删 U7/U8/U9/U14；M-web 的 Q6 引用改掉；M3 删假缺陷任务；M5 前移薄切片；M6 前裁决文件归属；M0 增加项见表。

**README.md**

18. 更新"当前状态"：`engine/`、`Cargo.toml`、`src/lib.rs`、`engine.ts`、`sessions.ts` 已在工作区；dev 与编译形态都能起；M0 从"下一步"变为"进行中"，并给出 **as of** 锚点与最近一次冒烟结果。
19. 新增一节"文档治理"：状态锚点、`nsh` 与 `pi` 双侧的 pin/升级台账、协议冻结与变更流程（谁改 `contracts/`、如何通知 UI/engine）。

## 5. 如果只做三件事

1. **冻结 `contracts/` + 把扩展宿主打通**（P0-1、P0-2）。这两件事决定 M1 之后是不是每两个月重写一次协议与扩展桥；而且它们不需要等任何外部条件。
2. **把构建回路写成文档 + 产物冒烟 + 打包冒烟**（事实审计 F1、F3 与本文 P1-5）。编译产物在 16:53 起不来、17:07 被修——但文档里没有这一节，多入口/资产/重签也仍未验证。M0 的全部意义是"能构建能运行"，这条链要靠脚本与 CI 守住，而不是靠人肉发现。
3. **把 dispatch 切片提前 + 给引擎加监督/重连**（P0-3、里程碑 1）。产品的两个核心承诺都在这里，越晚验证越贵。

## 6. 我与作者的判断分歧（供讨论，不必采纳）

- **"UI 不持 storage"**：我认为 nsh 的 `Storage`（无 capability、5 MB）恰好适合放 layout/zoom/上次容器/窗口偏好这类 UI 状态；全部过 wire 会把"engine 可用性"变成"界面能不能记住布局"的前置条件。若坚持文件权威，请在文档里写出理由（可读、可 diff、可备份？）。
- **Q22 的"丢弃增量"**：我会把渲染路径定为"从转录文件重建 + 事件只做加速"，这样切容器、重连、崩溃恢复是同一套逻辑；现在读起来像是"事件流就是状态"。
- **归档语义**：v1 的 archive 是"不可见 + 杀资源 + 级联归档"，但没有任何恢复入口；我会把它做成"归档 = 从侧栏移除，永不删除，可在设置里找回"，成本一样，风险小一个量级。
- **M5 的位置**：我会接受"里程碑纪律"的约束，但坚持在 M2 后插一个薄切片，而不是等到 M4/M5。
