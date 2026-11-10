# Q29 调研：nsh 内置 VtEmulator vs Ghostty 仿真核

> 2026-11-10。结论先行：**「换 Ghostty 仿真核」的收益被 nsh 的 `TerminalEmulator` trait 上限锁死**——拿得到解析正确性，拿不到鼠标/超链接/光标形状这些新能力；而后者才是 Ghostty 相对 nsh 的主要差距。因此建议把「换核」与「扩 trait/组件」打包评估，而不是先换核。

## 1. nsh VtEmulator 的实际覆盖面（源码逐项核对）

实现：`crates/nsh-base/src/term/vt.rs`（684 行），基于 `vte` crate（Alacritty 的解析器）。

### 支持的

| 类别 | 覆盖 |
|---|---|
| 光标移动 | `A B C D E F G d H f`、`s`/`u`、`ESC 7`/`ESC 8` |
| 擦除 | `J`（0/1/2/3）、`K`（0/1/2）、`X` |
| 插入/删除 | `@`、`P`、`L`、`M` |
| 滚动 | `S`、`T`、`r`（DECSTBM 滚动区域） |
| SGR | 0–9 基础属性、21–29 关闭、30–37/39/40–47/49 十六色、90–97/100–107 亮色、38/48 的 256 色与 24 位色（含冒号形式） |
| 模式 | `?1`（application cursor keys）、`?7`（auto wrap）、`?25`（光标可见）、`?2004`（bracketed paste）、`?47/?1047/?1049`（alt screen） |
| 查询 | DSR（`CSI 6n` 光标位置、`CSI 5n` 状态）、DA（`CSI c` → VT220） |
| 其他 | `ESC c` 重置、OSC 0/2 标题、宽字符（`unicode_width`，宽字符占两格） |

**对 agent TUI 的结论**：Claude Code / Codex / Copilot 这类全屏 TUI 所需的 alt screen、真彩、光标定位、清屏、宽字符、bracketed paste **全部具备**。

### 缺失的

| 缺口 | 影响 | 谁会用 |
|---|---|---|
| **鼠标上报**（`?1000/1002/1003/1006/1015`） | 终端里点击/拖选/滚轮全部无效 | vim、htop、less、tmux |
| **光标形状**（DECSCUSR `CSI Ps SP q`） | 程序设的竖条/下划线/方块光标不生效 | vim、多数 TUI |
| **OSC 8 超链接** | 终端里的链接不可点 | 现代 CLI 工具、`ls --hyperlink` |
| **OSC 52 剪贴板** | TUI 无法写系统剪贴板 | vim、tmux |
| **OSC 4/10/11 调色板** | 程序无法改主题色 | 部分工具 |
| **下划线样式**（`4:2` 双线、`4:3` curly）、`58` 下划线色 | SGR `4` 只区分开/关，冒号参数被忽略 | 现代语法高亮 |
| **kitty keyboard protocol** | 无法区分 `Ctrl+I` 与 `Tab` 等 | 最新 neovim |
| **kitty graphics / sixel** | 终端内图片不显示 | 少数场景 |
| 焦点上报（`?1004`）、闪烁字体、上划线等 | 影响小 | 罕见 |

### 一处曾误判（已撤回，留档以免重犯）

初版把 `scroll_up`（`vt.rs:216`）无条件调用 `push_scrollback` 读成「alt screen 会污染 scrollback」。**这是错的**：`push_scrollback` 自身第一行就守卫 `if self.primary.is_some() || self.max_scrollback == 0 { return; }`（`vt.rs:205-208`），而 `primary` 正是 alt screen 期间的标志；`vt.rs:649` 还有 `alternate_screen_restores_the_primary` 测试。

教训：**只看调用点不构成缺陷判定**，要跟进被调函数与既有测试。这条撤回后，nsh 内置仿真核在 alt screen/scrollback 语义上是正确的，Q29 的论证只剩「trait 上限」与「未知风险」。

## 2. Ghostty（libghostty-vt）的覆盖面

- VT 合规：完整（Ghostty 以其兼容性为卖点，xterm/vte 兼容测试覆盖）
- 输入：全部鼠标模式、kitty keyboard protocol、焦点上报
- 输出增强：OSC 8/52/133/4/10/11、下划线样式、光标形状
- 图形：kitty graphics、sixel
- 性能：Zig 实现，page-based grid，大吞吐优化
- Zu 侧已有 Rust 绑定可用：`~/projects/dspo/manox-app/crates/steer-ghostty`（含 `sys.rs` 手写 FFI 与构建脚本）

## 3. 决定性约束：trait 的能力上限

这是本次调研最重要的一条。`Terminal` 组件通过 trait 从仿真核取数，而 trait 的形态是：

