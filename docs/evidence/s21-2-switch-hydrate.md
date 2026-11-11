# §2.1-2：切容器必 hydrate、external 建后必切换画布（A1/B3）

日期：2026-11-11。工作树未提交（§2.1-1 已提交为 `a58e0ad`）。`nsh check` ✓、`cargo check --all-targets` ✓、
`nsh test` 233/233 ✓、`script/bundle-mac.sh` ✓。

## 验收

| 验收 | 证据 |
|---|---|
| 启动停在启动容器并显示其对话 | `startup.test.tsx` 第一条：A 先有一条用户消息，B 后建且 engine 的 active 被设回 A；`open` 后不点任何东西，`session-transcript` 出现且 `user-message` 计数 > 0 |
| Hero 页点 Pi / Claude Code / Codex / Copilot 进入对应 sheet | `startup.test.tsx` 第二条：scratch Hero 点 Pi → 会话 sheet（`session-hero`）；Claude/Codex/Copilot → `terminal-view`，标签是各自的 kind |
| 切容器必 hydrate | `container-hero.test.tsx` 改写：切到 A 等 `session-transcript`，切到空的 B 等 `session-hero`，再切回 A |
| 最新意图不被旧应答覆盖 | `switch.test.tsx`：启动 switch 未完成时点 A，等 engine 的 active 变成 A，并断言画布 tab 仍是 A 的会话（旧实现会被启动 switch 的迟到应答换回 B） |

## 改了什么

| 面 | 之前 | 之后 |
|---|---|---|
| 启动顺序 | `container.list` → `session.list`（全量扫盘）→ 切容器 → hydrate | `container.list` → 切容器（`container.show` + `layout.get` + hydrate）→ `session.list`。画布不再等全量会话索引 |
| 到达画布的路径 | switch / create / createExternal 各自写 `activeContainerId` + `layout` + `zoom` + `syncVisible` | 三处共用 `activateCanvas()`（同时 upsert 行），只有一条路径 |
| 画布意图 | 无序号，谁先返回谁生效 | 每次 switch / New / create / archive 取一个 ticket；慢的旧 ticket 在 `flushLayout`、`container.show`、`layout.get`、hydrate 之后检查，过期就不改画布 |
| archive 的后续切换 | 另起一次 switch（会拿到比"archive 期间的用户点击"更新的 ticket） | 沿用 archive 自己的 ticket，archive 期间的用户点击仍然赢 |

`switchContainer` 现在只负责拿票与早退，实际流程在私有的 `switchNow(id, ticket)`；archive 的"切到相邻容器"直接调用它。

## 过程中暴露与修正的两件事

1. **真实竞态**：启动 switch 尚未完成时侧栏已可点击。旧实现里启动 switch 的迟到应答会把画布换回启动容器，而用户点的那一行在 engine 里才是 active。ticket 规则修掉的就是这一类"错位"（A1/B3 的同类）。
2. **两条测试原先依赖时序**：`container-hero` 等的是侧栏文件夹标题，但容器的标签会随 session 视图载入从文件夹变成会话名；启动顺序一变，这个瞬时窗口就没了。现在等行 id / sheet id。`switch.test` 用固定 `sleep(800)` 读 engine 的 active；启动 hydrate 期间 shell 切容器前的 `layout.put` 可能排队约 1.3 s。现在轮询 active，并额外断言画布仍在被点的容器上。

启动顺序的收益在大会话库上最明显：`session.list` 要扫几百个文件，画布不应为它空等。

## 未做

- `container.show`/hydrate 的进度没有 UI 提示（画布先显示 sheet，会话内容随后出现）。
- 容器内 Hero 的动作语义不在本条：现在点浏览器会留下 Hero 与浏览器两个 tab，点终端/Claude 等会新建
  SessionContainer，Pi 动作聚焦 Zu 会话而不是原生 pi TUI。这三条是 §2.1.1 的 F1–F3。
- §2.1-3 起的 scratch 迁移、动作可用性矩阵不在本条。
