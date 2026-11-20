# 上游特性观察（依赖 bump 必读）

> 目的：把「在等上游」和「我们还没做」分开。每次动任何 pin 的版本，都必须逐条核对
> 这张表；上游满足了的条目转为跟进任务，不允许静默忽略或顺手在 bump 里改行为。

## 0. 先分清归属（否则会把 UI 问题误记成上游）

终端这条链有三层，只有前两层算「上游」：

| 层 | 内容 | 归属 | 典型事项 |
|---|---|---|---|
| 仿真核 | libghostty-vt：解析、grid、selection/mouse 协议、formatter | Ghostty（`native/ghostty` 的 FFI 转写） | 协议覆盖、C API 稳定性、render-state 暴露哪些字段 |
| 平台桥 | nsh 元素树、隐藏 `input()`（平台 text input / IME client）、keymap 与 edit menu、剪贴板后端、窗口 | nsh 框架 | Cmd+C 与平台输入的优先级、IME 候选窗锚点、剪贴板读的同步性、非主键 press |
| 我们的组件 | `native/src/term_view/`（原生 NSView）、sheet、`app/nsh.json` | 本 repo | CoreText 网格绘制、选择策略、键编码接线、`NSTextInputClient`（预编辑绘制与候选框锚点）、能力声明 |

**判定规则**：只有「在平台桥里没有可行绕行」的项才记为 `open/blocker`；能在我们组件或
app 配置里解决的，记 `verify` 或直接从表里拿掉，放进 §8 的本地 TODO。UI 侧的行为
（复制、选择、IME 锚点、链接样式、手型）默认是我们自己的事，不是上游缺口。

## 1. 硬性流程（给 agent）

**触发**：任何 pin 变更都算 —— nsh 的 git rev / `.cnb.yml` 的 `NSH_VERSION`、Ghostty 的
`GHOSTTY_REV`/zig 版本（`native/ghostty/build.rs`）、manox 的 tag、pi-harness/bun 的 pin、
以及 lock 里被显式钉住的版本。

**每次 bump 按顺序做**：

1. 打开本文件，对每一条 `open` / `verify` 条目，在**新版本**的源码/头文件里核对
   「上游检查点」；不能联网或没 checkout 就写 `unchecked`，不要猜。
2. 在 §5 的核对台账加一行：日期、依赖、旧→新、逐条结果（missing / satisfied / changed）。
3. 上游已满足（`satisfied`）：
   - 把状态改成 `ready`，在行内写证据（文件:行、头文件段落或上游 issue/PR）；
   - 在 §6「跟进」写清落点与验收，并决定是否单独开 PR；
   - **不要**在 bump 的 PR 里直接改终端行为，除非只是版本号/绑定转写。
4. bump 的 commit/PR 描述必须有一行：
   `upstream-watch: YYYY-MM-DD checked, <n> open → <n> open`，并列出状态变化。
5. `verify` 条目（例如「native component 能不能自己接 Cmd+C」）不能只靠读文档：先在
   真宿主上跑一次验证，再把结论写回。

## 2. 版本落点（bump 时一起改）

| 依赖 | 版本写在哪 | 同版本必须同步 |
|---|---|---|
| nsh | `native/Cargo.toml`（`nsh-core`/`nsh-base` 的 rev）、`.cnb.yml` 的 `NSH_VERSION`、`script/tasks.ts` 读 CNB | 生成的 `app/.nsh/rust` workspace（nsh CLI 重写）；`nsh --version` 必须与 pin 一致 |
| Ghostty | `native/ghostty/build.rs` 的 `GHOSTTY_REV`、`GHOSTTY_TARBALL_SHA256`、`ZIG_VERSION` 与各 host zig sha | `native/ghostty/src/sys.rs`（手写转写，diff `include/ghostty/vt/*.h`）；`build.rs` 的 `TRANSLATE_C_*`/`AROCC_*` 本地化常量（见下）；构建缓存 stamp 会因 rev 变化自动失效 |
| esctest2（符合性测试集，test-only） | `script/tasks.ts` 的 `ESCTEST2`（url/sha256/dir） | Ghostty 自带 esctest runner 的 pin：`<ghostty>/test/esctest/build.zig.zon` 的依赖版本与 sha——不一致时同步我们的 pin，并再生 `native/conformance/esctest-baseline.txt`（runbook 见其 README）与 `docs/evidence/conformance.json` |
| manox | `native/manox/Cargo.toml` 的 `tag = "vX.Y.Z"` | `Cargo.lock` 的 rev；四个 crate 同 tag |
| pi-harness / bun | `pi-harness/package.json` + `src/version.ts` 的台账守卫 | `.cnb.yml` 的 bun 安装与 build target |
| Rust 工具链 | `rust-toolchain.toml` 的 channel（镜像 rustc 见 `.cnb.yml` 注释） | `bun run gate` 的 clippy/rustfmt（组件随 toolchain 一起装） |

