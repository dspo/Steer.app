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

> **状态：已完成（2026-11-10）。** `contracts/` v1 冻结（TS 类型 + 命令/事件表 + 运行时校验 + `protocol.md`）；`state.subscribe` 快照重连、`generation` 持久化、5 s 心跳 / 15 s 判死 / 指数退避重启；`bindExtensions({ mode: "rpc" })` 的 UI 矩阵（confirm 走 `AlertDialog`，select/input/editor 走应用内 Dialog，notify/status/title 走壳，其余 no-op + `ui.unsupported`）；project trust 走同一 select 并写 pi trust store；zh-CN/en 键表 + parity。**22 条测试**覆盖契约、快照/重连、杀进程自愈（中断标记）、协议版本拒连、真实扩展 confirm/notify 与对话框矩阵。

**目的**：把 M1 临时定义的协议冻成契约，把引擎从"能重启"升级到"能自愈"，把扩展宿主打通。**这一档不加用户可见的大功能，但后面每一条都踩在它上面。**

| 项 | 内容 |
|---|---|
| contracts | `contracts/` 的 v1：TS 类型 + 信封 `{v,id,sessionId?,type,payload}` + `protocol.md`；命令按 `engine/session/state/ui` 分组，标注幂等性与重放语义；事件清单对齐 pi（`queue.update`、`compaction.*`、`retry.*`、`session.info`） |
| 重连 | `state.snapshot`（容器、打开会话、活跃 run、未读、`generation`）+ `state.subscribe`；UI 重连带快照；协议版本不匹配即拒连并提示 |
| 引擎监督 | 心跳与退出码采集、指数退避重启、`generation` 递增；引擎死亡时 UI 的降级（已落盘转录只读可看） |
| 扩展宿主 | `bindExtensions({ uiContext, mode: "rpc" })`（Q33）；UI 方法矩阵（confirm/select/input/editor 走对话框，notify/setStatus/setTitle 走壳，其余 no-op + 日志）；`ui.request`/`ui.response` 与超时；project trust 触发 |
| i18n | 键表立起（zh-CN 第一 + en fallback），壳的文案全部进表；parity 测试。nsh 0.4.0 发布运行时不导出 `nsh/i18n`，键表落为纯 TS（Q39） |

**验收**：杀掉 engine 进程 → 自动重启 → UI 重连拿到快照并显示"已恢复"，进行中的回合被标为中断；本机的两个真实扩展加载后 `confirm` 弹出 nsh 对话框、`notify` 到达；`nsh test` 覆盖快照与重连。

## 6. M3 — SessionContainer 与 Panel/Sheet 关系

**目的**：把"一次一个对话"变成"一个容器 = 一组面板"。这是关系对象模型的第一块，也是工作台形态的骨架。

| 项 | 内容 |
|---|---|
| 容器模型 | `registry.json`（`{v, containers[], runs[]}`）；`ContainerKind`；`alive()`；单一 `create_container` 入口与单点 teardown；archive/unarchive 的数据面（Q34：永不删除，v1 无 UI 入口） |
| Panel/Sheet | 会话进 `DockArea`；按容器 stash（`layouts/{containerId}.json`，zoom 单独存并在恢复时用 `groupOf`/`toggleZoom` 灌回）；sheet 注册表接真实会话族（对话/subagents/统计占位）；启动恢复上次活跃容器 |
| 多会话 | 同一容器多会话切换；引擎侧会话 LRU（`dispose` + 按需 rehydrate）；切容器丢弃增量、按文件重建 |
| 降级 | 非可见 sheet 的节流策略（先只对会话 sheet 生效；终端/webview 在 M7/M10 落） |

**验收**：开两个容器 → 切换 → 各自布局独立；把 sheet 拖到另一 panel 再拖回，状态不丢；重启后布局与上次容器恢复；archive 后容器从侧栏消失、资源回收（数据面）。

## 7. M4 — Project 与 Launcher

**目的**：让"从哪开始"可组织：项目（多根、primary）与发射台。

| 项 | 内容 |
|---|---|
| Project | `projects.json`（`{v, projects[], membership}`）；多根、恰一根 primary、名称跟随/固定；容器 cwd = primary 快照；**Project 只由用户显式创建** |
| membership | 容器→项目显式归属；拖行换项目；无归属落 Chats 桶 |
| Launcher | 先 composer 后容器（项目 chip + composer + agent 动作行）；「＋」进入时目标锁死；空画布 = Launcher |
| 规模 | 侧栏两层聚合（工作区 → 分组 → 会话）+ 虚拟化；对账按 mtime 水位增量，不全量 `listAll` |

**验收**：建双根项目 → 从 Launcher 开对话（cwd = primary）→ 侧栏正确分组 → 拖容器换项目 → 重启后 membership 保持；660+ 会话下列表滚动不卡。

