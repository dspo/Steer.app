# §2.3-14：品牌图标

日期：2026-11-12。验收对象是 [plan.md](../plan.md) §2.3 的第 14 项。

## 1. 交付

`brand-icons.tsx`：四个品牌标（Claude、Codex、Copilot、Pi）以 **填充路径** 落进
Canvas——Claude/Codex/Copilot 的 path 取自 manox-app 的
`agent-ui/assets/icons/{claude,codex,githubcopilot}.svg`，Pi 取自
`~/Downloads/pi-coding-agent.svg`（800 单位网格）。每个品牌带自己的
`viewBox` 与 `fill-rule`（copilot/claude 的 evenodd 保留）；`BrandIcon`
按 `size` 缩放、以 **纯色 tint**（默认 `muted-foreground`）填充——品牌色在
深浅两种外观下不可靠，单色 tint 两者都可读。

Hero 的工具行（`launcher.tsx`）：第二排 Claude Code / Codex / GitHub
Copilot / Pi 换成各自的品牌标（13pt，与 11.5pt 文字对齐）；第一排的终端与
浏览器保持轮廓 Glyph（它们是功能位，不是品牌）。

## 2. 验收证据

截图 `docs/evidence/ui-s23-14-brand-icons.png`（`--target macos`）：两排工具
图标与文字对齐，第二排是四个品牌标。`projects.ui` 的工具行用例（六枚
testID、行序）不变全绿；`nsh test .` 262/262（一次 steer 用例遇供应商慢
首 token，重跑全绿）；`nsh check` ✓、`cargo check --all-targets` ✓、
`script/bundle-mac.sh` ✓（133M / 52M）。

## 3. 已知边界

- 品牌标只在 Hero 的工具行（§2.3 的验收范围）；侧栏行与 tab 沿用轮廓 Glyph。
- 多色品牌版本（Claude 的橙、Copilot 的渐变）不属于本项——两种外观下的
  可读性优先。
