# 计划

> 唯一的工作指导文档。已完成的部分给证据位置；未做的按批次给出任务与验收。

**当前进度（2026-11-11）**：`main` @ `6a0bcea`，门禁全绿（`nsh test` 220/220）。§2 的三批任务**均未动工**；
下一个动作是 §2.1 的第 1 项（Hero sheet 化）。开工前读：本文件 §2 → [architecture.md](architecture.md)
§4.2/§4.3/§5.4 → [DESIGN.md](DESIGN.md) §3 → [evidence/apis-verified.md](evidence/apis-verified.md)。
> 架构见 [architecture.md](architecture.md)，视觉规格见 [DESIGN.md](DESIGN.md)，决策台账见 [decisions.md](decisions.md)。

## 1. 已完成（M0–M12，证据在 evidence/）

| 里程碑 | 交付 | 证据 |
|---|---|---|
| M0 地基 | 双包结构（app + `engine/`）、mixed 模板、`zu/engine` 启停 sidecar、WS 握手、ad-hoc dmg | 本节 §5 |
| M1 对话 | 会话列表、转录（`TextView` 流式 Markdown）、工具卡、停止、引擎重启续聊 | `engine.test.ts` |
| M2 契约与监督 | `contracts/` v1、`state.snapshot` 重连、引擎心跳/退避重启、扩展宿主 UI 桥、i18n 键表 | `contracts.test.ts`、`ui-host.test.tsx` |
| M3 容器与面板 | 注册表、per-container layout/zoom、多会话、archive、sheet 节流 | `containers.test.ts`、`containers.ui.test.tsx` |
| M4 项目与 Launcher | 多根 Project、membership（创建时固定）、Finder 选目录、侧栏两级、虚拟化 | `projects.test.ts`、`projects.ui.test.tsx` |
| M5 子代理 | `dispatch` 门控、`runs[]`、名册、级联中断 | `subagents.test.ts` |
| M6 轮廓 Casing | 侧栏/顶栏/页签基础几何、token 化 | [DESIGN.md](DESIGN.md)、`evidence/ui-rework.md` |
| M7 终端 | `zu/pty`（portable-pty）、external 容器、vim/htop/Claude TUI 实测 | `pty.test.ts`、`terminal.*.test.tsx` |
| M8 文件与编辑器 | `zu/fs`、文件树、真 `Editor`、两文件 Diff | `fs.test.ts`、`files.ui.test.tsx` |
| M9 Git | `zu/git`（shell out）、Changes/History、stage/commit/checkout | `git.test.ts`、`git.ui.test.tsx` |
| M10 浏览器 | `WebView` sheet、地址栏、外开转当前 sheet | `browser.test.ts`、`evidence/m10-browser.md` |
| M11 LSP | `zu/lsp`、rust-analyzer / tsserver / gopls 实测、Problems、F12 | `lsp.test.ts`、`lsp.ui.test.tsx` |
| M12 常驻 | 单实例、关窗隐藏、托盘、通知、更新三态 | `lifecycle.*.test.tsx`、`updates.test.ts` |

**未做**：M13 签名与公证（需要 Developer ID）；M10 的 `target=_blank` 已改为当前 sheet 内导航（nsh 无新窗口回调）；M12 的托盘点击/真实通知投递/真实更新安装未端到端验证。

## 2. 下一批：Casing II 与 Hero sheet

三条结构性决策先行，其余条目都是它们的派生：

- **S1 取消页面状态，Hero 变 sheet**：删除 `launcherOpen`；`home:{containerId}`（容器内）与 `home:scratch`（临时画布）是 sheet kind；画布永远只渲染 sheet 树。
- **S2 容器由 sheet 序驱动**：容器记 `sheetOrder`（创建序），标题取"存活的最早创建者"，每个 sheet kind 提供动态标题。
- **S3 外壳一体化**：窗口一层底色（titlebar + 侧栏同材质无分隔），内容是一张内嵌的白色圆角卡片。

### 2.1 第 1 批：结构性（S1 + S2）

