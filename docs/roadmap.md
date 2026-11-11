# 路线图：目标与里程碑

> 原则：**先造能跑的原型车，再逐渐丰富**。
> **M0** 只准备环境与骨架（不可用）；**M1 起，每个里程碑结束时都必须是一个能构建、能运行、能完成一件真实事情的 App。**
> **顺序按「能定下架构的工作在前，实现细节在后」排**：M2–M5 把契约定死、把对象模型跑起来；M6 打磨轮廓；M7 起才是集成细节。

## 1. 产品目标

**Zu 是 pi 的桌面端。** 它把 pi 的 coding agent 从终端 TUI 带到一个多面板工作台里：并行的会话、可见的子代理、与 agent 工作并排的终端/编辑器/Diff/Git，以及一个图形化的 task 组织面。它不是「更好的终端」，也不是 IDE 的替代品；它是**围绕 pi 的工作台**。

**给谁**：已经在用 `pi` CLI 的开发者，他们的 `~/.pi` 里已经有一堆会话、扩展与 skill，换到 Zu 应该无缝——打开就能看到昨天用 CLI 开的会话。

**衡量成功的用户场景**：

1. 打开 Zu，侧栏列出我所有的会话（不论谁创建的），点开就能继续。
2. 我让 captain 派两个子代理并行改不同文件，我在名册里看着它们跑。
3. 同一个工作台里，一边是对话，一边是 Claude Code TUI，一边是 diff——我把它们拖成任意布局。
4. 关掉窗口它还在后台跑，跑完了系统通知我。

**不做**：多窗口、跨容器画布、沙箱授权轴、归档管理 UI（v1）、移动端、web 目标。

## 2. 里程碑纪律

- **可构建可用**：每个 M 结束时 `nsh run .` 能起窗口并完成该 M 的目标场景；`script/bundle-mac.sh` 能出可运行的 dmg。
- **每个 M 一个分支 + 一个 PR**，结束时打 `mN` 标签；不跨 M 做大规模重构。
- **门禁**：`nsh check`、`nsh test`（含 live 集成用例，`ZU_SKIP_LIVE=1` 可跳过）、`cargo check`。
- **持续项**：每个 M 之后跑一次引擎崩溃/重启演练与协议版本偏斜检查；`pi` 与 `nsh` 的 pin 变更都要跑终端与 DockArea 冒烟。

## 3. M0 — 地基（不可用）· 已完成

> **状态：已完成（2026-11-10）。** 双包结构、mixed 模板、`zu/engine` native module、sidecar 编译与握手全部跑通；`script/bundle-mac.sh` 出 ad-hoc 签名的 dmg，包内 sidecar 实测被启动。

| 项 | 内容 |
|---|---|
| 仓库结构 | 仓库根即 app（TSX + `src/lib.rs`，mixed 模板的约定）+ `engine/`（Bun + pin 的 pi） |
| 构建 | `engine` 的 `bun run build` → 单文件 sidecar + 两个 WASM 资产；`script/bundle-mac.sh` → Helpers + 嵌套 ad-hoc 签名 + dmg |
| native module | `zu/engine`：`start/stop/status/port/token/logPath`，Rust 侧定位 sidecar 并在退出时回收 |
| engine 最小面 | loopback WS + token 握手 + `ping` |
| UI 最小面 | 一个窗口 + 引擎状态条 |

**验收**：起窗口；启动引擎 → 握手 → 状态显示运行中；退出应用 → 引擎退出（关窗不退出 app 是 macOS 惯例，托盘在 M12）。

## 4. M1 — 开启一个对话（第一个可用 App）· 已完成

> **状态：已完成（2026-11-10）。** 侧栏列出 pi 的全部会话；打开显示历史（`TextView` Markdown）；prompt 流式进入转录；工具调用显示为卡片；流式中可停止且已生成部分保留；引擎重启后同一会话可续聊。**8 条测试**覆盖全部验收项。

| 层 | 内容 |
|---|---|
| engine | `SessionManager` + `createAgentSession`；`session.create/open/info/prompt/abort/close`；`agent_settled` 作为回合终点；turn 结束写 `zu.turn` custom entry |
| UI | 会话侧栏（`listAll` 枚举）；对话 sheet（`TextView` 流式 Markdown、工具卡、composer）；引擎状态条 |

**验收**（全部有测试）：侧栏列出 pi 的会话；点开显示历史；流式 + 工具卡 + `agent_settled`；流式中停止保留转录；引擎重启续聊；pi 的加载器读到 `zu.turn`。

## 5. M2 — 契约与监督（横切面）· 已完成

> **状态：已完成（2026-11-10，`186df66`）。** `contracts/` v1 冻结（TS 类型 + 命令/事件表 + 运行时校验 + `protocol.md`）；`state.subscribe` 快照重连、`generation` 持久化、5 s 心跳 / 15 s 判死 / 指数退避重启；`bindExtensions({ mode: "rpc" })` 的 UI 矩阵（confirm 走 `AlertDialog`，select/input/editor 走应用内 Dialog，notify/status/title 走壳，其余 no-op + `ui.unsupported`）；project trust 走同一 select 并写 pi trust store；zh-CN/en 键表 + parity。**22 条测试**覆盖契约、快照/重连、杀进程自愈（中断标记）、协议版本拒连、真实扩展 confirm/notify 与对话框矩阵。

