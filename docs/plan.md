# 计划

> 唯一的工作指导文档。已完成的部分给证据位置；未做的按批次给出任务与验收。

**当前进度（2026-11-12）**：§2.1-1（`a58e0ad`）、§2.1-2（`bcd4004`）、§2.1.1 F1（`4293eb7`）已提交；
§2.0 的 P0-1 / P0-2（模型注册与无模型界面）已完成，证据见 [evidence/s20-models.md](evidence/s20-models.md)；
四条调整已并入（`b1f4937`）。门禁全绿（`nsh check` ✓、`cargo check --all-targets` ✓、`nsh test` ✓、
`script/bundle-mac.sh` ✓），证据见 [evidence/s1-hero-sheet.md](evidence/s1-hero-sheet.md)、
[evidence/s21-2-switch-hydrate.md](evidence/s21-2-switch-hydrate.md)、
[evidence/s21-1-hero-actions.md](evidence/s21-1-hero-actions.md)、
[evidence/s211-f2f3-container-terminals.md](evidence/s211-f2f3-container-terminals.md)、
[evidence/s21-3-scratch.md](evidence/s21-3-scratch.md)、
[evidence/s21-4-action-matrix.md](evidence/s21-4-action-matrix.md)、
[evidence/s21-5-container-title.md](evidence/s21-5-container-title.md)、
[evidence/s21-6-system-locale.md](evidence/s21-6-system-locale.md)、
[evidence/s21-7-auto-archive.md](evidence/s21-7-auto-archive.md)、
[evidence/s22-8-shell.md](evidence/s22-8-shell.md)、
[evidence/s22-9-sidebar-drag.md](evidence/s22-9-sidebar-drag.md)、
[evidence/s22-10-remove-picker.md](evidence/s22-10-remove-picker.md)、
[evidence/s22-11-composer.md](evidence/s22-11-composer.md)、
[evidence/s22-11a-slash.md](evidence/s22-11a-slash.md)、
[evidence/s22-12-13-chrome.md](evidence/s22-12-13-chrome.md)、
[evidence/s23-14-brand-icons.md](evidence/s23-14-brand-icons.md)、
[evidence/s23-15-drag-ghost.md](evidence/s23-15-drag-ghost.md)、
[evidence/s23-16-lilex.md](evidence/s23-16-lilex.md) 与 `docs/evidence/ui-s2-*.png`。
**下一个动作是 §5 的整洁化轨道**（C1/C5/C6/C7 可立即插入；Casing II 的功能项 1–16 已全部完成，
C2/C3 的文件移动不再与功能改写冲突）。
开工前读：本文件 §5 → [architecture.md](architecture.md) §4.2/§4.3/§5.4 → [DESIGN.md](DESIGN.md) §3 →
[evidence/apis-verified.md](evidence/apis-verified.md)。
> 架构见 [architecture.md](architecture.md)，视觉规格见 [DESIGN.md](DESIGN.md)，决策台账见 [decisions.md](decisions.md)。

## 0. 里程碑索引

任务列表的**权威来源是本文件**；对话或别处的列表都是它的派生视图，不另存副本。委托时引用里程碑与任务号即可。

| 里程碑 | 内容 | 状态 | 章节 |
|---|---|---|---|
| M-0 | P0 可用性：模型注册与无模型界面 | ✅ | §2.0 |
| M-A | M0–M12 已交付 | ✅ | §1 |
| M-B | Hero 与画布结构（S1 + S2） | ✅ 1–7 与 F1–F3 全部完成 | §2.1、§2.1.1 |
| M-C | 一体化外壳与组合（S3） | ✅ 8–13 全部完成 | §2.2 |
| M-D | 细节（图标、拖拽、字体） | ✅ 14–16 全部完成 | §2.3 |
| M-E | 独立修复 | ⏸ B2 挂起 | §2.4 |
| M-F | 代码仓库整洁化（并行轨道） | ⬜ | §5 |



## 1. 已完成（M0–M12，证据在 evidence/）

