# 重型集成可行性分析

> 2026-11-10。对象：Ghostty 终端、浏览器、PTY/TUI、编辑器/IDE、Git UI。
> 每项给出「nsh 现成能力 → 缺口 → 实现路径 → 工作量与风险」，全部结论有源码/文档依据（行号可查）。
> 结论先行：**五项都可行；其中三项（PTY、Ghostty 仿真核、LSP）汇聚到同一个 Rust native module，这使 Q28=B 的裁决不只是「能启动引擎」，而是重型集成的统一地基。**

## 0. 共同地基：Rust native module 的能力面

`#[native_module("zu/native")]` 可导出（nsh `website/docs/rust.md:229-330`）：

| 形态 | 用途 | 关键细节 |
|---|---|---|
| `#[module]` | 无状态函数集 | 同步在 TSX 调用内执行；`async fn` 返回 Promise 并跑 NSH 任务 |
| `#[class]` | 有状态的 Rust 对象 | TSX `new Ledger()`；`dispose()` / `using` 释放；生命周期归 TSX 对象 |
| `#[component]` | Rust 组件 | props + events，TSX 可放 |
| `Callback<A>::post` | **Rust → TSX 异步推送** | 文档原话：`which Rust calls at once inside a call, or later with post and call_async`（`rust.md:377`） |
| `on(event, listener)` | 订阅，返回 `Stop` | 适合 PTY 输出、LSP 诊断的流式推送 |

这三件（class + Callback::post + on/Stop）恰好覆盖「长生命周期资源 + 异步字节流 + 可撤销订阅」，是 PTY / LSP / 进程管理的通用原语。

---

## 1. Ghostty 终端

### 现成能力
nsh 的 `Terminal` 组件（`crates/nsh-base/src/term/mod.rs`）：
- **自带仿真器** `VtEmulator`（基于 `vte` crate，`vt.rs` 684 行）
- **可插拔仿真器缝**：`TerminalEmulator` trait（`emulator.rs:144-161`）

```rust
pub trait TerminalEmulator {
    fn feed(&mut self, bytes: &[u8]);
    fn resize(&mut self, size: TerminalSize);
    fn line_count(&self) -> usize;
    fn line(&self, index: usize) -> TerminalLine;   // Vec<TerminalRun>（text + style）
    fn cursor(&self) -> Option<TerminalCursor>;
    fn take_events(&mut self) -> Vec<TerminalEmulatorEvent>;
    fn modes(&self) -> TerminalModes;
}
```

`TerminalEmulatorFactory`（`emulator.rs:164-184`）经 `provide_context` 注入，注释里**直接点名 libghostty**。

组件本身不跑程序——app 用 `write`(入) 与 `onData`(出) 接任意字节源（文档：`a pseudo-terminal, a WebSocket, an SSH channel`）。

### 缺口
无。**唯一约束**：factory 是 Rust API，必须从 Rust 侧提供 → 需要 native module（Q28=B 已具备）。

### 实现路径
1. `src/emulator/ghostty.rs`：`struct GhosttyEmulator` 实现 trait，内部包 `steer-ghostty` 的 libghostty-vt 绑定（该 crate 已有 `sys.rs` 与 build script 静态链接）。
2. grid 转换：vt 的 cell → `TerminalLine`/`TerminalRun`（文本 + fg/bg/bold/italic/underline/inverse/hidden）。
3. `take_events` 映射：标题、bell、DA 响应（设备属性查询需回给程序）。
4. `provide_context(TerminalEmulatorFactory::new(|size, scrollback| Box::new(GhosttyEmulator::new(size, scrollback))))`。
5. 颜色策略：NSH 内置 16 色是固定调色板（VS Code 终端色）；Ghostty 若走自己的主题，需要自定义调色板——trait 里颜色是 `TerminalColor::Indexed(u8)`，调色板由渲染侧决定，nsh 固定。**这是唯一需要接受的差异**（或给 nsh 上游提 palette 扩展）。