| # | 任务 | 要点 | 验收 |
|---|---|---|---|
| 1 | Hero sheet 化（S1） | `home:{containerId}` / `home:scratch`；删 `launcherOpen`；`empty()` 改为"画布无 sheet"；侧栏「新建」/⌘N 进 scratch；每个 panel 的 tab bar 最右加常驻 `+`，打开该 panel 的 Hero sheet（已存在则激活） | 启动、切容器、点 `+` 都只渲染 sheet；删 `launcherOpen` 后全量测试绿 |
| 2 | 修 A1/B3 | 切容器必 hydrate；external 容器创建后必切换画布；S1 落地后这类错位结构性消失 | 构建后启动停在启动容器并显示其对话；Hero 页点 Pi/Claude/Codex/Copilot 进入对应 TUI sheet |
| 3 | scratch 画布 | kind `Scratch`，不持久化；Hero 带项目 chip（选项目/Chats/新建项目）；提交 composer 或选动作后铸真实容器并切换；scratch 里开的浏览器 sheet 随容器迁移，未提交则暂存 | 新建 → 选项目 → 提交 → 得到归属该项目的容器；不提交切走再回来，浏览器仍在 |
| 4 | 动作可用性矩阵 | 见 [DESIGN.md](DESIGN.md) §4.1：容器内全可用；scratch+项目除"文件/更改/历史/问题"需先建容器外可用；scratch 无项目只剩浏览器与选项目 | 三种上下文各一条 UI 测试 |
| 5 | 容器标题（S2） | `sheetOrder` + 每 kind 的 `title()`：session=会话名（`appendSessionInfo` 可改）/terminal=OSC 标题/webview=页面 title/其余固定 | 关闭第一个 sheet 后第二个顶上来；Claude Code 改终端标题时容器标题跟着变 |
| 6 | 语言跟随系统 | 删语言按钮；启动读 `locale()`：`zh*`→zh-CN，其余→en | 系统中文显示中文，非中文显示英文 |
| 7 | 无 tab 自动归档（含 Hero） | 容器 `sheetCount === 0` → 切到相邻容器 → archive → 侧栏行 180ms 退场（高度+透明度） | 关掉包括 Hero 在内的全部 sheet 后容器消失且引擎侧 archived |

### 2.2 第 2 批：外壳与组合（S3）

| # | 任务 | 要点 | 验收 |
|---|---|---|---|
| 8 | 一体化外壳 | 全窗 `sidebar` 底；titlebar 40pt 无分隔线；侧栏无右边框；内容区白卡 `radius 14` + 四周 8–10pt；tab bar 融入卡片；composer 在卡片内左右 24 | 与 ZCode 截图并排，底色/圆角/间距/字号一致 |
| 9 | 侧栏可拖拽 | 侧栏与卡片间 4pt 热区，宽 200–360，持久化到 `zu/settings.json` | 拖拽即时生效，重启保持 |
| 10 | picker 三态 | 常态=纯文本标题（无框无底）；hover=凹槽（`bg-inset` + inset 阴影 + radius 6）；展开=下拉从凹槽下沿接出；宽度 360pt | 与截图一致 |
| 11 | composer（仅交互） | 分割线只与 composer 同宽；模型/thinking/context 右对齐；idle=↑发送、streaming=■停止（同位置）；排队/引导/打断收进 `⋯` 菜单（不接线） | 三种状态各一条截图；`⋯` 项可点但无副作用 |
| 12 | 红绿灯 | 原生比例：直径 12、间距 8、左边距 16、垂直居中 | 与原生窗口并排看不出差异 |
| 13 | tab 宽度 Chrome 式 | `maxWidth 240`、`minWidth 72`、`flexShrink 1`、`flexGrow 0`；标题截断 | panel 变窄或 tab 增多时被均匀挤压 |

### 2.3 第 3 批：细节

| # | 任务 | 要点 | 验收 |
|---|---|---|---|
| 14 | 品牌图标 | Claude/Codex/Copilot 取自 `manox-app/crates/agent-ui/assets/icons/{claude,codex,githubcopilot}.svg`；Pi 用 `~/Downloads/pi-coding-agent.svg`；注入 tint 使其在两种外观下可读 | 工具行两排图标与文字对齐 |
| 15 | 拖拽 tab 的抽象物 | 源 tab 变占位（`opacity 0.35`）；幽灵为 tab 形状（144 宽、同圆角、带图标标题、`scale 1.02` + 阴影）；落位用 `DockDropIndicator.index` 在两个 tab 之间画 2pt brand 竖线，落到组/边缘用现有指示 | 拖动时能看到"正在拖什么"与"会落在哪儿" |
| 16 | Lilex | 仅 sheet 内容（正文/编辑器/终端/Diff）；`Lilex-Light.ttf`(300) + `Lilex-Medium.ttf`(500) 同 family，邻近映射（400→300、600+→500）；轮廓不变 | 内容区用 Lilex，标题栏/侧栏仍是系统字体 |

### 2.4 独立修复

| # | 问题 | 要点 |
|---|---|---|
| 17 | 复查 13「无可用模型」 | `modelsData` 的 registry 可能没加载 CLI 的 models（`~/.pi/agent/models.json`）。对比 `pi --list-models` 与 `session.models`，必要时显式初始化 model registry |
| 18 | B2 markdown 偶发纯文本 | **挂起**：现场已丢失（重启后自行恢复）。保留一个可复现样本后再修 |

## 3. 不做（挂账）

- 归档容器的恢复入口（自动归档后会看不到；按裁决暂不提供）。
- 排队/引导/打断的实际接线（需要 pi 扩展或协议扩展）。
- 设置页的语言切换（改为跟随系统）。
- M13 签名与公证（需要 Developer ID 账号）。

## 4. 门禁

```
nsh check .                                ✓ 必须
cargo check --all-targets                  ✓ 必须
nsh test .                                 ✓ 全量（含 live 模型、三个语言服务器）
script/bundle-mac.sh                       ✓ 打包冒烟
```

每个批次结束时：全量绿 + 截图（`docs/evidence/ui-*.png`）+ 本节状态更新。
