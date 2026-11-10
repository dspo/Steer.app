# M11 — LSP 证据

> 机器：macOS（Apple Silicon），`rust-analyzer 1.99.1 (58cf8f9c 2026-10-13)`，
> `typescript-language-server` 与 `gopls` 已安装但本里程碑未用于验收。
> 应用要求：不 kill/restart 用户正在跑的 app；所有门禁用
> `ZU_PORT=47835 ZU_STATE_DIR=/tmp/zu-m11-test-$$` 隔离。
> 所有数字与输出都来自本次运行的 `/tmp/zu-m11-rust-*/evidence.json`，不是手写摘要。

## 1. 门禁

```sh
nsh check                    # ✓ checked zu-app / built the Rust crate
nsh build                    # ✓（bundled fixtures; 1 runner warning 是既有）
cargo check --all-targets    # ✓
cargo test --lib             # ✓ 37 passed（基线 29；新增 8 条 LSP 单元测试）
nsh test .                   # ✓ 141/141（104 TS + 37 Rust；基线 130 = 101 TS + 29 Rust）
                             #   ZU_PORT=47835 ZU_STATE_DIR=/tmp/zu-m11-test-$$
```

新增测试：

| 测试 | 真实度 |
|---|---|
| `lsp.test.ts` › rust-analyzer reports a real type error, hover, definition and completion | **真实**：真实 `rust-analyzer`、真实 Cargo 项目、真实 JSON-RPC，无 mock |
| `lsp.test.ts` › a missing server and a missing cwd are coded errors | 真实错误路径（`ERR_LSP_COMMAND` / `ERR_LSP_CWD` / `ERR_LSP_ARGS`） |
| `lsp.ui.test.tsx` › the UI shows diagnostics, hover, definition, completion, Problems and a restart | **真实 Workbench + 真实 `zu/lsp` 进程**；语言服务器是受控 Node 脚本（固定答案，屏幕上标 `fake`） |
| `src/lsp.rs` 的 8 条单元测试 | `Content-Length` 帧拆分/多帧/额外 header/坏长度/超限/多字节、命令解析、显式 cwd |

## 2. 真实 rust-analyzer 验收

fixture 由测试自己用 `zu/fs` 写在 `/tmp/zu-m11-rust-<tag>/`：

```toml
[package]
name = "zu-m11-fixture"
version = "0.1.0"
edition = "2021"
```

```rust
// src/main.rs
use zu_m11_fixture::add;

fn main() {
    let value: i32 = "not a number";
    let sum = add(1, 2);
    let _unused = value;
    println!("{value} {sum}");
}
```

```rust
// src/lib.rs
pub fn add(left: i32, right: i32) -> i32 {
    left + right
}
```

流程：`Lsp.start({ command: "rust-analyzer", args: [], cwd: canonicalRoot })` →
`initialize`（rootUri/workspaceFolders/客户端能力）→ `initialized` → `didOpen` → 等
`textDocument/publishDiagnostics` → hover → definition → completion → `stop` →
等 exit。`workspace/configuration`、`client/registerCapability` 等服务端请求由测试
按 `lsp.ts` 同样的方式应答。

### 2.1 diagnostics（原文）

```json
{
  "range": { "start": { "line": 3, "character": 21 }, "end": { "line": 3, "character": 35 } },
  "severity": 1,
  "code": "E0308",
  "codeDescription": { "href": "https://doc.rust-lang.org/stable/error_codes/E0308.html" },
  "source": "rust-analyzer",
  "message": "expected i32, found &'static str"
}
```

（另一次冷启动首跑得到的是 rustc 风格的 `mismatched types`；两种都是服务器的真实
输出，测试按 `mismatched types|expected i32` 接受，不锁死一种措辞。）

### 2.2 hover（原文）

```json
{
  "contents": {
    "kind": "markdown",
    "value": "\n```rust\nzu_m11_fixture\n```\n\n```rust\npub fn add(left: i32, right: i32) -> i32\n```"
  },
  "range": { "start": { "line": 4, "character": 14 }, "end": { "line": 4, "character": 17 } }
}
```

### 2.3 definition（原文）

