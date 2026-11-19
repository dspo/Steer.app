# AGENTS.md — Zu

Zu（祖冲之）是 coding agent 的 macOS 桌面工作台：nsh（TSX/AppKit，**QuickJS 运行时**）写的外壳，
两种会话引擎平级共存——pi（ACP，一会话一持久 `pi-acp` 进程）与 manox（Rust in-proc AHP 宿主）。
壳与容器零 harness 语义；会话的 durable 权威在磁盘，UI 只是投影。

## 目录

- `app/` — nsh TSX 应用：`core/`(registry/containers/dock/projects)、`shell/`、`canvas/`、
  `modules/`(home/browser/files/git/terminal/problems/pi/manox)、`domains/`、`ui/`
- `contracts/` — 跨模块词汇：`module.ts`（SheetKindSpec/SheetModule）、`ahp/`（vendored AHP
  类型 + reducers，PIN.md 记上游版本）
- `native/` — Rust `zu/native`（acp/fs/git/lsp/pty/state/picker/instance 等各域）
- `native/ghostty/` — `zu-ghostty`：libghostty-vt 的手写 FFI + 构建脚本（pinned rev/zig/sha256），
  终端的仿真核；`native/src/session.rs` 的 `TerminalSession` 持有程序与仿真器（随 PTY 存活）；
  `native/src/term_view/` 是 macOS 原生组件 `zu.terminal`（按 id 附着会话：CoreText 按格绘制 + 自身即
  `NSTextInputClient`），TSX 侧经 `nativeComponent` 声明于 `app/domains/terminal.ts`
- `native/manox/` — **独立 cargo workspace**：manox AHP 宿主半边
- `pi-harness/` — app 内置的 pi 引擎（pin pi 1.5.0，`bun build --compile` 出 `dist/pi-acp`）
- `script/` — `tasks.ts`（dev/check/test/evidence/bundle 入口）、`ci.ts`（CI 六个 stage 的门禁体）、
  `check-layers.mjs`（分层门禁）、`lib/toolchain.ts`（共享 nsh 发现/校验/spawn 纪律）
- `.agents/skills/` — vendored 技能（nsh、nsh-design-guides），来源锁定在 `skills-lock.json`（勿手改）；
  `agent/` 是本地构建产物目录，已 gitignore，不是它
- `docs/` — `architecture.md`（入口）、`decisions.md`（Q1–Q115 决策台账）、`DESIGN.md`（视觉规格）、
  `sheet-module-ARCHITECTURE.md`、`pi-acp-*.md`、`plan.md`、`upstream-watch.md`、`evidence/`

## 命令

统一入口 `script/tasks.ts`（需要 bun、cargo、nsh CLI 三套工具链）。前置：nsh 版本必须等于
`.cnb.yml` 的 `NSH_VERSION`（tasks.ts 会校验；`NSH=/path/to/nsh` 可覆盖），Rust 版本由
`rust-toolchain.toml` 钉住（1.99.1 + clippy/rustfmt）。

**门禁在本地**（Q119）：cnb 的 check-and-test 不再随 push/PR 自动跑，只在
`git push origin HEAD:ci/remote` 时执行一遍 Linux 复核；main push 仅在 NPC 镜像输入
（`.ide/Dockerfile*` 或 `.cnb.yml`）变化时用 `ifModify` 重建 NPC 镜像。`$` 下的
NPC 事件流水线保持不变。

- `bun run gate` — **本地完整门禁，合并前必须绿**：layer gate → rustfmt/clippy（两个 workspace）→
  `nsh check app` → native `cargo test` + headless → manox 门禁 → macOS 终端门禁 → pi-harness
  （含 darwin 编译）
- `bun run gate:fast` — 秒级门禁（layer gate + rustfmt + harness 版本台账）；`.githooks/pre-push`
  调用它，首次 clone / 新 worktree 后跑一次 `bun run hooks:install`
- `bun run dev` — 开发实例；默认端口 8810，状态目录 `~/.steer/dev`（与已安装的 Zu.app 可同时运行）
- `bun run check` — `nsh check app`：TSX **唯一类型检查口** + 逐 crate cargo check
- `bun run test` — `nsh test .`（app/ 下 headless 测试）；`native/` 的成员 crate（`zu-ghostty`）另需
  `cd native && cargo test --workspace`（gate 的 test stage 两者都跑）
