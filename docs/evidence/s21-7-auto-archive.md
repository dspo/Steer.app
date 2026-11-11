# §2.1-7：无 sheet 自动归档（含 Hero）

日期：2026-11-12。验收对象是 [plan.md](../plan.md) §2.1 的第 7 项。

## 1. 交付

**关闭路径**：nsh 的 tab × 关不掉组里最后一个 tab，所以 shell 的 `renderTab`
现在对每个 tab 都画自己的 ×（`tab-close-{panel}`）——最后一个 Hero、最后一个 Pi
会话因此可关。这是这条路径可达的前提。

**自动归档（Q69）**：`setLayout` 在容器画布空了（`sheetCount === 0`）时自动
`archiveContainer(id)`——不需要第二条命令。归档自己完成后续：切到引擎给出的
下一个容器（按活跃度，没有则进 scratch）、结束该容器的全部终端与 LSP。scratch
画布不参与（它不是容器）。external 容器因此有了完整的生命周期：进程退出 →
sheet 关闭 → 容器归档（"进程即容器"走完最后一公里；`external.ui` 的退出用例
改为断言归档）。

**侧栏退场（DESIGN §3.8）**：归档提交前调用
`LayoutAnimation.configureNext(LayoutAnimation.create(180))`——删除行由平台原生
动画播放（行淡出、同组其余行平滑上移），不再用自制的 wrapper（nsh 的 style
不支持 `transitionProperty: "height, opacity"`，原生 LayoutAnimation 正是
DESIGN 点名的方式）。

## 2. 验收证据

- `auto-archive.ui.test.tsx`（fixture `fixtures/auto-archive.tsx`：一个 Pi 容器，
  画布是会话 sheet + Hero）：先关 Hero 的 ×、再关会话的 ×（最后一个 tab 可关），
  断言 transport 收到 `container.archive:c1`、`rows=0`、画布落到 scratch 的
  Hero、行标题从侧栏消失。
- `containers.test.ts`（live 引擎）：shell 的 `createContainer` 建容器 →
  `closeSheet` 关掉唯一 sheet → 轮询 `container.list` 直到 `archived: true`，
  且 `activeContainerId` 已离开该容器——**引擎侧归档**由这条用例证明。
- `external.ui.test.tsx`："a terminal's own exit archives its container"——TUI
  进程自己退出 → sheet 关闭 → 容器归档、画布到 scratch Hero。

## 3. 门禁

| 门禁 | 结果 |
|---|---|
| `nsh check .` | ✓ |
| `cargo check --all-targets` | ✓ |
| `nsh test .` | ✓ 252/252（250/250、251/251 + 本批新增） |
| `script/bundle-mac.sh` | ✓（Zu.app 133M / Zu.dmg 52M） |

## 4. 已知边界

- 关掉最后一个 Hero 也归档容器：Hero 是 sheet，× 之后容器没有任何东西，这是
  Q69 的定义。想再开始就 ⌘N（scratch）或侧栏项目行的 `+`。
- 布局文件在归档前可能写入一棵空树（`scheduleSave` 在归档前触发一次）；
  unarchive 恢复的是空布局，首次展示播种 Hero（`openScratch`/空态的
  `empty-open-hero` 都能回到工作状态）。
- headless 的原生 LayoutAnimation 无法逐帧断言；用例断言归档调用、行消失与
  画布切换，动画本身由平台播放。
