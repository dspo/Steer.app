# T1 — 会话转录的证据（issue #20 / Q110）

交付分支 `feat/transcript-tui`（独立 worktree），合并请求指向 `origin/main`。
按 issue §6 的五个工作流推进为四个自包含提交（协议 / store / 渲染 / 字体）+ 文档；
store 与渲染合并且门禁必须同绿，故未拆成两个分支提交，差异见 PR 描述。

## 门禁（2026-11-16）

分支基于 `origin/main` caa0b97（rebase 到最新，含 #21 脚手架收敛、#24 测试目录
收拢、#23 内置扩展 registry；测试在 `app/tests/`，stub 为 bun 运行的
`acp-stub-agent.ts`，转录 wire facts 已移植）。

| 门禁 | 结果 |
|---|---|
| `pi-harness bun test` | **142 pass / 0 fail**（11 个文件：mapping/replay/app 覆盖 `_meta.pi`、settle、`_meta.zu`、`_zu/session_banner`、replay 同词，含 #23 的 registry/precedence/settings） |
| `cargo test -p zu-app font_tests` | **2 pass**（`geist_ships_under_one_family`、`geist_mono_ships_under_one_family`） |
| `nsh check app` | ✓（含 Rust crates check/build） |
| `node script/check-layers.mjs` | ✓（0 例外） |
| `nsh test app` | **246 用例：238 通过 / 0 失败 / 8 skip**（8 skip 是 manox gate 的静默跳过） |

早前 `acp-load-probe` 的失败是 `pi-harness/dist/pi-acp` 未构建的环境性失败；
`bun install && bun run build`（`bun run dev` 也会做）之后全绿。本分支新增
`transcript.test.ts` 与 `chat.ui` 的 T1 用例，全部通过。

**#23（内置扩展 registry）之后的 banner 语义**：banner 的 extensions 列表
过滤 pi CLI builtin 的 `hidden` 扩展与宿主匿名 inline 管线（`<inline:N>`——
常驻 gate/prompt-section/dispatch 对）；registry 的命名 `zu:*` 条目（可被
`disabledExtensions` 关闭）保留在列表里。skills 走同一 `getSkills()`——
内置扩展经 `additionalSkillPaths` 带来的技能与其他技能同源聚合，不重复、
不遗漏；collision diagnostics 照常进 warnings。

## headless 覆盖（`app/tests/chat.ui.test.tsx` + `app/modules/pi/transcript.test.ts` + `app/acp.test.ts`）

- banner：转录首行显示 `pi 1.5.0 · qwen3.8-flash · thinking high` 与
  `2 个技能 · 1 个扩展 · 1 条警告`；折叠时 warnings 常显；展开出现
  skills/extensions/warnings 明细；空会话不渲染 banner（`chat-empty` fixture，
  Q121 起空会话就是同一张对话页）。
- 用户横幅：`user-message` 整宽横幅 + `❯`；`user-copy` / `entry-copy` 存在，
  且行上**没有**「复制」文字（图标 + tooltip）。
- 思考：settle 后折叠为 `思考 · 4.2s`；点击展开出现纯文本正文；流式尾部在
  streaming fixture 断言（`thinking-stream`）。reducer 断言同一消息的多个
  thought delta 累加，且被工具卡 flush 的回复在 settle 时换回自身 entry id。
- 工具卡：execute 显示 `$ bun test login`、末 12 行、`exit 1`、`1.8s`、
  `共 36 行 · 打开完整输出`；展开出现完整输出；read 默认只有
  `path · lines 1–80`；edit 显示 `+1 −1`，展开出现 diff 行。
- 结算后的页脚：`streaming-caret` 不存在（turn 结束不再闪蓝色光标）。
- reducer：live 与 replay 同 entries（id/顺序/文本）、思考先于文本、settle 带
  `durationMs/stopReason/error`、乐观用户行换键、工具 partial 替换、end 带
  diff/`_meta.zu`（`transcript.test.ts`）。
- 传输：stub 的 replay 带 messageId/`_meta.pi`、prompt 流以 settle marker 收口
  （`acp.test.ts`、`fixtures/acp-stub-agent.ts`）。

## 头less 宿主的已知限制（诚实记录）

- **小按压目标在虚拟化 List 里命中不稳定**：复制图标（`user-copy` /
  `entry-copy`，h-6 w-6）的 headless press 有时不派发（大命中区的折叠头/卡头
  稳定）。因此复制闪光（icon 翻 check 900ms）没有 headless 断言；复制行为
  （`Clipboard.writeText` + 闪光）需 `--target macos` 真机确认。
- **`--target macos` 的多数用例仍受开发宿主限制**（`could not load module
  'zu/native'`，与 M8/M10 记录的同一 nsh 开发宿主限制）；但 chat.ui 的
  fixture 用例在该目标下可运行并出图，已拍到：
  `ui-transcript-light.png`、`ui-transcript-dark.png`（`setColorScheme`
  前后，已核对深浅 token 生效）、`ui-transcript-tools.png`（execute 展开 +
  回答 Markdown/代码块）、`ui-s23-16-geist.png`（取代 `ui-s23-16-lilex.png`）。
  中文回退与 mono 对齐已看：无行高跳变，未调 `lineHeight`。
