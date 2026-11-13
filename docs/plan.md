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
| sheet 模块化 | S0–S3 全部落地（`contracts/module.ts`、`app/core/registry.ts`、`app/domains/`、`app/modules/`、容器去 harness 身份、通知按 sheet id、旧 wire 删除）；门禁 215 用例 207 通过 / 8 skip |

下一批是产品打磨（见 §2 的剩余项），不再有结构性迁移。

## 1. sheet 模块化（已完成）

契约与目标见 [sheet-module-ARCHITECTURE.md](sheet-module-ARCHITECTURE.md)。落地结果：

| 阶段 | 产出 | 证据 |
|---|---|---|
| S0 | `contracts/module.ts`、`app/core/registry.ts`、`registerModule/startModules`；home/browser 先注册 | `sheet-modules.test.tsx`；`check-layers.mjs` |
| S1 | `app/domains/`（fs/git/lsp/pty/state/pimodels/acp/manox/picker/instance）；`zu/native` 只在此出现 | `check-layers.mjs` 零违例 |
| S2 | files/git/terminal/problems 模块化；`canvas/sheets.tsx` 只剩 registry 查找 + 未知占位 | `nsh test app` 全绿 |
| S3 | pi/manox 模块化；容器去 `kind`/`sessions`；通知按 sheet id；旧 wire 与 `pi-engine` 删除 | 同上；pi-harness 36 单测、manox 门禁绿 |

## 2. 遗留能力项（架构落地之外，已归档）

这些不是 sheet 模块化的缺口——S0–S3 的验收与它们无关；它们是 P4 删除 legacy engine 后的能力面，
按「下一个产品批次」归档，不阻塞本次交付：

| # | 问题 | 现状与原因 | 后继条件 |
|---|---|---|---|
| G1 | ACP 的审批与扩展 UI | 旧引擎的 `bindExtensions`/扩展 UI 桥随 P4 删除；ACP 映射尚未覆盖 `session/request_permission` | ACP 权限卡阶段；在那之前不声称扩展 UI 可用 |
| G2 | 会话内模型/effort/压缩 | ACP 未映射 `/model`、`/thinking`、`/compact`；Hero 的首次选择已生效（Q104），UI 对三条命令给明确提示 | distro 补齐 modes/setModel/compact 或 x-zu 等价方法 |
| G3 | 子代理数据面 | 旧 `dispatch` 扩展随 legacy engine 删除；ACP 无 dispatch（P5 generic agents），名册显示不可用 | P5 或把名册入口从产品面移除 |
| G4 | 打包产物真机启动 | `script/bundle-mac.sh` 已绿、`Helpers` 含 `pi-acp`；未在打包后的 app 里跑一轮真实 turn | 发布前的真机冒烟 |

**本轮移除并归档**：legacy engine wire（`contracts/protocol.*`、`stores/engine.ts`、`pi-engine`）、
扩展 UI 桥、子代理 dispatch 数据面、会话内模型/思考/压缩的旧通道。决策见 Q107。

## 3. 挂起 / 不做

- **M13 签名与公证**：需要 Developer ID 账号。
- **归档容器的恢复入口**：按 Q34 暂不提供 UI。
- **托盘点击、真实通知投递、真实更新安装、第二进程实拦**：需签名 bundle 与真机，未验证。
- **manox 的扩展产品面**：Steer 式审批瀑布、draft、compact、fetchTurns、模型切换、workspaces 同步等，
  按「能对话」边界不做（范围裁决见 [sheet-module-ARCHITECTURE.md](sheet-module-ARCHITECTURE.md) §8）。
- **B2 markdown 偶发纯文本**：现场已丢失，保留样本后再修。

## 4. 门禁

```sh
nsh check app                                   # crate check + TSX typecheck（crate 在 native/）
(cd native && cargo check --all-targets)        # 必须
nsh test app                                    # 全量（ZU_SKIP_LIVE=1 跳过 live 模型/LSP）
ZU_MANOX_GATE=1 nsh test app/manox.test.ts      # manox 折叠对账/panic 恢复（hermetic）
MANOX_RUN_LIVE=1 ZU_MANOX_GATE=1 nsh test app/manox.test.ts   # 真内核 live turn（可选）
ZU_MANOX_GATE=1 nsh test app/manox.ui.test.tsx  # manox sheet 门禁
node script/check-layers.mjs                    # 依赖门禁（模块/域/主干）
script/bundle-mac.sh                            # 打包冒烟（Helpers/pi-acp 断言）
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