### 工作量与风险
- 工作量：**中**（1-2 周）。trait 面很窄，主要成本是 vt → TerminalLine 的映射与事件语义对齐。
- 风险：低-中。`steer-ghostty` 的 static link 进 nsh 的 build（两份 build script 合并、C 依赖链），以及 libghostty-vt 的版本推进（nsh 侧 trait 不变，ghostty 升级独立）。
- **建议**：v1 先用 nsh 内置 `VtEmulator`（vte 是 alacritty 的解析器，能力足够跑 TUI），**Ghostty 替换作为独立里程碑**（不阻塞 v1）。见 Q29。

---

## 2. 浏览器

### 现成能力（`website/docs/web-view-and-video.md`）
`<WebView>` 是**原生 WebKit 视图**（macOS/iOS WKWebView，Linux WebKitGTK，Windows WebView2），且——

> "they sit in your layout like any other element: they scroll with their parent, take rounded corners and clipping, and other views can overlap them without layering problems."（`web-view-and-video.md:10`）

这一点**明显优于 Steer 的 wry 集成**（Steer 的 subview 只能置顶、裁剪要手动同步）。

能力面：
| 方向 | 能力 |
|---|---|
| props | `src`、`html`、`userAgent`、`incognito`、`injectedJavaScript(…BeforeContentLoaded)`、`scrollable`、`javaScriptEnabled`、`baseUrl` |
| 事件 | `onLoadStart` / `onLoad` / `onError` / `onNavigationStateChange`（url/title/loading/canGoBack/canGoForward）/ `onMessage` / `onDownload` |
| ref | `reload` / `goBack` / `goForward` / `stopLoading` / `injectJavaScript` / `postMessage` / `load({ src, headers })` / `sendInput` |
| IPC | 页面 `window.nsh.postMessage(string)` ↔ `onMessage`；app `postMessage` → 页面 `message` 事件 |
| 自服务资源 | `urlScheme` / `url_scheme`（app 自己的 scheme 由 NSH 提供页面资源） |
| 签名页 | `load({ src, headers })` 支持带认证头的请求 |

### 缺口
1. **devtools**：文档未提及打开 Web Inspector。桌面调试页面的开发者体验缺失（可用 `injectJavaScript` 做日志回传缓解）。
2. **多标签管理**：无内建，需在 sheet 层自建（每 tab 一个 WebView + 会话状态）。
3. **cookie / 站点数据策略**：`incognito` 是二选一（页面数据随 web view 生存或持久），没有「共享 profile」的显式控制——对内置浏览器够用，对 OAuth 登录流需要实测。
4. **沙箱能力**：需要 `capabilities.webview.hosts` 授予访问的域（请求被拒时 `onError` 给 `ERR_ACCESS_DENIED`）。

### 实现路径
浏览器 sheet = 自己画地址栏 + 前进后退 + `<WebView>` + 每 sheet 一个 web view。状态（URL/标题/loading）从 `onNavigationStateChange` 进 store。

### 工作量与风险
- 工作量：**小**（数天）。组件成熟度高于自研。
- 风险：低。macOS 无额外依赖（系统 WebKit）。
- 待验证：devtools 能否从 nsh 打开（若无，记录降级）。

---

## 3. PTY 集成 Claude Code / Codex / Copilot TUI

### 现成能力
- `Terminal` 组件：键盘、bracketed paste、方向键、控制键、滚动、alt screen（由仿真器支持）、鼠标模式（`TerminalModes`）
- `onData`（用户按键 → 程序）、`onResize`（cols/rows）、ref `write`（程序输出 → 屏幕）

### 缺口
**PTY 本身**。Bun 没有内建 PTY；nsh 也不提供进程 PTY（它的 `process.spawn` 是管道，不是终端）。

### 实现路径
Rust native module（与 Q28 同一模块）：

```rust
#[class]
pub struct Pty { /* portable-pty MasterPty + Child */ }

#[class]
impl Pty {
    pub fn new(shell: String, args: Vec<String>, cwd: String, cols: u32, rows: u32) -> Result<Pty, String>;
    /// 订阅输出；Callback::post 逐块推给 TSX
    pub fn on_data(this: Instance<Pty>, listener: Callback<SharedString>) -> Stop;
    pub fn on_exit(this: Instance<Pty>, listener: Callback<i32>) -> Stop;
    pub fn write(&mut self, data: String);
    pub fn resize(&mut self, cols: u32, rows: u32);
    pub fn kill(&mut self);
}
```

