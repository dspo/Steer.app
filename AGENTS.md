# AGENTS.md — Zu

Zu（祖冲之）是 coding agent 的 macOS 桌面工作台：nsh（TSX/AppKit，**QuickJS 运行时**）写的外壳，
两种会话引擎平级共存——pi（ACP，一会话一持久 `pi-acp` 进程）与 manox（Rust in-proc AHP 宿主）。
壳与容器零 harness 语义；会话的 durable 权威在磁盘，UI 只是投影。

## 目录

- `app/` — nsh TSX 应用：`core/`(registry/containers/dock/projects)、`shell/`、`canvas/`、
  `modules/`(home/browser/files/git/terminal/problems/pi/manox)、`domains/`、`ui/`
- `contracts/` — 跨模块词汇：`module.ts`（SheetKindSpec/SheetModule）、`ahp/`（vendored AHP
  类型 + reducers，PIN.md 记上游版本）
- `native/` — Rust `zu/native`（acp/fs/git/lsp/pty/state/picker/instance/pimodels 各域）
- `native/manox/` — **独立 cargo workspace**：manox AHP 宿主半边
- `pi-harness/` — app 内置的 pi 引擎（pin pi 1.5.0，`bun build --compile` 出 `dist/pi-acp`）
- `script/` — `tasks.ts`（唯一入口）、`check-layers.mjs`（分层门禁）、`bundle-mac.sh`
- `.agents/skills/` — vendored 技能（nsh、nsh-design-guides），来源锁定在 `skills-lock.json`（勿手改）；
  `agent/` 是本地构建产物目录，已 gitignore，不是它
- `docs/` — `architecture.md`（入口）、`decisions.md`（Q1–Q107 决策台账）、`DESIGN.md`（视觉规格）、
  `sheet-module-ARCHITECTURE.md`、`pi-acp-*.md`、`plan.md`、`evidence/`

## 命令

统一入口 `script/tasks.ts`（需要 bun、cargo、nsh CLI 三套工具链）。前置：nsh 版本必须等于
`.cnb.yml` 的 `NSH_VERSION`（tasks.ts 会校验；`NSH=/path/to/nsh` 可覆盖）。

- `bun run dev` — 开发实例；默认端口 8810，状态目录 `~/.pi/zu-dev`（与已安装的 Zu.app 可同时运行）
- `bun run check` — `nsh check app`：TSX **唯一类型检查口** + 逐 crate cargo check
- `bun run test` — `nsh test .`（app/ 下 headless 测试）
- 分层门禁：`node script/check-layers.mjs`
- Rust 门禁（两个 workspace **各跑一遍**）：在 `native/` 与 `native/manox/` 里分别
  `cargo fmt --all --check && cargo clippy --all-targets -- -D warnings`
- manox 门禁：`ZU_MANOX_GATE=1 nsh test app/tests/manox.test.ts app/tests/manox.ui.test.tsx` —
  **不带该变量断言静默跳过**，裸跑绿 ≠ 跑过
- pi-harness 自检：`cd pi-harness && bun run check-version && bun test`
- `ZU_SKIP_LIVE=1` = CI 口径：跳过 live 模型/LSP 与 acp-load-probe

## 分层规则（check-layers.mjs 硬门禁）

- `core/` `shell/` `canvas/` 不 import `modules/` `domains/`；`App.tsx` 是唯一 import 模块的装配点
- `domains/` 是叶子：只 import `contracts/` 与 native 面
- 模块只 import `core/` `domains/` `ui/` `contracts/` 与自己目录；不 import `shell/` 或别的模块
- `zu/native` / `manox/native` 只能在 `app/domains/` 里 import
- 例外进 `script/check-layers.mjs` 的 ALLOW 且须带移除阶段；ALLOW 里已消失的条目也算失败

## 硬约束与易踩的坑

- **TSX 跑在 QuickJS**：无 node 内建模块、动态 require → pi 引擎不能进 UI 进程；
  重型集成只在 Rust native 侧，TS 侧只做协议与 UI
- **UI 不持 fs/process**：文件只经 `zu/fs`，进程只经 native 域（`app/domains/` 是唯一 native 面）
- **`app/nsh.json` 能力面保护的是 UI 代码，不是 agent 动作**——harness 工具以用户权限运行，别读成「agent 沙箱」
- **文件是事实**：会话权威在 `~/.pi/agent/sessions/`（pi）/ `~/.manox/`（manox）；Zu 状态在 `~/.pi/zu/`，
  只由 UI 经 `zu/state` 读写（临时文件 + rename，版本拒绝 `ERR_STATE_STALE`；持久文件顶层带 `"v"`）
- **pi → Zu 兼容最高优先**：官方 pi CLI 产生的会话必须能列出/打开/续跑；解析失败不阻塞启动
- **容器没有 harness 身份**：Project → Container → Sheet 三层；「容器的会话有哪些」是 pi 模块自己的投影
- `nsh check app` 首试失败常是已知 malachite-bigint 双版本问题（修复命令见 `native/manox/Cargo.toml` 注释）；
  不是该错才需要看完整日志
- 新持久化对象先回答「持久还是易失」；写者唯一，不允许第二个写面

## 视觉规范（docs/DESIGN.md）

颜色只从 `app/theme.json` 语义 token 取，`*.tsx` 无 raw hex / `rgb()`；半径阶梯 8/10/12；
字体 12–18 窄阶梯；动效 120ms/180ms 只解释变化。层级靠间距、字重与 hairline，不堆卡片与阴影。

## 工作方法

- **以 PR 为目标的编辑活动在独立 git worktree 中进行**
- **尽早交付 PR**：提出 PR 后不要傻等 CI 通过才交付给用户——让用户的静态 review 与 CI 并行，节省开发者时间
- **review 时别重复劳动**：CI 与验证脚本能验证的东西，非必要不跑
- **review 必须给结论**：除了意见，明确三选一——`approve` / `approve with changes`（address comments and self-merge）/ `request changes`
- **推进合并要处理所有问题**：以「勿以善小而不为，勿以恶小而为之」的心态，nit 级也要处理；合并前 CI 必须通过
- **不留 follow-up**：不要总想着丢给下一个 PR 或等用户后续跟踪——follow-up 当场处理，要么附进当前 PR，要么立即主动开 follower-up PR
- **subagent 任务以 10–60 分钟为宜**：太小自己顺手做掉（交接上下文反而浪费），太大不可控——明确边界、拆分阶段委派
- **subagent 的工作必须评审验收**：必要时要求返工；小瑕疵自己接手随手修掉

## 改动前先读

- 架构面改动 → `docs/architecture.md`（现状）+ `docs/decisions.md`（为什么）
- 新增/改动 sheet 模块 → `docs/sheet-module-ARCHITECTURE.md`
- pi 协议/传输 → `docs/pi-acp-PROTOCOL.md` + `docs/pi-acp-IMPLEMENTATION.md`
- 视觉 → `docs/DESIGN.md`
- 提交信息跟随 git log 惯例：`type(scope): 描述`（中英文皆有先例）
