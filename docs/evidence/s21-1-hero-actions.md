# §2.1.1 Hero 动作的容器内语义（验收反馈）

日期：2026-11-11。F1 已完成，工作树未提交；F2/F3 未动工。`nsh check` ✓、`nsh test` 235/235 ✓、`script/bundle-mac.sh` ✓。

三条验收反馈（用户）：

1. 容器 Hero 上做了具体操作后，Hero 要**就地变成对应的 tab**，不能 Hero 与目标同时存在。
2. 容器 Hero 里打开终端/Claude Code 等 TUI，应该开在**当前 SessionContainer**，不是新建一个。
3. Hero 的 Pi 动作是**原生 pi TUI**，与 Zu 封装的会话（Zu Session）不同；不应该打开/聚焦 Zu 会话。

## F1：Hero 就地替换（已完成）

- `dock.ts` 的 `replaceSheet(layout, from, to)`：把 `to` 放进 `from` 的组与槽位、激活它；`to` 若已在别处打开，
  先移除再移动（一个 sheet 一个实例）；`from` 已不在（Hero 被关掉）则退回 `appendSheet`。
- 容器 Hero 的**浏览器**动作用 `openBrowserSheet(containerId, heroSheetId)`，浏览器占 Hero 的槽位。
- 容器 Hero 的 **composer 提交**经 `startInContainer` → `showContainerSession(containerId, heroSheetId)`，
  会话 sheet 占 Hero 的槽位（原本已开的会话先移除再放回，仍是一个实例）。
- 关掉目标 sheet 不会把 Hero 变回来；Hero 由 tab bar 的 `+` 再开。
- 测试：`dock.test.ts` 的 `replaceSheet` 单元测试（含跨组移动与 Hero 已关的回落）；`containers.ui.test.tsx`
  的“Hero's action takes the Hero's tab”（浏览器替换、关闭后不复活）；composer 提交的用例补了 Hero 消失断言；
  `browser.ui.test.tsx` 补了 Hero 消失断言。

## F2：容器内的终端/TUI 资源（未做）

当前：容器 Hero 的 Terminal / Claude Code / Codex / Copilot 仍走 `createExternalContainer`，会新建侧栏行并切换画布；
Hero 留在原容器的布局里。目标：

- 终端 sheet id 扩成 `terminal:{containerId}:{n}`（同一容器多个）；外部容器仍用 `terminal:{containerId}`（进程即容器）。
- `terminals.ts` 从“按容器 id 持一个 PTY”改为“按终端资源 id 持 PTY”；`TerminalBody` 从 sheet id 取资源与容器；
  `closeTerminal(containerId)` 变成“结束该容器的全部终端”；归档时逐个结束。
- 资源终端可关（关闭即杀 PTY），外部容器的唯一终端仍不可关（关掉就没有容器了）。
- 动作开在当前容器并用 F1 的 `replaceSheet` 占 Hero 的槽位；侧栏行数不变。
- 验收：Pi 容器 Hero 依次开终端与 Claude → canvas 两个终端 tab、侧栏同一行；归档后两个 PTY 都结束。

## F3：Pi TUI 与 Zu 会话分离（未做）

当前：容器 Hero 的 Pi 动作调用 `showContainerSession`，聚焦 Zu 会话。目标：Pi 动作在容器内开一个终端资源，
命令是原生 `pi`，走 F2 的机制；composer 仍进 Zu 会话。scratch 的 Hero 先按第 3 项铸容器，再在容器内开 TUI。

## 顺带修掉的测试债

`git.ui.test.tsx` 的 fixture 根在 `/tmp/zu-m9-git-fixture`，跨运行累积文件；本轮跑到 21 个改动文件时，
目标行被挤到提交行下面，press 命中失败。现在测试在 app 的 storage 里声明本轮自己的根（`zu-m9-root`），
fixture 读它作为容器 cwd；每次运行一个全新的仓库，文件树与 Changes 都只含本轮文件。
