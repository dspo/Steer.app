# 决策台账

> 决策文档。Zu 的全部已定决策，Q 编号是唯一编号。每条给「问题 → 裁决 → 落点 → 一句话理由」。
> 设计正文见 [architecture.md](architecture.md)；决策过程与论证见 [evidence/decision-log.md](evidence/decision-log.md)。

## 引擎与后端

| # | 问题 | 裁决 | 落点 |
|---|---|---|---|
| Q6 | 要不要保留「系统 pi」调试通道 | **不保留**。唯一引擎路径 = 内嵌 sidecar；调试用源码形态 | arch §3.2 |
| Q7 | 持久化根 | 全部用户状态落 `~/.pi`；pi 的持久化逻辑完全兼容；Zu 增强落 `zu/`；**凭据天然共享** | arch §3.5 |
| Q10 | Zu 增强写入 captain 会话的形式 | **C — `CustomEntry`**（不进 LLM 上下文，pi 容忍） | arch §5.7 |
| Q14 | 自更新渠道 | GitHub Releases（nsh/updater） | arch §3.7 |
| Q17 | 访问机制 | **不引入**沙箱 vs 完全访问轴，用 pi 原生能力 | arch §3.4 |
| Q23 | 用户已有的 pi 扩展与 skill | **加载**（全量）+ `ctx.ui` 三态桥（confirm/select/input）；editor/custom 降级 | arch §4.5 |
| Q24 | `settings.json` 读写 | **读共享、写独立**；模型选择写回共享 | arch §3.5 |
| Q27 | 遥测 | 支持 pi-telemetry，**不在早期里程碑**；默认不上报 | arch §3.7 |
| Q28 | sidecar 怎么被启动 | **B — Rust native module**（`zu/engine` spawn） | arch §3.6 |
| Q30 | LSP 客户端放哪 | **Rust native module**（与 PTY 共享子进程基础设施） | arch §3.6 |
| Q31 | native module 职责边界 | **按域拆注册面**（engine/pty/lsp/git，共用一个 crate）+ 生命周期表 | arch §3.6 |

## 前端与 UI

| # | 问题 | 裁决 | 落点 |
|---|---|---|---|
| Q2 | 跨容器画布 | **单容器画布 + 单窗口**视图切换；多窗口不在设计中 | arch §4.2 |
| Q4 | 布局 stash 三语义点 | 恢复上次容器；死资源 sheet 静默移除；空态 = Launcher | arch §4.3 |
| Q5 | 键盘范围 | v1 最小集：`⌘W` / `⌘1-9` / `⌘K` | arch §4.4 |
| Q9 | 界面语言 | zh-CN 第一 + en fallback，键表第一天立住 | arch §6 |
| Q12/Q16 | 托盘与通知 | 托盘常驻 + 通知；关窗收起不确认、单实例、不自启、通知首版激进 | arch §4.6 |
| Q20 | 多窗口打开面 | **澄清**：多窗口不在设计中（侧栏 item 即容器入口） | arch §4.2 |
| Q21 | Zoom 持久性 | **持久**（写进容器布局 stash） | arch §4.3 |

## 关系对象模型

| # | 问题 | 裁决 | 落点 |
|---|---|---|---|
| Q1 | 子会话转录归属 | **路径即关系**：captain 住 pi 原生存储（pi 可见），subagents 住 `zu/subagents/{captainId}/{ts}_{runId}.jsonl`（pi 视而不见）；**兼容方向不对称** | arch §3.5 / §5.3 |
| Q3 | 注册表格式 | JSON 快照 + 原子 rename + 启动对账 + 状态生命周期分级 | arch §5.5 |
| Q11 | 归档可见性 | v1 不做；未来候选设置页「归档管理」子页 | arch §5.4 |
| Q13 | 子代理定义体系 | markdown + frontmatter；三来源；认 skills 字段；热生效 | arch §5.6 |
| Q15 | 外部容器种类 | 四类 TUI（Terminal/Claude/Codex/Copilot） | arch §5.3 |
| Q18 | 无主会话呈现 | 启动对账自动纳入；运行时 watch；外部改动复活 | arch §5.4 |
| Q19 | 定义的项目来源目录 | `.pi/agents/` | arch §5.6 |
| Q22 | turn 进行中的语义 | 切容器丢弃增量、restore 重建；退出弹确认（早期可直接退出） | arch §4.3 |

## 产品与分发

| # | 问题 | 裁决 | 落点 |
|---|---|---|---|
| Q8 | 产品名 / logo | **Zu**（祖冲之）；`<->` + 密率 355/113 | arch §6；`ui.tsx` 的 `Logo` |
| Q25 | macOS 签名与公证 | sidecar 放 `Contents/Helpers`、直接执行不释放；嵌套签名 + hardened runtime + JIT entitlement + 公证 | arch §3.7 |
| Q26 | 仓库公开性 | **公开** | arch §3.7 |
| Q29 | 终端仿真核 | **M2 先用 nsh 内置**冒烟 + 修 alt 缺陷；「Ghostty + 扩 trait/组件」作为条件性里程碑 **M-tty**，一次换到位 | arch §6；[evidence/terminal-emulator.md](evidence/terminal-emulator.md) |

## 待决（已登记，尚未裁决）

外部审计（`docs/review/`）提出的问题大部分已在 [architecture.md](architecture.md) 落成决策；以下三项需要产品判断：

| # | 议题 | 现状 | 需要定什么 |
|---|---|---|---|
| D1 | 浏览器里程碑的域名授权 | `capabilities.webview.hosts` 是构建期白名单，而地址栏意味着任意站点 | 要么承认 `hosts: ["*"]` 并在 UI 上标出风险，要么取消地址栏只做声明过的站点 |
| D2 | 扩展的 `ctx.mode` 取值 | pi 现有 `"tui"`/`"print"`/`"rpc"`；Zu 是 GUI | 直接用 `"rpc"`（扩展按非 TUI 降级），还是与上游商量新增 `"gui"` |
| D3 | 归档容器的可恢复性 | Q11 说 v1 不做 UI 入口，但 archive 是不可见 + 杀资源 | 确认「永不删除、后续在设置里找回」足够，还是 v1 就要一个最小恢复入口 |

## 决策编号说明

- Q1–Q31 覆盖**已讨论**的问题。以下议题未经讨论、尚在正文里悬空（不是已裁决）：扩展宿主契约（Q23 的 UI 桥细节）、project trust、引擎监督与重连策略、文件读写归属（Editor 保存走 wire 还是 native module）、协议完整性校验、pi 会话格式版本、归档容器的可达性（Q11）、模型选择入口、i18n 落地时机。
- 原 engine/ui/domain 三份文档里的 E/U 编号已废弃，统一并入本表。
- 条件性里程碑（M-tty / M-arch / M-web）的触发条件见 [roadmap.md](roadmap.md) §15。