```rust
// emulator.rs:111  —— 光标只有位置，没有形状
pub struct TerminalCursor { pub col: u16, pub row: u16 }

// emulator.rs:121  —— 模式只有两项
pub struct TerminalModes {
    pub application_cursor: bool,
    pub bracketed_paste: bool,
}

// emulator.rs:131  —— 事件只有三种
pub enum TerminalEmulatorEvent { Title(String), Bell, Reply(Vec<u8>) }

// emulator.rs:144  —— 取数只有逐行
pub trait TerminalEmulator {
    fn feed(&mut self, bytes: &[u8]);
    fn resize(&mut self, size: TerminalSize);
    fn line_count(&self) -> usize;
    fn line(&self, index: usize) -> TerminalLine;
    fn cursor(&self) -> Option<TerminalCursor>;
    fn take_events(&mut self) -> Vec<TerminalEmulatorEvent>;
    fn modes(&self) -> TerminalModes;
}
```

**推论**：
1. 即使换上 Ghostty，**鼠标在哪儿、点在哪一格、是否按下**都无法传到 `Terminal` 组件——trait 没有这个通道，组件的输入侧也不会发鼠标序列给程序。
2. **光标形状、超链接、调色板**同样没有承载字段。
3. 所以「只换实现」的实际收益 = **解析正确性 + 内部性能**；「鼠标/超链接/光标形状」需要**同时改 nsh 的 trait 与 Terminal 组件**（新增 `TerminalModes` 字段、鼠标事件通道、`TerminalStyle` 的超链接/下划线样式字段、`TerminalCursor.shape`）。

## 4. 性能模型：换核省不掉的部分

`Terminal` 的渲染是虚拟列表，逐行取数：

```rust
// mod.rs:32-36
let count = term.emu.borrow().line_count();
let rows = virtual_list(count, move |at| { ... line(at) ... });
```

`line(at)` 每次把 grid 的一行转成 `TerminalLine { runs: Vec<TerminalRun> }`（文本按样式分组）。这个**每次渲染都发生的转换**，换任何仿真核都省不掉——trait 的 line 级 API 固定了它。Ghostty 的 grid 优势只能在转换之前（解析与滚动）体现，且会被转换成本摊薄。

→ **性能不是换核的主要理由**（除非实测显示 nsh 的解析在大量输出时明显卡顿）。

## 5. 三个选项

| 选项 | 内容 | 拿到什么 | 代价 |
|---|---|---|---|
| **A 用 nsh 内置** | 现状 | agent TUI 全功能；缺鼠标/超链接/光标形状 | 零 |
| **B 换 Ghostty（仅实现）** | `steer-ghostty` 绑定 + `TerminalEmulator` 实现 | 解析正确性（修 alt 污染）、内部性能 | 1–2 周；**鼠标/超链接仍然没有** |
| **C Ghostty + 扩 nsh 终端栈** | B + 扩 `TerminalModes`/`TerminalStyle`/`TerminalCursor`/鼠标事件通道 + 组件输入输出。**注意**：`provide_context` 是 owner 子树作用域，`Terminal` 在渲染时 `use_context` 拿 factory，所以 TSX 直接用 `nsh/base` 的 `<Terminal>` 拿不到——需要一个自己的 Rust 包装组件（`provide_context` + 渲染 `nsh_base::term::terminal()`） | 完整终端体验 | 数周；需要维护 nsh fork（或上游 PR） |

## 6. 建议

按「能跑的原型车」精神：

1. **M2（终端里程碑）先用 A 跑真 TUI 冒烟**，产出一份缺陷清单：alt screen 污染、宽字符对齐、光标、颜色、滚动手感。
2. **立即修 alt screen 缺陷**：这是明确 bug，改动小（`alternate()` 加标志 + `scroll_up` 判断），优先给 nsh 上游提 PR；上游不接则本地 fork 打补丁。
3. **「换 Ghostty + 扩 trait/组件」打包成一个独立的「终端增强」里程碑**（暂定 M-tty），而不是在 M2 里就换。理由：只有 B 拿到的收益（解析正确性）不足以支撑提前换；要换就一次换到 C（顺带拿鼠标/超链接），否则会换两次。
4. 若实测发现 nsh 的解析缺陷大面积（不止 alt 污染），则 M2 直接跳 C，跳过中间的 B。

**这与「一开始就用 Ghostty」的原意并不冲突**：做终端时就定下 Ghostty 为终态，只是把「换核」与「扩 trait」合成一次动作，避免换两遍。

## 7. 待实测清单（M2 冒烟要回答的问题）

1. Claude Code / Codex / Copilot 在 nsh `Terminal` 里的渲染是否完整（alt screen、颜色、光标、宽字符）。
2. alt screen 污染 scrollback 的实际观感（vim、less、tmux）。
3. 大量输出（`cargo build`、`yes | head -n 100000`）时的滚动帧率与 CPU。
4. 中文/emoji 宽度与图表对齐（`unicode_width` 对 emoji ZWJ 序列的处理）。
5. 鼠标在 TUI 里的缺失是否被用户感知（Claude Code 是否依赖鼠标）。