**目的**：把 M1 临时定义的协议冻成契约，把引擎从"能重启"升级到"能自愈"，把扩展宿主打通。**这一档不加用户可见的大功能，但后面每一条都踩在它上面。**

| 项 | 内容 |
|---|---|
| contracts | `contracts/` 的 v1：TS 类型 + 信封 `{v,id,sessionId?,type,payload}` + `protocol.md`；命令按 `engine/session/state/ui` 分组，标注幂等性与重放语义；事件清单对齐 pi（`queue.update`、`compaction.*`、`retry.*`、`session.info`） |
| 重连 | `state.snapshot`（容器、打开会话、活跃 run、未读、`generation`）+ `state.subscribe`；UI 重连带快照；协议版本不匹配即拒连并提示 |
| 引擎监督 | 心跳与退出码采集、指数退避重启、`generation` 递增；引擎死亡时 UI 的降级（已落盘转录只读可看） |
| 扩展宿主 | `bindExtensions({ uiContext, mode: "rpc" })`（Q33）；UI 方法矩阵（confirm/select/input/editor 走对话框，notify/setStatus/setTitle 走壳，其余 no-op + 日志）；`ui.request`/`ui.response` 与超时；project trust 触发 |
| i18n | 键表立起（zh-CN 第一 + en fallback），壳的文案全部进表；parity 测试。nsh 0.4.0 发布运行时不导出 `nsh/i18n`，键表落为纯 TS（Q39） |

**验收**：杀掉 engine 进程 → 自动重启 → UI 重连拿到快照并显示"已恢复"，进行中的回合被标为中断；本机的两个真实扩展加载后 `confirm` 弹出 nsh 对话框、`notify` 到达；`nsh test` 覆盖快照与重连。

## 6. M3 — SessionContainer 与 Panel/Sheet 关系 · 已完成

> **状态：已完成（2026-11-10，`b4ceea3`）。** `registry.json`（v1：containers/runs/activeContainerId）+ `layouts/{containerId}.json` 落盘、原子 rename；`container.create/show/attachSession/archive/unarchive` 与 `layout.get/put`；单点 archive teardown（abort/dispose/丢 runs）；引擎在 `requireSession` 里按 registry 按需 rehydrate，超过 8 个空闲会话按 LRU dispose；UI 的 `containers.ts` 按容器 flush/restore 布局与 zoom，会话 store 改为按 session id 的多视图，非可见 sheet 走占位节流；侧栏容器行 + 全部会话两段。**35 条测试**覆盖注册表/重启恢复/archive、两容器布局独立、zoom 恢复、sheet 跨 panel 移动状态不丢、可见性/剪枝。

**目的**：把"一次一个对话"变成"一个容器 = 一组面板"。这是关系对象模型的第一块，也是工作台形态的骨架。

| 项 | 内容 |
|---|---|
| 容器模型 | `registry.json`（`{v, containers[], runs[]}`）；`ContainerKind`；`alive()`；单一 `create_container` 入口与单点 teardown；archive/unarchive 的数据面（Q34：永不删除，v1 无 UI 入口） |
| Panel/Sheet | 会话进 `DockArea`；按容器 stash（`layouts/{containerId}.json`，zoom 单独存并在恢复时用 `groupOf`/`toggleZoom` 灌回）；sheet 注册表接真实会话族（对话/subagents/统计占位）；启动恢复上次活跃容器 |
| 多会话 | 同一容器多会话切换；引擎侧会话 LRU（`dispose` + 按需 rehydrate）；切容器丢弃增量、按文件重建 |
| 降级 | 非可见 sheet 的节流策略（先只对会话 sheet 生效；终端/webview 在 M7/M10 落） |

**验收**：开两个容器 → 切换 → 各自布局独立；把 sheet 拖到另一 panel 再拖回，状态不丢；重启后布局与上次容器恢复；archive 后容器从侧栏消失、资源回收（数据面）。

## 7. M4 — Project 与 Launcher · 已完成

> **状态：已完成（2026-11-10，`2a1b9d8`）。** `projects.json` v1（projects/membership）+ `project.list/create/update/setMembership`；多根、唯一 primary、路径/目录校验、名称跟随/固定；容器 cwd = primary 快照；Launcher（composer → 容器、项目 chip、锁定目标）；侧栏 Project → 容器分组、Chats 桶、菜单/拖行换项目；全部会话改用虚拟化 `List`，引擎会话索引按 mtime 水位缓存（不清空时不再全量 `listAll`）。**45 条测试**覆盖双根项目、Launcher 创建（cwd=primary）、分组、拖行/菜单归属、重启保持与 700 会话虚拟化。

**目的**：让"从哪开始"可组织：项目（多根、primary）与发射台。

| 项 | 内容 |
|---|---|
| Project | `projects.json`（`{v, projects[], membership}`）；多根、恰一根 primary、名称跟随/固定；容器 cwd = primary 快照；**Project 只由用户显式创建** |
| membership | 容器→项目显式归属；拖行换项目；无归属落 Chats 桶 |
| Launcher | 先 composer 后容器（项目 chip + composer + agent 动作行）；「＋」进入时目标锁死；空画布 = Launcher |
| 规模 | 侧栏两层聚合（工作区 → 分组 → 会话）+ 虚拟化；对账按 mtime 水位增量，不全量 `listAll` |

**验收**：建双根项目 → 从 Launcher 开对话（cwd = primary）→ 侧栏正确分组 → 拖容器换项目 → 重启后 membership 保持；660+ 会话下列表滚动不卡。

