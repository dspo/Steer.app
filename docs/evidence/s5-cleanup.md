# §5：代码仓库整洁化（C1–C7）

日期：2026-11-12。验收对象是 [plan.md](../plan.md) §5 的七条轨道。每类移动独立成提交，随时可回绿。

## 提交与内容

| 轨道 | 提交 | 内容 |
|---|---|---|
| C1 | `9b72b82` | 导出审计：12 个零调用符号删除（`containerCount`、`nextSheetId`、`TOOLBAR_KINDS`、`Logo`、`SectionTitle` 等），约 60 个模块内部符号收回 `export`；364 个 i18n 键全部有引用；注释无旧路径残留 |
| C3 | `a4ed5d1` | `launcher.tsx`→`hero.tsx`，`launcher-*` test id、`app.launcher.*` 键、`K` 表分组、`LauncherTool`→`HeroTool`，DESIGN/architecture 的现役行改用 Hero（里程碑史保留当时措辞） |
| C7 | `f76bb55` | `cargo fmt` 全绿；clippy 实用项修复（6 处 let-chain 折叠、2 处多余 return），`--all-targets` 零告警；四个 native 模块的 `//!` 文档列全错误码（权威在定义处），architecture §3.6 只留索引 |
| C4 | `d8e1570` + `0a21630` | 会话命名判定收敛到 `sessionHasName`（titles 不再两处比对 id 前缀）；五个工作区 sheet opener（editor/diff/changes/history/problems）补 `noteSheetOpened`——此前最先打开它们时容器标题静默失灵，`titles.test` 新增用例钉住；终端标题的 folder 后缀与容器标题 fallback 统一走 `fs.baseName`；画布关闭规则归一（每 tab 可关，Q69）；claude/codex/copilot 三个死 sheet kind 及其 6 个键删除；`sheetTitle` 的 files/changes/history 分支读自己定义的 SPECS |
| C5 | `fc9e8dd` + steer 收尾提交 | 两处固定 sleep（startup 1.5s、container-hero 2s）删除，各自连跑 3 次绿；steer live 用例三层加固：①搁浅回合重试一次；②计数回合从 400 行降到 100 行（steer 在首个 token 一到就落，窗口足够）；③**根因修复**——session jsonl 的 `stop: error` 空回合暴露出 fresh sidecar 的默认模型按 auth 解析顺序竞速（Q24 的 last-used），可能落到本机凭证已坏的 provider（gpt-6.1-sol，instant error）；用例现在显式 `session.setModel` 钉住 catalog 里的 qwen3.8-flash（用户在菜单里选一次的等价物），被测的是 steer 语义不是默认模型抽奖 |
| C2 | `5335034`、`2142c72`、`a74abe0`、`ea0bef6`、`1b3237d` | 五批移动：`ui/`（8 模块 + locales）→ `stores/`（21）→ `canvas/`（3）→ `sheets/`（9，含 project-roots）→ `shell/`（3）；`App.tsx` 留在根（nsh 的入口锚点：`nsh check .`、测试的 `open("./App.tsx")`、打包都按根解析）；`tray.svg` 资产 import 随导入者改 `../assets/`。每批独立提交、`nsh check` + 相关套件绿后前进 |
| C6 | 随 §2.3-16（`d954393`）与本批 | 全部 docs 链接检查通过（docs/*.md、evidence/*.md、README）；decisions 区间改 Q1–Q95；`docs/research` 入档并在 README/architecture 的文档表挂索引；§8.16 的模型 P0 标记已解决；DESIGN §3.4 与 architecture 字体行改为 `assets!()` 机制 |

## 验收对照

- **C1**：`nsh check`/`nsh build` 无告警（bundler 的未用导出提示为零）；导出清单逐项有调用方。
- **C2**：五批各可编译、各自套件绿；README 代码地图按层重写并与目录一致。
- **C3**：`grep -rn "launcher" --include="*.ts(x)"` 除测试里用户输入的字符串外为零；代码、i18n、DESIGN/architecture 同一套术语。
- **C4**：审计（8 项发现）中低风险项全部落地；zoom 的 16ms 舞步与 scratch 布局镜像两处**有意保留**（时序敏感，重写风险大于收益），在此记为已知镜像。
- **C5**：测试文件中剩余的 `sleep` 全部是带超时的轮询循环；全量连跑见下。
- **C6**：链接检查零断链；状态数字与最近门禁一致。
- **C7**：`cargo fmt --check` 干净、clippy 零告警、错误码有表（索引 + 模块权威）、Rust 死代码零 `#[allow]`；engine 侧导出全有调用方。

## 门禁

`nsh check` ✓、`nsh build` ✓（打包器零告警）、`cargo check --all-targets` ✓（零告警）、
`script/bundle-mac.sh` ✓（133M app / 53M dmg，字体在包内）。
C5 的验收「全量连跑 3 次全绿」：修复默认模型竞速后 **3 连跑全绿**（265/265，2m22s / 2m26s / 2m24s，
2026-11-12）。此前 6 次全量中 steer 用例 4 次搁浅，即上表 C5 的第三层加固的由来。

## 已知边界

- zoom 还原的 `applyZoom` 16ms 定时与 `scratchLayout` 平行信号是仅存的两处镜像状态（时序敏感，测试网已密；
  重写需要 dock/containers 的布局协议级改动，超出"整洁化不改行为"的边界）。
- steer 用例的重试上限两次（180s + 120s），供应商持续无输出时仍会失败——这是诚实的失败，不是测试缺陷。
