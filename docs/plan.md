# 计划

> 唯一执行指导。架构见 [architecture.md](architecture.md)，扩展机制的目标态见
> [sheet-module-ARCHITECTURE.md](sheet-module-ARCHITECTURE.md)，决策见 [decisions.md](decisions.md)。
> 已完成的工作不再逐批叙述——细节在 git 历史与测试里；本文件只保留**待做**与**门禁**。

## 0. 当前状态（2026-11-13）

已交付：

| 里程碑 | 内容 |
|---|---|
| M0–M12 | 地基、对话、契约与监督、容器与面板、项目与 Hero、子代理、轮廓、终端、编辑器、Git、浏览器、LSP、常驻/通知/更新 |
| Casing II | Hero sheet 化、容器标题、一体化外壳、侧栏拖拽、composer、斜杠命令、页签、Lilex |
| C8 | 三包布局：`app/` + `native/` + `pi-harness/`，`contracts/` 留根 |
| ACP cutover | P0–P3：distro ACP 入口、`zu/acp` 泵、注册表/布局写者反转、控制面切换（默认 ACP） |
| manox M1 | 真宿主 in-proc（manox v0.9.1）、panic 边界、折叠对账门禁、能对话回路 |

下一批只有一条主线：**sheet 模块化（S0–S3）**。它同时收掉「pi 是内置、其他是扩展」的耦合。

## 1. 主线：sheet 模块化

目标与契约见 [sheet-module-ARCHITECTURE.md](sheet-module-ARCHITECTURE.md)。每阶段独立验收、全量回绿；
行为不变优先于结构好看。

| 阶段 | 内容 | 验收 |
|---|---|---|
| **S0 门禁与契约** | `contracts/module.ts`；`core/registry` + `registerModule`；`home` 与 `browser` 先走新路径 | 依赖门禁上线；browser（零 native）跑通；全量测试绿 |
| **S1 域收口** | 拆 `app/domains/`；sheet 不再 import `zu/native` 的类型 | `zu/native` 只出现在 `domains/`；测试绿 |
| **S2 工作台模块化** | files/git/terminal/problems 搬成模块；删 `SheetKind` 闭集与壳侧分支 | `canvas/sheets.tsx` 只剩 registry + 未知 kind 占位 |
| **S3 harness 模块化** | pi/manox 搬成模块；容器去 `kind`/`sessions`；通知按 sheet id；删旧 wire（P4） | `App.tsx` 只 import 模块；壳零 harness 词汇；旧 wire 零残留 |

每阶段的迁移清单（现存违例即 checklist）在目标文档 §1。

## 2. 独立修复（可与主线并行）

| # | 问题 | 要点 | 验收 |
|---|---|---|---|
| F1 | 打包缺 `pi-acp` | `script/bundle-mac.sh` 只复制 `pi-engine`；ACP 默认路径需要 `Contents/Helpers/pi-acp` | 打包后 app 能跑一轮真实 pi turn；脚本断言两个入口都在 |
| F2 | ACP 的审批与扩展 UI | `session/request_permission` 与扩展 UI 桥在 ACP 映射里仍缺席 | agent 停下提问时能应答；至少一条 stub client 测试 |
| F3 | 模型/effort 的真源 | Hero 对两条 harness 都用 pi catalog；按模块贡献 picker | manox 用自己的 provider 集（或明确记录共用 pi 的裁决） |
| F4 | 旧 wire 的残留面 | `ZU_PI_TRANSPORT=engine` 仍可走；P4 未删 | 与 S3 同批删除，零残留 |

## 3. 挂起 / 不做

- **M13 签名与公证**：需要 Developer ID 账号。
- **归档容器的恢复入口**：按 Q34 暂不提供 UI。
- **托盘点击、真实通知投递、真实更新安装、第二进程实拦**：需签名 bundle 与真机，未验证。
- **manox 的扩展产品面**：Steer 式审批瀑布、draft、compact、fetchTurns、模型切换、workspaces 同步等，
  按「能对话」边界不做（原双 harness 设计 §4.4）。
- **B2 markdown 偶发纯文本**：现场已丢失，保留样本后再修。

## 4. 门禁

```sh
nsh check app                                   # crate check + TSX typecheck（crate 在 native/）
(cd native && cargo check --all-targets)        # 必须
nsh test app                                    # 全量（ZU_SKIP_LIVE=1 跳过 live 模型/LSP）
ZU_MANOX_GATE=1 nsh test app/manox.test.ts      # manox 折叠对账/panic 恢复（hermetic）
MANOX_RUN_LIVE=1 ZU_MANOX_GATE=1 nsh test app/manox.test.ts   # 真内核 live turn（可选）
ZU_MANOX_GATE=1 nsh test app/manox.ui.test.tsx  # manox sheet 门禁
script/bundle-mac.sh                            # 打包冒烟（含 Helpers 断言）
```

依赖门禁（S0 起成为 `nsh check` 的前置）：

1. `core/`、`shell/` 不 import `modules/`、`domains/`；
2. `modules/*` 之间零 import；
3. `zu/native` / `manox/native` 只出现在 `app/domains/`；
4. 未知 kind 渲染占位、不抛错。

每个阶段结束：全量绿 + 必要的截图（`docs/evidence/`）+ 本文状态更新。

## 5. 文档纪律

- **权威链**：`architecture.md`（当前形态）→ `sheet-module-ARCHITECTURE.md`（目标机制）→
  `pi-acp-ARCHITECTURE.md`（pi 协议）→ `DESIGN.md`（视觉）→ `decisions.md`（裁决）→ 本文件（执行）。
- **状态锚点**：只有本文件 §0 与 `architecture.md` §7 写「已完成/待做」；其他文档不复制状态。
- **证据可再生**：`docs/evidence/` 只放验证产物（截图、实测输出），不写过程叙事；历史在 git。
- **决策先行**：改架构先改 `decisions.md` 与对应架构文档，再改代码。
