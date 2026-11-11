# §2.1-5：容器标题（S2）

日期：2026-11-12。验收对象是 [plan.md](../plan.md) §2.1 的第 5 项。

## 1. 规则

容器记 `sheetOrder`（每个 sheet 的**创建序**，UI store 持有，`containers.ts`）；
容器的标题是**存活的最早创建 sheet** 的标题，每个 kind 用自己的 `title()`：

| kind | 标题 |
|---|---|
| `session:{id}` | 会话名（`appendSessionInfo` 改名即跟随）；还没有名字的新会话**不参与**——id 前缀会让两个容器读成同一个 |
| `terminal:{containerId}:{n}` | OSC 标题（Claude Code 改标题，容器跟着变）；没有 OSC 时是种下的 `类型 · 目录` |
| `webview:{containerId}:{n}` | 页面 title，其次地址 |
| 其余（files/changes/history/problems/…） | 固定（带目录名） |
| `home:*`（Hero） | **不参与**：每个容器的起始页都读作同一个词 |

没有可用的 sheet 命名时回退到"这个容器是什么"：captain 会话的名字（有名字时）、
external 容器资源 1 的终端标题、kind 标签、目录名——即 S2 之前的规则，作为兜底。

`sheetOrder` 的记账：打开 sheet 的地方调用 `noteSheetOpened(id)`（打开顺序不能从
布局 diff 读出来——dock 的编辑函数从当前树构造下一棵树，`appendSheet` 原地改
panels）；`setLayout` 只负责剪掉已关闭的；`activateCanvas` 在容器第一次被展示
（重启后 order 为空）时用恢复的树序播种。不持久化：重启后以恢复布局的树序为准。

## 2. 验收证据

`titles.test.ts`（store 层，走真实的 `setLayout`/`removeSheet` 路径）：

- 关闭第一个 sheet（`setLayout(removeSheet(...))`）后 `sheetOrder` 剪掉它，
  容器标题变成第二个 sheet 的（Alpha → Beta）。
- 终端的 OSC 标题进入 `terminalInfo` 后容器标题跟随（`Claude Code` →
  `fix the failing test`）。
- 浏览器页标题优先，无标题时用地址（`Example Domain` → `example.org/next`）。
- 打开顺序按创建序记账（先开 s2 再开 s1，order 是 `[s2, s1]`，不随 tab 顺序）；
  全部关闭后回退到 captain 名/目录。

受新规则影响的既有用例更新：`browser.ui.test.tsx`（容器由它的浏览器页命名，
改用 `tab-close-{id}` 关掉空白页而不是按标题点页签，避免与侧栏行的同名歧义）、
`hero-terminals.ui.test.tsx`（归档按钮的标签随 S2 变成终端的标题）、
`switch.test.tsx` 覆盖的"未命名容器仍显示目录名"由回退规则保证（titles.test 里断言）。

## 3. 门禁

| 门禁 | 结果 |
|---|---|
| `nsh check .` | ✓ |
| `cargo check --all-targets` | ✓ |
| `nsh test .` | ✓ 249/249（连跑 4 次，见下） |
| `script/bundle-mac.sh` | ✓ 见 §2.1 完成记录 |

## 4. 已知边界

- `sheetOrder` 不持久化：重启后容器标题来自恢复布局的树序，可能与创建序不同
  （布局保存的就是用户最后排列的样子）。
- 「文件/更改/历史/问题」等固定标题 sheet 成为最早 sheet 时，容器以它们命名
  （如 `文件 · tmp`）——这是规则的自然结果，不是特判。
- 供应商侧的偶发：`engine.test.ts` 的 steer 用例在本机连续跑全量时偶发
  "turn ended without a first token"（免费档模型限流的表现；失败信息现在带
  会话行、错误与事件，不再是 `false !== true`）。C5 的确定性等待会继续收敛。
