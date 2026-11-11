# §2.1.1 F2 / F3：容器内的终端资源与原生 Pi TUI

日期：2026-11-11。验收对象是 [plan.md](../plan.md) §2.1.1 的 F2、F3。

## 1. 改动前的状态

F1 之后，容器 Hero 的每个动作仍然分两路：浏览器已经就地替换 Hero，但
Terminal / Claude / Codex / Copilot / Pi 仍按 M7 的旧模型走——Terminal 与各 TUI
`container.create` 出一个新的 external 容器（侧栏多一行）；Pi 则聚焦当前容器
的 Zu 会话 sheet（`showContainerSession`）。F2/F3 要把这两条都改成"在容器内"。

## 2. F2：终端是容器的资源

**模型**：一张终端 sheet 是 `terminal:{containerId}:{n}`（n 是该容器内递增的
资源号），PTY 按这个资源 id 存在 `terminals.ts`；`terminalResource()` 解析
容器 id 与序号（容器 id 自带冒号，所以序号只取最后一段；旧布局的
`terminal:{containerId}` 视为资源 1）。`terminalInfo`、`attach/detach`、
`bindTerminalRef`、`terminalSize`、`setTerminalTitle`、`closeTerminal` 都改成
按资源 id 记账。

**动作**：`openTerminalSheet(containerId, action, fromSheet?)` 分配下一个资源号、
记下这个资源跑什么（`shell` / `Pi` / `Claude` / `Codex` / `Copilot`），再
`replaceSheet` 把 Hero 换成它——F1 的"就地替换"继续成立。容器 Hero 的
Terminal/Claude/Codex/Copilot 都走这条；scratch 画布没有容器，仍按 §2.1-3
铸 external 容器（F2 的边界）。侧栏行数因此不变。

**归档**：`closeTerminalsOfContainer(id)` 结束该容器全部 PTY；顺序是先更新注册表
（`archived: true`）再杀进程——旧顺序下仍挂载的终端 sheet 会在一个渲染帧里
看到容器还活着，把刚结束的 PTY 重新拉起来。`TerminalBody` 另外拒绝为已归档的
容器开新 PTY。

**顺带修掉的真 bug**：`closeTerminal` 之后原生 PTY 仍会回调 exit，回调里
`publish()` 把刚删掉的 `terminalInfo` 条目写回去（表现为归档后 PTY 计数不减）。
现在读写回调先确认 handle 还是当前 map 里的那一个，否则丢弃。

## 3. F3：Pi 动作 = 原生 `pi` TUI

容器 Hero 的 Pi 不再走 `showContainerSession`，而是
`openTerminalSheet(containerId, "Pi")`——终端里跑原生 `pi` CLI。Zu 会话仍只由
composer / `session:{sessionId}` sheet 承担：Pi 动作不动 Zu 会话 sheet，只有提交
composer 才进入它。scratch 的 Pi 仍先铸 Pi 容器（第 3 项会改成按项目铸）。

## 4. 验收证据

`hero-terminals.ui.test.tsx`（fixture `fixtures/hero-terminals.tsx`：一个 Pi 容器、
一个 captain 会话、Hero 是唯一 sheet；fixture 把 store 读成一行探测文本，
断言的是 sheet id、侧栏行数与活着的 PTY 数）：

- **F2**：Hero 点 Terminal → 画布是 `terminal:c1:1`，Hero 的 tab 消失，侧栏仍是
  1 行；`+` 重开 Hero，点 Claude → 画布多出 `terminal:c1:2`，仍是 1 行、2 个 PTY，
  tab 标题 `Claude Code · tmp`；归档该容器 → PTY 数 0、侧栏 0 行。
- **F3**：Hero 点 Pi → 画布是 `terminal:c1:1`、标题 `Pi · tmp`，Zu 会话 sheet
  没有出现；随后用 composer 提交 → `session:s1` 出现在画布；再 `+` → Pi，画布
  同时有 `session:s1` 与 `terminal:c1:2`（会话 sheet 位置不变），PTY 2 个。

`terminals.test.ts` 覆盖 id 解析（含自带冒号的容器 id、旧 id、非终端 kind）与
每个 kind 的默认动作。回归：`terminal.ui.test.tsx`（真 PTY/vim/htop）、
`terminal.claude.test.tsx`（Claude TUI）、`external.ui.test.tsx`（scratch 仍铸
external 容器）、`containers.ui.test.tsx` 全绿。

## 5. 门禁

| 门禁 | 结果 |
|---|---|
| `nsh check .` | ✓ |
| `cargo check --all-targets` | ✓ |
| `nsh test .` | ✓ 241/241 |
| `script/bundle-mac.sh` | ✓（同一批次内跑过一次；见 §2.1.1 完成记录） |

## 6. 已知边界

- 应用重启后 PTY 本来就会重启；恢复的终端 sheet 没有"它跑什么"的记忆，按容器
  kind 取默认（external 容器重启它的 CLI，Pi 容器重启 shell）。动作只在本次运行
  里记住。
- Pi 容器里的 plain shell 自己退出时不关闭 sheet（保留 restart 入口），TUI 退出
  则连同 sheet 关闭；external 容器的终端退出一律关闭 sheet。
- `pi` TUI 在 PTY 里需要已登录的 pi；没有凭证时它自己显示登录提示，Zu 不拦。
