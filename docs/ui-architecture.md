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

## 2. 现有实现盘点（本仓已落地）

| 文件 | 内容 |
|---|---|
| `App.tsx` | 壳装配 + 受控 DockArea 接线（layout/onLayoutChange/onPanelActiveChange/onZoomChange/renderTab/renderDock/renderPanel/renderEmpty + 部件样式类） |
| `dock.ts` | 布局数据与纯编辑：`initialLayout` / `appendSheet`（落当前显示的组）/ `activateSheet` / `sheetCount` / `nextSheetId` |
| `sheets.tsx` | 注册表：13 种 kind 的标题/图标/mock 体（一行占位文本 + 拖拽保状态计数器） |
| `App.test.tsx` | 无头测试：outline、加 sheet、计数器 |

## 3. 待建清单

1. **按容器 stash 的布局存储**：`layoutStore: Record<containerId, DockAreaLayout>`（切容器 = stash 当前 + restore 目标，对应 Steer A2 的按容器键 stash）；持久化到 nsh Storage（`onLayoutChange` 是高频事件，**debounce 后保存**——文档原话「it comes on every edit」）。
2. **启动恢复**：上次活跃容器 + 其布局；对指向已死资源的 sheet 显示「重启」占位（诚实降级，不静默丢弃）。
3. **键盘与焦点路由**（iTerm2 手感的关键）：panel 获焦高亮、`⌘1-9` 切 sheet、`⌘W` 关 sheet、`⌘D` 沿焦 panel 分栏、`⌘K` 命令面板（nsh/base `Command` 组件，原生虚拟化）承载全部 sheet/布局动作。
4. **自定义拖拽预览**：`renderDragPreview` 圆角 chip（gallery 同款），当前用默认形态。
5. **会话 sheet 族实化**：主对话（transcriptStore 投影）、subagents/后台任务/轨迹/统计（同一会话域的派生视图）；流式渲染用 gallery Chat 的 pending + rAF 每帧批 flush 模式；转录用 `List` 虚拟化 + `maintainVisibleContentPosition` 跟随底部。
6. **i18n**：接入 nsh-i18n 或自持 Fluent（词汇表归属待定，v1 可先英文）。

## 4. 与关系对象模型的接缝

- 侧栏一行 = 一个 SessionContainer（domain-model.md §4）；canvas 显示的是**该容器的视图 stash**——视图类对象无生命周期语义，开关/拖拽永不触碰会话与资源。
- sheet id 带容器命名空间：容器死亡 ⇒ 资源 sheet 全部失效（布局清理语义见 Q4-②）；会话 sheet 仍可打开（文件在，rehydrate）。

## 5. 开放问题（需要拍板）

### Q4：布局 stash 的三个语义点

**背景**：布局按容器 stash 后，有三个场景没有定死行为。逐一解释：

**① 启动时恢复哪个容器？**
每次启动 app，画布要有内容。选项：A）记住上次活跃的容器（注册表里存 `lastContainerId`，启动直接 restore 它）；B）总是落到 Launcher 发射台（不自动恢复任何容器，用户手动点）。A 的体验连续（接续昨天的工作），B 的行为可预测（每次从干净状态开始）。Steer 的现状接近 A（恢复活跃会话）。**建议 A**，Launcher 从「＋」进入。

**② 容器死亡后，stash 里指向死资源的 sheet 怎么办？**
比如容器里开了两个终端 sheet（PTY 是资源，本次 runtime 生命周期），archive 容器或 engine 重启后 PTY 没了，但布局树里还记着这两个 sheet id。选项：A）**静默移除**——恢复布局时把失效 sheet 删掉，画布干净但用户会疑惑「我的终端呢」；B）**诚实占位**——sheet 还在，内容显示「该终端已随容器关闭 ＋ 重新打开」按钮，用户点一下重新拉起 PTY。B 多一个占位组件，但把「资源死了」这个事实显式交给用户。**建议 B**（与 Steer 的「诚实降级」倾向一致）。

**③ 无容器时的画布显示什么？**
没有选中任何容器（或全部归档）时：A）空态提示 + 「新建会话」入口；B）直接显示 Launcher（项目 chip + composer + agent 动作行，PLAN-PROJECTS 的发射台形态）。B 让「发射台」和「画布空态」合一，少一个页面状态。**建议 B**。

**需要你回答**：① A/B？② A/B？③ A/B？

### Q5：键盘与焦点路由的第一批范围

**背景**：iTerm2 的手感一半来自键盘。nsh/base 有 `keymap` 与 `Command` 命令面板原语（gallery 的 ⌘K 面板 5000 行虚拟化过滤是现成能力），但快捷键集要自己定。范围选项：

- **最小集（v1）**：`⌘W` 关当前 sheet、`⌘1-9` 切当前 panel 的第 n 个 sheet、`⌘K` 命令面板（包含：打开某类 sheet、切容器、zoom、重置布局）。
- **完整集（v2）**：加 `⌘D` 沿焦 panel 分栏、`⌘⇧D` 垂直分栏、`⌘⏎` zoom 当前 panel、`⌘⇧[ / ]` 移动 sheet 到相邻 panel、`⌘N` Launcher。

多做一个快捷键就多一份文档/测试/冲突排查成本（尤其 `⌘D` 与浏览器习惯的肌肉记忆冲突）。**建议 v1 最小集**，完整集等真实使用反馈。

**需要你回答**：v1 快捷键按最小集走吗？有没有你一定要在 v1 就有的键位？