- 分层门禁：`bun script/check-layers.mjs`
- Rust 门禁（两个 workspace **各跑一遍**）：在 `native/` 与 `native/manox/` 里分别
  `cargo fmt --all --check && cargo clippy --all-targets -- -D warnings`
- manox 门禁（`nsh test` 只收单个路径，三条分开跑）：`ZU_MANOX_GATE=1 nsh test app/tests/manox.test.ts`
  （折叠对账/panic 恢复）、`ZU_MANOX_GATE=1 nsh test app/tests/manox-models.test.ts`（宿主模型目录与
  config 折叠）、`ZU_MANOX_GATE=1 nsh test app/tests/manox.ui.test.tsx`（sheet 门禁）—
  **不带该变量断言静默跳过**，裸跑绿 ≠ 跑过
- 终端门禁：`ZU_TERMINAL_GATE=1 nsh test app/tests/terminal.ui.test.tsx --target macos`（另有
  `terminal-sheet.visual`、`hero-terminals.ui` 的退出用例）——终端是 AppKit 视图，headless 里是空盒子，
  **不带该变量这些用例静默跳过**；`native/src/term_view` 的几何/IME/键位单测随 `cargo test` 在 macOS 跑
- pi-harness 自检：`cd pi-harness && bun run check-version && bun test`
- 终端符合性：`bun run conformance [-- esctest|ucs|all] [--gate=p0]`——report-only 不拦合并，
  需 python3 与网络（首次下载 esctest2 到 `~/.cache/steer-conformance/`），全量约 1 分钟；
  验收口径与基线见 issue #46 与 `native/conformance/README.md`
- `ZU_SKIP_LIVE=1` = gate 口径（`bun run gate` 的 test stage 显式带上）：跳过 live 模型/LSP 与
  acp-load-probe；手动跑 `bun run test` 不受影响
- 终端/ghostty 构建：首次 `cargo check` 由 `native/ghostty/build.rs` 下载并编译 libghostty-vt
  （zig 0.17，冷构建约 4 分钟）；`ZU_GHOSTTY_CACHE` 指向缓存目录可复用静态库，
  `GHOSTTY_SRC`/`GHOSTTY_ZIG` 可指向本地 checkout/toolchain

## 分层规则（check-layers.mjs 硬门禁）

- `core/` `shell/` `canvas/` 不 import `modules/` `domains/`；`App.tsx` 是唯一 import 模块的装配点
- `domains/` 是叶子：只 import `contracts/` 与 native 面
- 模块只 import `core/` `domains/` `ui/` `contracts/` 与自己目录；不 import `shell/` 或别的模块
- `zu/native` / `manox/native` 只能在 `app/domains/` 里 import
- 例外进 `script/check-layers.mjs` 的 ALLOW 且须带移除阶段；ALLOW 里已消失的条目也算失败

## 依赖 bump（硬性）

任何 pin 变更都算：nsh 的 git rev / `.cnb.yml` 的 `NSH_VERSION`、`rust-toolchain.toml` 的
Rust channel、Ghostty 的 `GHOSTTY_REV`/zig（`native/ghostty/build.rs`）、manox tag、
pi-harness/bun、lock 级 pin。

1. 先读 `docs/upstream-watch.md`，对每条 `open` / `verify` 项在**新版本**里核对，不能只读文档；
2. 在它的核对台账加一行：日期、旧→新、逐条结果（`missing` / `satisfied` / `changed` / `unchecked`）；
3. 上游已满足：状态改 `ready` 并写证据，跟进写进 §6；不要在 bump 的 PR 里顺手改终端行为；
4. bump 的 commit/PR 描述必须有 `upstream-watch: YYYY-MM-DD checked, <n> open → <n> open`；
5. 没有核对视为 bump 未完成。

## 硬约束与易踩的坑

- **TSX 跑在 QuickJS**：无 node 内建模块、动态 require → pi 引擎不能进 UI 进程；
  重型集成只在 Rust native 侧，TS 侧只做协议与 UI