## 8. M5 — 子代理与调度面（架构落地完成）

**目的**：让 captain 派活、并行跑、可见可续跑。**至此关系对象模型完整：Project → Container → 会话/资源/视图。**

| 项 | 内容 |
|---|---|
| 调度 | `dispatch` 扩展（创建/续跑/引导/停止 + `list_agents`）；**只在 captain 注册**（subagent 不注册），三级以上直接拒绝 |
| 存储 | 子会话落 `zu/subagents/{captainId}/{ts}_{runId}.jsonl`；`parentSession` 指向 captain；`runs[]` 记录（live 在内存、settled 在文件） |
| UI | 名册 sheet（live + settled）；子会话 transcript 只读；captain 转录里的派发/交付 note 行 |
| 级联 | archive captain ⇒ 中断 live run、保留 settled、回收资源；unarchive 整树复活 |

**验收**：captain 派两个子代理改不同文件 → 名册显示 running → 交付 → 续跑一个 → pi CLI 打开 captain 能看到 `zu.*` custom entry；子会话无法再派发。

## 9. M6 — 轮廓打磨（M-Casing）

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

## 10. M7 — 终端与 agent TUI（细节开始）

**目的**：在 Zu 里开真终端，跑 Claude Code / Codex / Copilot。

| 项 | 内容 |
|---|---|
| native module | `zu/pty`（`portable-pty`），`Callback::post` 直推 TSX；**不经 wire** |
| UI | Terminal sheet 接 PTY；external 容器（`terminal`/`claude`/`codex`/`copilot`）；`onResize` 回写 |
| 仿真核 | 先用 nsh 内置 `VtEmulator`；**产出真实缺陷清单**（不预设缺陷），据此决定是否进入 M-tty |
| 降级 | 非可见终端 sheet 的节流（保留 emulator，暂停渲染） |

**验收**：shell 里跑 `ls`/`vim`/`htop`；Claude Code TUI 完成一次真实对话并 `Ctrl+C` 中断；resize 重排正确；关容器 → PTY 被 kill。

## 11. M8 — 编辑器与 Diff

| 项 | 内容 |
|---|---|
| native module | `zu/fs`（read/write/stat/list，路径策略在 Rust 侧）；LSP 复用同一份内容 |
| UI | Editor sheet（真文件读写、语法高亮、折叠、find/replace）；DiffView sheet（工作区 diff 或两文件对比）；文件树 dock |
| 边界 | 大文件/二进制/编码策略；外部修改冲突（转只读提示） |

**验收**：打开文件 → 编辑 → 保存 → 磁盘一致；看一次 git diff，hunk 正确。

## 12. M9 — Git

| 项 | 内容 |
|---|---|
| native module | `zu/git`（shell out `git`）：status/diff/log/branches/stage/commit/checkout |
| UI | Changes 面板（DiffView + 文件列表 + stage）；History；分支切换 |

**验收**：改文件 → Changes 显示 → stage → 提交（`git log` 验证）→ 切分支。

## 13. M10 — 浏览器

| 项 | 内容 |
|---|---|
| UI | Browser sheet（`WebView` + 地址栏 + 前进/后退/刷新）；每 sheet 一个 web view |
| 授权 | `webview.hosts: ["*"]`（Q32：任意站点，地址栏旁标明）；页面消息不进 wire、不进 agent 上下文 |
| 边界 | 页面消息不进 wire、不进 agent 上下文；`injectJavaScript` 只做日志回传；非可见 sheet 暂停 |

**验收**：打开文档页、搜索、前进后退；链接在 sheet 内或外部打开。

## 14. M11 — LSP

| 项 | 内容 |
|---|---|
| native module | `zu/lsp`：起语言服务器、stdio JSON-RPC、`didOpen/didChange` 增量、诊断/hover/definition/completion |
| UI | 诊断标记与 Problems 面板；hover 卡片（`TextView`）；F12 跳转；补全列表 |

**验收**：Rust 文件有类型错误 → Problems 显示；hover 有签名；F12 跳到定义；补全有候选。

## 15. M12 — 常驻、通知与自更新

| 项 | 内容 |
|---|---|
| 生命周期 | 托盘图标 + 菜单（显示/退出）；单实例（锁文件或 `NSRunningApplication`）；「端口被占用」的明确文案 |
| 通知 | turn settle / 子会话交付 → 系统通知；权限申请；首版激进，后续做减法 |
| 更新 | GitHub Releases；检查/下载进度/安装重启；**更新包必须含 `Contents/Helpers`** |

**验收**：关窗后 agent 继续跑 → 完成时收到通知 → 托盘点开回到窗口；新版本能检查到并安装；第二个实例被拦并给出提示。

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