## 8. M5 — 子代理与调度面（架构落地完成）· 已完成

> **状态：已完成（2026-11-10，`1f2d335`）。** `SubagentManager` 在引擎进程内创建子会话（`zu/subagents/{captainId}/{ts}_{runId}.jsonl`、`parentSession` 指向 captain、继承模型）；`dispatch`/`list_agents` 仅作为 captain 的 extension factory 注册，子会话 `noExtensions`，三级以上无工具可用；工具支持 spawn/resume/inject/abort（`wait` 可选）；live 在内存、settled 进 `registry.json.subagentRuns[]`；archive captain 中断 live 并保留 settled；名册 sheet、只读转录与 captain 的 `zu.dispatch`/`zu.delivery` note 行。**50 条测试**覆盖 captain 工具注册、子代理交付/续跑、重启后 settled 读取、archive 级联与名册 UI。

**目的**：让 captain 派活、并行跑、可见可续跑。**至此关系对象模型完整：Project → Container → 会话/资源/视图。**

| 项 | 内容 |
|---|---|
| 调度 | `dispatch` 扩展（创建/续跑/引导/停止 + `list_agents`）；**只在 captain 注册**（subagent 不注册），三级以上直接拒绝 |
| 存储 | 子会话落 `zu/subagents/{captainId}/{ts}_{runId}.jsonl`；`parentSession` 指向 captain；`runs[]` 记录（live 在内存、settled 在文件） |
| UI | 名册 sheet（live + settled）；子会话 transcript 只读；captain 转录里的派发/交付 note 行 |
| 级联 | archive captain ⇒ 中断 live run、保留 settled、回收资源；unarchive 整树复活 |

**验收**：captain 派两个子代理改不同文件 → 名册显示 running → 交付 → 续跑一个 → pi CLI 打开 captain 能看到 `zu.*` custom entry；子会话无法再派发。

## 9. M6 — 轮廓打磨（M-Casing）· 已完成（记录差异）

> **状态：已完成（2026-11-10，`9f3eeaa`），非像素级。** 232pt 侧栏、白色选中卡 + 软阴影、34pt 页签条与 primary 指示器、
> 12 半径 composer/Launcher/对话框、统一菜单/toast 表面、120/180ms 颜色动效、token 化滚动条；设计系统与
> 动效清单见 [DESIGN.md](DESIGN.md)。并排截图（`/tmp/zu-m6.png` 与 `/tmp/steer-m6.png`）暴露的结构性差异
> 记录在 DESIGN §8：nsh 0.4.0 运行时不实现隐藏标题栏，Zu 仍显示系统标题条；Steer 的 composer 有模型/权限
> chip，Zu 的功能边界尚未包含。验收的「肉眼不可辨」未达成，不冒充通过。

> **命名**：Chrome 会与浏览器混淆，Shell 与命令行混淆，Frame 与动画帧混淆。**Casing**（机壳）指包在内容外面的那层壳，无歧义；中文称「轮廓」。

**目的**：轮廓像素级对标 Steer.app。**架构落地之后的第一件事**——先把用户每天看的外壳做对，再往里塞细节。

| 项 | 内容 |
|---|---|
| 参照 | Steer.app 的侧栏、页签条、工具栏、状态条、对话框、空态；逐项取尺寸（间距/圆角/字号/行高/描边）、颜色、阴影、过渡 |
| 对齐 | 2026-Light 的 token 映射到 `theme.json`；`Glyph` 图标的视觉重量对齐（线宽/端点） |
| 交互 | hover/active/pressed 反馈、页签指示器、拖拽预览、滚动条、窗口圆角与阴影 |
| 方法 | 同一界面（侧栏 + 三栏画布 + composer）两边截图并排，逐项差值；不引入新组件，只调样式与布局 |
| 边界 | 不改数据面、不加功能；只为视觉与手感 |

**验收**：并排截图评审通过（间距、字号、颜色、圆角、过渡在肉眼不可辨的范围内）；交互反馈（hover/active/拖拽/页签滑动）与 Steer 一致；`nsh test` 与打包冒烟仍绿。

> **2026-11-11 目视验收：首轮未通过，已按清单返工（见下）。** 原始返工清单见 [目视验收.md](目视验收.md)：
> ① 顶栏控件未对标 Steer（应为侧栏开关／最近 sessions 下拉／VS Code 打开／新 panel，而非 gear/语言/phase）；
> ② 侧栏缺「新建／切换分组／搜索」，Project→SessionContainer 两级与排序未对齐；
> ③ 点击容器行未切换内容视图——**已修**（容器标题取自 session id 前缀，两个容器同名，看起来没动；现按「会话名 → 目录末段」命名，并有真实引擎的切换测试）；
> ④ 容器起始页未像素级参照 Steer；
> ⑤ 对话渲染未复用 gallery 的 AI Chat，Composer 仍是独立气泡（应为横线分隔，去项目目录/访问模式/语音，留 model/上下文/发送/引导/排队/打断）。
>
> **返工状态（`92c82e0` + `e6f5b9e`）**：① 40pt Steer 顶栏（侧栏开关 / 居中 360pt 最近 SessionContainer 搜索下拉 / VS Code `vscode://file` / 工具 overflow；引擎状态移到 26pt 底栏）；② 侧栏「新建 / Project↔Recent 分组 / 搜索」，Project→SessionContainer 两级、项目 position 与容器 recency 排序；③ 容器 press 强制 `switchContainer`，`containers.ui.test` 真实点两个容器验证画布切换；④ 空会话 Hero + 内联 composer；⑤ gallery 式 Markdown/用户气泡/工具行 + 无卡片 Composer（仅一条 hairline，model·id·thinking + context，发送/停止/排队/引导/打断，Enter idle 发送 / running 排队）。证据 `docs/evidence/ui1-*.png`、`ui5-*.png`。仍未验证：真实模型回合、引擎 `session.info`/steer/followUp 真 wire、长历史虚拟化。

