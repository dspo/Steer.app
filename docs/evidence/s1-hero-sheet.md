# S1：Hero sheet 化（§2.1 第 1 项）

日期：2026-11-11。工作树未提交；`nsh check` ✓、`cargo check --all-targets` ✓、`nsh test` 231/231 ✓、
`script/bundle-mac.sh` ✓。截图：[ui-s2-hero-sheet.png](ui-s2-hero-sheet.png)（容器内 Hero）、
[ui-s2-scratch-hero.png](ui-s2-scratch-hero.png)（scratch 画布）。

## 改了什么

| 面 | 之前 | 之后 |
|---|---|---|
| 画布 | `launcherOpen ? <Launcher/> : <DockArea/>`——页面与容器是两份真相 | 只有 `DockArea`：容器布局或 scratch 布局；无 sheet 时是 `renderEmpty` |
| 起始页 | `launcherOpen` 页面布尔 | sheet `home:{containerId}` / `home:scratch`（`dock.ts` 的 `homeSheetId`） |
| 新建 | `openLauncher()` 打开页面 | 侧栏「新建」/⌘N → `openHero(null)` → scratch 画布；项目行 `+` → `openHero(projectId, true)`（项目 chip 锁定） |
| scratch | 不存在 | `activeContainerId === null` 即 scratch：布局只在内存（`scratchLayout`），不写 `layouts/`，不碰 `container.show` |
| panel 的 `+` | 无 | 每个可见组标题栏右端常驻；打开该组的 Hero（已存在则激活） |
| 容器内 Hero | 无 | composer 发到该容器 captain 会话；Pi 动作把会话 sheet 提到前面；浏览器在容器内开 sheet；项目 chip 是事实（锁定） |
| 终端/TUI 容器的 Hero | 无 | 它不能承载 Pi 会话：composer 与 Pi 动作在那个工作区（同 cwd、同项目）铸一个 Pi 容器，不让提交落空；这与 scratch Hero 走同一条 `startFromScratch(text, target)` |
| scratch Hero | 无 | composer 提交后铸容器并切换（沿用 M4 的 `startFromScratch`）；未提交时 scratch 原样保留 |

`launcherOpen` / `openLauncher` / `closeLauncher` / `startFromLauncher` 已删除；`launcherProjectId` 等表单状态改名为
`heroProjectId` / `heroLocked` / `heroStarting`。`launcher.tsx` 只剩 Hero sheet 与项目对话框（文件名保留，README 一直称它为
Hero）。

## nsh 0.4.0 的缺口：tab bar 没有尾部插槽

`DockArea` 的 tab bar（`crates/nsh-base/src/dock/tab_group.rs` 的 `tab_group`）只渲染 tabs：`each(tabs, ...)`，
没有 trailing/accessory 回调，`renderTab` 也只能给单个 tab 自己的内容。所以 `+` 不是 DockArea 的部件，而是 app 的覆盖层：

- `tab-plus.tsx` 的 `tabBarBoxes()` 由布局树算出每个可见组的矩形：split 的 `sizes` 是 pt，除最后一个可见子节点外取记录值，
  最后一个取剩余；组间 handle 按 `handleClass="basis-px"` 记 1pt；zoom 只画被 zoom 的组；宽度 < 600pt（nsh 的 compact
  阈值）只画显示中的组。
- 覆盖层 `absolute inset-0` + `pointerEvents: box-none`，每个组右端一个 20pt 的 ghost 按钮（`testID="tab-plus-{anchor}"`）。
- tab bar 用 `paddingRight: 30` 预留这条带，tab 不会压在按钮下（Chrome 式挤压是 §2.2-13 的事）。
- 本仓库不打开 dock；若布局里出现 dock，中心区的坐标会偏向，因此不画（宁可没有，也不画错位置）。

顺带修了 `ui.tsx` 的 `plus` 字形：它此前只有一条竖线（截图里像一个光标），现在补上横线。

## 一个 nsh 规则，留给 §2.1-7

`DockArea` 的 tab 可关闭性 = `closable && draggable && !(group.alone && shown <= 1)`：**组里只剩一个 tab 时，
那个 tab 的 × 不可用**（`area.rs` 的 `rules`）。但零 sheet 并非不可达：终端/TUI 进程自己退出时，
`TerminalBody` 会关掉它的 sheet（`terminalInfo` 的 running→false，`onProgramExit`；`exit`、`/exit`、`/quit` 都会
走到这里），所以外部容器的最后一个 sheet 可以关到零，画布转入 `renderEmpty`。

§2.1-7 仍需要一条 shell 侧的关闭路径，但理由不是"零 sheet 不可达"：它要覆盖**不是进程的 sheet**——最后一个 Hero、
最后一个 Pi 会话——以及在 `sheetCount === 0` 时切到相邻容器并 archive。`renderEmpty` 里现在有「打开起始页」
（`empty-open-hero`），空画布不会成为死路。

## 测试

新增/改写的覆盖：

- `tab-plus.test.ts`（6 条）：单组铺满、横向 split 的右边缘与 1pt handle、无 sizes 均分、纵向 split、zoom、compact、
  空画布无按钮。
- `dock.test.ts`：`home:{id}` / `home:scratch` 的归属与"一次只开一个"。
- `containers.ui.test.tsx`：`+` 打开 Hero（tab 标题、关闭再打开、重复只激活）、容器内 Hero 提交进 captain 会话
  （不是新容器）、macOS 截图。
- `projects.ui.test.tsx`：New 进 scratch（按钮与 ⌘N）、重复 New 只保留一个 Hero、项目行 `+`、Hero 工具行/项目菜单。
- `external.ui.test.tsx`：首次启动（无容器）的 canvas 就是 scratch 的 sheet 树；终端容器里执行 `exit` 后最后一个
  sheet 关掉、画布转入 `renderEmpty`、Hero 按钮把它开回来。
- `browser.ui.test.tsx`：Hero 的浏览器动作仍开在活动容器（fixture 从 `open-launcher` 改为 `open-hero`）。

## 未做（属于后面的条目）

- scratch 的浏览器 sheet 随容器迁移、未提交暂存（§2.1-3）。
- 动作可用性矩阵（§2.1-4）；现在 scratch 无项目时只剩「选项目 + 终端/agent 动作」，浏览器在 scratch 禁用。
- 容器标题 `sheetOrder`（§2.1-5）。
- 无 sheet 自动归档（§2.1-7；关闭路径与零 sheet 的说明见上）。