```json
[{
  "originSelectionRange": { "start": { "line": 4, "character": 14 }, "end": { "line": 4, "character": 17 } },
  "targetUri": "file:///private/tmp/zu-m11-rust-1794338871337-685228/src/lib.rs",
  "targetRange": { "start": { "line": 0, "character": 0 }, "end": { "line": 2, "character": 1 } },
  "targetSelectionRange": { "start": { "line": 0, "character": 7 }, "end": { "line": 0, "character": 10 } }
}]
```

`lsp.ts` 取 `targetRange` 的 start 作为 `revealPosition` 的目标，取
`targetSelectionRange` 作为 hover 下划线的范围；两者都只接受容器根内的 URI。

### 2.4 completion（前 6 项）

```json
[
  { "label": "self::", "kind": 14, "sortText": "7ffffff6", "textEdit": { "range": {...0-width...}, "newText": "self::" } },
  { "label": "crate::", "kind": 14, "sortText": "7ffffff6" },
  { "label": "sum", "kind": 6, "detail": "i32", "preselect": true },
  { "label": "value", "kind": 6, "detail": "i32", "preselect": true },
  { "label": "add", "kind": 3, "detail": "fn(i32, i32) -> i32" },
  { "label": "main", "kind": 3, "detail": "fn()" }
]
```

### 2.5 耗时与超时（本次运行）

| 阶段 | 耗时 | 说明 |
|---|---|---|
| `initialize` | **42 ms** | 服务器进程已在机器上，项目很小 |
| diagnostics | **697 ms** | 从 `didOpen` 到第一条 error；rust-analyzer 首次会建索引 |
| hover | **2025 ms** | 前面约 1.9 s 是 crate graph 未就绪时的 `ContentModified` 重试（测试每 250 ms 重问）；服务器一旦就绪，单次响应是毫秒级 |
| definition | **2026 ms** | 与 hover 同时重试 |
| completion | **31 ms** | 图已就绪 |

测试的等待上限：initialize 60 s、诊断 120 s、hover/definition/completion 各 30 s；
原生测试整体 150 s。`initialize` 的超时在 `lsp.ts` 是 60 s，hover 8 s、definition
10 s、completion 8 s（超时即取消/关列表，不阻塞编辑器）。冷启动（无 cargo 缓存）
的实测会明显更慢；本机 fixture 很小，所以以上数字不代表大仓库。

## 3. headless UI（真实 Workbench + 真实 `zu/lsp`）

fixture `fixtures/lsp.tsx` 用真实 `Workbench`，容器 cwd 是 `/tmp/zu-m11-ui-fixture`，
初始布局同时打开文件树与 `src/main.rs` 的 editor sheet。服务器是用
`setLspCommandResolver` 注入的 **真实子进程** `node /tmp/.../fake-lsp.js`：

- 它不是应用内的 mock：`Lsp.start` 真起进程、真走 stdin/stdout、真解析
  `Content-Length`；`fixtures/m11-fake-lsp.ts` 是脚本源码，测试用 `zu/fs` 写入。
- 它的答案固定并带 `fake` 字样：一条 error（line 0）、一条 warning（line 2）、
  hover Markdown、definition 到 `src/target.rs`（selection 1:4）、completion
  `fake_completion`。屏幕上能看到 `fake diagnostic: mismatched types`。
- 真实路径：`initialize` → `didOpen` → `publishDiagnostics` → `lsp.ts` 的 store →
  `Editor.diagnostics` / Problems；Problems 行 → `openEditorSheet` + reveal；
  F12 → `onDefinitionRequest` → `lspDefinition` → 目标 sheet + reveal；Ctrl+Space →
  `onCompletionRequest` → `lspCompletion` → `presentCompletions`；重启按钮 → 新进程、
  新 pid、重新 didOpen。

断言（`lsp.ui.test.tsx`）：`2 个诊断`；Problems 头与行文本；Problems 行点击后
`lastReveal` 为 `editor:...main.rs:0:0`；F12 后 `target.rs:ready` 且
`lastReveal` 为 `editor:...target.rs:1:0`；补全列表出现 `fake_completion`；
重启后 `rust:ready:<new pid>` 且诊断重新出现。