## 10. M7 — 终端与 agent TUI（细节开始）· 实现完成，验收未全过

> **状态：实现完成，2 项验收未达成（2026-11-11，`52a1ed1`）。**
> 已实现并实测：`zu/pty`（`portable-pty` + 引擎线程回调）、external 容器（`Terminal`/`Claude`/`Codex`/`Copilot`，无 pi session）、真实 Terminal sheet、Launcher 动作行、归档杀 PTY、按容器布局 stash。门禁 `nsh check`/`nsh build`/`cargo check`/`nsh test` 全绿。
> **已验证**：shell 跑 `ls`/`vim`/`htop`；Terminal 视图的 `TerminalRef.text()` 读回 `printf` 输出；resize 后 PTY 与 `stty size` 一致；关闭 handle/归档杀进程；Claude Code v2.1.278 的 TUI 在本机渲染出 banner/composer，Ctrl+C 回到 shell。
> **未达成 1**：Claude Code 的**真实对话**没有完成——本机一次真实 turn 返回 `API error · Retrying`（无模型回复），所以只验证了「TUI 启动 + Ctrl+C 中断」，没有验证「完成一次对话」。
> **未达成 2**：`VtEmulator` 缩小终端时**不重排**，只截断每行。实测 300 字符行在 165 列时占 165+135，缩到 95 列后只剩 95+95（丢 110 字符）。缺陷清单见 [evidence/terminal-emulator.md](evidence/terminal-emulator.md) §8，验收命令与截取见 [evidence/m7-terminal-captures.md](evidence/m7-terminal-captures.md)。
> 因此 M7 **不标「已完成」**；「resize 重排」修 nsh 还是并入 M-tty，待评审决定。

**目的**：在 Zu 里开真终端，跑 Claude Code / Codex / Copilot。

| 项 | 内容 |
|---|---|
| native module | `zu/pty`（`portable-pty`），`Callback::post` 直推 TSX；**不经 wire** |
| UI | Terminal sheet 接 PTY；external 容器（`terminal`/`claude`/`codex`/`copilot`）；`onResize` 回写 |
| 仿真核 | 先用 nsh 内置 `VtEmulator`；**产出真实缺陷清单**（不预设缺陷），据此决定是否进入 M-tty |
| 降级 | 非可见终端 sheet 的节流（保留 emulator，暂停渲染） |

**验收**：shell 里跑 `ls`/`vim`/`htop`；Claude Code TUI 完成一次真实对话并 `Ctrl+C` 中断；resize 重排正确；关容器 → PTY 被 kill。

## 11. M8 — 编辑器与 Diff

> **状态（2026-11-11，`6ff8097`，M8）**：实现完成，验收达成一半。
> **已实现并实测**：`zu/fs`（`list`/`stat`/`read`/`write`/`mkdir`；每次调用显式传工作区根，Rust 侧 canonicalize 并拒绝 `..`、根外绝对路径与越界 symlink；2 MiB 读上限、1000 项目录上限；临时文件 + rename 原子写并保留 mode/BOM；`ERR_FS_STALE` 带当前 mtime/size）、文件树 sheet（`files:{containerId}`，目录优先、懒加载子目录、空/加载/错误态、按文件对比）、真 `Editor` sheet（`editor:{containerId}:{base64url path}`，按扩展名或文件名决定语法高亮、折叠、查找/替换、脏标记、Save + Mod+S、冲突/错误只读、reload/close）、两文件 `DiffView` sheet（`diff:{containerId}:{old~new}`，split/unified、真实 hunk 统计）；Pi 与 external 容器都用其 cwd。
> **已验证**：headless 打开真实 `/tmp` 文件 → 编辑 → Mod+S → 用 `zu/fs` 读回磁盘一致；外部改写后保存被 `ERR_FS_STALE` 拒绝、编辑器转只读、reload 后恢复；两真实文件的 `DiffView` 统计 `+2 −1 · 1`（hunk 正确）。门禁 `nsh check`/`nsh build`/`cargo check --all-targets`/`cargo test --lib`/`nsh test .` 全绿（99 条）。证据见 [evidence/m8-editor-diff.md](evidence/m8-editor-diff.md)。
> **未达成（M9 已补）**：「看一次 git diff」不在 M8——没有 git 模块，不做伪造的 worktree diff；两文件对比已实现，工作区 diff 留给 M9（Q57）。M9 的 `zu/git` + Changes 面板已用真实 `git diff` 补齐（§12）。

| 项 | 内容 |
|---|---|
| native module | `zu/fs`（read/write/stat/list/mkdir，路径策略在 Rust 侧）；LSP 复用同一份内容 |
| UI | Editor sheet（真文件读写、语法高亮、折叠、find/replace）；DiffView sheet（两文件对比已实现；工作区 diff 待 M9）；文件树 sheet（`files:{containerId}`，不是独立 dock） |
| 边界 | 2 MiB/1000 项上限；二进制/非 UTF-8 拒绝并显示状态；BOM 往返；外部修改冲突（转只读，reload 后恢复） |