- **中文斜体未验收**：思考流式尾部只在 streaming 期间可见，上述截图都是
  settled 状态；斜体保留现状，待真机/streaming 截图验收，不达标按计划退化
  为「次要色 + 左线」。

## 字体

- 七个 TTF 来自 Google Fonts CSS API（桌面 UA，静态实例），name table 的
  typographic family 分别为 `Geist`（300/400/500/600）与 `Geist Mono`
  （300/400/500），已用 name-table 解析核对；crate 的 `font_tests` 守字面。
- 中文回退系统字体（Geist 无 CJK）；行高未发现跳变，未调 `lineHeight`。

## 交付后目视修正（2026-11-16 21:xx）

真机目视发现多处，已在本分支修复并复核：

1. **思考块只显示最后一个 delta**：`reduceThoughtChunk` 的 fallback 直接新建
   draft，覆盖了之前的 thoughts；改为在同一个 draft 上累加。另补
   `TranscriptState.activeId`：同一 pi message 被工具卡 flush 后，settle
   marker 以 pi entry id 到达时把已 flush 的行换 key 并 settle，不再新增
   空行、也不留下假 streaming。
2. **turn 结束后页脚仍闪蓝色光标**：`waitingForWords` 在 `!streaming()` 时
   返回 `true`；改为 `false`，并加「settled 转录无 `streaming-caret`」断言。
3. **复制是文字**：新增 `copy` 线图标与共享 `CopyButton`；用户横幅、回答、
   工具动作行都改成 icon-only，文字只留在 tooltip/accessibility。截断行的
   「打开完整输出」重复文案也收成一个 `file` 图标（行文本只留 `共 N 行`）。
4. **工具卡在缺 `output` 的行上崩溃**：真机报 `cannot read property 'length'
   of undefined`。`transcriptRows` 现在对 tool 行补 `output: ""` 与
   `diffs: []`（schema 变化/热重载留下的旧行不再让卡片抛错），`outputLines`
   也做同样的兜底；新增 reducer 断言。
5. **冷启动恢复的会话只显示 tab title + Hero**：模块 `initialize` 只做
   `refreshSessions()`，restored layout 的 `hydrateVisible()` 跑在侧栏文件
   scan 之前，拿不到 path/cwd 就静默返回。先改成 scan 落地后再 hydrate；但
   这段空窗仍会露出 Hero，所以 `hydrateSession` 现在**在找 path 之前**就置
   `loading`（10s 自清门），`ChatView` 优先画 `HistoryLoading`（manox 的
   pixel meerkat 移植）；scan 重试打开、replay 落定后再切转录。
6. **工具调用像有 titlebar**：现在**没有 title/header/kind 图标/caret**；整块
   `bg-inset` 就是点击目标，第一行直接是 `$ command` / `path · lines` /
   `path +A −D`，duration/exit 在 command 行右侧，状态只留 running 的 6pt
   pulse 或 failed 的 alert。无 body 的工具行用 `tool-fallback` 显示 title，
   不再出现空块。
7. **展开旧工具行仍崩溃**：`ExecuteBody`/`ReadBody`/`SearchBody`/`OtherBody`
   直接读 `entry().output.length`，而 `transcriptRows` 的归一化没有覆盖
   List 回收后的旧行。所有读取点改为 `entry().output ?? ""`（`diffs` 同理），
   不再依赖归一化先到。
8. **用户行去掉 `❯`**：改成整宽横幅左侧 3pt `primary` 竖条（有意偏离 Pi
   TUI），对应用户要求；复制仍是一个图标。
9. **加载页黑白**：meerkat 的颜色改成 `theme.json` 的 `meerkat-*` 数据色
   （浅色/深色各一套），TSX 仍无 raw hex。
10. **每块两个复制控件 / Bash 展开白色子卡片**：复制/打开动作统一放到**块内
    左下**，且只有一个上下文相关的复制图标（diff > output > command/input；
    read/edit 另有一个 `code` 图标的 open）；展开输出不再套 `bg-background`
    子卡片。嵌套复制按压不会折叠卡片（测试断言）。
11. **空卡片/Edit 错位（List 回收）**：`EntryRow` 的 kind 分支、`ToolBlock`
    的 body 分支原来是在组件体里取一次快照；List 把 cell 复用给另一个 entry
    时就会残留上一行。现在 kind/body/标题/复制文本全部走 `entry()` 的响应式
    `If` 与 getter，并新增 `entry-recycle.tsx` 用例覆盖 tool→tool→user→assistant。
12. **思考块的专门控件**：去掉 `思考 >` header/caret/时长；展开时就是思考
    文本本身，折叠时**首行 + `...`**；字体 **15/22 与正文同号**，只保留次要色。
    点击文字任意位置切换。
