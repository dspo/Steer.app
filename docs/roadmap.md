# 路线图：目标与里程碑

> 2026-11-10。原则：**先造能跑的原型车，再逐渐丰富**——不先造完美车架与完美轮子。
> **M0** 只准备环境与骨架（不可用）；**M1 起，每个里程碑结束时都必须是一个能构建、能运行、能完成一件真实事情的 App。**

## 1. 产品目标

**Zu 是 pi 的桌面端。** 它把 pi 的 coding agent 从终端 TUI 带到一个多面板工作台里：并行的会话、可见的子代理、与 agent 工作并排的终端/编辑器/Diff/Git，以及一个图形化的 task 组织面。它不是「更好的终端」，也不是 IDE 的替代品；它是**围绕 pi 的工作台**。

**给谁**：已经在用 `pi` CLI 的开发者，他们的 `~/.pi` 里已经有一堆会话、扩展与 skill，换到 Zu 应该无缝——打开就能看到昨天用 CLI 开的会话（Q7/Q18）。

**衡量成功的用户场景**：

1. 打开 Zu，侧栏列出我所有的会话（不论谁创建的），点开就能继续。
2. 我让 captain 派两个子代理并行改不同文件，我在名册里看着它们跑。
3. 同一个工作台里，一边是对话，一边是 Claude Code TUI，一边是 diff——我把它们拖成任意布局。
4. 关掉窗口它还在后台跑，跑完了系统通知我。

**不做**：多窗口（Q2/Q20）、跨容器画布、沙箱授权轴（Q17）、归档管理 UI（Q11）、移动端、web 目标（M10 之后再议）。

## 2. 里程碑纪律

- **可构建可用**：每个 M 结束时 `nsh run .` 能起窗口并完成该 M 的目标场景；打包（M0 起 ad-hoc dmg）能生成可运行的 app。
- **每个 M 一个分支 + 一个 PR**，结束时打 `mN` 标签；不跨 M 做大规模重构（发现的架构问题先记 `decisions.md` 的待决区，不阻塞当前 M）。
- **门禁**：`nsh check`、`nsh test`、engine 的 `bun test`；每个 M 至少一条端到端冒烟（真 pi、真 PTY 等用 env 门控）。
- **技术债挂账**：能跑优先，但每笔临时手段必须在 PR 描述里注明「何时还」。

## 3. M0 — 地基（不可用）

> **状态：已完成（2026-11-10）。** 双包结构、mixed 模板、`zu/engine` native module、sidecar 编译与握手全部跑通；`script/bundle-mac.sh` 出 ad-hoc 签名的 dmg，包内 sidecar 实测被启动。

**目的**：把「一个新 App 能起来并与引擎说话」这件事跑通。这一阶段的产品不可用，是唯一允许不可用的里程碑。

| 项 | 内容 |
|---|---|
| 仓库结构 | 仓库根即 app（TSX + `src/lib.rs`，mixed 模板的约定：`App.tsx` 与 `nsh.json` 同级）+ `engine/`（Bun + pin 的 pi） |
| 构建 | `engine/`：`bun build --compile` → 单文件 sidecar，产物进 app bundle 的 `Contents/Helpers/`（Q28=B） |
| native module | `zu/engine`：`spawnEngine()` / `stopEngine()` / `engineStatus()`；Rust 侧 `current_exe()` 定位 sidecar |
| engine 最小面 | loopback WS server + token 握手 + `ping`/`pong` + 进程退出时清理 |
| UI 最小面 | 一个窗口 + 状态条显示「引擎：未启动/运行中/端口 N」 |
| 打包 | ad-hoc 签名 dmg（正式签名留到 M11） |

**验收**：`nsh run .` 起窗口；点「启动引擎」（或启动时自动）→ engine 进程起来 → WS 握手 → 状态条显示运行中；**退出应用 → engine 随之退出**（关窗不退出 app 是 macOS 惯例；托盘常驻在 M10）。没有对话，没有终端。

**风险**：mixed 模板与 `nsh check` 的首次配置（`"rust": "."`、`.nsh/types` 生成）；sidecar 与 UI 的路径定位在 `nsh run` 与打包后两种形态下的差异。