**验收**：打开文件 → 编辑 → 保存 → 磁盘一致（✓，`files.ui.test.tsx`）；看一次 git diff，hunk 正确（✗ M8；由 M9 的 `zu/git` + Changes 面板补齐，见 §12 与 `git.ui.test.tsx`）。

## 12. M9 — Git

> **状态（2026-11-11，`30be72d`）**：实现完成，验收全部达成。
> **已实现并实测**：`src/git.rs` 导出 `zu/git`（`status`/`diff`/`log`/`branches`/`stage`/`unstage`/`commit`/`checkout`/`createBranch`/`init`/`setIdentity`）。每次调用显式传工作区根；根必须是仓库顶层，`..`、绝对路径、pathspec magic 与 `-` 开头的路径一律拒绝；`git` 以 argv 数组执行、cwd 即根，不经过 shell，清掉 `GIT_DIR` 等重定向变量，不做任何 fetch/pull/push；唯一写入的 git 配置是仓库自己的 author identity（`--local`，全局配置不动）。status 用 porcelain v2 `-z` 解析（branch/oid/ahead/behind、staged/unstaged/untracked/conflicted、rename 的旧路径）；diff 用 `--no-ext-diff --no-textconv --unified=3`，untracked 走 `--no-index /dev/null`，补丁上限 2 MiB；log 用控制字符分隔的记录；commit 前用 `git var` 检查身份，缺失返回 `ERR_GIT_IDENTITY`。
> **UI**：`changes:{containerId}`（真实文件列表按 staged/工作区/未跟踪/冲突分组、单文件与全部 stage/unstage、选中文件后用 M8 的 `DiffView` 的 `patch` 模式显示真实 `git diff`、提交行、身份对话框、空/加载/错误/未初始化仓库态）与 `history:{containerId}`（真实 log、分支菜单 checkout、新建分支对话框）；顶栏新增 `open-changes` / `open-history`。checkout 后重读 changes/history，并 reload 该容器中没有未保存改动的编辑器。
> **已验证**：`git.test.ts` 对测试自建的真实临时仓库走完 status → stage → commit → `git log` → 修改 → `git diff`（hunk/行数）→ 分支创建/切换，并覆盖路径越界、非仓库、仓库子目录、空提交信息；`git.ui.test.tsx` 在真实 `Workbench` 顶栏打开 Changes，UI 内 stage 一个真实文件、提交并用 `zu/git` 的 `git log` 验证 author/subject/hash，DiffView 画出工作区 hunk（`+2 −1`），History 菜单 checkout 后 Changes 分支与打开的编辑器内容都跟着变。门禁 `nsh check`/`nsh build`/`cargo check --all-targets`/`cargo test --lib`/`nsh test .` 全绿。证据见 [evidence/m9-git.md](evidence/m9-git.md)。

| 项 | 内容 |
|---|---|
| native module | `zu/git`（shell out `git`）：status/diff/log/branches/stage/unstage/commit/checkout/createBranch/init/setIdentity |
| UI | Changes 面板（真实 status + `DiffView` patch + stage/unstage + 提交行）；History（真实 log + 分支菜单）；顶栏入口 |
| 边界 | 根必须为仓库顶层；路径不得越出根；补丁 2 MiB；无网络操作；不写全局 git 配置；commit 缺身份时只写仓库本地身份 |

**验收**：改文件 → Changes 显示 ✓（`git.ui.test.tsx`）→ stage ✓ → 提交（`zu/git` 的 `git log` 与 CLI transcript 验证）✓ → 切分支 ✓（Changes/History/编辑器跟随）。

> M8 已交付两文件 `DiffView`（`zu/fs` + 稳定 sheet id）。M9 补 git 数据面（`zu/git`）与 Changes/History 面板；工作区 diff 从 M9 起用 `git diff` 驱动 `DiffView` 的 `patch` 模式，不再走“两文件对比”作为替代。

## 13. M10 — 浏览器

> **2026-11-11 已知差距**：`target=_blank` / `window.open` 现由页前注入脚本转成宿主消息，**在当前 sheet 内导航**（nsh 0.4.0 没有新窗口回调，也未授予 `openUrl`）——脚本与消息契约有单测；页内链接点击与页内搜索仍未自动化；headless 没有 web view，真实页面由 macOS 宿主手工验过 `example.com` 与 DuckDuckGo Lite。 · 实现完成，验收达成一半

