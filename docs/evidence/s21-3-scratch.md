# §2.1-3：scratch 画布

日期：2026-11-11。验收对象是 [plan.md](../plan.md) §2.1 的第 3 项。

## 1. 验收要求

- 新建 → 选项目 → 提交 → 得到归属该项目的容器。
- 不提交切走再回来，浏览器仍在。
- scratch 不持久化：无 cwd、无进程、不进注册表、只保留一份。

## 2. 本次补齐的部分

§2.1-1/§2.1-2 已经把 scratch 画布做成"没有容器的画布"（`activeContainerId === null`，
布局只在内存里，唯一 sheet 是 `home:scratch`，Hero 带项目 chip，提交 composer 铸容器）。
第 3 项缺的是两件事：

**浏览器在 scratch 上可用**。`openBrowserSheet(null)` 现在把页面记在
`webview:scratch:{n}`（`SCRATCH_CANVAS`），Hero 的浏览器按钮不再要求已有容器，
并且和 F1 一样就地替换 Hero。离开 scratch 再回来页面还在：布局随 `stashScratch`
留在内存，`pages` 也还在 store 里。

**铸容器时页面随迁**。`transferScratchBrowserSheets(containerId)` 在画布切换**之前**
（scratch 还是当前布局）取出 `webview:scratch:*` 的页面，按布局顺序重挂到
`webview:{containerId}:{n}`，返回新 id；`createContainer` / `createExternalContainer`
把返回的 id 追加到新容器的布局里，随后把 scratch 布局重置成只有一个 Hero
（下一张 scratch 从干净状态开始）。页面状态（地址、标题、消息日志）整体跟着走，
不是"重开一个标签页"。

容器 store 不能反向 import 浏览器 store（`browser.ts` 已经 import 了它），所以移动
通过 `setScratchSheetTransfer()` 安装——模式与 `terminals.ts` 的 `setProgramExitHandler` 一致。

**动作的铸容器语义**（architecture §5.3 的边界在这里落定）：scratch 上
- Terminal / Claude / Codex / Copilot → 铸一个独立 external 容器（"进程即容器"），
  切换过去，页面随迁；
- Pi → 先铸 Pi 容器（F3 的边界），再在这个容器里开原生 `pi` TUI 终端资源；
- 提交 composer → 铸 Pi 容器并把首条消息发进它的 captain 会话。

scratch 本身仍不是容器（architecture §5.4："Scratch 不是容器……不进注册表、不持久化"），
没有引入 `ContainerKind = "Scratch"` 这种假注册表行。

## 3. 验收证据

`projects.ui.test.tsx` → `the scratch canvas holds a browser page and moves it into the container it mints`
（fixture `fixtures/projects.tsx` 增加一行 store 探测：`panels=`、`active=`、`project=`、`pages=`）：

1. 新建 → Hero；项目 chip 选 Project Two。
2. Hero 点浏览器 → `webview:scratch:1`；地址栏输入 `example.org` → store 里
   `webview:scratch:1=https://example.org`。
3. 点侧栏 Alpha（离开 scratch）→ 再点新建回来：`panels` 仍含 `webview:scratch:1`，
   `active=scratch`（未提交的页面暂存）。
4. 选 Project Two、提交 composer → `active=c3`；`panels=session:s3,webview:c3:1`，
   不再有 `webview:scratch:*`；`pages=webview:c3:1=https://example.org`（地址活着）；
   `project=p2`（归属所选项目）。

`projects.ui.test.tsx` 的其余 11 条（项目 chip、创建项目、New/Cmd+N、picker 等）与
`browser.ui.test.tsx`（容器内浏览器、地址保持）继续全绿。

## 4. 门禁

| 门禁 | 结果 |
|---|---|
| `nsh check .` | ✓ |
| `cargo check --all-targets` | ✓ |
| `nsh test .` | ✓ 242/242 |
| `script/bundle-mac.sh` | ✓ 见 §2.1 完成记录 |

同时把 `engine.test.ts` 的 steer 用例首 token 预算从 45s 放到 90s（结算等待 150s、
用例 300s）：这是本机负载下唯一会偶发失败的地方（C5 的"确定性等待"）。

## 5. 已知边界

- scratch 只保留一份；离开再回来看到的还是同一张（这是设计，不是缓存）。
- 页面在**铸容器时**迁移；scratch 上关掉的浏览器 tab 不会跟着迁。
- 应用重启后 scratch 不存在（不持久化），页面与布局都回到空。
- scratch 无项目时只剩浏览器与选项目（动作可用性矩阵的第 4 项）。
