# 计划

> 唯一执行指导。架构见 [architecture.md](architecture.md)，扩展机制见
> [sheet-module-ARCHITECTURE.md](sheet-module-ARCHITECTURE.md)，Pi 的目标实现见
> [pi-acp-IMPLEMENTATION.md](pi-acp-IMPLEMENTATION.md)，决策见 [decisions.md](decisions.md)。
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
| Pi × ACP 会话运行时 | A0–F0 落地：一会话一持久 `pi-acp`、config/mode/resume/close、usage/commands/info/compaction、permission/elicitation、扩展 UI、子代理 `_zu/subagents/*`、sheet/容器/退出生命周期；协议/宿主测试补齐 |

门禁：`nsh check app` ✓、`check-layers` ✓、`nsh test app` 219 用例 211 通过 / 8 skip、
`pi-harness bun test` 41 ✓、`bun run smoke` ✓、`script/bundle-mac.sh` ✓。

真机 live 验收已完成（2026-11-13，`pi-harness/scripts/acp-live-acceptance.ts`，记录见
[evidence/pi-acp-live-2026-11-13.md](evidence/pi-acp-live-2026-11-13.md)）。剩余只有发布前的打包真机启动。

下一批是**打包产物真机启动**，不再有结构性迁移。

## 1. sheet 模块化（已完成）

契约与目标见 [sheet-module-ARCHITECTURE.md](sheet-module-ARCHITECTURE.md)。落地结果：

| 阶段 | 产出 | 证据 |
|---|---|---|
| S0 | `contracts/module.ts`、`app/core/registry.ts`、`registerModule/startModules`；home/browser 先注册 | `sheet-modules.test.tsx`；`check-layers.mjs` |
| S1 | `app/domains/`（fs/git/lsp/pty/state/pimodels/acp/manox/picker/instance）；`zu/native` 只在此出现 | `check-layers.mjs` 零违例 |
| S2 | files/git/terminal/problems 模块化；`canvas/sheets.tsx` 只剩 registry 查找 + 未知占位 | `nsh test app` 全绿 |
| S3 | pi/manox 模块化；容器去 `kind`/`sessions`；通知按 sheet id；旧 wire 与 `pi-engine` 删除 | 同上；pi-harness 36 单测、manox 门禁绿 |

## 2. Pi × ACP 集成（已完成）

实现记录：[pi-acp-IMPLEMENTATION.md](pi-acp-IMPLEMENTATION.md)（Q108）。

| 包 | 内容 | 状态 |
|---|---|---|
| A0 | `AcpHost`：一会话一持久进程、崩溃/resume、sheet/容器/退出生命周期（无 cap/TTL） | ✅ |
| B0 | stable v1 会话语义面：config/mode、resume/close、usage/commands/info/compaction/notice | ✅ |
| C0 | `SessionView` 收口；删 env/静态斜杆/假不可用/旧 transport | ✅ |
| D0 | permission + elicitation + 扩展 UI + 审批卡/对话框 | ✅ |
| E0 | dispatch 扩展 + `_zu/subagents/*` + 持久索引 + 名册 | ✅ |
| F0 | 协议/宿主/UI 测试、死代码删除、文档销账、真机 live 验收 | ✅ |

**真机 live 验收（2026-11-13）**：真实模型切换、档位 `high` + resume 保留、`/compact`
151k→46k、审批放行/拒绝、扩展 confirm/select/input、子代理 settle/abort/重启读转录、SIGKILL 后
resume、进程收尾、冷启动/首 token/RSS 记录。详见
[evidence/pi-acp-live-2026-11-13.md](evidence/pi-acp-live-2026-11-13.md)。

仍需发布前做：**G4 打包产物真机启动/真实 turn**（脚本已绿，GUI 未手点）。容器归档/退出 app 的
GUI 菜单未逐一手动驱动；它们调用已实测的 `closeContainerSessions`/`closeAllSessions`。

**G4（打包真机冒烟）** 不依赖本设计，留在发布清单：脚本已绿，真机启动未验。

**已归档**：legacy engine wire、扩展 UI 桥、子代理 dispatch 数据面、会话内模型/思考/压缩的旧通道
（Q107）；它们已在 A0–F0 以新形态回来。

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

- **权威链**：`architecture.md`（当前形态）→ `sheet-module-ARCHITECTURE.md`（扩展机制）→
  `pi-acp-IMPLEMENTATION.md`（Pi 实现与验收）→ `pi-acp-PROTOCOL.md`（协议映射/历史）→
  `DESIGN.md`（视觉）→ `decisions.md`（裁决）→ 本文件（执行）。
- **状态锚点**：只有本文件 §0 与 `architecture.md` §7 写「已完成/待做」；其他文档不复制状态。
- **证据可再生**：`docs/evidence/` 只放验证产物（截图、实测输出），不写过程叙事；历史在 git。
- **决策先行**：改架构先改 `decisions.md` 与对应架构文档，再改代码。