> **状态（2026-11-11，`bbfb5ac`）**：实现完成；真实 macOS 宿主上加载了真实网页并跑通前进/后退，
> 但「链接在 sheet 内或外部打开」只达成 sheet 内一半（原因见下）。
> **已实现并实测**：`browser.ts` 按 sheet id `webview:{containerId}:{n}` 持 URL/标题/loading/
> canGoBack/canGoForward/error/页面消息日志（UI state only）；`browser-ui.tsx` 的 Browser sheet
> 一个 `WebView` + 地址栏（裸域名补 `https://`、只开 http/https）+ 后退/前进/刷新/停止
> （enabled 跟随真实 nav state）+ 2pt loading 轨道与「加载中…」文字 + 页面标题进页签 +
> 错误面板（码 + 文案 + 重试）+ 默认页（任意站点可加载、页面消息不进 agent）+ 可展开的
> 页面消息日志（仅 UI，`onMessage` 不触达 engine/wire）。顶栏 `open-browser` 与 Launcher
> 「浏览器」是入口；每容器可开多个（n 递增）。
> **已验证**：`--target macos` 的真实 WKWebView 加载 `example.com`（`Example Domain`）、
> IANA 文档页（`Example Domains`）、DuckDuckGo Lite 搜索结果（`native shell at DuckDuckGo`）；
> 后退回 `Example Domains`、前进回 `DuckDuckGo`，按钮 enabled 状态由测试断言；浅色/深色/
> 搜索/错误/消息日志截图见 [evidence/m10-browser.md](evidence/m10-browser.md)。门禁
> `nsh check`/`nsh build`/`cargo check --all-targets`/`cargo test --lib`（29）/
> `nsh test .`（130/130，`ZU_PORT=47834`）全绿。
> **未达成 / 限制**：headless 宿主没有 web view（`WebView.available()` 为 true 但页面不加载），
> 因此默认测试只覆盖 UI 状态机，真实页面只在 `--target macos` 验证；`target=_blank`/`window.open`
> 在 nsh 0.4.0 没有打开回调，M10 不授予 `openUrl`，所以「外部打开」未实现（普通链接在
> sheet 内导航是平台行为，未做页内点击自动化）；搜索通过搜索结果 URL 完成，没有验证页内
> 搜索框输入（未授予 `webview.input`）；未在 iOS/Android/Windows/Linux 上验证真实 web view。

| 项 | 内容 |
|---|---|
| UI | Browser sheet（`WebView` + 地址栏 + 前进/后退/刷新/停止 + 错误态 + 页面消息日志）；每 sheet 一个 web view；每容器多个 |
| 授权 | `webview.hosts: ["*"]`（Q32：任意站点，地址栏旁标明）；页面消息不进 wire、不进 agent 上下文 |
| 边界 | 页面消息只进 UI 日志；不使用 `injectJavaScript`；非可见 sheet 卸载/重挂载（nsh 无 pause API），URL/标题在 store 保留、页面运行时状态丢失 |

**验收**：打开文档页 ✓、搜索 ✓（搜索 URL）、前进后退 ✓；链接在 sheet 内 ✓ / 外部打开 ✗（nsh
0.4.0 无新窗口回调，未授予 `openUrl`）。

## 14. M11 — LSP

> **2026-11-11 已知差距**：三个语言服务器都已实跑——`rust-analyzer`（诊断/hover/定义/补全）、`typescript-language-server --stdio`、`gopls` 各自报告真实类型错误（`lsp.test.ts`）；诊断只保留已打开文件，无全工作区索引；重启或归档不恢复语言服务器。

| 项 | 内容 |
|---|---|
| native module | `zu/lsp`：起语言服务器（argv、显式 cwd、无 shell）、`Content-Length` 帧、完整消息/ stderr / exit 的 `Callback::post`、进程组清理；ID/超时/取消在 TS |
| UI | 每容器/语言族一个客户端；**全文** `didOpen/didChange/didSave/didClose`（诚实：`didChange` 发整份文本，不是增量 range）；诊断进 `Editor.diagnostics` 与 Problems；hover 卡片（`Overlay` + `TextView`）；F12/Mod-click 定义跳转；补全列表；Problems `problems:{containerId}` + 顶栏入口 + 重启 |
| 语言 | `rust-analyzer`、`typescript-language-server --stdio`、`gopls`；只同步容器根内的文件 |

**状态（2026-11-11，`3772680`，实现完成、验收达成，有限制）**：Rust fixture（`/tmp` 下真实 Cargo 项目，故意
类型错误）经真实 `rust-analyzer 1.99.1` 跑通 initialize（42 ms）→ didOpen → diagnostics
（697 ms，`E0308 expected i32, found &'static str`）→ hover（含 `pub fn add(left: i32, right:
i32) -> i32`）→ definition（`src/lib.rs`，selection `0:7–0:10`）→ completion（`value` 的
`detail: i32`、`add` 的 `fn(i32, i32) -> i32`）；见 [evidence/m11-lsp.md](evidence/m11-lsp.md)。
headless UI（真实 `Workbench`、真实 `zu/lsp` 进程、受控 fake server）验证诊断进编辑器与
Problems、Problems 行打开文件并 reveal、F12 打开目标 sheet、补全列表、重启换 pid。
门禁 `nsh check`/`nsh build`/`cargo check --all-targets`/`cargo test --lib`（37）/
`nsh test .`（141/141，`ZU_PORT=47835`）。

**未达成 / 限制**：真实 rust-analyzer 验收只覆盖 Rust；TypeScript/Go 映射已实现但未用真实
`typescript-language-server`/`gopls` 跑验收。headless 的 `app.hover` 只在 selector 自身的
view 上派发 `MouseMove`，而 `Editor` 在内部 rows 上监听，所以「指针 → onHover」这条路径
无法在 headless 驱动；UI 测试只渲染同一个 `HoverCard`（固定 anchor），真实 hover 由 native
测试覆盖。诊断只保留**打开的文件**（Problems 是编辑器视图，不是全工作区索引）；服务端索引
进度只显示 `$/progress` 的标题；补全关闭 snippet support，`insertText` 不发 snippet；
应用重启/归档不恢复语言服务器，重启后按打开的文件重新 didOpen。

## 15. M12 — 常驻、通知与自更新