## 4. M1 — 开启一个对话（第一个可用 App）

> **状态：已完成（2026-11-10）。** 侧栏列出 pi 的全部会话；打开显示历史（`TextView` 渲染 Markdown）；prompt 流式进入转录；工具调用显示为卡片；流式中可停止且已生成部分保留；引擎重启后同一会话可续聊。**8 条测试**覆盖：shell 渲染、对话渲染 fixture、连接与列表、真实流式回复、工具卡、流式中停止、重开保留、引擎重启续聊 + `zu.turn` custom entry。

**目的**：**在 Zu 里真正与 pi 对话。** 这是整条路线的原型车：侧栏 + 对话 + composer，能流式、能中止、能重启继续。

| 层 | 内容 |
|---|---|
| engine | `SessionManager` + `createAgentSession`（SDK，单会话）；`session.create/open/prompt/abort/close`；`agent_settled` 作为回合终点 |
| wire | 上述命令 + `message.delta` / `message.complete` / `agent.state` / `tool.start` / `tool.end` / `error` |
| UI | 侧栏会话列表（engine 用 `SessionManager.listAll` 枚举，Q18 对账）；对话 sheet（`TextView` 流式 Markdown、工具卡、composer `Input` + 发送/停止） |
| 数据 | 会话选择（列表点开）、流式状态；未读计数留到 M2（容器模型） |

**实现备注**：工具卡由 `tool.start/end` 折成带状态的卡片，测试用真实 `read` 工具调用验证；每个 turn 结束时 engine 向会话写一条 `zu.turn` custom entry（Q10 的机制从 M1 起用），pi 的加载器能读出它。

**验收**（全部要有手测记录）：
1. 侧栏列出 pi CLI 昨天创建的会话，点开显示完整历史。
2. 输入一句话 → 流式回复 → 工具调用卡片出现 → 回合结束（`agent_settled`）。
3. 流式中按「停止」→ 状态正确，转录保留。
4. 关掉 app 重开 → 会话仍在，能继续对话（同一 pi session 文件）。
5. 会话文件在 pi 的原生存储里，pi 的加载器能读回，且**能看到 Zu 写的 `zu.turn` custom entry**（测试断言 `session.open` 返回的 `customTypes` 含它；`SessionManager` 就是 pi CLI 用的加载器）。

**风险**：`createAgentSession` 的真实运行（spike 未验证项）；流式增量与 `TextView` 重渲的帧率；pi 的 `agent_settled` 之前是否还有事件。

## 5. M2 — 工作台形态（多容器、panel/sheet）

**目的**：从「一个聊天窗口」变成「一个工作台」：侧栏一行 = 一个容器，切换即切换一组面；sheet 可拖拽、布局可持久化。

| 层 | 内容 |
|---|---|
| engine | 容器注册表（`~/.pi/zu/registry.json`，JSON 快照 + 原子 rename）；`container.list` / `open` / `archive`；teardown 单点 |
| UI | `DockArea` 接入（替换 M1 的单 sheet）；sheet 注册表（session 族：对话/subagents/统计占位）；布局 stash（含 zoom，U14）；侧栏容器行（状态点、未读、模型/cost） |
| 交互 | sheet 跨 panel 拖拽、组边缘分栏、拖手缩放、`⌘W`/`⌘1-9`/`⌘K`（U9）；启动恢复上次容器（U7）；死资源 sheet 静默移除（U8） |

**验收**：开两个会话容器 → 切换 → 各自布局独立；把一个台 sheet 拖到另一个 panel 再拖回，状态不丢；重启后布局与上次活跃容器恢复。

**风险**：DockArea 的受控 layout 与 stash/restore 的时序（切容器时先 stash 后 restore）；会话切换时的流式增量（Q22：丢弃非当前容器增量）。

## 6. M3 — 终端与 agent TUI

**目的**：在 Zu 里开真终端，跑 Claude Code / Codex / Copilot。

