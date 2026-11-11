# §2.2-11a：composer 的 pi 斜杆命令

日期：2026-11-12。验收对象是 [plan.md](../plan.md) §2.2 的 11a 项。映射表落在
[DESIGN.md](../DESIGN.md) §3.6 与 [architecture.md](../architecture.md)（§3 的
wire 表 + §4.3 的 composer 段）。

## 1. 交付

**新 wire 命令**（本地命令需要的两条腿）：
- `session.setThinking` `{ sessionId, level }` → pi 的 `setThinkingLevel()`；
  `thinking_level_changed` 事件原路把新档位推进 composer；
- `session.compact` `{ sessionId, instructions? }` → pi 的 `compact()`；
  进度走既有的 `compaction.*` 事件；streaming 中拒绝（`session_busy`）。

**`slash.ts`**：映射表（local / prompt / unsupported 三类）+ 候选过滤 +
`runSlash`。本地命令：`/model`（`openModelMenuRequest` 信号 → ModelPicker 打开）、
`/thinking`（档位循环，off→minimal→…→max→off）、`/compact`、`/clear`
（清空本地视图，文件保留）、`/new`（scratch 的 Hero）、`/resume`
（shell 安装的钩子：开侧栏 + 打开其会话搜索）。pi 交互独占的命令
（`/help` `/login` `/quit` `/settings` `/export` `/import` `/fork` `/clone`
`/session` `/tree` `/name` `/reload` `/trust` `/share` `/copy` `/bug`
`/hotkeys` `/changelog`）给出一句明确提示；其余按原文进 `session.prompt`
（pi 的扩展宿主执行扩展/模板/技能命令）。

**composer**：草稿以 `/` 开头时在输入框上方弹候选（命令 + 一句说明，随输入
过滤）；Enter 对 `/` 草稿执行命令而不是发送；不支持时显示
`session-slash-notice` 一行说明。与模型菜单不冲突（`/model` 就是开它），
与停止/排队不冲突（Enter 的排队车道在非 `/` 草稿上）。

**i18n**：`app.slash.*` 七条（双语）；`sessions.ts` 加
`setSessionTransport`（与 `setModelTransport` 同型的测试缝）。

## 2. 验收证据（每条映射一条测试，`slash.test.ts` 9 条）

| 映射 | 用例 |
|---|---|
| 候选列表 | `the popup lists the local commands filtered by the draft`（全表顺序 + `/co` 过滤） |
| `/model` | `/model asks the composer to open the model menu`（请求信号置为该会话） |
| `/thinking` | `/thinking cycles to the next level through the engine`（off→minimal→…→off，走 `session.setThinking`） |
| `/compact` | `/compact starts a manual compaction`（transport 收到 `session.compact`） |
| `/clear` | `/clear empties the local view and keeps the session's file`（消息清空、path 保留） |
| `/new` | `/new opens the scratch Hero`（画布到 scratch，`activeContainerId === null`） |
| `/resume` | `/resume asks the shell to open the sidebar's search`（钩子被调） |
| 不支持 | `pi's interactive commands answer with a reason, not a send`（五个交互命令全部拒绝且 transport 无 prompt） |
| 按原文 | `anything else is pi's own command: sent verbatim through the prompt`（`/review the diff`、`/deploy:2 now` 原样进 `session.prompt`） |

## 3. 门禁

| 门禁 | 结果 |
|---|---|
| `nsh check .` | ✓ |
| `cargo check --all-targets` | ✓ |
| `nsh test .` | ✓ 262/262 |
| `script/bundle-mac.sh` | ✓（本批动了引擎，重打后 Helpers 三件套在位） |

## 4. 已知边界

- 弹层不做键盘上下选（候选是可点行 + Enter 直跑草稿命令）；nsh Input 没有
  方向键拦截的公开缝，留给后续。
- 弹层只列 Zu 的本地命令；扩展/模板/技能命令不列但按原文可用（pi 的
  `getCommands` 是扩展宿主 API，列全要再走一条 wire 命令，挂账）。
- `/compact` 的进度以 `compaction.*` 事件呈现（既有通道）；"压缩中"的状态行
  属于 composer 的后续视觉批次。