## 3. 观察项

状态：`open` 等上游；`verify` 先在真机验证；`ready` 上游已有、等我们做；`watch` 维护性；
`done` 已落地。影响：P1 用户每天会撞；P2 常用路径有摩擦；P3 打磨；P4 极少用；P5 新功能。

| ID | 状态 | 类型 | 我们缺什么 | 影响 | 上游检查点 | 满足后做什么 |
|---|---|---|---|---|---|---|
| NSH-CLIP-SYNC | open | blocker | 原生 Rust 组件里可**同步**读剪贴板（ghostty 的 clipboard-read 回调要求当场 reply） | P3：程序查询剪贴板（OSC 52 `?`、tmux/vim 少数路径）；写入已通 | `nsh-core/src/element/ambient.rs` 的 `clipboard_string() -> Answer`；`Core` 只把 `ClipboardBackend` 给 JS 剪贴板，无组件侧同步入口 | 接 ghostty `OPT_CLIPBOARD_READ`，回复 `text/plain` |
| GHO-CLIP-ASYNC | open | alternative | ghostty 允许 clipboard-read 的 reply **延迟**（现在回调期间 VT 流暂停，必须同步答） | 同上 | `include/ghostty/vt/terminal.h` 的 `GhosttyTerminalClipboardReadFn`/reply 契约 | 用 nsh 的异步 `clipboard_string()` 回填 |
| NSH-MOUSE-PRESS | open | blocker | 非主键的 **press** 事件（现在只有 `PressDown` 主键、`MouseUp` 全键、右键 `ContextMenu`） | P4：右键/中键的上报与中键粘贴；左键、滚轮、释放、移动都够用 | `crates/nsh-core/src/ops.rs` 的 `EventKind`；`element/builder.rs` 是否有 `on_mouse_down` | 鼠标上报补右/中 press |
| NSH-COPY-HOOK | **done** | closed | 原以为要确认 `Cmd/Ctrl+C` 会不会被平台输入截走 | 已关闭：不是上游问题 | 根因是 `app/nsh.json` 没申请 `capabilities.clipboard`；补上后 `on_key_with` 在 headless 与 `--target macos` 都先于平台输入触发 | 已加能力 + `Cmd+C copies the selection` 测试；系统剪贴板未被测试污染（nsh 测试用内存剪贴板） |
| GHO-RENDER-LINK | open | simplifier | render-state 没有 row/cell 级超链接信息（URI 只能逐 cell `grid_ref`；`screen.h` 的 row 标志只在 grid ref 路径上） | P3：链接常态下划线；Cmd-hover 已可用 | `include/ghostty/vt/render.h` 的 `GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_*` / `ROW_DATA_*` 是否出现 hyperlink | 渲染时直接标链接，不再逐 cell 查 |
| GHO-API-STABLE | watch | maintenance | libghostty-vt 的稳定 ABI/1.0（现在 pre-1.0，手写转写绑定） | 不是 UX；是升级成本与发布风险 | `include/ghostty/vt/build_info.h`、`types.h` 的版本、Ghostty release notes | 收敛到官方绑定/生成，减少 `sys.rs` 手改 |
| GHO-MOUSE-ENCODER | **ready** | ready | 官方鼠标编码器已存在：`ghostty_mouse_encoder_*`、`ghostty_mouse_event_*`、`setopt_from_terminal`（X10/UTF-8/SGR/URxvt/SGR-Pixels） | P4；维护性是主要收益：可删掉我们手写的 SGR/legacy | `include/ghostty/vt/mouse/{encoder,event}.h` | 换掉 `sgr_mouse`/`sgr_motion`，补协议覆盖 |
| GHO-SELECTION | **done（已采用格式器）** | ready | 官方选择：`selection_format_buf` + `SCREEN` grid ref 已接；`select_word/line/all/output`、gesture、tracked ref 仍可选 | 已消除「跨滚动错位/不能选 scrollback」；剩边缘自动滚动与 reflow/prune 的 tracked 锚定 | `include/ghostty/vt/selection.h`、`grid_ref_tracked.h` | 需要更顺的拖选时接 gesture/tracked ref；边缘自动滚动 |
| GHO-SEARCH-OSC133 | future | future | `search.h`、semantic prompt / OSC 133 标记 | P5：只有在做 scrollback 搜索/vi 模式/提示导航时才需要 | `include/ghostty/vt/search.h`、`terminal.h` 的 semantic prompt 回调 | 另立功能，不阻塞终端替换 |

## 4. 已不再阻塞（留档，避免以后又去等）

