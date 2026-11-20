# 终端标题：捕获、解释与投影

> 状态：**PR1–PR3 已落地，PR4（manox 捕获）随本分支落地（2026-11-19）**。上游：dspo/manox `v0.13.0`（#1030 的 chunk observer 全量交付；bump 台账见 upstream-watch）。PR3 的评审修正（D4 删除接线、C1 矩阵回正、D5 trim/合并限频、非阻塞 tap、补测）均已含。本文是 issue [#73](https://cnb.cool/dspo-group/Steer.app/-/issues/73)
> 的实现规格：pi 侧的捕获（ops-tap）、会话级通道（fd 继承）与投影（tab-only）已落地；内核行为基线见 §6。
> 上游缝：dspo/manox#1030（chunk observer）、dspo/manox#1032（工具 env，C1 后置）。
> 讨论与三轮评审核对记录见 issue #73 评论链与 dspo/manox#1030 修订记录。

## 0. 一句话

**工具往 stdout 写标准 OSC 0/2，标题即改——与它跑在一个真终端里逐字同构；不为标题发明任何专属工具或专属通道。**

## 1. 需求

1. **必须项**：纯 `printf '\033]2;t\a'`（无重定向、不知道 `ZU_TTY`）在托管形态生效。C1 的显式重定向是文档化的补充形态，不是前提——它要求 agent 知道 Zu 约定，本身就是专属知识。
2. **范围**：终端 tab 直跑（已原生可用）+ **Zu 托管对话（pi）** + **Manox 托管对话**的 Bash 工具。
3. **可扩展**：今天 OSC 0/2，明天 OSC 9 / OSC 52 / OSC 7——捕获与解释分离，解释者唯一。

## 2. 架构

```
工具 stdout（含 printf 的原始字节）
  │ L0 捕获：ops-tap（原始字节、不落盘、纯观察者）
  │   pi   customTools 的 createBashToolDefinition + operations tap
  │        （captain/subagent 两点接线；codemode 走同 registry 自动覆盖）
  │   manox install_bash_output_tap（dspo/manox#1030）
  │        前台四变体挂 on_data + background 挂 registry 读端
  ▼
L1 解释：会话级 headless ghostty-vt Emulator
  │   pi 跨进程经会话私有 PTY（manox in-proc 直喂）
  ▼
L2 投影：title 事件 → 该对话 sheet 的 tab 标题（tab-only）
```

- **解释者唯一**：ghostty-vt 是终端世界的既有解释者——无自定义 scanner、无 policy 表；OSC 9/52 的扩展 = 接/不接 Emulator 既有回调（默认不接 = 默认关，OSC 52 剪贴板天然关闭）。
- **pi 落地（PR3）**：`customTools` 两点接线（captain `pi-session.ts`、subagent `subagents.ts`，codemode 走同 registry）；通道 `title_capture.rs`（进程级 registry，`TitleCapture.open/close`）；fd 经 acp.rs 的 `pre_exec` 继承（`ZU_TITLE_FD`）；投影 store `modules/pi/titles.ts` + kind `tabTitle`。
- **manox 落地（PR4）**：内核 tap 在泵启动时安装（`Manox::start` → `ensure_tap_installed`，restart 复用）；`title_bridge.rs` 持有每线程的 headless ghostty，tap 按 `session_id`（= Zu 的 thread id）路由字节，**in-proc 直喂**（无 PTY 传输）；TSX `TitleBridge` 经 domains 边界由 manox 模块的 titles store 消费（与 pi 共用 `core/title-store.ts` 的 D3/D4/D5 语义）；manox-chat kind 的 `tabTitle` = 线程的程序标题。
- **捕获选型**：ops/chunk 层 tap（`onData` Buffer 在 pi 的 stripAnsi 之前、manox 的 `BashDataCallback` 是 `&[u8]` 原始字节），宿主进程内执行不受工具子进程 seatbelt 写白名单约束。否决过：shell shim（沙箱拒写 + procsub 语法面）、AHP 帧 tap（依赖「内核不剥字节」的否定性行为 + 截断）、装饰 `BashOperations`（macOS 前台 tracked 路径绕过 ops——dspo/manox#1030 修订记录）。

## 3. 决策记录（2026-11-19 拍板）

