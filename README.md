# Zu

**Zu**（祖冲之——纪念其对 π 的贡献）是 coding agent 的桌面工作台，TSX 写在 [NSH](https://nsh.dev) 上。
壳（项目侧栏、顶栏、页签条）包着一块 `DockArea` 画布，**panel** 持有可拖拽的 **sheet**：
会话（pi / manox）、终端与 TUI、浏览器、文件树、编辑器、Diff、Changes/History、Problems。
logo 为 Steer 的 `<->` 构型加载祖冲之密率（上 355、下 113）。

会话来源是两种 **harness**，地位相同：

- **pi**：轮级 ACP 子进程（`pi-harness/` 随 app 分发，精确 pin pi 1.5.0）；
- **manox**：进程内 AHP 宿主（`native/manox`，git pin manox v0.9.1）。

durable 权威都在磁盘（`~/.pi` 会话文件 / `~/.manox` journal），零活进程可读。
**目标架构**是把每个 sheet 内容都收成一个注册模块（`modules/<id>/`），壳只拥有
Project → Container → Sheet 的关系模型；契约与迁移见
[docs/sheet-module-ARCHITECTURE.md](docs/sheet-module-ARCHITECTURE.md)。

## 状态

状态只有一个锚点：**[docs/plan.md](docs/plan.md) §0**（已交付/待做）与
**[docs/architecture.md](docs/architecture.md) §7**（已知问题）。本文件不复制状态。

## 文档

| Doc | 内容 |
|---|---|
| [docs/sheet-module-ARCHITECTURE.md](docs/sheet-module-ARCHITECTURE.md) | sheet 模块契约、能力域、依赖门禁（S0–S3 已落地） |
| [docs/architecture.md](docs/architecture.md) | **当前**：约束、两条 harness、存储、native 域、对象模型、风险 |
| [docs/pi-acp-IMPLEMENTATION.md](docs/pi-acp-IMPLEMENTATION.md) | **设计稿（待审）**：Pi × ACP 的会话运行时、协议面、UI/UX 与 A0–F0 |
| [docs/pi-acp-PROTOCOL.md](docs/pi-acp-PROTOCOL.md) | pi 模块：ACP 协议映射与历史裁决（P0–P4，已冻结） |
| [docs/DESIGN.md](docs/DESIGN.md) | 视觉规格：token、外壳几何、表面、动效、各 sheet |
| [docs/decisions.md](docs/decisions.md) | 决策台账 Q1–Q107（问题 → 裁决 → 落点） |
| [docs/plan.md](docs/plan.md) | 执行计划：状态、批次、门禁 |
| [docs/evidence/](docs/evidence/) | 可再生的验证产物（截图、实测记录） |

## 代码地图

```
app/                 nsh 应用（nsh.json、App.tsx、测试与 fixtures）
  core/              关系模型：registry、containers、dock、projects、lifecycle、notifications、shell-actions
  shell/             工作台、侧栏、顶栏、生命周期与托盘、项目对话框、设置/搜索/更新
  canvas/            sheet 解析与容器标题、tab `+`
  domains/           能力型面（唯一 import zu/native 的地方）：fs、git、lsp、pty、state、acp、manox、picker…
  modules/           每个 sheet 内容的模块：home、browser、files、git、terminal、problems、pi、manox
  ui/                无状态原语、token、品牌图标、i18n
  assets/            托盘图标（TSX 资产）
native/              zu-native crate（Rust 能力域）
  src/               acp、fs、git、lsp、pty、instance、picker、pimodels、state
  manox/             独立 crate：manox 宿主半边 in-proc + 帧泵
  assets/fonts/      Lilex（随 crate）
pi-harness/          完整 pi 发行版：ACP 入口、内置扩展；bun 编译成 `dist/pi-acp`
contracts/           跨侧共享面：`module.ts`（模块契约）与 vendored AHP
script/              打包脚本与 `check-layers.mjs`（依赖门禁）
```

`app/nsh.json` 的 `"rust": ["../native", "../native/manox"]`；nsh 命令一律以 `app` 为应用目录。

## Run it

装好 [`nsh`](https://nsh.dev/docs/installation)（或 checkout 构建）后：

```sh
nsh run app --target macos   # AppKit 宿主
nsh run app --target web     # 浏览器
nsh check app                # crate check + TSX typecheck
nsh test app                 # 全量测试（ZU_SKIP_LIVE=1 跳过 live 模型/LSP）
```

改了 `pi-harness/src` 或 `native/` 后：

```sh
cd pi-harness && bun run build     # 产出 dist/pi-acp 与两个 WASM
cd pi-harness && bun run models:parity   # 与 pi --list-models 对比
node script/check-layers.mjs       # 依赖门禁（core/shell/domains/modules）
script/bundle-mac.sh               # 打包冒烟（Helpers/pi-acp）
```

完整门禁（含 manox 的 hermetic/live 两档）见 [docs/plan.md](docs/plan.md) §4。

## 文档治理

- **单一事实源**：架构进 `architecture.md`，Pi 的目标实现进 `pi-acp-IMPLEMENTATION.md`，裁决进
  `decisions.md`，执行进 `plan.md`，视觉进 `DESIGN.md`；同一事实不复制到两处。
- **状态锚点**：只有 `plan.md` §0 与 `architecture.md` §7 写「已完成/待做/已知问题」。
- **证据可再生**：`docs/evidence/` 只放验证产物（截图、实测输出、未验证项的记录），不写「我们如何走到这里」；
  过程叙事以 git 历史为准。
- **决策先行**：改架构先改台账与架构文档，再改代码。
- **版本台账**：pi 在 `pi-harness/package.json` 精确 pin（`check-version` 守）；manox 在
  `native/manox/Cargo.toml` 以 tag pin + `Cargo.lock` 锁定；nsh 在 `native/Cargo.toml` git pin `506b5392`（0.4.0）。
  任一侧升级都要跑完整门禁并在台账留记录。