Q29 当时把「鼠标 / 光标形状 / 超链接」记成 nsh `TerminalEmulator` trait 的上限，并计划
M-tty 扩 trait。现在 spike 走的是**自己的组件**，不再使用 `TerminalEmulator` /
`TerminalEmulatorFactory`：

- nsh trait 是否扩出鼠标/光标形状/超链接 **不影响本路线**；不要为它排期；
- 只有将来想退回 nsh 的 `<Terminal>`（例如放弃自绘）时，这些才是前置。

## 5. 核对台账

| 日期 | 依赖（旧 → 新） | 核对项 | 结果 | 证据 / 备注 |
|---|---|---|---|---|
| 2026-11-16 | nsh `f4d68f7`（v0.5.0，未 bump） | NSH-CLIP-SYNC / NSH-MOUSE-PRESS / NSH-COPY-HOOK | CLIP 仍缺同步读；MOUSE 无 MouseDown；COPY 待真机验证 | `nsh-core` 检查见 §3 行内路径；spike 报告 `docs/evidence/ghostty-spike.md` |
| 2026-11-16 | Ghostty `042b16b`（未 bump） | GHO-CLIP-ASYNC / GHO-RENDER-LINK / GHO-API-STABLE / GHO-MOUSE-ENCODER / GHO-SELECTION | CLIP 仍要求同步；RENDER-LINK 仍无 cell 级；API pre-1.0；MOUSE/SELECTION 已可用 | `include/ghostty/vt/*.h`；spike 的 `native/ghostty/src/sys.rs` 转写 |
| 2026-11-16 | nsh `f4d68f7`（未 bump） | NSH-COPY-HOOK | **satisfied（本 repo 侧）**：补 `capabilities.clipboard: true` 后 `Cmd+C` 在 headless 与 macOS 真宿主均触发；nsh 测试用内存剪贴板 | `app/nsh.json`；`terminal.ui.test.tsx` 的 `Cmd+C copies the selection` |
| 2026-11-18 | manox `v0.12.0` → `v0.12.1` | NSH-CLIP-SYNC / NSH-MOUSE-PRESS / GHO-CLIP-ASYNC / GHO-RENDER-LINK / GHO-API-STABLE / GHO-MOUSE-ENCODER / GHO-SELECTION | missing / missing / missing / missing / watch / satisfied / satisfied；本依赖不涉及 nsh/Ghostty 项，状态不变 | `dspo/manox` v0.12.1 checkout `6a02100`；仓库内无 nsh/Ghostty pin 变更 |
| 2026-11-18 | manox `v0.12.0` → `v0.12.1` | v0.12.0 的 3 处 `MANOX_HOME` 绕过（sandbox 可写根、子代理 core 目录、cx provider 配置） | **satisfied**：三处均改走 `MANOX_HOME`；下游把 manox home 迁到 `~/.steer/.manox` 并完成迁移 | `crates/manox-harness/src/ext/sandbox.rs:336`、`core/session/identity.rs:146`、`ext/provider.rs:24` 及各自测试（v0.12.1） |
| 2026-11-19 | manox `v0.12.1` → `v0.13.0` | NSH-CLIP-SYNC / NSH-MOUSE-PRESS / GHO-CLIP-ASYNC / GHO-RENDER-LINK / GHO-API-STABLE / GHO-MOUSE-ENCODER / GHO-SELECTION | missing / missing / missing / missing / watch / satisfied / satisfied；本依赖不涉及 nsh/Ghostty 项，状态不变 | `dspo/manox` v0.13.0 checkout `090f1eb`；仓库内无 nsh/Ghostty pin 变更 |
| 2026-11-19 | manox `v0.12.1` → `v0.13.0` | #1030 的 bash 输出 tap（进程级 chunk observer：前台 `on_data` + background registry 读端，`BashOutputTapId` 带 session/exec 身份，`install_bash_output_tap` 进程单例） | **satisfied**：`manox-harness/src/ext/bash/tap.rs` 全量落地，前台四变体与 background 汇入同一 drain 收口；验收清单（含 macOS tracked 形状）随内核 acceptance 测试交付 | `crates/manox-harness/src/ext/bash/tap.rs`、`ext/bash/mod.rs:457-467`、`ext/bash/background.rs:551-570`、`lib.rs:93`（v0.13.0） |
| 2026-11-19 | manox `v0.12.1` → `v0.13.0` | #1032 的会话工具 env 注入（`SessionIntent.tool_env` → bash spawn 收口） | **satisfied**：`runtime_trait.rs:99` 字段在位，`agent_server.rs:1073` 透传，`sandbox.rs:668 apply_tool_env` 收口（`KERNEL_MANAGED_ENV_KEYS` 防覆盖 + `LD_*/DYLD_*` 拒绝）；Zu 侧尚未接线（manox 标题桥 in-proc 直喂、无从端路径，C1 显式直写保持后置） | `crates/manox-ahp-runtime/src/runtime_trait.rs:99`、`manox-session-core/src/agent_server.rs:1073`、`manox-agent/src/sandbox.rs:668`（v0.13.0） |
| 2026-11-19 | manox `v0.12.1` → `v0.13.0` | v0.12.1 的 3 处 `MANOX_HOME` 绕过 | **satisfied**（继承自 v0.12.1 的修正，未回退）：`ext/sandbox.rs`、`core/session/identity.rs`、`ext/provider.rs` 仍走 `MANOX_HOME` | 同文件路径，v0.13.0 checkout 复核 |


