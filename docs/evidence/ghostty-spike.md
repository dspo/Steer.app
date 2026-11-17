# Ghostty 终端（2026-11-16）

> 实现记录（从 spike 分支演化而来，文件名沿用）。目标不是「换 `TerminalEmulator` 实现」，
> 而是**自己做一个终端组件**：libghostty-vt 只当仿真核，grid、cursor、鼠标、选择、滚屏
> 都由 Zu 的 Rust 组件画和收，不经过 nsh 的行模型 trait。

## 1. 结论

| 问题 | 结果 |
|---|---|
| libghostty-vt 能进 Zu 的 native 构建吗 | **能**。静态链接，复用 manox 的 pinned rev / zig / sha256 / 缓存脚本；本机直接命中 `~/.cache/steer-ghostty`，没有重付 4 分钟 zig 构建 |
| 能绕开 `nsh/base` 的 `Terminal` 自己画吗 | **能**。`zu/native` 新增 `GhosttyTerminal` 组件，绝对定位逐 run 绘制；sheet 的 TSX 只改一个 import |
| 现有终端验收还过吗 | **过**。`terminal.ui.test.tsx` 5/5（shell/resize/title、vim alt screen、htop、reflow、滚屏+选择） |
| 缩小窗口会 reflow 吗 | **会**。300 个 0 在 165 列→126 列后仍完整，截图见 `ghostty-spike-wide.png` / `ghostty-spike-narrow.png` |
| 光标形状 / 鼠标 / 滚屏 | 光标形状按 ghostty 的 `visual_style` 画；鼠标 press/release/motion/wheel 发 SGR（legacy 兜底）；滚屏走 ghostty viewport，输出在底部时自动跟随 |
| 选择 / 复制 / 链接 / 剪贴板 | 拖选 + 双击词 + 三击行，**释放即复制**（copy-on-select）；单击不置一格高亮。选择存 **screen 行**、复制走 ghostty `selection_format_buf`，跨滚动与 scrollback 都不错位。Cmd-hover 高亮 OSC 8 链接、Cmd-click 打开；OSC 52 写入接 `set_clipboard`。**Cmd+C 已在 headless 与 macOS 真宿主验证**（前提：`nsh.json` 的 `capabilities.clipboard: true`，本次已补） |
| 键盘 / IME / scrollbar | 按键经 ghostty `KeyEncoder`（DECCKM、modifyOtherKeys、kitty flags）；IME composition 画在光标处，隐藏 input 也移到光标格（候选窗锚点随之）；右下滚动条可点/拖 |

## 2. 代码地图

```
native/ghostty/                 zu-ghostty：libghostty-vt 的安全封装（无 nsh 依赖）
  build.rs                      manox 的构建脚本，缓存变量改名 ZU_GHOSTTY_CACHE
  src/sys.rs                    手写 FFI：manox 的子集 + DATA_MODE/TOTAL_ROWS/
                                MOUSE_TRACKING/CURSOR_VISIBLE、GhosttyCell/CELL_DATA_WIDE、
                                ROW_CELLS_DATA_RAW
  src/lib.rs                    Terminal（write/resize/scroll/reset/title/bell/replies/
                                modes/mouse/cursor/rows/scrollbar/hyperlink/text_all/OSC 52）
                                + RenderState snapshot（Cell 带 text、wide、显式 fg/bg）
                                + KeyEncoder（kitty 键盘）
native/src/terminal.rs          GhosttyTerminal 组件：props/events/ref 与 sheet 现有调用同形；
                                grid 绘制、隐藏输入、按键、粘贴、鼠标/滚屏、选择、链接、
                                scrollbar、IME 与 cursor
native/src/lib.rs               #[native_module("zu/native")] 注册组件
app/domains/terminal.ts         re-export（层门禁要求 zu/native 只在 domains）
app/modules/terminal/view.tsx   只换 import：`GhosttyTerminal as Terminal`
app/terminal.ui.test.tsx        原有 3 个用例 + 缩小 reflow 用例
docs/evidence/ghostty-spike-*.png
```