| 里程碑 | 交付 | 证据 |
|---|---|---|
| M0 地基 | 双包结构（app + `engine/`）、mixed 模板、`zu/engine` 启停 sidecar、WS 握手、ad-hoc dmg | 本节 §5 |
| M1 对话 | 会话列表、转录（`TextView` 流式 Markdown）、工具卡、停止、引擎重启续聊 | `engine.test.ts` |
| M2 契约与监督 | `contracts/` v1、`state.snapshot` 重连、引擎心跳/退避重启、扩展宿主 UI 桥、i18n 键表 | `contracts.test.ts`、`ui-host.test.tsx` |
| M3 容器与面板 | 注册表、per-container layout/zoom、多会话、archive、sheet 节流 | `containers.test.ts`、`containers.ui.test.tsx` |
| M4 项目与 Launcher | 多根 Project、membership（创建时固定）、Finder 选目录、侧栏两级、虚拟化 | `projects.test.ts`、`projects.ui.test.tsx` |
| M5 子代理 | `dispatch` 门控、`runs[]`、名册、级联中断 | `subagents.test.ts` |
| M6 轮廓 Casing | 侧栏/顶栏/页签基础几何、token 化 | [DESIGN.md](DESIGN.md)、`evidence/ui-rework.md` |
| M7 终端 | `zu/pty`（portable-pty）、external 容器、vim/htop/Claude TUI 实测 | `pty.test.ts`、`terminal.*.test.tsx` |
| M8 文件与编辑器 | `zu/fs`、文件树、真 `Editor`、两文件 Diff | `fs.test.ts`、`files.ui.test.tsx` |
| M9 Git | `zu/git`（shell out）、Changes/History、stage/commit/checkout | `git.test.ts`、`git.ui.test.tsx` |
| M10 浏览器 | `WebView` sheet、地址栏、外开转当前 sheet | `browser.test.ts`、`evidence/m10-browser.md` |
| M11 LSP | `zu/lsp`、rust-analyzer / tsserver / gopls 实测、Problems、F12 | `lsp.test.ts`、`lsp.ui.test.tsx` |
| M12 常驻 | 单实例、关窗隐藏、托盘、通知、更新三态 | `lifecycle.*.test.tsx`、`updates.test.ts` |

**未做**：M13 签名与公证（需要 Developer ID）；M10 的 `target=_blank` 已改为当前 sheet 内导航（nsh 无新窗口回调）；M12 的托盘点击/真实通知投递/真实更新安装未端到端验证。

## 2. 下一批：Casing II 与 Hero sheet

三条结构性决策先行，其余条目都是它们的派生：

- **S1 取消页面状态，Hero 变 sheet**：删除 `launcherOpen`；`home:{containerId}`（容器内）与 `home:scratch`（临时画布）是 sheet kind；画布永远只渲染 sheet 树。
- **S2 容器由 sheet 序驱动**：容器记 `sheetOrder`（创建序），标题取"存活的最早创建者"，每个 sheet kind 提供动态标题。
- **S3 外壳一体化**：窗口一层底色（titlebar + 侧栏同材质无分隔），内容是一张内嵌的白色圆角卡片。

### 2.0 P0 可用性：模型注册（先于 Casing II 剩余项）

「没有可用的模型」让发消息这一核心动作失效，是可用性问题，不是配色细节；排在 F2 之前。

| # | 问题 | 要点 | 验收 |
|---|---|---|---|
| P0-1 | 会话没有可用模型（原 §2.4-17） | `modelsData` 的 registry 可能没加载 pi CLI 的 models（`~/.pi/agent/models.json` + 认证）。先对比 `pi --list-models` 与 `session.models`，找出是引擎没初始化 registry、过滤掉了 provider，还是 UI 没展示；在引擎启动/会话创建前显式初始化 model registry，不靠副作用。 | 同一台机器上新会话列出的模型与 `pi --list-models` 一致；默认模型能直接发消息；`session.models` 的空/错有引擎测试 |
| P0-2 | 无模型时的界面 | 没有可用模型时，composer 不只把发送禁用掉：显示一句可操作的说明（例如配置 pi 的 provider/登录），并保留输入；模型菜单显示真实原因，不静默空列表。 | 无模型状态有明确文案与入口；有模型后无需重启即恢复；一条 UI 测试 |