> 台账只增不改：一次 bump 一行；结果用 `missing` / `satisfied` / `changed` / `unchecked`。

## 6. 跟进（上游已满足、我们还没做）

| 项 | 落点 | 验收 |
|---|---|---|
| GHO-SELECTION（已做主体） | `native/src/term_view/view.rs`：选择存 screen 行，复制走 `selection_format_buf` | 已完成：跨滚动/scrollback 选择与复制；剩余：边缘自动滚动、tracked ref 抗 reflow/prune |
| GHO-MOUSE-ENCODER | `native/ghostty` 暴露 encoder，组件删掉手写 `sgr_mouse`/`sgr_motion` | SGR 与 legacy/URxvt 行为不变；单测覆盖 motion/release/wheel |
| NSH-POINTER（本地，无上游） | 组件在 Cmd-hover 链接时 `.cursor(Cursor::Pointer)` | hover 手型出现、离开恢复 |
| NSH-CLIP-SYNC / GHO-CLIP-ASYNC 任一满足 | `native/ghostty` 的 `set_on_clipboard_write` 旁加 read hook | OSC 52 查询能返回当前剪贴板 |

## 7. 检查命令速查

```sh
# nsh：pin 在哪、当前 checkout
rg -n "rev =|NSH_VERSION" native/Cargo.toml .cnb.yml
nsh --version
# 逐条 grep（checkout 在 ~/.cargo/git/checkouts/nsh-*/*）
rg -n "pub fn clipboard_string|pub trait ClipboardBackend" <nsh>/crates/nsh-core/src
rg -n "MouseDown|on_mouse_down" <nsh>/crates/nsh-core/src
rg -n "pub enum Cursor" -A 20 <nsh>/crates/nsh-core/src/effects.rs

# Ghostty：rev 与头文件
rg -n "GHOSTTY_REV|ZIG_VERSION|SHA256" native/ghostty/build.rs
rg -n "GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_" <ghostty>/include/ghostty/vt/render.h
rg -n "ghostty_mouse_encoder_|ghostty_selection_gesture_" <ghostty>/include/ghostty/vt
rg -n "GhosttyTerminalClipboardReadFn" -A 30 <ghostty>/include/ghostty/vt/terminal.h
# 注意：`pkg/translate-c` 的 tarball/arocc git 依赖由 build.rs 本地化；
# bump Ghostty 时若上游改了这两个 zon 的字段顺序，构建会以 “.hash line moved” 断言失败，
# 需要同步 TRANSLATE_C_URL/SHA 与 AROCC_URL/SHA（codeberg 的 git 在 CI 不可达）。

# bump 后的最小回归
cd native && cargo test -p zu-ghostty -p zu-app
cd app && ZU_SKIP_LIVE=1 nsh test terminal.ui.test.tsx

# 符合性：结果应仍为 411/42/114 与基线无新增失败；数字变了先怀疑 esctest2 pin
bun run conformance
```

## 8. 本地 TODO（不是上游，别写进「等上游」）

- ~~**IME 候选窗/输入锚点**~~：已改为光标处一整格 + 组合期不清空 value；中文候选窗仍需
  真机人工复验（输入法不在自动化范围内）。
- ~~**Cmd+C 真机验证**~~：已关闭。补 `capabilities.clipboard: true` 后 headless/macOS 都通过。
- ~~**选择语义**~~：已改为 screen 行锚定 + `selection_format_buf` 复制；跨滚动与 scrollback 可选。
  剩余：边缘自动滚动、tracked ref 抗 reflow/prune（§6 GHO-SELECTION）。
- **链接常态下划线 + 手型指针**（P3）：指针用 nsh 的 `Cursor::Pointer`（已可用）；
  常态下划线等 GHO-RENDER-LINK，或维持 Cmd-hover。
- **边缘自动滚动 / 双击后拖拽扩词**（P2）：选择已内容锚定，继续补这两个交互。
- ~~**CI Linux 冷构建**~~：已通过（PR #27，8m03s）；`build.rs` 本地化 translate-c/arocc，
  `xz-utils` 与 `ZU_GHOSTTY_CACHE` 卷已生效。
- **性能/内存**：`yes`、`cargo build`、5000 行 scrollback 的帧率与 RSS。