PTY 侧没有改动：`native/src/pty.rs` 仍是唯一进程事实，组件只接收 `onData` / 发 `onResize`。

## 3. 跑过的验证

```
cd native && cargo test -p zu-ghostty -p zu-app
  zu-ghostty 10 passed（write/title、reflow、DEC modes/mouse、scrollback、全文 text_all
  含 scrollback、selection_text 跨 scrollback、OSC 52、OSC 8 链接、scrollbar、kitty 键编码）
  zu-app 75 passed（含 SGR/legacy 鼠标与 motion、宽字符/spacer run、带背景/反色的尾空格、
  选择 span、word 判定、IME 输入格随滚动的换算）

ZU_SKIP_LIVE=1 nsh test terminal.ui.test.tsx
  7 passed（原 3 + reflow + ref 滚屏/选择 + CJK/emoji + Cmd+C 复制）

ZU_SKIP_LIVE=1 nsh test terminal.ui.test.tsx --target macos --filter "reflows|scrolls"
  2 passed，截图写入 /tmp 后复制到 docs/evidence/

ZU_SKIP_LIVE=1 nsh test .
  236 tests: 222 passed, 0 failed, 14 skipped（1m23s，ZU_SKIP_LIVE）

CNB PR #27
  check-and-test: success（8m03s；Linux amd64 冷构建：toolchain → lint(layer) →
  lint(rust，含 libghostty-vt zig 构建) → build(nsh check) → test → manox → pi-harness）
```

滚屏/选择现在有自动验收：fixture 的 Up/Bottom/Select 按钮调用 ref 的
`scrollBy/scrollToBottom/selectAll/selectedText`，测试断言视口行与人选文本；
SGR wheel/motion 的字节编码有单测。真实鼠标拖选与 Cmd-hover 链接仍需
`--target macos` 手工验收（headless 没有指针移动与修饰键按住）。

截图（真实 macOS 宿主、1200×800 → 1000×650）：

- `ghostty-spike-wide.png`：151×35，`REF` + 300 个 0 两行，彩色 prompt，bar 光标；
- `ghostty-spike-narrow.png`：126×26，同样的 300 个 0 重排成三行，无截断；
- `ghostty-spike-selection.png`：滚到顶部后全选，视口整屏高亮，selection 文本可读；
- `ghostty-spike-cjk.png`：`CJK中文🙂END` 在网格里占对宽度，光标与后续文本不错位；
- `ghostty-spike-longline.png`：200 列长行按 grid 换行、无 `...`，`PROMPT> ` 与光标同一行；
- `ghostty-spike-pi.png`：pi TUI 的 reverse-video composer 光标可见。

## 4. 实现要点（给转正用）

1. **组件必须自己持有 emulator**：`Term` 里 `Rc<RefCell<Inner { term, render_state, cols, rows }>>`，
   TS ref 的 `write/reset/text/focus` 都打到这里；没有 replay 之外的协议。
2. **回调不要借用同一个 RefCell**：ghostty 的 `WRITE_PTY` / bell / title 回调在 `vt_write`
   内同步触发；把 replies/bell/title 落到独立的 `Rc<RefCell<Pending>>`，写完再 drain 成事件。
3. **render state 是 viewport**，不含 scrollback：全文 `text()` 走 formatter（见 6），
   `viewport_text()` 才是渲染器看到的那几行。
4. **宽字符**：row cells 没有 wide 字段；读 `ROW_CELLS_DATA_RAW` 再用
   `ghostty_cell_get(WIDE)`。spacer tail 不占列，wide cell 占两列。
5. **颜色**：不把 ghostty 的解析色直接写进 UI；用 `GhosttyStyle` 的 tag 区分 Palette/RGB/默认，
   默认色取 `nsh_core::element::tokens()` 的 `foreground`/`background`，保持 nsh 的调色板。
6. **`text()` 用 formatter**：`GHOSTTY_FORMATTER_FORMAT_PLAIN`、`trim`、不 `unwrap`，一次调用
   拿到 scrollback + screen；另有 `viewport_text()` 给「用户看到的」和测试用。