| 层 | 内容 |
|---|---|
| native module | `zu/pty`：`Pty::new/onData/onExit/write/resize/kill`（`portable-pty`） |
| UI | Terminal sheet（nsh `Terminal` 组件）接 PTY；external 容器（`terminal` / `claude` / `codex` / `copilot`，0 号即 PTY 进程）；`onResize` 回写 PTY |
| 仿真核 | **先用 nsh 内置 `VtEmulator`**；按 [evidence/terminal-emulator.md](evidence/terminal-emulator.md) 的待实测清单冒烟，产出缺陷报告；同时给 nsh 提 alt screen 污染的修复 PR |
| 生命周期 | PTY 归容器（容器死全回收；重启不恢复终端，Q3/§9） |

**验收**：
1. 开一个 shell 终端，跑 `ls`、`vim`、`htop`（记录渲染缺陷）。
2. 开 Claude Code TUI，完成一次真实对话；用 `Ctrl+C` 中断。
3. resize 窗口/panel，TUI 重排正确。
4. 关容器 → PTY 进程被 kill（`ps` 验证）。
5. 产出 Q29 的冒烟结论：是否需要进入「终端增强」里程碑。

**风险**：nsh 内置仿真核的 alt screen 污染与鼠标缺失（已知）；PTY 与 nsh 键盘/粘贴的边界（bracketed paste 双向）；进程孤儿。

## 7. M4 — 项目与 Launcher

**目的**：让「从哪开始一个对话」变得可组织：项目（多根、primary）与发射台。

| 层 | 内容 |
|---|---|
| UI | Launcher（项目 chip + composer + agent 动作行；先 composer 后容器）；项目创建/编辑对话框（多根、设为主要）；侧栏按项目分组 |
| 数据 | Project 实体 + membership（`~/.pi/zu/projects.json`）；容器 cwd = primary 快照；拖行换项目 |
| 规则 | 创建后不可改目标（INITIAL-CWD D1/D8）；组头「＋」锁死项目（D2） |

**验收**：建一个双根项目 → 从 Launcher 开对话（cwd 是 primary）→ 侧栏正确分组 → 拖一个容器到另一项目 → 重启后 membership 保持。

## 8. M5 — 子代理（pi 的调度面）

**目的**：让 captain 派活、并行跑、可见可续跑。

| 层 | 内容 |
|---|---|
| engine | `dispatch` 扩展（创建/续跑/引导/停止 + `list_agents`）；子会话落 `~/.pi/zu/subagents/{captainId}/{ts}_{runId}.jsonl`（路径即关系）；custom entry 写 `zu.dispatch` / `zu.delivered` |
| UI | 名册 sheet（live + settled）；子会话 transcript 只读视图；captain 转录里的派发/交付 note 行 |

**验收**：让 captain 派两个子代理改不同文件 → 名册显示 running → 交付 → 续跑其中一个 → pi CLI 打开 captain 会话能看到 zu custom entry 且不报错。

## 9. M6 — 编辑器与 Diff

**目的**：在工作台里看和改代码。

| 层 | 内容 |
|---|---|
| UI | Editor sheet（`Editor` 组件，真文件读写，语法高亮、行号、软换行）；DiffView sheet（工作区变更或两文件对比，split/unified） |
| 数据 | 文件树 dock（`Tree`）；文件变更随容器 cwd |

**验收**：打开文件 → 编辑 → 保存 → 磁盘内容一致；看一次 git diff（`DiffView`），hunk 显示正确。

## 10. M7 — Git

**目的**：不离开 Zu 完成一次提交。

| 层 | 内容 |
|---|---|
| 数据 | `zu/git`：`status` / `diff` / `log` / `branches` / `stage` / `commit` / `checkout`（shell out `git`） |
| UI | Changes 面板（DiffView + 文件列表 + stage 勾选）；History（提交列表 + 详情）；分支切换（命令面板/菜单） |

**验收**：改一个文件 → Changes 显示 → stage → 写 commit message → 提交成功（`git log` 验证）；切分支。

## 11. M8 — 浏览器

**目的**：工作台里查文档。

