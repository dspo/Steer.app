# manox 对话：gallery 部件 — 截图（2026-11-16）

真实 macOS 宿主（从仓库根跑：`nsh test app/manox-conversation.ui.test.tsx --target macos`）：

- `ui-manox-chat-widgets.png` — 部件总览：思考折叠（折叠态标签 + 展开态 hairline 正文）、
  execute 工具卡（图标块 + 标题/详情 + 已完成 chip + `52 pass, 0 fail` + `输出 · exit 0`）、
  待审批工具卡（等待审批 chip + 拒绝/批准）、跨天日期分隔（`2026/11/16`）、错误行
  （`the provider refused the second request`）、每轮回复下的复制动作行、用户气泡。
- `ui-manox-chat-actions.png` — 复制动作按下后的 `已复制` 状态。

数据来源是 AHP 的 `ChatState`（vendored `contracts/ahp`）：行由 turn 与 `responseParts`
展平而来，`Turn.startedAt` 插日期行；没有 ACP、没有翻译层。工具卡的正文按
`ToolResultContent` 的类型渲染：text/terminal（preview + exitCode）/fileEdit（路径 +
+/- 统计）/subagent/resource。

**已知数据缺口**（AHP 没有，不猜）：思考耗时（`ReasoningResponsePart` 无时间戳，
落定后只显示「思考」）、工具耗时（`ToolCallResult` 无 duration；terminal 结果有 exitCode）、
重新生成/重试（chat 通道没有 retry/fork action）。

同一命令在 headless 的 run 是行为门禁（`ZU_SKIP_LIVE=1 nsh test app/manox-conversation.ui.test.tsx`，
5 用例）：思考折叠、工具卡（标题/状态/终端预览/退出码）、日期行、复制、跟随滚动。
真机额外断言「读者滚上去后增长不抢位置」（headless 的列表不虚拟化，该条只在真机成立）。