TSX：
```tsx
const pty = new Pty("claude", [], cwd, 80, 24);
pty.onData((chunk) => termRef.write(chunk));
pty.onExit((code) => markSheetExited(code));
<Terminal onData={(e) => pty.write(e.data)} onResize={(e) => pty.resize(e.cols, e.rows)} />
```

### 关键验证点（TUI 能否正确渲染）
TUI 应用（Claude Code 等）依赖：alt screen（`\x1b[?1049h`）、光标定位、颜色、清屏、鼠标、bracketed paste、Unicode 宽字符。nsh 的 `VtEmulator`（vte 解析）+ `TerminalModes` 覆盖了这些；**但需要实测一次**真 TUI 的渲染（尤其 alt screen 退出后的 scrollback、光标形状、宽字符对齐）。若不够则换 Ghostty 仿真核（§1 的路径）。

### 工作量与风险
- 工作量：**中**（1-2 周，含 portable-pty 接入与 TUI 冒烟）。
- 风险：中。portable-pty 是成熟 crate；主要不确定性在 TUI 渲染完整度（可被 Ghostty 替换兜底）。
- 附带收益：Claude/Codex/Copilot 的启动预设、环境注入、cwd 快照都在这一层，正好是 external 容器的「0 号进程」。

---

## 4. 编辑器 / 完整 IDE

### 现成能力
`Editor`（`nsh/base`）：
- rope 模型、撤销、**多语言语法高亮**（按语言名/扩展名/文件名）、行号 gutter、软换行、tab 宽度
- **折叠**、**多光标**、**find/replace（正则/大小写/整词）**、装饰（decorations）、诊断（Problems）
- 命令 API：`edit(edits[])`、`run(command)`、`setSelections`、`revealPosition`
- 只读模式、`onChange` 受控/非受控

配套：`DiffView`（split/unified 自适应、hunk accept/revert、行内评论、统计）、`Tree`（虚拟化文件树）、`DockArea`（工作台）、`Terminal`。

### 缺口
**LSP 客户端**。nsh 的 EditorDemo 里的「语言服务器」是**剧本模拟**（`examples/gallery/demos/lsp/server.ts`，正则匹配），不是真 LSP。要做真 IDE，需要：
- 启动语言服务器子进程（`rust-analyzer`、`typescript-language-server` …）
- stdio JSON-RPC 客户端：initialize / didOpen / didChange / completion / hover / definition / diagnostics / codeAction
- 把结果转为 Editor 的 decorations/diagnostics 与 `TextView` 渲染的 hover 卡片

### 实现路径（两个选项）
- **Rust native module**：`portable-pty`/`std::process` 起 LSP，JSON-RPC 在 Rust 侧（`lsp-types` crate），经 `Callback::post` 推给 TSX。优点：与 PTY 同层，性能好，无 Node 依赖。缺点：要写 Rust 的 LSP 客户端（约 2-4k 行）。
- **engine（Bun）侧**：用 `vscode-languageserver-protocol` 或手写 JSON-RPC，经 wire 推给 UI。优点：生态现成库多。缺点：engine 是 pi 的领域，塞 LSP 会增加其复杂度；且开销跨进程。

### 工作量与风险
- **编辑器本身**：组件齐备，集成工作量小（数天）。
- **LSP**：这是唯一的大件（数周），且与「完整 IDE」的目标绑定。
- 风险：中等。LSP 协议面大但成熟；难点在增量同步（`didChange` 的 range 计算）与多服务器管理。
- **建议**：编辑器先做（无 LSP 也能用：高亮 + 编辑 + 保存）；LSP 作为独立里程碑（Q30）。

---

## 5. Git UI

