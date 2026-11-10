# 前端 UI 架构（轮廓与 panel/sheet 画布）

> 状态：设计定稿（2026-11-10 讨论定稿）；§3 的部分已实现于本仓（见 §2 盘点）。开放问题见文末。

## 0. 一句话

**轮廓与内嵌对象分离**（Steer 血统）：壳（rail、项目侧栏、工具栏、状态条）零领域状态；画布是受控的 `nsh/base DockArea`——**panel** 是带页签条的容器（可任意多个、可拖手调宽、可拖拽停靠重排、可 zoom），**sheet** 是页签内容（Pi 会话、终端、各 agent TUI、webview、编辑器、Diff、会话的 aux 视图），sheet 可跨 panel 拖拽移动且状态不丢。交互对标 iTerm2/Warp。

## 1. 决策记录

| # | 决策 | 备注 |
|---|---|---|
| U1 | panel/sheet 全量建在 `nsh/base DockArea` 上，不自研拖拽/停靠/resize 引擎 | DockArea 原生提供：跨组拖页签、组边缘分栏、发丝线拖手 + thumb、drop indicator、zoom、<600pt compact（单组 + dock 抽屉/sheet） |
| U2 | 布局是**受控纯数据**：app 持有 `DockAreaLayout`，`onLayoutChange` 回报整份新布局传回 | 与 Steer「布局是投影、宿主唯一写入者」同构；nsh 单引擎线程下无租约问题，纪律成本低 |
| U3 | **sheet 身份 = 稳定 id**（`kind:instance`，如 `session:{containerId}`、`terminal:{containerId}:{n}`）；布局树只存 id；内容由 `sheets.tsx` 注册表按 id 解析 | 布局持久化天然轻量；sheet 单实例语义自动成立（拖拽 = move 不复制） |
| U4 | `renderPanel` 按 key 渲染一次 → **sheet 跨 panel 移动状态不丢** | 已由测试验证（mock 计数器） |
| U5 | 重型 sheet（PTY 终端、webview）保守活 + `pinned` 语义 + LRU 上限；失焦超时降级（PTY 数据流在 engine 侧缓冲，回来重放） | PTY 数据流永远在引擎，组件只是渲染面 |
| U6 | 侧栏会话行 → 打开/激活对应 sheet；工具栏 ＋ → 在当前显示的组新建 sheet | 已实现 |
| U7 | 启动恢复**上次活跃容器**（`lastContainerId` 持久）；canvas 空态 = **Launcher 发射台**（与「先 composer 后容器」合一） | 原 Q4①；空态形态承 domain-model §6.2，2026-11-10 拍板 |
| U8 | 死资源 sheet 在布局恢复时**静默移除**（简单实现优先；不做占位组件） | 原 Q4②，产品负责人授权自决 |
| U9 | 键盘 v1 **最小集**：`⌘W` 关 sheet、`⌘1-9` 切 sheet、`⌘K` 命令面板（nsh/base `Command`，承载打开/切换/zoom/重置全部动作） | 原 Q5 |
| U10 | **单容器画布是永久形态**：跨容器画布永不出现（非 v1 限定）；跨容器需求走多窗口（每窗一个容器，nsh 多窗口原生） | 原 Q2（domain-model §8 同步记录） |
| U11 | **i18n 对齐 Steer：zh-CN 第一语言 + en fallback，键表第一天立住**（nsh-i18n 或自带轻量 Fluent；`set_locale` 能力并入 spike） | 原 Q9，2026-11-10 拍板 |
| U12 | **托盘常驻 + 系统通知**（v1）：关窗即收起（**无确认**，后台 run 继续）、turn settle / 子会话交付发通知；**单实例强制**；**不做登录自启**；通知首次做得**激进**（宁可多报，后续按反馈做减法） | 原 Q12C + Q16 定案，2026-11-10 |
| U13 | **logo = Steer 的 `<->` 构型 + 密率 355/113**（横线上方 355、下方 113，纪念祖冲之）；Canvas 绘制，`ink` 可注入 | 原 Q8 修订，2026-11-10；已落码于 `ui.tsx` 的 `Logo` |

## 2. 现有实现盘点（本仓已落地）

| 文件 | 内容 |
|---|---|
| `App.tsx` | 壳装配 + 受控 DockArea 接线（layout/onLayoutChange/onPanelActiveChange/onZoomChange/renderTab/renderDock/renderPanel/renderEmpty + 部件样式类） |
| `dock.ts` | 布局数据与纯编辑：`initialLayout` / `appendSheet`（落当前显示的组）/ `activateSheet` / `sheetCount` / `nextSheetId` |
| `sheets.tsx` | 注册表：13 种 kind 的标题/图标/mock 体（一行占位文本 + 拖拽保状态计数器） |
| `App.test.tsx` | 无头测试：outline、加 sheet、计数器 |

## 3. 待建清单

1. **按容器 stash 的布局存储**：`layoutStore: Record<containerId, DockAreaLayout>`（切容器 = stash 当前 + restore 目标，对应 Steer A2 的按容器键 stash）；**持久化落 `~/.pi/zu/`（E11），经 engine wire 的 state 面——UI 的 nsh Storage 裁撤**；`onLayoutChange` 是高频事件，**debounce 后保存**（文档原话「it comes on every edit」）。
2. **启动恢复**：上次活跃容器 + 其布局（`lastContainerId` 持久，U7）；恢复时对指向已死资源的 sheet **静默移除**（U8）。
3. **键盘与焦点路由**：v1 最小集（U9）——`⌘W` / `⌘1-9` / `⌘K`；panel 获焦高亮；命令面板承载全部 sheet/布局动作。
4. **自定义拖拽预览**：`renderDragPreview` 圆角 chip（gallery 同款），当前用默认形态。
5. **会话 sheet 族实化**：主对话（transcriptStore 投影）、subagents/后台任务/轨迹/统计（同一会话域的派生视图）；流式渲染用 gallery Chat 的 pending + rAF 每帧批 flush 模式；转录用 `List` 虚拟化 + `maintainVisibleContentPosition` 跟随底部。
6. **i18n（U11）**：zh-CN 第一 + en fallback；键表与 parity 测试从第一个真实 sheet 起 立；`nsh-i18n`/`set_locale` 形态并入 spike。
7. **托盘与通知（U12）**：托盘图标 + 菜单（显示/隐藏窗口、退出）；通知权限申请 + turn settle/交付两类通知（首版激进：全部容器的完成事件都报）；关窗拦截为「收起」（无确认、后台继续）；单实例通过第二实例转发激活。

## 4. 与关系对象模型的接缝

- 侧栏一行 = 一个 SessionContainer（domain-model.md §4）；canvas 显示的是**该容器的视图 stash**——视图类对象无生命周期语义，开关/拖拽永不触碰会话与资源。
- sheet id 带容器命名空间：容器死亡 ⇒ 资源 sheet 全部失效（布局清理语义见 Q4-②）；会话 sheet 仍可打开（文件在，rehydrate）。

## 5. 已裁决（原开放问题，2026-11-10）

- **Q4①** 启动恢复上次活跃容器 → U7；**Q4②** 死资源 sheet 静默移除（产品负责人授权按简单实现）→ U8；**Q4③** canvas 空态 = Launcher（domain-model §6.2 既有设计，随 U7 一并定案）。
- **Q5** 键盘 v1 最小集 → U9。
- 本文档暂无未决问题；新问题集中至 **docs/open-questions.md**。