> **P0-1 / P0-2 已完成（2026-11-11）**：根因是 `modelsData` 用 `Array.isArray(runtime.getAvailable)` 做守卫
> （方法永远不是数组），引擎从不问 pi，静默返回空列表。现在引擎在启动时显式创建一个共用的 `ModelRuntime`
> 并交给每个会话；空列表必带 `reason`（catalog/凭证/模型/失败），pi 的 `unknown/unknown` 占位模型不再发出去；
> `session.models` 默认读 snapshot，`refresh: true` 才重做 auth 检查。composer 在无模型时保留输入、停住发送、
> 给说明与重试，菜单显示同一原因。验收：`cd engine && bun run models:parity` 打印 `67 / 67`、`the two lists are equal`；
> `engine.test.ts` 用空 pi home 断言 `no_credentials`；`models.ui.test.tsx` 覆盖无模型说明、菜单原因与重试恢复。
> 证据与门禁见 [evidence/s20-models.md](evidence/s20-models.md)，决策 [decisions.md](decisions.md) Q81。

### 2.1 第 1 批：结构性（S1 + S2）

| # | 任务 | 要点 | 验收 |
|---|---|---|---|
| 1 | Hero sheet 化（S1） | `home:{containerId}` / `home:scratch`；删 `launcherOpen`；`empty()` 改为"画布无 sheet"；侧栏「新建」/⌘N 进 scratch；每个 panel 的 tab bar 最右加常驻 `+`，打开该 panel 的 Hero sheet（已存在则激活） | 启动、切容器、点 `+` 都只渲染 sheet；删 `launcherOpen` 后全量测试绿 |
| 2 | 修 A1/B3 | 切容器必 hydrate；external 容器创建后必切换画布；S1 落地后这类错位结构性消失 | 构建后启动停在启动容器并显示其对话；Hero 页点 Pi/Claude/Codex/Copilot 进入对应 TUI sheet |
| 3 | scratch 画布 | kind `Scratch`，不持久化；Hero 带项目 chip（选项目/Chats/新建项目）；提交 composer 或选动作后铸真实容器并切换；scratch 里开的浏览器 sheet 随容器迁移，未提交则暂存 | 新建 → 选项目 → 提交 → 得到归属该项目的容器；不提交切走再回来，浏览器仍在 |
| 4 | 动作可用性矩阵 | 新增 [DESIGN.md](DESIGN.md) §4.1（现在没有这一节）：容器内全可用；终端/TUI 类动作的容器内语义见 §2.1.1；scratch+项目除"文件/更改/历史/问题"需先建容器外可用；scratch 无项目只剩浏览器与选项目 | 三种上下文各一条 UI 测试 |
| 5 | 容器标题（S2） | `sheetOrder` + 每 kind 的 `title()`：session=会话名（`appendSessionInfo` 可改）/terminal=OSC 标题/webview=页面 title/其余固定 | 关闭第一个 sheet 后第二个顶上来；Claude Code 改终端标题时容器标题跟着变 |
| 6 | 语言跟随系统 | 删语言按钮；启动读 `locale()`：`zh*`→zh-CN，其余→en | 系统中文显示中文，非中文显示英文 |
| 7 | 无 tab 自动归档（含 Hero） | 容器 `sheetCount === 0` → 切到相邻容器 → archive → 侧栏行 180ms 退场（高度+透明度） | 关掉包括 Hero 在内的全部 sheet 后容器消失且引擎侧 archived |

#### 2.1.1 Hero 动作的容器内语义（验收反馈，2026-11-11）

> 这三条来自 §2.1-1 的验收，不是新批次；排在第 3 项之前，因为 scratch 的"选动作"依赖它们。