### 现成能力
- `DiffView`：split/unified、hunk 级 accept/revert、行内评论、`+N −M · N hunks` 统计、折叠上下文带 `@@ headers`
- `Tree` / `List`：文件树、提交列表、分支列表
- `Editor`：commit message 编辑
- `Command`：⌘K 面板（分支切换、提交搜索）

### 缺口
**Git 数据源**。nsh 没有 Git 能力，需要自己取：
- **shell out `git`**：`git status --porcelain=v2 -z`、`git diff`、`git log --format=%H%x00%s...`、`git branch -vv`。零依赖、行为与用户 CLI 一致、与 pi 的 bash 工具看到的相同。
- **libgit2 / git2-rs**：无进程开销、API 结构化；但要引入 C 依赖（libgit2 编译）与版本维护。

### 决策依据
manox-app 的 AGENTS.md 禁 `git2`（理由是 plugin marketplace 一律 shell out 系统 git）。nsh-pi 是独立项目，可重新评估，但「shell out」在当前架构下仍有优势：
- engine 侧本来就有 pi 的 bash 工具在同一工作区跑 git，行为一致；
- Rust native module 已在（Q28），`std::process::Command` 起 git 无新依赖；
- 结构化解析成本：`--porcelain=v2 -z` 与 `--format` 输出稳定且易解析。

### 实现路径
- `GitService`（Rust native module 或 engine）：`status()` / `diff(path)` / `log(limit)` / `branches()` / `stage(files)` / `commit(msg)` / `checkout(branch)`，全部 shell out `git`。
- UI：Changes 面板（`DiffView` + 文件树）、History（提交列表 + 提交详情）、Branch 切换（`Command` / `Menu`）。
- 写操作（stage/commit/checkout）需要确认与 pi 的 bash 工具并发时的锁（git 自身有 index.lock，失败要能友好提示）。

### 工作量与风险
- 工作量：**中**（1-2 周，不含冲突解决 UI）。
- 风险：低。`git` 是稳定接口；风险在「UI 的交互设计」而非技术。
- 不做：冲突解决的 3-way merge UI（`DiffView` 支持 3-way 显示，但合并操作复杂，挂账）。

---

## 6. 汇总与对既有决策的影响

| 能力 | 现成度 | 缺口 | 落脚点 | 工作量 | 风险 |
|---|---|---|---|---|---|
| Ghostty 终端 | ★★★★☆ | 仿真核替换（可选） | Rust native module | 1-2 周 | 低-中 |
| 浏览器 | ★★★★★ | devtools、多标签 | 纯 TSX | 数天 | 低 |
| PTY / TUI | ★★★☆（PTY 缺） | PTY 本身 | Rust native module | 1-2 周 | 中 |
| 编辑器 | ★★★★☆ | LSP 客户端 | 编辑器纯 TSX；LSP 见 Q30 | 编辑器数天；LSP 数周 | 中 |
| Git UI | ★★★☆（数据源缺） | git 调用 | Rust/engine shell out | 1-2 周 | 低 |

### 对 Q28=B 的确认
Rust native module 从「启动引擎的一个小工具」升级为**重型集成的统一地基**：engine spawn、PTY、Ghostty 仿真核、LSP、Git 全部落在它身上。这强化了 B 的选择（A 的 `sh -c` 完全不具备这些能力），也意味着**这个模块的职责边界要提前设计好**（见 Q31）。

### 里程碑影响（原 v4）
- 「PTY/终端」不再是 v4 的单独一档，而应与 Q28 的 native module 一起在 v1 之后立即建立骨架（空 PTY + 空 LSP 桩），避免界面先做完再回头改底层。
- 浏览器最小（数天），可提前到 v2 与容器模型一起做。

## 7. 衍生问题（见 open-questions Q29–Q31）

- **Q29**：Ghostty 仿真核替换的时机（v1 内置 VtEmulator 够用 vs 一开始就上 libghostty-vt）。
- **Q30**：LSP 客户端放 Rust native module 还是 engine。
- **Q31**：Rust native module 的职责边界（它同时管进程、PTY、LSP、Git，需要一个清晰的所有权与生命周期模型）。