| # | 决策 | 理由 |
|---|---|---|
| D1 | **投影 tab-only**：程序标题只进 dock tab 文本（`SwitcherTitle`）与关闭按钮 a11y；`sheetTitle`/`containerTitle`/侧栏/通知保持会话名 | `containerTitle` 取 `sheetTitle` 且 `namesContainer` 默认 true——程序标题流入会连带改容器名。实现：新增 `tabTitle(id)` hook，`sheetTitle` 不动；`titles.test.ts` 的 containerTitle 断言同步修订 |
| D2 | **并发撕序列 = 接受 + 测试**：per-session 单写队列；「并发 + 标题恰跨 tap chunk 边界」偶发丢一次标题、下一条即恢复；确定性并行用例固化；per-exec Emulator 记为后备 | per-exec Emulator 是重装备；退化面是有界的装饰性损失。注意：ghostty-vt 的跨 write 重组只对**单流**成立 |
| D3 | **空标题回落会话名**（不保留上一个程序标题、不清空 tab） | tab 需要有身份；终端 tab 的「保留最后标题」语义不适用于对话 sheet |
| D4 | **标题 = 会话级瞬态**：Emulator 与 title store 随会话存活，sheet 重开仍在；`releaseSession`/容器归档不清 store，删除会话才清 | sheet 关闭期间 manox 后台命令的标题不丢；pi 的 harness 重启（新 spawn）也不丢 store |
| D5 | **标题事件的净化唯一权威在投影**：trim、超长（内核 1024 字节上限）、空标题回落（D3）；限频「合并到最新」不丢包 | 内核行为与投影策略分层；直写形态（C1）同样被投影覆盖。PR3 落地：store 写入 trim（空白视为空、同步回落）；非空标题按会话合并到最新（120ms 窗口，app 侧，最终值不丢） |

## 4. 生命周期与传输

- **Emulator / title store：per session**（pi 会话 / manox AHP thread）。
- **传输通道：会话级一对**——会话开始、首次 spawn 前创建，harness 重启**复用同一从端**，会话结束才销毁（复用窗口与泄漏都从根上移除）；销毁只随会话结束。
- **fd 继承，不走路径 open**：pi harness 由 `std::process::Command` spawn（acp.rs:264，`CommandExt` 已在用），`pre_exec` 把 app 持有的从端 fd dup 到约定 fd 号（`ZU_TITLE_FD`）+ env 告知 fd 号；app 先持 master 保证从端有效，失败面「原始字节注入别的表面」从根上移除。从端以 `O_NOCTTY | O_NONBLOCK` 打开，同一环境变量下发的还有 **`ZU_TTY`（从端路径，C1 显式直写形态）**。
- **tap 的背压取舍（PR3 评审定稿）**：从端是非阻塞 fd——缓冲满时 harness 的 tap `writeSync` 拿到 EAGAIN，**丢弃剩余**而非阻塞（阻塞会卡住 harness 的事件循环，连 ACP 帧一起）。宿主的 drain 正常时不会发生；退化面是偶发丢标题，下一条即恢复。
- **harness 崩溃重启**：复用同一通道与 fd（重启前 re-dup 一次即可）；title store 在会话层，不丢。
- 背压：排空循环独立线程、不与 UI 锁竞争（`pty.rs` reader 线程模式）。写满 tty 缓冲而排空停摆时写者阻塞——与真终端同一流控语义。

## 5. `ZU_TTY` 矩阵（C1 显式直写形态）

| 形态 | `ZU_TTY` | 纯 printf（无重定向） | 落地 PR |
|---|---|---|---|
| 终端 tab 直跑 | ✅ `tty_name()` 注入（**已落地**） | ✅ 原生 | PR2 |
| pi 托管 | ✅ `ZU_TTY` = 通道从端路径（**已落地**，与 `ZU_TITLE_FD` 同 spawn 注入） | ✅ ops-tap（**已落地**） | PR3 |
| manox 托管 | ❌ 后置（#1032 的 `tool_env` **已随 v0.13.0 交付**；未接线的原因是标题桥 in-proc 直喂、无从端路径可声明——桥 PTY 化后即可接） | ✅ chunk observer（**已落地**） | PR4 |

C1 用法（可文档化给 agent 的显式形态，**已落地**）：

```sh
printf '\033]2;Zu: 阶段名\007' > "$ZU_TTY"
```