| # | 任务 | 要点 | 验收 |
|---|---|---|---|
| F1 | Hero 就地替换 | Hero 上的动作（浏览器、终端、各 TUI）在当前 canvas 的同一组里**替换 Hero 自身**：先把目标 sheet 插到 Hero 的位置，再关掉 Hero；Hero 不留在旁边。提交 composer / 选择动作同理。 | 容器 Hero 点浏览器：Hero 的 tab 消失，浏览器 tab 占它的位置；关掉浏览器不会把 Hero 变回来（Hero 由 `+` 再开） |
| F2 | 容器内的终端/TUI 资源 | 容器 Hero 的 Terminal / Claude Code / Codex / Copilot / Pi TUI 在**当前容器**内开终端 sheet（`terminal:{containerId}:{n}`，同一容器可多个），不新建 SessionContainer；`terminals.ts` 从"按容器 id 持一个 PTY"改为"按终端资源 id 持 PTY"；归档容器杀掉它的全部终端。侧栏行数不变。 | Pi 容器 Hero 依次开终端与 Claude：canvas 多出两个终端 tab，侧栏仍是同一个容器；归档后两个 PTY 都结束 |
| F3 | Pi TUI 与 Zu 会话分离 | Hero 的 Pi 动作 = 原生 `pi` CLI 的 TUI，开成 F2 的终端资源；Zu 会话仍由 composer / `session:{sessionId}` sheet 承担，且 Hero 的 Pi 动作不聚焦已打开的会话。scratch 的 Hero 先按第 3 项铸容器，再在容器内开 TUI。 | Pi 容器 Hero 点 Pi：出现原生 pi TUI 的终端 tab，Zu 会话 sheet 不变；用 composer 才进入 Zu 会话 |

**边界**：F2 只管**容器 Hero**。scratch 没有容器，动作仍按第 3 项先铸容器；"侧栏/Launcher 直接拉起的终端 = 独立 external 容器"（architecture §5.3）对 scratch 仍成立，铸哪种容器在第 3 项定稿。

> **F2 / F3 已完成（2026-11-11）**：终端改成容器内的资源（`terminal:{containerId}:{n}`，PTY 按资源 id
> 记账），容器 Hero 的 Terminal/Claude/Codex/Copilot/Pi 都在本容器开终端 sheet 并就地替换 Hero，
> 侧栏行数不变；归档先更新注册表再杀该容器全部 PTY。Pi 动作是原生 `pi` CLI 的 TUI，Zu 会话只由
> composer 进入。证据 [evidence/s211-f2f3-container-terminals.md](evidence/s211-f2f3-container-terminals.md)
> （`hero-terminals.ui.test.tsx` 两条验收 + `terminals.test.ts`）；决策 [decisions.md](decisions.md) Q82。

> **第 3 项已完成（2026-11-11）**：scratch 上可以开浏览器（`webview:scratch:{n}`，页面暂存），
> 提交 composer 或选动作铸容器时页面重挂到该容器（`webview:{containerId}:{n}`）并随布局迁移，
> scratch 布局随后重置为只有一个 Hero；动作的铸容器语义定为：Terminal/Claude/Codex/Copilot
> 铸 external 容器，Pi 铸 Pi 容器后在其中开原生 `pi` TUI。证据
> [evidence/s21-3-scratch.md](evidence/s21-3-scratch.md)；决策 [decisions.md](decisions.md) Q83。

> **第 4 项已完成（2026-11-11）**：DESIGN 新增 §4.1 动作可用性矩阵（三种画布上下文 × 六类动作，
> 容器内语义指回 §2.1.1）；代码按矩阵对齐——scratch 无项目时铸工作区的工具禁用、只留浏览器与
> 项目 chip，顶栏「文件/更改/历史/问题」在 scratch 上禁用、「浏览器」可用。三条 UI 测试各覆盖一种
> 上下文。证据 [evidence/s21-4-action-matrix.md](evidence/s21-4-action-matrix.md)。