**不是真实的部分 / 未覆盖**：

- 受控服务器的语义（哪些行有诊断、hover 文本）是固定的，不是 rust-analyzer；
  真实 server 的四个答案由 `lsp.test.ts` 覆盖。
- headless 的 `app.hover(selector)` 只把 `MouseMove` 派给 selector 命中的 view
  及其祖先（`nsh-testing` 的 `Screen::hoverable`），而 `Editor` 在内部 rows 上听
  `onMouseMove`，所以「指针 → `onHover`」在 headless 驱动不了。UI 测试改为用同一
  `HoverCard` 组件 + 固定 anchor 渲染（fixture 的 `fixture-hover` 按钮），断言
  `Overlay` / `TextView` 能显示 Markdown；`Editor.onHover → textDocument/hover`
  这段由 native 测试和代码路径覆盖，**没有**在 headless 验证。
- 没有真实 macOS 截图；没有用真实鼠标驱动 hover。
- TypeScript / Go 没有用真实 `typescript-language-server` / `gopls` 跑验收；语言
  映射与启动 argv 有代码与类型，但不声称验证。

## 4. 本轮修掉的真实缺陷

`~/.cargo/bin/rust-analyzer` 是 `rustup` 的 symlink。`resolve_program` 最初对找到的
路径做 `canonicalize()`，把程序变成 `rustup`，`argv[0]` 也随之变成 `rustup`；结果
rustup 打印自己的帮助（`install/uninstall/toolchain...`），stdout 里没有任何
`Content-Length`，`initialize` 60 s 超时。修复：程序路径只做「绝对化」，**不解析
symlink**（cwd 仍然 canonicalize），调用方拿到的就是 rust-analyzer；测试与 UI 都
随即通过。这条写进 architecture §3.6/§8.13。

## 5. 验收状态

| M11 验收项 | 状态 | 证据 |
|---|---|---|
| Rust 类型错误 → Problems 显示 | ✓ | 真实 rust-analyzer diagnostics；headless UI 的 Problems 行 |
| 诊断进 `Editor.diagnostics`（gutter/squiggles） | ✓（数据） | `diagnostics` prop 映射；headless `editor-diagnostics` 2 条；视觉波浪线未截图 |
| hover 有签名 | ✓（LSP 数据） | 真实 hover Markdown；headless 卡片组件；**真实指针路径未自动化** |
| F12 跳到定义 | ✓ | 真实 definition → lib.rs；headless F12 → target.rs + reveal |
| 补全有候选 | ✓ | 真实 rust-analyzer `value: i32`；headless `fake_completion` 列表 |
| 非可见 editor 保留诊断 | ✓（store 按文件，不依赖 sheet 挂载） | 诊断在 `lspDiagnostics`，Editor 隐藏不卸载 store；未单独断言隐藏态 |
| server 只在该开时开 | ✓ | 打开受支持文件 / Problems 的项目标记；无标记不启动 |
| server 崩溃/错误态 | ✓ | `onExit` → error + stderr 尾；Problems 有错误条与重启 |
| 归档容器停止 server | ✓ | `stopLspContainer` 在 `archiveContainer` 里 |

## 6. 限制清单（与 roadmap/architecture 同一口径）

1. 全文同步（`didChange` 发整份文本，180 ms 防抖），不是增量；2 MiB 上限内可接受。
2. 诊断只保留**打开的文件**；Problems 不是全工作区索引，关闭 sheet 即 `didClose` 并清掉该文件。
3. 每容器 × 语言族一个进程；大仓库的 rust-analyzer 索引成本不受 Zu 控制。
4. 补全 `snippetSupport: false`，不插入 snippet；hover 的 `codeDescription` 链接只在卡片里显示，不外开。
5. 应用重启/归档不恢复语言服务器；重开文件会重新 didOpen。
6. 真实验收只覆盖 Rust；TS/Go 未实跑。
7. headless 无法驱动 Editor 内部 rows 的 hover；无真实 macOS 截图。
8. `initialize` 在冷启动/大仓库可能超过 60 s（会显示 server error，可重启）；本次小 fixture 42 ms。
