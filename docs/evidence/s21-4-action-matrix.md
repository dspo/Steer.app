# §2.1-4：动作可用性矩阵

日期：2026-11-11。验收对象是 [plan.md](../plan.md) §2.1 的第 4 项。

## 1. 交付

**DESIGN §4.1**（[DESIGN.md](../DESIGN.md)）新增矩阵：三种画布上下文
（容器内 / scratch + 项目 / scratch 无项目）× 六类动作（浏览器、终端与各 TUI、
Pi、composer、文件/更改/历史/问题、项目 chip），并写明容器内语义指回 §2.1.1。

代码随之对齐：

- 容器内：Hero 六个工具与顶栏 `⋯` 的五个 sheet 全部可用（原本如此）。
- scratch + 项目：Hero 的工具可用（浏览器开在 scratch，其余先铸容器）；
  顶栏「文件/更改/历史/问题」禁用——它们要一个容器；「浏览器」可用。
- scratch 无项目（chip 停在 Chats）：铸工作区的工具（终端/Claude/Codex/Copilot/Pi）
  禁用，只留浏览器与项目 chip；composer 仍可用（Chats 是合法的对话目标）。
  禁用不是隐藏：按钮留在原位（`opacity-40`），读屏与 tooltip 仍说明是哪个动作。

顶栏的「浏览器」也从"必须有容器"里放出来：scratch 上的浏览器页记在
`webview:scratch:{n}`，铸容器时随迁（§2.1-3）。

## 2. 验收证据

`projects.ui.test.tsx` 三条（fixture `fixtures/projects.tsx` 的真实 Workbench）：

- `a container's Hero and titlebar offer every action`：容器 Hero（tab bar 的 `+`）
  的终端/浏览器/Claude/Pi 全部 enabled；顶栏 `open-files`/`open-changes`/
  `open-history`/`open-problems`/`open-browser` 全部 enabled。
- `a scratch canvas with a project offers the actions but not the workspace sheets`：
  选 Project One 后 Hero 终端/浏览器/Pi enabled；顶栏四个工作区 sheet disabled、
  浏览器 enabled。
- `a scratch canvas without a project keeps the browser and the chip`：New 停在
  Chats 时浏览器与 chip enabled，终端/Claude/Pi disabled，顶栏文件 disabled。

既有用例按新规则调整（`external.ui.test.tsx`、`startup.test.tsx`）：它们要验
「scratch 的 Hero 拉起终端/TUI」，现在先建一个项目并从 chip 选中；`startup`
里每次 New 回到 scratch（target 重置为 Chats）后再选一次，这正是矩阵要表达的
状态切换。

## 3. 门禁

| 门禁 | 结果 |
|---|---|
| `nsh check .` | ✓ |
| `cargo check --all-targets` | ✓ |
| `nsh test .` | ✓ 245/245 |
| `script/bundle-mac.sh` | ✓ 见 §2.1 完成记录 |

## 4. 已知边界

- 矩阵只覆盖"能不能点"与"点了开在哪"；禁用原因的文案由 tooltip/读屏承担，
  界面上没有额外的说明行（Hero 只有一个提示行，留给 composer 快捷键）。
- `startup.test.tsx` 里的 steer 之外的 live 用例仍依赖真实模型；本机连续跑全量时
  「a steer reaches…」偶发在首 token 前超时（现在会打印会话行与错误，而不是
  `false !== true`），属于 C5「确定性等待」的范围，未在本项内改行为。