13. **正文字重**：正文加 Geist **Light 300**（`Geist-Light.ttf`，Rust font
    测试同步），用户/回答/思考/子代理正文都用 300；标签与标题仍 400–600。
14. **工具折叠**：折叠态只显示**输入首行 + `...`**（execute `$`、read
    `read path:from-to`、edit `edit path`、write `write path`、search
    `grep pattern`、other `name JSON`）；展开才显示输入和输出。
15. **全文本可选择**：banner/用户/回答/思考/工具/note 的根 View 都设
    `userSelect: "text"`，TextView 自身 `selectable`，所有文字可拖选并
    `Cmd+C`。
16. **两种底纹**：用户横幅 `bg-muted`，工具块 `bg-inset`，两档分开（还原
    Pi TUI 的用户消息/工具调用区分）。
17. **工具 footer**：状态（running spinner / failed alert / done check）、
    duration、exit code、复制/open 全放在块底一行，与正文之间用 1px
    `line`、`opacity 0.7` 的细线分隔；移除了 `$` 前的状态标记。
18. **工具输入**：read/write/edit 的输入显示 `name + path`（read 带
    `:from-to`），用**前景色**；输出用次要色。write 的结果文本
    （`Successfully wrote…`）现在展开可见。
19. **工具字体**：Geist Mono **15/22、weight 300**（新增
    `GeistMono-Light.ttf`，与正文同号、比正文略轻）。
20. **输出选择与收尾**：输出渲染为一个 Text（保留换行），鼠标可跨行选中；
    reducer 统一去掉输出末尾连续的 `\n`/`\r`/空格。

21. **基础字号**：对齐 Pi TUI 所在终端的 13/18（终端 sheet 也是 13/18），正文/思考/工具/子代理都改 13/18；工具 mono 300。
22. **拷贝控件对齐**：用户/回答的 copy 向文本左缘微移（offset -2/-4）；工具 footer 的 copy/open 改到左侧，所有块统一左对齐。
23. **省略号自适应**：去掉手动追加的 `...`；思考折叠行和工具预览都用 `numberOfLines:1`，只在横向放不下时由平台加省略号。
24. **footer 高度**：按钮 h-5（20pt）、meta 11/14、块内 gap 4，footer 不再喧宾夺主。
25. **Braille spinner**：running 状态改用 `⠋⠙⠹…` 10 帧点阵 spinner，80ms/帧，`reduceMotion` 冻结；不再用蓝色圆点。每个 spinner 用自己的 frame signal，多个 running 卡不再互相抢帧。
26. **流式思考全量**：thinking 流式时展示全部行（原来只显示末 2 行）；首行是触发条，其余行用 `Collapsible reveal` 展开/折叠（native spring），settled 默认折叠。
27. **滚动不被拉底**：`List` 的 `onScroll` 不再依赖 `dragging`；滚轮/拖拽上滑立即把 following 置 false，流式更新不再 `scrollToEnd`，回到底部恢复。
28. **PR review nits**：`native/src/lib.rs` 字号注释 4 sans/3 mono；`pi-session.ts` 删除游离的 `/**`；BrailleSpinner 改 per-card frame。
29. **有序列表选择/拷贝**：本 PR 无法在应用侧修 nsh `TextView` 的选择 range，已提 issue #37（序号/文本选择不一致，复制应带序号）。

截图已重拍：`ui-transcript-light.png`、`ui-transcript-tools.png`、
`ui-transcript-loading.png`；全量门禁 262 用例 254 通过 / 0 失败 / 8 skip。

## Rebase 到 #32 之后

分支已 rebase 到 `origin/main` 922c454。main 的结构化工具结果通道（#32）与交互工具 mailbox（#33）保留：harness 的 `_meta.zu` 同时带 `details` 与 `durationMs/exitCode/truncation`；客户端 `ToolMeta.details` 存在且 registry 有 renderer 时 `ToolBlock` 渲染 `tool-card`，回放无 details 时回紧凑块。`pi-tool-details` 与 `tool-cards` fixture/测试已迁到新的 Entry/reducer 模型。hero 的无效 `shadow-[...token(border)]` class 改为 token 的 inline boxShadow，启动不再 warn。

## 真机待确认（Live smoke 清单）

- [x] `--target macos` 拍图：`ui-transcript-light.png`、`ui-transcript-dark.png`、
      `ui-transcript-tools.png`、`ui-s23-16-geist.png`；浅色/深色、中文回退、
      mono 对齐已看。
- [ ] 中文斜体验收（思考流式尾部，需 streaming 期截图）；不达标按计划退化
      为「次要色 + 左线」。
- [ ] 复制闪光（banner 行 / 回答行 / 工具输出）与剪贴板内容。
- [ ] live smoke（真实一轮）：banner 的 skills/extensions 与 `pi` CLI 启动屏
      一致；Bash 工具显示真实 exit code 与 duration；思考流式可见；重开会话
      replay 仍有思考/工具输出（统计缺省）。