- 注入点一：`Process::spawn`（native/src/pty.rs）——终端 sheet 与 `Pty` 两个 PTY 消费方都声明：凡持 tty 者声明事实；
- 注入点二：`title_capture.rs` 的 `wire`——托管会话的通道从端路径作为 `ZU_TTY` 下发，与 `ZU_TITLE_FD` 同 spawn 注入；显式直写与 tap 写入进同一个 Emulator；
- Rust 契约：`the_program_sees_its_own_tty_as_zu_tty`（pty.rs）与 `zu_tty_names_the_channel_tty_in_the_shell`（title_capture.rs）。

## 6. 内核行为基线（PR1 已锁定，`native/src/session.rs`）

`session.rs` 的 headless 单测是捕获管线的接收契约；以下行为由测试锁死：

| 行为 | 基线 |
|---|---|
| OSC 2 + BEL / + ST（`ESC \`） | 设置标题并出 `title` 事件 |
| OSC 0（icon name + title） | 同一单标题投影，无 icon/title 分离 |
| 序列在任意字节边界分片 | 重组（内核按字节流解析） |
| UTF-8 标题跨字符/字符内分片 | 完整存活 |
| alt-screen 下设置 | 正常投影 |
| 空标题序列 | **上报空串**（事件照发）；投影层决定含义（D3 回落） |
| 超长标题（>1024 字节） | **截断到内核上限，不丢弃** |
| 重设标题 | 事件携带完整当前标题（非增量） |
| OSC 2 + 0x9C 终止符 | **不终止**（ghostty-vt 既有行为：UTF-8 模式 C1 字节是 payload）；内核取消该序列且无残渣——后续序列全新解析。工具应以 BEL 或 `ESC \` 结尾 |

## 7. 测试矩阵（实现验收）

**已落地（PR3）**：

- **投影拆分**：`titles.test.ts`——tab 显示程序标题而 `containerTitle`/`sheetTitle` 保持会话名；空标题回落；按会话键；whitespace 清空同步回落；prune（删除的会话清 store 与通道，活的受保护）。
- **native**：`title_capture.rs` 六例——从端写入出标题、`pre_exec` 继承端到端（sh `>&$ZU_TITLE_FD`）、`ZU_TTY` 在 shell 内可见且显式直写进同一 Emulator、install 复用并重挂观察者、空标题语义（首个空不上报；真标题后的空上报回落）、remove 释放。
- **pi-harness**：`title-tap.test.ts` 六例——tap 喂原始 chunk 且 pi 流不变、经 `ZU_TITLE_FD` 端到端（真实 bash）、非零退出码透传、renderer 与 `shellPath`/`commandPrefix` 保真、**两组并行 bash 跨 chunk 标题**（确定性切分）、**100 MB 过 tap**（<10s、逐字节完整、尾部标题存活）。

**已落地（PR4）**：

- **native**：`title_bridge.rs` 四例——桥内 feed 出标题、按 session 路由且互不串、空标题语义（同通道）、remove 后丢弃；内核 tap 的**进程单例与 restart 复用**有断言；四条 bash 路径（tracked/plain/persistent/subagent/background）的覆盖由内核 v0.13.0 的 acceptance 测试交付（tap.rs 的 test_support + 内核测试）。

**后置/上游项**：

- `ZU_MANOX_GATE` app 级用例（真实泵 + 真实 bash 跑一轮 → tab 标题变）：需要模型回合，随 ZU_MANOX_GATE 的既有门禁补；内核侧四路径覆盖已由 v0.13.0 acceptance 测试交付。

**后置（app 级 e2e，非设计缺口，随 PR5 或 PR4 后补）**：

- abort/timeout 中断后 tap 不破坏（bun 侧已覆盖退出码；abort 场景需真实 harness 用例）。
- harness 崩溃重启后通道复用与 sheet 重开标题（native `install` 复用已测；app 级重连用例待真实 harness）。
- 端到端用例（`Acp.start` 带通道 → harness bash 写 OSC → tab 标题变）——native 与 pi 两半各自已测，串联用例需要真实 harness，随 PR4 后补。

## 8. upstream-watch（依赖 bump 时核对）

- **pi 1.5.0**：settings bash options 组装（`agent-session.js:2983-2992`）、`customTools` 按名覆盖（`_refreshToolRegistry`）、operations `onData` 在 stripAnsi 之前、`ctx.setTitle` SDK 模式 no-op。
- **dspo/manox（v0.13.0 起）**：#1030 两条应用点在位（前台 `on_data` + background registry 读端）、验收清单七项通过、内核新增 bash 路径必须过 tap；#1032 `tool_env` 交付后核对其不被内核管理键覆盖。