| 层 | 内容 |
|---|---|
| UI | Browser sheet（`WebView` + 地址栏 + 前进/后退/刷新）；每 sheet 一个 web view；`onNavigationStateChange` 驱动标题与图标 |
| 能力 | `capabilities.webview.hosts` 白名单；`incognito` 选项；`injectJavaScript` 做日志回传（devtools 缺失的缓解） |

**验收**：打开文档页、搜索、前进后退；链接在 sheet 内打开或外部打开（可配置）。

## 12. M9 — LSP

**目的**：编辑器从「高亮」升级到「理解代码」。

| 层 | 内容 |
|---|---|
| native module | `zu/lsp`：起语言服务器（`std::process`）、stdio JSON-RPC、`didOpen/didChange` 增量、诊断/hover/definition/completion 推送 |
| UI | 诊断标记与 Problems 面板；hover 卡片（`TextView`）；跳转（`EditorRef.revealPosition`）；补全列表 |

**验收**：Rust 文件里有一条类型错误 → Problems 显示；hover 有签名；`F12` 跳到定义；补全有候选。

## 13. M10 — 常驻、通知与自更新

**目的**：从「一个 App」变成「一个一直在的助手」。

| 层 | 内容 |
|---|---|
| 生命周期 | 关窗收起（无确认，Q16）；单实例；托盘图标 + 菜单（显示/退出） |
| 通知 | turn settle / 子会话交付 → 系统通知（首版激进，Q16）；权限申请 |
| 更新 | nsh/updater + GitHub Releases（Q14）；检查/下载进度/安装重启 |

**验收**：关窗后 agent 继续跑 → 完成时收到通知 → 托盘点开回到窗口；新版本能检查到并安装。

## 14. M11 — 分发（正式签名与公证）

**目的**：陌生人下载后双击可用。

| 项 | 内容 |
|---|---|
| 签名 | Developer ID；**嵌套签名**（sidecar 先签，再签 app）；hardened runtime + Bun JIT entitlement（Q25） |
| 公证 | notarytool；staple |
| 产物 | dmg（arm64）+ 校验；首次启动无 Gatekeeper 拦截 |

**验收**：在一台干净机器上双击安装 → 首次启动无拦截 → 引擎能起。

## 15. 条件性里程碑

| 名称 | 触发条件 | 内容 |
|---|---|---|
| **M-tty 终端增强** | M3 冒烟的缺陷超出「可接受」或用户要求鼠标/超链接 | Ghostty 仿真核 + 扩 nsh trait/组件（鼠标、光标形状、OSC 8/52、下划线样式），见 Q29 |
| **M-arch 归档管理** | 用户开始需要找回归档容器（Q11） | 设置页「归档管理」子页 |
| **M-web** | 产品需要浏览器/移动端访问（Q6 的 web 挂账） | 同一 wire 的 web client |

## 16. 依赖与顺序

```
M0 ──▶ M1 ──▶ M2 ──▶ M3 ──┬─▶ M4 ──▶ M5 ──▶ M6 ──▶ M7 ──▶ M8 ──▶ M9 ──▶ M10 ──▶ M11
                          └─▶ (M-tty 视 M3 冒烟结果插入)
```

- **M1 是唯一不可延后的一环**（没有对话就没有产品）。
- **M2 早于 M3**：终端要作为容器资源放进工作台，工作台形态先立住，终端接入才自然。
- **M4 早于 M5**：子代理的派发需要先有项目/cwd 的组织语义。
- **M6–M9 顺序可调**（编辑器/ Git / 浏览器 / LSP 相互独立，按真实使用优先级调整）。
- **M10/M11 不能省**：没有常驻与签名，Zu 只是开发者的自用工具。

## 17. 每个里程碑都要带的持续项

- [architecture.md](architecture.md) §7 的已知风险逐条销账（真实会话、fork 观感、并发写、签名）。
- pi 版本锁定与兼容性台账（E11 的纪律）：每次 pi 升级跑一遍引擎测试与 TUI 冒烟。
- 文档同步：架构决策变更同日更新对应 `docs/*.md`；用户可感知的交互写进 README 的当前状态。
