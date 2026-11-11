# §2.2-11：composer 仅交互

日期：2026-11-12。验收对象是 [plan.md](../plan.md) §2.2 的第 11 项与
[DESIGN.md](../DESIGN.md) §3.6。斜杆命令（11a）单独一批，见 §2.2-11a 的证据。

## 1. 交付（对照 DESIGN §3.6 的表）

| 项 | 之前 | 现在 |
|---|---|---|
| 分割线 | 面板整宽的 `border-t`（composer 外层容器画的） | **composer 自己的 hairline，恰好与 composer 同宽**（maxWidth 820 居中的 wrapper 画 `borderTopWidth: 1`），`ChatComposer` 新增 `hairline` 参数；Hero 的 composer 无线 |
| 布局 | 左簇（模型+context）/右簇（动作 lane） | **一行全部右对齐**：`模型 · thinking`、`context%`、（streaming 时）`⋯`、主按钮 |
| 主按钮 | idle=↑发送；streaming=■停止 + 排队/引导/打断三枚 chip | idle=↑发送；streaming=**■停止（同位置）**；排队/引导/打断收进 **`⋯` 菜单**（`id:session-more`），**可点无副作用**（`onSelect` 只关菜单，§2.2-11 的"不接线"） |

Enter 的车道不变：streaming 时 Enter = 排队（followUp），这条不在菜单里。

## 2. 验收证据

**三种状态各一张截图**（`--target macos`，`docs/evidence/`）：
- `ui-s22-11-idle.png`：一枚 ↑ 发送，无停止、无 `⋯`；
- `ui-s22-11-streaming.png`：■ 停止在发送的位置，右侧模型/思考/context 齐平，`⋯` 在停止左侧；
- `ui-s22-11-menu.png`：`⋯` 展开的排队/引导/打断。

**测试**（`chat.ui.test.tsx` 改两条）：
- streaming：停止常活、send 不在、`session-more` 在；打开菜单见到三条目；点
  `session-interrupt` 只关菜单——transcript 的 `id:user-message` 计数不变；
  Enter 仍走排队车道（计数 +1）。
- idle：一枚发送、无停止、无 `⋯`；输入后发送落进 transcript。
- 其余 4 条（Markdown/streaming caret/错误 quiet line/虚拟化）不受影响；
  全量 253 条绿。

## 3. 门禁

| 门禁 | 结果 |
|---|---|
| `nsh check .` | ✓ |
| `cargo check --all-targets` | ✓ |
| `nsh test .` | ✓ 253/253 |
| `script/bundle-mac.sh` | ✓（见 §2.2-9 批次；本批未动引擎） |

## 4. 已知边界

- `sessions.ts` 的 `steer`/`interrupt`（真实接线，引擎命令都在）暂时没有 UI
  调用方——按 §2.2-11"不接线"与 §3 挂账，等 `⋯` 菜单接线时恢复（pi 扩展或
  协议扩展是挂账条件）。
- 分割线只在会话的 composer 上；Hero（起始页）没有线，与 Steer 一致。