7. **ghostty 的 viewport 不自动跟随输出**：在 `write` 前读 scrollbar，若视口在底部
   （`offset + len >= total`）就在写后 `scroll_bottom()`；用户滚上去后不再抢回。
8. **鼠标协议**：SGR release 是同一 button + 小写 `m`（不是 +3）；motion 加 32 位；
   X10（`?9`）只报 press；`on_mouse_move` 的 `pressed_button` 决定 1002 是否上报。
9. **选择是视口矩形**：anchor/focus 都是视口坐标；滚动后高亮跟着格子走，不跟内容走
   （转正要改成内容锚点，或用 ghostty 的 tracked grid ref）。
10. **nsh 的方法返回值**：Rust 返回 unit 的方法在 JS 里是同步 `void`，返回值的是
    `Promise`（`text/selectedText/viewportText`）；`TerminalRef` 的 TS 类型按此写。
13. **复制/剪贴板要能力**：`app/nsh.json` 必须有 `capabilities.clipboard: true`，否则
    `set_clipboard` 静默失败（OSC 52 写入、Cmd+C 都受影响）。
14. **IME 候选窗锚点是我们的 input 位置**：隐藏 `input()` 在 grid 内 absolute 到光标格
    （`viewport_cursor` 把 active-area 行减去 viewport 滚动量），平台 IME 的
    `firstRect` 随之落在光标处。
11. **构建位置**：nsh 生成的 app crate 写死 `build = false`，所以 build.rs 必须放在 path dep
    crate（`native/ghostty`）。这个 crate 不能自带 `[workspace]`（会报 multiple workspace
    roots），设成 `native` workspace 的成员即可。
12. **nsh 不需要改**：没有用 `TerminalEmulatorFactory` / `provide_context`；鼠标坐标来自
    `PressEvent.position` / `MouseEvent.position`，`on_press_down` / `on_mouse_up` /
    `on_mouse_move` 与 `CompositionChange` 都在，SGR 编码与拖选不需要 upstream 扩 trait。

## 4.1 实机回归修复（2026-11-16）

用户真机跑 dev 实例后的五个问题，逐条定位与修复：

| 现象 | 根因 | 修复 |
|---|---|---|
| `>` 提示符、光标、输入文本不在同一行 | 每个 run 的文本被装进「列宽」盒子；字体实际 advance 比测出的 cell 宽一点，nsh 文本就加 `...` 截断。终端 grid 本身已按宽度换行，于是可见文本被截在上一行、光标/回显在下一行 | 文本 run 不再设 `.w()`，按自然宽度绘制（背景盒仍按列宽）；长行/换行提示符完整显示，光标回到同一行。截图 `ghostty-spike-longline.png` |
| 一行文本没显示全，后面补 `...` | 同上 | 同上 |
| 选中即拷贝 | 之前只在 Cmd+C 时复制 | 拖选/双击词/三击行在**释放时自动复制**；单击只清选择、不置一格高亮 |
| 鼠标点任何地方闪一下光标 | 按下即设 1 格选择，释放又清掉；且每次按下都重新 focus 隐藏 input | 按下只记 pending，移动超过原格才成选择；已聚焦时不再重复 focus |
| 进入 pi TUI 后无光标 | pi 的 composer 光标是 **reverse-video 空格**；行尾裁剪只按 `bg` 判断，把这类带样式的空格删了 | 行尾只裁「完全默认」的 run（`plain()`）；pi 光标恢复。截图 `ghostty-spike-pi.png` |
| 中文输入法候选不显示/不跟随 | 隐藏 input 只有 1px 且在视口左下；组合期间清空 value 可能取消 IME 会话 | input 移到光标格；组合期间不清空 value。真机中文候选仍需人工复验 |
| 输入时 `>` 轻微抖动 | 两个来源：①每次写入把整棵行树推倒重建（文本视图逐键重建，字形亚像素漂移）；② IME input 随每键移动、在提示符上反复合成 | ①行改为「`rows_count` 信号 + 每行 `computed`」：快照缓存进 `FrameData`，行元素只在 resize 重建，按键只更新所在行（曾试 `virtual_list`，真机 sheet 里不实例化行导致白屏，已回退为普通列）；② input 保持 1px 且**只在组合开始时**跳到光标，平时不动 |
| 候选框只跟第一次输入 | 提交后立刻清空 input 的 value，打断了平台刚要收尾的 IME 会话，后续组合不再重新锚定 | `anchor_cell` 只在**组合开始**时跳到当前光标；组合提交后延迟 120ms 再清 value（`ime_grace`），让会话先关闭 |
| 打开终端不自动聚焦 | sheet bind 时的 `focus()` 早于 input 布局，平台忽略；之后无人再聚焦 | 新增 `autofocus` prop（sheet 传 `visible()`）：首次布局聚焦一次；`view.tsx` 在变为可见 tab 时 effect 再聚焦 |