> **第 5 项已完成（2026-11-12）**：容器记 `sheetOrder`（创建序，UI store；重启后以恢复布局的树序播种），
> 标题取存活的最早创建 sheet 的 `title()`——session=会话名（未命名的新会话不参与）、terminal=OSC 标题、
> webview=页面 title、其余固定；Hero 不参与命名，无可命名 sheet 时回退 captain 名/终端标题/目录。
> 证据 [evidence/s21-5-container-title.md](evidence/s21-5-container-title.md)（`titles.test.ts`）。

> **第 6 项已完成（2026-11-12）**：语言按钮删除；`App` 首帧前 `followSystemLocale()` 读 nsh 的
> `locale()`，`localeToShellLocale` 做 `zh*→zh-CN`、其余→en（运行中不跟随）。映射有单测，
> 两种系统语言各有 fixture 级 UI 测试；打开真 App 的用例改为用 `copy(zh,en)` 断言壳正在画的文案。
> 证据 [evidence/s21-6-system-locale.md](evidence/s21-6-system-locale.md)。

> **第 7 项已完成（2026-11-12）**：每个 tab 都有自己的 ×（nsh 关不掉组里最后一个），
> `setLayout` 在容器画布空了时自动 `archiveContainer`（含 Hero）；侧栏退场用原生
> `LayoutAnimation.create(180)`（行淡出、其余行上移）。external 容器由此走完
> "进程即容器"：进程退出 → sheet 关 → 容器归档。验收：`auto-archive.ui.test.tsx`
> （transport 收到 archive、画布到 scratch Hero、行消失）+ `containers.test.ts`
> 轮询 `container.list` 的 `archived: true` + `external.ui` 的退出用例。
> 证据 [evidence/s21-7-auto-archive.md](evidence/s21-7-auto-archive.md)。

> **第 8 项已完成（2026-11-12）**：S3 一体化外壳——全窗一层 `sidebar` 底；顶栏 40pt 无分隔线；侧栏无右边框；
> 内容区是 `card` 白卡（radius 14、四周 8–10pt、`overflow hidden`），页签条融在卡内（`bg-card` + hairline，
> 活动页签靠 shadowCard + primary 下划线区分）；composer 在卡内左右 24、底部 16。`TabBarPlus` 的测量基准
> 移到卡片，`+` 几何不受边距影响。截图 `docs/evidence/ui-s2-scratch-hero.png` 已用新壳重拍。
> 证据 [evidence/s22-8-shell.md](evidence/s22-8-shell.md)。

> **第 9 项已完成（2026-11-12）**：侧栏与卡片间的 10pt 沟槽里有 4pt 拖拽手柄
> （`PanResponder`），宽度钳 200–360、拖拽即时生效；新协议命令
> `settings.get`/`settings.put`（`settings` 组）把它持久化到 `zu/settings.json`
> （引擎侧钳宽、合并写、原子落盘），`bootShell` 启动读回。证据
> [evidence/s22-9-sidebar-drag.md](evidence/s22-9-sidebar-drag.md)（`settings.test.ts`
> 含 live 引擎的读写用例）。

> **第 10 项已完成（2026-11-12）**：顶栏 picker 整体删除（组件、`pickerCandidates`/
> `pickerSessions`/`pickContainer`/`PICKER_LIMIT`、四个 i18n 键、三个以 picker 为入口的
> UI 用例）；`titlebar.ts` 按剩余职责拆为 `vscode.ts`（VS Code 动作）与 `search.ts`
> （侧栏搜索的匹配规则）。顶栏只剩左开关与右侧动作，中心是拖拽区。
> 证据 [evidence/s22-10-remove-picker.md](evidence/s22-10-remove-picker.md)。