- **UI 不持 fs/process**：文件只经 `zu/fs`，进程只经 native 域（`app/domains/` 是唯一 native 面）
- **`app/nsh.json` 能力面保护的是 UI 代码，不是 agent 动作**——harness 工具以用户权限运行，别读成「agent 沙箱」；
  剪贴板已开（`capabilities.clipboard: true`，About 页的复制按钮依赖它）；若关掉，组件里的复制/OSC 52 会被能力门拒绝
- **文件是事实**：会话权威在 `~/.pi/agent/sessions/`（pi）/ `$MANOX_HOME/`（manox，默认 `~/.steer/.manox`）；Zu 状态在 `~/.steer/`，
  只由 UI 经 `zu/state` 读写（临时文件 + rename，版本拒绝 `ERR_STATE_STALE`；持久文件顶层带 `"v"`）
- **pi → Zu 兼容最高优先**：官方 pi CLI 产生的会话必须能列出/打开/续跑；解析失败不阻塞启动
- **容器没有 harness 身份**：Project → Container → Sheet 三层；「容器的会话有哪些」是 pi 模块自己的投影
- `nsh check app` 首试失败常是已知 malachite-bigint 双版本问题（修复命令见 `native/manox/Cargo.toml` 注释）；
  不是该错才需要看完整日志
- 新持久化对象先回答「持久还是易失」；写者唯一，不允许第二个写面
- **上游/本地先分清**：只有 nsh 平台桥与 ghostty 核里无法绕行的才是上游项；UI 侧行为
  （选择、复制、IME、链接、光标）默认是我们自己的事，记进 `upstream-watch.md` §0 前先确认

## 视觉规范（docs/DESIGN.md）

颜色只从 `app/theme.json` 语义 token 取，`*.tsx` 无 raw hex / `rgb()`；半径阶梯 8/10/12；
字体 12–18 窄阶梯；动效 120ms/180ms 只解释变化。层级靠间距、字重与 hairline，不堆卡片与阴影。

## 工作方法

- **PR 编辑在独立 git worktree 中进行**。惯例：`PWD=$(pwd) git worktree add $PWD.worktrees/pr_topic -b feat/pr_topic origin/main`；PR 合并后主动回收 origin 与本地对应的 branch、worktree
- **先回应再动手**：收到 user message 后，第一次写操作前随口说一句你的理解与打算，说完就继续，不等确认
- **尽早交付 PR**：提出 PR 后不要傻等远端检查才交付给用户——让用户的静态 review 与本地 gate 并行，节省开发者时间
- **合并前跑本地 gate**：`bun run gate` 必须绿，PR 描述贴结果；首次 clone / 新 worktree 后
  `bun run hooks:install`，之后每次 push 自动跑 `gate:fast`
- **review 时别重复劳动**：本地 gate 与验证脚本能验证的东西，非必要不跑
- **review 必须给结论**：除了意见，明确三选一——`approve` / `approve with changes`（address comments and self-merge）/ `request changes`
- **推进合并要处理所有问题**：以「勿以善小而不为，勿以恶小而为之」的心态，nit 级也要处理；合并前
  `bun run gate` 必须绿
- **不留 follow-up**：不要总想着丢给下一个 PR 或等用户后续跟踪——follow-up 当场处理，要么附进当前 PR，要么立即主动开 follower-up PR
- **subagent 任务以 10–60 分钟为宜**：太小自己顺手做掉（交接上下文反而浪费），太大不可控——明确边界、拆分阶段委派
- **subagent 的工作必须评审验收**：必要时要求返工；小瑕疵自己接手随手修掉
- 交付 PR 如涉及 UI UX 体验变更，应当告知用户如何目视验收（给出运行应用的命令行和目视验收要点）。

## 改动前先读

- 架构面改动 → `docs/architecture.md`（现状）+ `docs/decisions.md`（为什么）
- 新增/改动 sheet 模块 → `docs/sheet-module-ARCHITECTURE.md`
- pi 协议/传输 → `docs/pi-acp-PROTOCOL.md` + `docs/pi-acp-IMPLEMENTATION.md`
- 视觉 → `docs/DESIGN.md`
- 依赖/上游 → `docs/upstream-watch.md`
- 提交信息跟随 git log 惯例：`type(scope): 描述`（中英文皆有先例）
