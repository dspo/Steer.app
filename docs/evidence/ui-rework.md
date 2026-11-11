# 2026-11-11 目视验收返工

对照 [目视验收.md](../目视验收.md) 的返工记录。代码提交：`92c82e0`（引擎/顶栏/侧栏）、
`e6f5b9e`（起始页/对话/composer）。本文只记录实际跑过的验证。

## 门禁

- `nsh check .` ✓
- `nsh build .` ✓（1 asset）
- `cargo check --all-targets` ✓、`cargo test --lib` 47/47
- 全量 `nsh test .` **198/198**，隔离 `ZU_PORT=47840` / `ZU_STATE_DIR=/tmp/zu-chat-final-*`
- 引擎专项：`engine.test.ts` 15/15（含 ephemeral port、start 期间排队、reconnect 排队、
  session.info model/context、start failure 清理）；`engine.test.ts` 在 `env -u ZU_PORT` 下
  另跑一次，断言实际端口不是 47823。

## 截图

- `docs/evidence/ui1-titlebar-sidebar.png`、`ui1-session-picker.png`
- `docs/evidence/ui5-hero-{light,dark}.png`、`ui5-stream-{light,dark}.png`、
  `ui5-launcher-{light,narrow}.png`

## 真实 vs 未验证

已真实验证：真实 macOS 窗口截图（1200×800，light/dark；launcher 900×600）；容器 press 切换
（`containers.ui.test` 点两个容器，断言 alpha/beta 画布互换）；标题栏 picker 的过滤/排序/上限
（真实 registry）；VS Code URL 生成与 `openUrl` 调用（headless `app.openedUrls()`）；
`session.info` 的 model/thinking/context 真实 rust 引擎数据（engine.test）；composer 的
发送/停止/排队/引导/打断在 seeded fixture 中触发对应 store 方法。

未验证：真实模型回合（无凭据）；真实的 `session.steer`/`followUp` wire 回执与队列 UI；长历史
虚拟化（当前 `Scroll`+`Each`）；托盘/系统通知/真实 updater 安装（M12 既有差距）。


## 2026-11-11 需求清单 01 收尾

- 进一版 `nsh test .` **220/220**，`cargo test --lib` 52/52，`nsh build .` 1 asset。
- 顶栏 36pt、去掉底部状态栏；SessionContainer picker 30/32pt；引擎/语言/刷新/停止进 overflow。
- 起始页：两级 Providers→Models、Enter/⌘↩ 发送、Shift+↩ 换行、无「开始」；Finder `osascript choose folder` 选根（native Picker），侧栏建项目入口移除。
- 工具两行：终端/浏览器 + Claude Code/Codex/GitHub Copilot/Pi；无「外部终端」「TUI」。
- 容器归属创建后固定；拖拽/换项目菜单与 `project.setMembership` 删除。tab 统一 144pt、悬浮关闭；TUI 自行退出关 tab；panel content `overflow-hidden` 不再画到邻 panel；VS Code `windowId=_blank`。
- 仍有肉眼复核项：真实 Finder 对话框（headless 未启动）、面板拖拽分隔线观感、复杂 Markdown 在超长虚拟列表回收行中的表现。