### 4.2 第三轮实机回归（2026-11-17）：渲染逐行对齐 nsh

用户再报：光标离文本有一段距离、`>` 输入时向下动一下、候选框仍只出现一次。裁决：**停止自创近似，把 nsh `Terminal` 的行渲染逐行移植**（`nsh-base/src/term/mod.rs` 的 `row()`）：

| 项 | 我此前的自创 | 现在的移植（= nsh） |
|---|---|---|
| 行结构 | 文本 run 各自包一层绝对定位 view（后来的自然宽度流式也对不齐） | **一整行一条流式 `text("")` + inline 样式 run**；背景/选区/hover 下划线收进**一个绝对定位层**（`left_0/right_0`） |
| 光标 | 自定 shape 三元组 + 半透明块 | **nsh 原样**：`absolute().top_0().bottom_0().left(cw*col).w(cw)` + `app_class(cursor_class)`；shape 只改宽度（bar=2px）或压到 2px 高（underline） |
| cell 宽度 | 一次性测量（computed 只依赖 font/size） | **每个 rev 重测**：dev host 经 HTTP 取 crate 字体，首测可能落在回退字体上，把错误的 advance 锁死——光标与文本的横向漂移即此 |
| 隐藏 input | 锚点跟随光标移动（候选框锚在动的原生视图上） | **固定在终端左下角**（nsh 原样 `left_0().bottom_0().w(1px)`）：锚永不动，候选框每次组合都出现在同一处 |

## 5. 还没做的

受上游限制的项与「上游已满足、我们还没做」的项统一记在
[`docs/upstream-watch.md`](../upstream-watch.md)（bump 必查）。本报告只留 spike 结论：

- 上游已就绪、值得先做：ghostty 的 selection API（内容锚定选择/精确复制）与
  mouse encoder（替掉手写 SGR）；
- 真正的上游缺口：同步剪贴板读（OSC 52 读）、非主键 press、native component 的
  Cmd+C hook（待真机验证）、render-state 的 cell 级超链接；
- 本地 TODO：链接常态样式、边缘自动滚动、CI 冷构建、性能/内存压测。
  （IME 锚点与 Cmd+C 已在本次关闭，见台账。）

## 6. 成本观察

- 本机首次 `nsh check app`：1m32s（含依赖与组件）；之后增量 <1s。
- headless 终端套件：~10s；macOS 单用例：~6s（含建 host，缓存后 ~0.5s 建）。
- 静态库 12 MB；release 链接增量未测。
- 代码量：`native/ghostty` 约 2.1k 行（FFI 0.9k + wrapper 0.7k + 构建 0.4k），
  组件 `native/src/terminal.rs` 约 1.6k 行（含单测）。

## 7. 下一步建议

1. 转正前把**选择改成内容锚点**（ghostty tracked grid ref）并接上边缘自动滚动；
2. OSC 52 读取、右键 paste、OSC 8 常态下划线与点击策略按产品口味补齐；
3. 加 `ZU_TERMINAL=ghostty|nsh` 一个版本的默认切换与回退；
4. 用真 `yes`/`cargo build` 与 5000 行 scrollback 压一次帧率/内存，再决定默认；
5. 若接受不了维护量，退回到「只补 reflow 上游」的 A 方案仍有明确收益。