> **2026-11-11 验证**：打包 app 实测——单实例生效（第二个进程直接执行二进制时不 boot 引擎，只显示提示）；关窗隐藏由 headless 窗口模型覆盖（真实 AX 点击与鼠标路径不同，不能自动断言）；引擎始终连接（动态端口 + 监督，见 architecture）。
> **仍未验证**：托盘图标的菜单栏呈现与点击、系统通知的真实投递（需要系统交互）、真实更新安装（仓库没有 updater 源，三态诚实显示）。另有一条 nsh 菜单 owner 释放的 panic 日志待上游修。

> **状态（2026-11-11，`c0d570b`，实现完成；桌面端到端验收部分完成）**：单实例、托盘/关窗收起、通知策略与更新 UI 都已落地并有测试，但**没有**在真实 macOS 窗口/通知中心/Release 上做端到端验收：本机 Zu 正在运行且禁止重启，仓库也没有更新源、公钥与 Release。因此 M12 **不标「完全达成」**；下表验收项的真机部分只列为未验证，不冒充通过。
>
> **已实现并测试**
> - **单实例**：`src/instance.rs` 的 `zu/native` `Instance`（`claim`/`release`/`lockPath`）。锁文件在 app 状态目录（`~/.pi/zu/instance.lock`，`ZU_STATE_DIR` 亦生效），先写同目录临时文件再 `hard_link` 成锁——读者永远看不到半写锁，竞争时只有一个 `link` 成功；锁里记 pid + 创建时间，pid 用 Unix null signal 判活，死进程的锁在下一轮回收；同进程重复 `claim` 是幂等（`already: true`）。**6 条 Rust 测试**：首 claim/幂等、活 owner 拒绝且不碰文件、死 pid 回收（`stale: true`）、截断锁回收、只释放自己的锁、并发两 claim 恰好一个成功。
> - **启动顺序**：`lifecycle.ts` 的 `startLifecycle()` 在桌面（`nsh/desktop` `isAvailable`）先 claim，未拿到就进入 `duplicate` 模式，**不启动引擎**；headless 完全不 claim。第二个实例显示「Zu 已在运行」+ owner pid/锁路径 + 退出按钮，并提示从 Dock/菜单栏回到第一个实例（nsh 没有跨进程「显示已有窗口」，不伪造）。它把主窗口设回 `closeOnPress: true`，关掉就是退出。
> - **托盘与关窗**：`nsh.json` 的 `window.closeOnPress: false` + `LifecycleHost`（`lifecycle-ui.tsx`）监听 `closePress` → `hide()`：关窗只是收起，engine/turn/PTY 继续跑；托盘菜单 Show/Hide、Check for Updates…、Quit；主键点击显示并聚焦窗口；应用菜单含 Edit roles、Window（Minimize/Zoom/Show `⌘0`/Close）与真正的 Quit（`quitApp` 先释放 claim 再 `Application.quit()`）。**headless 真窗口模型**验证：`pressClose()` 后 `state().visible === false` 且窗口仍 open，`⌘0` 可反复恢复，再次 close 仍隐藏。**未验证**：托盘图标/菜单点击、真实系统窗口的 Show、进程真正退出（headless 的 `Application.quit()` 是 no-op；`⌘Q` 的 handler 释放 claim 已测）。
> - **端口占用文案**：`Engine.portAvailable()`（Rust 真 bind 探测）+ `engine.ts` 在连不上且端口不自由时显示「端口 %{port} 已被占用：另一个 Zu 或进程在用它」，不再是笼统协议/超时文案；1 条 Rust 测试。
> - **通知**：`nsh.json` 加 `capabilities.notifications: true`；`notifications.ts` 的策略是**只有主窗口不在前台（不可见或未聚焦）才通知**（首版「激进」在桌面范围：turn settle + 子会话 settle 都发；聚焦时完全不发，避免自己看的时候刷屏）。id 按 session/run（`zu:session:<id>`、`zu:subagent:<runId>`），同 id 由系统替换；相同 body 5 s 内不重复；权限只在第一次需要时申请一次（被拒后记住、不再弹）；`agent.state` 只在 running→idle 边沿触发，重连快照补记 running，断线清空（中断的回合不算完成）；**通知被按时**关闭该通知、显示并聚焦主窗口，并带着 id 排队等 engine/registry 就绪后打开对应会话 sheet 或子代理名册（冷启动也能恢复，最多重试 20 次）。**8 条 TS 单测**覆盖前台/后台/隐藏、替换与去重、权限（default→denied / default→granted 只问一次）、子代理 id/正文、按开后的关闭、id 解析与外来 id、headless no-op。
> - **更新**：`updates.ts` + `updates-ui.tsx` 的 Updates 对话框（托盘「Check for Updates…」与顶栏齿轮）。显示当前版本/开发构建，诚实区分 **development / 未配置 updater / 可检查**；check → available（版本/notes/`canInstall`）→ download（真实字节进度）→ ready → install & restart；`canInstall: false` 时只显示下载 URL（不授予 `openUrl`）。安装成功时应用会退出，所以 promise resolve 后保持「正在安装」，**不声称装好**；失败显示错误并保持原状。**8 条 store 测试 + 3 条 UI 测试**（fake service：dev 不检查、未配置、available、下载进度、ready、安装不冒充、check/download 失败、canInstall false、formatBytes；UI 走 dev 态、完整 check→progress→install 态、通知权限行）。**未验证 / 无源**：仓库没有 `nsh.json` 的 `"updater"`（没有真实 source、公钥与 Release，不伪造），所以 `checkForUpdate()` 在此仓库只会在 dev 返回 null；端到端「检查到新版本并安装」不可测，发布时的配置与归档要求写在 [evidence/m12-lifecycle.md](evidence/m12-lifecycle.md)。
> - **打包**：`script/bundle-mac.sh` 在拷贝后**断言** `Contents/Helpers/{pi-engine,photon_rs_bg.wasm,quickjs.wasm}` 都在，缺一即失败；`NSH_UPDATE_ARCHIVE=1` 时额外打出包含整个 `.app`（因而包含 Helpers）的 `Zu-<version>-macos-<arch>.tar.gz`，并在输出里给出 `nsh update-manifest` 的 release 命令。
>
> **门禁**：`nsh check .` ✓、`nsh build .` ✓（1 个 asset：托盘 SVG）、`cargo check --all-targets` ✓、`cargo test --lib` 44/44 ✓、`nsh test .` **172/172** ✓（128 TS + 44 Rust，`ZU_PORT=47836`，隔离 `ZU_STATE_DIR`）、`script/bundle-mac.sh` ✓（Helpers 断言；产物在 `build/`）。证据见 [evidence/m12-lifecycle.md](evidence/m12-lifecycle.md)。