> **第 11 项已完成（2026-11-12）**：composer 重排为一行右对齐（模型 · thinking、context%、⋯、主按钮）；
> 分割线是 composer 自己的、恰好与它同宽；idle=↑发送、streaming=■停止（同位置），排队/引导/打断收进
> `⋯` 菜单且可点无副作用。三种状态截图 `ui-s22-11-{idle,streaming,menu}.png`。
> 证据 [evidence/s22-11-composer.md](evidence/s22-11-composer.md）。

> **11a 已完成（2026-11-12）**：斜杆命令落地——`slash.ts` 的三类映射（本地 / 按原文进 prompt /
> 不支持），输入 `/` 弹候选、Enter 对 `/` 草稿执行命令；新 wire 命令 `session.setThinking` 与
> `session.compact` 支撑本地腿；映射表进 DESIGN §3.6 与 architecture。9 条映射测试（每条一条）。
> 证据 [evidence/s22-11a-slash.md](evidence/s22-11a-slash.md)。

> **第 12、13 项已完成（2026-11-12）**：红绿灯的原生位置（左边距 16、40pt 内垂直居中，
> `controlsOffset { x:16, y:14 }`，直径/间距由系统绘制）；页签宽度改 Chrome 式
> （72–240、grow 0 / shrink 1、标题截断），`+` 的几何不受影响，截图已重拍。
> 证据 [evidence/s22-12-13-chrome.md](evidence/s22-12-13-chrome.md)。

> **第 14 项已完成（2026-11-12）**：`brand-icons.tsx` 落四个品牌标（manox-app 的
> claude/codex/githubcopilot + pi 自己的标，各自 viewBox 与 fill-rule，纯色 tint），
> Hero 第二排工具行换用。截图 `ui-s23-14-brand-icons.png`。
> 证据 [evidence/s23-14-brand-icons.md](evidence/s23-14-brand-icons.md)。

> **第 15 项已完成（2026-11-12）**：`renderDragPreview` 画幽灵（tab 形状、144 宽、卡底 + 阴影 +
> 自己的图标标题，跟随指针）；`renderDropIndicator` 在页签槽位画 2pt brand 竖线、组分割/边缘
> 保留块状指示。"源 tab 变占位（opacity 0.35）"需要 nsh 的 DockTab 暴露 dragging 标志（0.4.0 没有），
> 按 Q54 的升级规则单独成批，见证据的"已知边界"。
> 证据 [evidence/s23-15-drag-ghost.md](evidence/s23-15-drag-ghost.md)。

> **第 16 项已完成（2026-11-12）**：Lilex（Light 300 + Medium 500，同 family）由 zu-app crate 经
> `registry.assets(assets!())` 壳带，引擎首帧前注册；`fonts.ts` 的 `SHEET_FONT` 进四类 sheet 内容
> （正文、编辑器、终端、Diff），轮廓保持系统字体。不走 TSX 字体 import——fixture 的打包根在
> `fixtures/` 下，绝对路径 URI 会在 `--target macos` 宿主 404；crate 资产四个 host 同一条路径。
> Rust 单测守住 family、`fonts.test.ts` 守住常量；截图 `ui-s23-16-lilex.png`（内容 Lilex）、
> `ui-s23-16-lilex-shell.png`（全壳：侧栏/页签/composer 系统字体，画布 Lilex）。
> 证据 [evidence/s23-16-lilex.md](evidence/s23-16-lilex.md)。

> **F1 已完成（2026-11-11，`4293eb7`）**：`replaceSheet()` 把目标 sheet 放进 Hero 的原槽位并移除 Hero；容器 Hero 的
> 浏览器、终端/TUI（F2）与 Pi（F3）动作、以及 composer 提交都走它。证据
> [evidence/s21-1-hero-actions.md](evidence/s21-1-hero-actions.md)。

> **§2.1-1 已完成（2026-11-11，`a58e0ad`）**：`home:{containerId}` / `home:scratch` 是 sheet 种类；`launcherOpen` 及其页面路径已删除；
> 画布只有 sheet 树。每个可见组的标题栏右端有 `+`（nsh 0.4.0 没有尾部插槽，`+` 是 app 侧按布局几何画的覆盖层，
> 见 [evidence/s1-hero-sheet.md](evidence/s1-hero-sheet.md)）。nsh 的 tab × 关不掉组里最后一个 tab，但零 sheet 仍可达：
> 终端/TUI 进程自己退出会关掉它的 sheet。第 7 项需要 shell 侧的关闭路径来处理不是进程的 sheet（最后一个 Hero、
> 最后一个 Pi 会话），并在零 sheet 时切走归档。
>
> **§2.1-2 已完成（2026-11-11，`bcd4004`）**：启动先切画布、后扫会话索引；switch / create / external create 共用
> `activateCanvas`；每次画布意图取 ticket，旧应答不得覆盖新意图。验收与过程见
> [evidence/s21-2-switch-hydrate.md](evidence/s21-2-switch-hydrate.md)。这条只证明"点动作会进入 TUI sheet"；
> 容器内 Hero 的动作目前仍会新建 SessionContainer、且 Hero 会留在旁边，由 §2.1.1 的 F1–F3 修正。

### 2.2 第 2 批：外壳与组合（S3）

| # | 任务 | 要点 | 验收 |
|---|---|---|---|
| 8 | 一体化外壳 | 全窗 `sidebar` 底；titlebar 40pt 无分隔线；侧栏无右边框；内容区白卡 `radius 14` + 四周 8–10pt；tab bar 融入卡片；composer 在卡片内左右 24 | 与 ZCode 截图并排，底色/圆角/间距/字号一致 |
| 9 | 侧栏可拖拽 | 侧栏与卡片间 4pt 热区，宽 200–360，持久化到 `zu/settings.json` | 拖拽即时生效，重启保持 |
| 10 | 移除顶栏 picker | 删掉 titlebar 的会话/容器 picker：`SessionPicker` 与 `pickerCandidates`/`pickerSessions`/`pickContainer` 的 UI 路径、对应 i18n 键与 `App.test`/`containers.ui`/`projects.ui`/`titlebar.test` 里的用例一并收掉；顶栏只留左开关与右侧动作，中心不再有 360pt 控件，也不新增别处入口 | 顶栏无 picker；切容器只经侧栏；全量测试绿，且没有只为 picker 存在的导出 |
| 11 | composer（仅交互） | 分割线只与 composer 同宽；模型/thinking/context 右对齐；idle=↑发送、streaming=■停止（同位置）；排队/引导/打断收进 `⋯` 菜单（不接线） | 三种状态各一条截图；`⋯` 项可点但无副作用 |
| 11a | Composer 的 pi 斜杆操作 | 以 pi 1.5.0 的斜杆命令为准先列清单（`/model`、`/thinking`、`/compact`、`/clear`、`/new`、`/resume`、`/help`…），逐条映射：能本地做的（模型/思考、清屏、压缩、会话切换）由 Zu 的 store 执行，其余按原文进 `session.prompt`，不支持的明确提示；输入 `/` 弹候选（命令 + 一句说明），与模型菜单、停止/排队不冲突 | 映射表进 DESIGN §3.6 与 architecture；`/model` 能开模型菜单并切换，`/compact` 与 pi 一致，未知命令有提示；每条映射一条测试 |
| 12 | 红绿灯 | 原生比例：直径 12、间距 8、左边距 16、垂直居中 | 与原生窗口并排看不出差异 |
| 13 | tab 宽度 Chrome 式 | `maxWidth 240`、`minWidth 72`、`flexShrink 1`、`flexGrow 0`；标题截断 | panel 变窄或 tab 增多时被均匀挤压 |

### 2.3 第 3 批：细节

| # | 任务 | 要点 | 验收 |
|---|---|---|---|
| 14 | 品牌图标 | Claude/Codex/Copilot 取自 `manox-app/crates/agent-ui/assets/icons/{claude,codex,githubcopilot}.svg`；Pi 用 `~/Downloads/pi-coding-agent.svg`；注入 tint 使其在两种外观下可读 | 工具行两排图标与文字对齐 |
| 15 | 拖拽 tab 的抽象物 | 源 tab 变占位（`opacity 0.35`）；幽灵为 tab 形状（144 宽、同圆角、带图标标题、`scale 1.02` + 阴影）；落位用 `DockDropIndicator.index` 在两个 tab 之间画 2pt brand 竖线，落到组/边缘用现有指示 | 拖动时能看到"正在拖什么"与"会落在哪儿" |
| 16 | Lilex | 仅 sheet 内容（正文/编辑器/终端/Diff）；`Lilex-Light.ttf`(300) + `Lilex-Medium.ttf`(500) 同 family，邻近映射（400→300、600+→500）；轮廓不变 | 内容区用 Lilex，标题栏/侧栏仍是系统字体 |

### 2.4 独立修复

> 「无可用模型」已提升为 §2.0 的 P0-1/P0-2。

| # | 问题 | 要点 |
|---|---|---|
| 18 | B2 markdown 偶发纯文本 | **挂起**：现场已丢失（重启后自行恢复）。保留一个可复现样本后再修 |

## 3. 不做（挂账）

- 归档容器的恢复入口（自动归档后会看不到；按裁决暂不提供）。
- 排队/引导/打断的实际接线（需要 pi 扩展或协议扩展）。
- 设置页的语言切换（改为跟随系统）。
- M13 签名与公证（需要 Developer ID 账号）。

## 4. 门禁

```
nsh check .                                ✓ 必须
cargo check --all-targets                  ✓ 必须
nsh test .                                 ✓ 全量（含 live 模型、三个语言服务器）
script/bundle-mac.sh                       ✓ 打包冒烟
```

每个批次结束时：全量绿 + 截图（`docs/evidence/ui-*.png`）+ 本节状态更新。

## 5. 代码仓库整洁化（新增，并行轨道）

目标：结构可导航、每个事实只有一处、没有只为历史存在的代码/文档；**每个提交只做一类移动**，随时可全量回绿。
与 Casing II 并行：C1/C5/C6/C7 可立即插入；C2（文件布局）等 Casing II 的功能项完成后再做，避免移动与改写互相冲突。

| # | 任务 | 要点 | 验收 |
|---|---|---|---|
| C1 | 死代码与导出清理 | 清掉没人引用的导出/工具（如 `containerCount`、`nextSheetId`、`TOOLBAR_KINDS` 一类）、过期 i18n 键、注释里的旧路径；不为了"可能有用"保留 | `nsh check`/`nsh build` 无告警；全量测试绿；导出清单每一项都有调用方 |
| C2 | 文件布局 | 根目录 40+ 个模块按 `shell/`、`canvas/`、`stores/`、`sheets/`、`ui/` 归位；只改 import 路径，不改行为 | 每步可编译、测试绿；README 代码地图与目录一致 |
| C3 | 命名一致 | `launcher.tsx`→`hero.tsx`、`launcher-*` 测试 id/键、`home:*` 与"Hero"术语统一；`titlebar.ts` 在 picker 移除后按剩余职责改名 | 代码、i18n、DESIGN/architecture/README 用同一套术语 |
| C4 | 单一事实源 | sheet id/标题/可见性、终端资源、布局编辑只留一处；删重复的分支与镜像状态 | grep 不出第二份同类逻辑；相关单测合并 |
| C5 | 测试卫生 | fixture 隔离（M9 已改每轮新仓库）、确定性等待（不靠固定 sleep）、临时目录清理、跨测试共享状态审计 | 全量连跑 3 次全绿，无偶发 |
| C6 | 文档与证据 | 断链、过期状态/门禁数字、DESIGN 缺失章节（如动作矩阵 §4.1）、证据索引；`docs/research` 的去留 | 链接检查通过；状态与最近一次门禁一致 |
| C7 | Rust 与引擎 | `cargo fmt --check`、重点看 `clippy` 的实用项、错误码表、死代码；engine 侧同样 | 门禁绿；无新增告警 |