| 项 | 内容 |
|---|---|
| 生命周期 | 托盘图标 + 菜单（显示/退出）；单实例（锁文件或 `NSRunningApplication`）；「端口被占用」的明确文案 |
| 通知 | turn settle / 子会话交付 → 系统通知；权限申请；首版激进，后续做减法 |
| 更新 | GitHub Releases；检查/下载进度/安装重启；**更新包必须含 `Contents/Helpers`** |

**验收**：关窗后 agent 继续跑 → 完成时收到通知 → 托盘点开回到窗口；新版本能检查到并安装；第二个实例被拦并给出提示。

**M12 验收台账**：

| 验收项 | 状态 |
|---|---|
| 关窗后 agent 继续跑 | **已验证（打包 app，隔离状态/端口）**：真实 `Cmd+W` 后窗口 `is_on_screen:false` 但进程与引擎 `Helpers/pi-engine` 仍存活，`⌘0` 恢复窗口；真跑完一个模型回合未验证。 |
| 完成时收到通知 | **逻辑验证，系统投递未验证**：8 条单测覆盖触发/权限/去重/按开；真实 macOS 通知需要 signed bundle 且未重启用户 app。 |
| 托盘点开回到窗口 | **未验证**：nsh headless 没有托盘模型；真实 `⌘0` 恢复窗口已验证，托盘图标点击未测。 |
| 新版本能检查到并安装 | **未验证（不可测）**：本仓库无 updater 源/公钥/Release；UI 状态机用 fake service 测过，真实安装未发生。 |
| 第二个实例被拦并给出提示 | **部分验证**：Rust 并发/活 owner 测试 + 第二实例 UI fixture；没有启动第二个真实进程（会与用户正在运行的 app 抢固定端口）。 |

## 16. M13 — 签名与公证

| 项 | 内容 |
|---|---|
| 签名 | Developer ID；嵌套签名（sidecar 先签，带 JIT entitlement）；hardened runtime |
| 公证 | `notarytool`；`stapler` |
| 产物 | dmg（arm64）+ 校验 |

**验收**：干净机器双击安装 → 首次启动无拦截 → 引擎能起。

## 17. 条件性里程碑

| 名称 | 触发条件 | 内容 |
|---|---|---|
| **M-tty 终端增强** | M7 的缺陷清单超出可接受范围，或用户要求鼠标/超链接 | Ghostty 仿真核 + 扩 nsh trait/组件（鼠标、光标形状、OSC 8/52、下划线样式） |
| **M-arch 归档管理** | 用户需要在设置里找回归档容器（Q34：永不删除，v1 无入口） | 设置页「归档管理」子页 |
| **M-web** | 产品需要浏览器/移动端访问 | 同一 wire 的 web client |

## 18. 依赖与顺序

```
M0 ✓ ─▶ M1 ✓ ─▶ M2 契约与监督 ─▶ M3 容器与面板 ─▶ M4 项目与发射台 ─▶ M5 子代理
                                                                      │
                                                                      ▼
                                                          M6 轮廓（Casing）
                                                                      │
                    ┌─────────────────────────────────────────────────┘
                    ▼
        M7 终端 ─▶ M8 编辑器 ─▶ M9 Git ─▶ M10 浏览器 ─▶ M11 LSP ─▶ M12 常驻 ─▶ M13 签名
```

- **M2 必须早**：协议、监督、扩展宿主是所有后续工作的地基；M1 的 wire 已经是临时定义。
- **M3–M5 是架构落地**：对象模型的三层（容器、项目、子会话）跑通后，剩下的都是往 sheet 里塞内容。
- **M6 紧随架构落地**：先对外壳做像素级打磨，后面的细节才有正确的载体。
- **M7–M11 相互独立**，可按真实使用优先级调序。
- **M12/M13 不能省**：没有常驻与签名，Zu 只是开发者的自用工具。

## 19. 每个里程碑的持续项

- [architecture.md](architecture.md) §8 的已知风险逐条销账。
- `pi` 与 `nsh` 的 pin 变更：引擎测试 + TUI 冒烟 + 终端/DockArea 冒烟 + 兼容性台账。
- 引擎崩溃/重启演练；协议版本偏斜检查。
- `~/.pi/zu/` 的孤儿清理（容器已不在注册表时删 layout）。
