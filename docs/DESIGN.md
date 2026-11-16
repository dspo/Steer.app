# Zu 轮廓设计系统（M6 · Casing）

**参照**：[Steer.app](https://steer.app) 的浅色外壳。目标是同一张界面在 1100pt 宽下并排看时，
表面语言、密度与反馈一致，而不是复制它的功能。本文记录 token、几何、表面语言和动效清单；
实现落在 `theme.json`、`ui.tsx` 与各 sheet 模块的 TSX 中。模块边界（谁拥有 composer、谁拥有消息区）
见 [sheet-module-ARCHITECTURE.md](sheet-module-ARCHITECTURE.md)；本文只定视觉。

## 1. 设计立场

安静、精确、可读。层级靠间距、字重和一条 hairline，而不是到处加卡片、颜色或阴影。主任务
（继续对话 / 输入下一条消息）只保留一个焦点：画布和 composer。外壳不抢内容。

- 颜色只从 `theme.json` 的语义 token 取；`*.tsx` 里没有 raw hex / `rgb()` / `black` / `white`。
- 半径来自有限阶梯：8（控件）、10（行）、12（表面/对话框/composer）。
- 阴影只给浮起的东西：选中行、Hero/对话框、菜单、toast。平面区域靠背景和 hairline 分界。
- 字体走 12 / 12.5 / 13 / 14 / 14.5 / 15 / 18 的窄阶梯；正文 14.5 / 22，次要信息 10.5–12。
- 动效只解释变化：120ms 颜色/透明度，180ms 背景 + 阴影。没有装饰性动画。

## 2. Token

`theme.json`（light / dark 各一份，均含 `shadow`、`shadow-strong`、`toast`、`scrim`）：

| 角色 | Light | Dark | 用途 |
|---|---|---|---|
| `background` | `#ffffff` | `#131316` | 画布、composer 外沿 |
| `card` | `#ffffff` | `#1b1b1f` | 选中行、composer 卡片、对话框 |
| `sidebar` | `#fafafd` | `#171719` | 项目/会话栏 |
| `inset` | `#f7f7f9` | `#101013` | 页签条、Hero 底、工具卡 |
| `popover` | `#ffffff` | `#1e1e23` | 菜单/弹出层 |
| `toast` | `#ffffff` | `#1e1e23` | toast 面 |
| `foreground` | `#1d1d1f` | `#e8e8ea` | 主文字 |
| `muted-foreground` | `#6e6e73` | `#a0a0a8` | 次要文字、标签 |
| `faint` | `#8b8b91` | `#6f6f78` | 元数据、占位提示 |
| `border` | `#dedee3` | `#2d2d33` | 卡片/对话框/输入框边界 |
| `line` | `#e4e4e8` | `#26262b` | 区域分隔 hairline |
| `hover` | `#f0f0f3` | `#202025` | 行/按钮 hover wash |
| `accent` | `#f1eefc` | `#2a2340` | pressed wash、轻选择 |
| `primary` | `#6d5ae0` | `#8b7cf6` | 主操作、页签指示器 |
| `ring` | `#b8b0e8` | `#6e6e78` | focus outline |
| `brand-tint` | `rgba(109,90,224,.12)` | `rgba(167,139,250,.16)` | 计数 badge、拖放高亮 |
| `shadow` | `rgba(20,18,40,.08)` | `rgba(0,0,0,.40)` | 行的 1px 投影、卡片外沿 |
| `shadow-strong` | `rgba(20,18,40,.14)` | `rgba(0,0,0,.55)` | 对话框远投影 |
| `scrollbar-thumb` | `color-mix(muted-foreground 50%, background)` | 同左 | 滚动条 thumb |
| `scrim` | `rgba(17,17,20,.38)` | `rgba(0,0,0,.55)` | 对话框 backdrop |

`ui.tsx` 提供三种阴影与动效 token，避免每屏自己拼字面值：

```ts
shadowCard()    // 0 1px 2px shadow                    选中行
shadowRaised()  // 0 1px 2px + 0 8px 24px shadow      Hero / 菜单 / toast
shadowDialog()  // 0 2px 6px + 0 18px 44px shadow-strong  对话框
motion.fast     // 120ms ease-out：background/opacity/color/border
motion.medium   // 180ms ease-out：background/opacity/box-shadow
motionStyle()   // 用户在系统里减少动态效果时返回 {}
```

`applyScrollbarTheme()` 在 `App.tsx` 启动时把 `Scrollbar.setTheme` 设成同一套 token：
3pt 轨道、圆角 thumb、`scrolling` 模式、120ms 进出、900ms 停顿；减少动态效果时由运行时
跳过动画。

## 3. 外壳几何（Casing II 目标）

**目标形态**：窗口一层 `sidebar` 底色，顶栏与侧栏**同材质、无分隔线**，内容区是内嵌的白色圆角卡片——即 ZCode 截图的样子，而不是"三条独立栏各自带边框"。

| 区域 | 值 |
|---|---|
| 窗口 | 默认 1200×800，最小 900×600 |
| 窗口底 | 全窗 `sidebar`（顶栏、侧栏、卡片四周的空隙都是它） |
| 顶栏 | 40pt，**无底部分隔线**；左：侧栏开关；右：VS Code、工具 overflow；中心不放控件（保留窗口拖拽区） |
| 侧栏 | 232pt（可拖拽 200–360），**无右边框**；与卡片之间约 10pt 间距 |
| 内容卡片 | `card` 白底，radius 14，四周 8–10pt；卡片是唯一的"内容容器" |
| 卡片内页签条 | 34pt，`card` 底 + 底部 hairline（与内容分隔） |
| Composer | 卡片内，左右 24、底部 16，**无独立底色** |
| 红绿灯 | 直径 12、间距 8、左边距 16、与顶栏垂直居中 |

对齐脊线：卡片内左边 24、右边 24；侧栏内容左边 14 / 行文字 17；顶栏左 16、右 12。

### 3.1 内容卡片

一张卡片包住该容器的整个画布：页签条在卡片顶部，panels 与 composer 在卡片内。卡片本身 `overflow: hidden` + radius，panels 的分割线只画在卡片内部。切容器时卡片内容整体替换，窗口其余部分不动。

### 3.2 页签（段落切换器）

外壳的 sheet 页签条取画廊 `look/tabs.tsx` 的 `tabsLook`（"A section switcher"）：一条沉入卡片的
胶囊轨道，选中的页签是**一枚**浮起的药丸，在两个页签之间弹簧移动。

分工：`ui/ui.tsx` 出几何与外观（`switcher` 常量表、`switcherTrack()`、`switcherBar()`、
`switcherTab()`、`switcherTabFrame()`、`switcherPill()`）；`canvas/tab-switcher.tsx` 画轨道和那枚
药丸；`shell/shell.tsx` 只把 `DockArea` 的 bar 交给 `switcherBar()`（排布，不画）。

| 项 | 值 |
|---|---|
| 轨道 | 高 34、`radius 17`、`inset` 底、1pt `border`、`shadowInset()` 内阴影；内边距 3、页签间距 2 |
| 药丸 | 高 26、`radius 13`；`card` 底 + `border` 边 + `shadowCard()`；位置 = 选中索引 × （页签宽 + 间距），按 `motion.move`（504 / 38）弹簧过去，reduce motion 时直接落位 |
| 宽度 | **均分轨道**（画廊的 `fill`）：`switcherTabFrame()` 给每个页签 `flexGrow 1` + `flexBasis 0`，下限 72；页签增多时一起挤压，标题 13pt/500 截断 |
| 图标与标题 | 12pt；两档 tint 交叉、标题 `muted-foreground` → `foreground`，与药丸同一枚弹簧（画廊的 `TabTitle`） |
| 悬停 | 未选页签 `hover` 底；选中不动 |
| 分层 | 轨道与药丸在 `DockArea` **之前**声明、`pointerEvents: none`：页签的标签画在它上面，卡片画在它下面。`groupClass` 因此不铺底色（内容框自己铺 `background`） |
| 关闭控件 | 右侧 20pt 热区，`opacity 0` → hover 1，图标 `close` 10pt |
| 新增页签 | 轨道的右端留 34pt 给常驻 `+`（在轨道内，像 macOS 分段控件的尾部动作），在该 panel 打开 `home:{containerId}`（Hero） |

`+` 是 20pt 的 ghost 按钮（图标 11pt、`muted-foreground`），垂直居中于组标题栏。nsh 0.4.0 的
tab bar 没有尾部插槽，它由 app 覆盖层画在每组右端（[architecture.md](architecture.md) §4.2）。

为什么药丸不在 `renderTab` 里：`DockArea` 把每个页签画在自己的 bar 之上，一个页签的
`background` 画不出跨越兄弟的位移——跨页签的位移只能来自比页签更低、比 bar 更高的一层。
所以轨道与药丸由覆盖层画，页签只剩标签。**不要**把轨道搬回 bar：bar 一旦自己铺底，就把
覆盖层的药丸盖住。

**不要**为了位移动画自己接管 tab bar：拖拽换位、分组、`+` 的几何都在 `DockArea` 里；
覆盖层只读 `layout()`，不参与命中。

#### 内容：sheet 归注册表，画布只是投影

**不变量：一个 sheet 的 body 由注册表拥有，不由任何画布拥有。画布只决定它*放在哪*、*是否显示*，
永不决定它*是否存在*。**

nsh 里组件体只跑一次，行按 key 保留（`coding-guides.md` 的表）；所以 body 消亡只有一种原因：
它从树里消失。过去画布由 `layout()` 派生、切容器时整棵树被换掉，浏览器 sheet 因此每次回来都重新加载。
现在：

- `core/projection.ts`：纯数据。`tabBarBoxes` 给出每组的矩形，`groupFrames` 去掉 38pt 页签条，
  `sheetFrames` 给出每个 sheet 的 `{ 矩形, offset, place, shown, near }`——
  `offset = place × 组宽`，`place = 位置 − 显示中位置`。
- `canvas/sheet-host.tsx`：**一个扁平列表**，`Each of={openSheetIds} key={id}`，覆盖活动画布与
  被搁置画布的并集（`heldLayouts` 在切走时存下，**scratch 画布同样入库**——否则 scratch 上的浏览器页
  切容器再回来照样重载）。并集最多留 `PARKED_CANVASES`（4）个画布，按最近显示淘汰最旧的：
  常驻的内存与后台活动因此有界，代价是被淘汰的那个容器回来时从 store 重新加载。切页签、切容器、
  拖页签、分屏、zoom 都只改这些 sheet 的矩形与 offset，行的 key 不变，body 不重生：
  **浏览器页面不重载，终端不丢屏，对话不丢滚动位置**。
  **正在显示的画布不入 parked 集**（`activateCanvas` 的 `unpark`）：它的 sheet 由 `layout()` 拥有，
  留一份旧拷贝会让一个刚被关掉的页签继续挂载（一个没有页签能到达的 frame、WebView/PTY 继续跑），
  并占掉 LRU 名额。parked 的 sheet 按它自己那份布局给出 `place/offset`（冻结），所以回访时
  `place` 不变、不会可见地滑一下。
- 每个 sheet 是一个裁到组内容框的 frame，body 在 frame 内按 offset 平移。**显示页与左右邻居
  （`near`）是 `visible`**（滑动要画它们），其余是 `visibility: hidden`——引擎对它的处理覆盖绘制、
  命中、键盘焦点与读屏（`view.rs` 的 `can_target`、access 的隐藏），停放的 sheet 因此不必再手工围栏。
  邻居仍保留 `pointerEvents: none`：它们被 frame 裁掉，但布局仍在原位，命中测试按布局走。
- 位移与药丸共用 `motion.move`（504 / 38）：一组页跟着药丸一起滑，旧页滑出、新页滑入。
  **按 `place` 判定**：`place` 变了才滑；只变尺寸（窗口、分屏、同宽度的布局变化）直接落位
  （`set`）——换的是尺寸，不是页签。
- 显示中的 sheet 最后绘制，滑动途中按它仍然是命中的那一页。

层序：`SheetHost` 在 `DockArea` **之后**（拿到命中）、`+` 之前；`DockArea` 的内容框是一个洞
（`pointerEvents: none`，不铺底色），空画布的空态自己 `pointerEvents: auto`。页签条与轨道在
`DockArea` 里，仍在 sheet 之下、`+` 之上。`DockArea` 自己的分组拖放色块因此被 sheet 盖住——
拖页签到内容区时看不到那块预览。**这不是一行能修的**：`renderDropIndicator` 拿到的只有
`{ group, side, index }`（没有矩形），而它的元素画在 `DockArea` 的树里、注定在 sheet 之下；
把整个 `SheetHost` 挪到 `DockArea` 之前可以让它压在上面，实测却让内容区的按压落到错误的节点上
（`id:hero-browser` 被报 covered）。正解是上游让 `DockArea` 把指示器放进浮层，或给出该区域的矩形。

**不要**把 body 放回 `renderPanel`：`DockArea` 只画显示中的面板，切容器时它的整棵子树会被换掉，
body 就会重生（这正是本设计要消除的那种依赖）。

验收：`--target macos` 下给浏览器 body 加一个挂载计数（临时），开一页 → 切容器 → 切回，
计数保持 `1`；切页签同样保持 `1`。`core/projection.test.ts` 钉住矩形、offset、shown 与
zoom/compact 的投影。

### 3.3 顶栏无 picker（2026-11-11 调整）

顶栏不再有会话/容器 picker。切容器只经侧栏（项目 → 容器）；「新建」/⌘N 仍是 scratch 画布。顶栏中心留空，
只作为窗口拖拽区；不引入替代的居中控件。（命令面板 `⌘K` 是后续独立功能，不在这里补位。）

### 3.4 字体

| 范围 | 字体 |
|---|---|
| sheet 内容（会话正文、编辑器、终端、Diff） | **Lilex**：`Lilex-Light.ttf`(300) + `Lilex-Medium.ttf`(500)，注册为同一 family；正文 400 就近取 300，加粗 600+ 就近取 500 |
| 轮廓（顶栏、侧栏、页签、按钮、对话框） | 系统字体（不变） |

文件放 crate 的 `assets/fonts/`，经 `src/lib.rs` 的 `registry.assets(assets!())`
壳带：引擎在首帧前按文件 name table 的 family（`Lilex`）注册，dev server 按
登记伺服、打包时拷进包；TS 只有 `fonts.ts` 的 `SHEET_FONT` 常量，四类 sheet
内容以它为 `fontFamily`。不走 TSX 的字体 import（fixture 的打包根在
`fixtures/` 下，绝对路径 URI 会在 `--target macos` 的宿主 404）。

### 3.5 工具行图标

Hero 的两排动作使用各 CLI 的品牌图标（24pt 光学尺寸）：

| 动作 | 图标来源 |
|---|---|
| 终端 | 现有 `terminal` 线稿 |
| 浏览器 | 现有 `globe` |
| Claude Code | `manox-app/crates/agent-ui/assets/icons/claude.svg` |
| Codex | 同上 `codex.svg` |
| GitHub Copilot | 同上 `githubcopilot.svg` |
| Pi | `pi-coding-agent.svg` |

图标以 `tint` 注入（单色渲染），两种外观下都保持对比度；不引入彩色品牌色，避免与 2026-Light 冲突。

### 3.6 Composer

| 项 | 值 |
|---|---|
| 分割线 | 只与 composer 同宽（卡片内 24pt 边距之间），**不铺满 panel** |
| 布局 | 输入框一行；下一行右侧：`模型 · thinking`、`context%`、主按钮 |
| 主按钮 | idle：↑ 发送（`primary` 圆钮 32pt）；streaming：■ 停止（同位置、`destructive`） |
| 权限 | 模型菜单底部的「权限」小节：Ask / Auto / Read-only，当前值带勾；切换走 `session/set_mode` |
| 排队/引导/打断 | 运行中：输入框右上 `⋯` 菜单；排队走本地队列（`排队 N 条` 行），审批/询问时发送暂缓 |
| 斜杆命令 | 输入 `/` 在输入框上方弹出候选（name + 一句说明），样式与 Menu 同套；本地命令本地执行，distro 的命令表按原文提交 |
| 移除 | 项目目录、访问模式、语音（保持移除） |

斜杆命令的映射（pi 1.5.0 为准；表即 `slash.ts` 的实现，候选弹层逐条列"命令 + 一句说明"）：

| 命令 | Zu 的做法 |
|---|---|
| `/model` | **本地**：打开 composer 的模型菜单（`openModelMenuRequest`） |
| `/thinking` | **本地**：循环下一个思考档位（`session/set_config_option` 的 `thought_level`） |
| `/compact` | **本地**：`/compact` 作为 prompt 交给 distro，进度走 `compaction_update` |
| `/clear` | **本地**：清空本地会话视图（历史留在磁盘，重开即回来） |
| `/new` | **本地**：开 scratch 的 Hero（与「新建」同一入口） |
| `/resume` | **本地**：打开侧栏的会话搜索 |
| 扩展/模板/技能命令 | distro 的 `available_commands_update` 提供 name + description，**弹层逐条列出**；选中后按原文进 `session/prompt` |
| 其余未知命令 | 同样按原文进 `session/prompt`，由 distro 的分派器决定；**没有静态"不支持"表** |

输入 `/` 时弹层即过滤，Enter 对 `/` 草稿执行命令而不是发送；命令表热更新时候选就地刷新。
会话内的模型/档位/审批走 ACP 协议（`configOptions`/`modes`），不再有 spawn env 或"ACP 下不可用"分支。
本节描述的是 pi 面当前的 hairline composer；manox 面在自己的模块里有独立 composer（Steer 风格）。
Pi 会话的完整交互状态（审批卡、elicitation、命令候选、恢复/休眠）以
[pi-acp-IMPLEMENTATION.md](pi-acp-IMPLEMENTATION.md) §9 为准；视觉 token 仍取本文。

**项目信任对话框**（`app/ui/trust.tsx`，挂在 App 根部，不属于任何 sheet）：

| 项 | 值 |
|---|---|
| 触发 | `session/new` 期间 distro 通过 ACP `elicitation/create` 提问；此时还没有会话 sheet |
| 标题 | 13.5/600 alert 图标 + “信任这个项目？” |
| 正文 | distro 的消息（路径 + 将加载的 settings/extensions/skills/packages/MCP）；12/18 `muted-foreground` |
| 操作 | 主操作“信任并加载”（`primary`）；次操作“暂不信任”（outline） |
| 行为 | 接受写 Pi trust store；拒绝只影响本次；关闭/Esc 等于拒绝；按 cwd 去重 |

### 3.7 拖拽页签

- 拖起：源页签立即变占位（`opacity 0.35`，无背景与指示器）；
- 幽灵：页签形状（同宽 240、同圆角、带图标与标题），`scale 1.02`、`opacity 0.92`、`shadowRaised`；
- 落位：`DockDropIndicator.index` 非空时，在该位置画 2pt `brand` 竖线（高 22、圆角 1）；落到组内容区用现有块状指示；落到边缘用现有分栏指示。

### 3.8 归档动效

容器无 sheet 时：侧栏行高度 32→0、`opacity` 1→0（180ms ease-out），同组其余行用 `LayoutAnimation` 上移；随后画布切换到相邻容器（或 scratch）。

## 4. 表面语言

### 4.1 动作可用性矩阵

三种画布上下文下，每个动作是否可用，以及它在容器内的语义（§2.1.1 是行
Terminal/Claude/Codex/Copilot/Pi 的定义来源）：

| 动作 | 容器内 | scratch + 项目 | scratch 无项目 |
|---|---|---|---|
| 浏览器（Hero、顶栏） | ✓ 在该容器开 `webview:{containerId}:{n}` | ✓ 开 `webview:scratch:{n}`，铸容器时随迁 | ✓ 同左 |
| 终端 / Claude / Codex / Copilot | ✓ 该容器的终端资源 `terminal:{containerId}:{n}`（F2） | ✓ 先铸容器再接：external 容器（"进程即容器"） | ✗ 先选项目 |
| Pi | ✓ 原生 `pi` CLI 的终端资源（F3），不动 Zu 会话 | ✓ 先铸 Pi 容器，再在其中开 TUI | ✗ 先选项目 |
| composer | ✓ 该容器的 captain 会话 | ✓ 铸 Pi 容器并把首条消息发进去 | ✓ 铸 Chats 容器（聊天是合法目标） |
| 文件 / 更改 / 历史 / 问题（顶栏 ⋯） | ✓ | ✗ 需要容器：先提交 composer 或选一个动作 | ✗ 同左 |
| 项目 chip | 只显示归属，不可改 | ✓ 选项目 / Chats / 新建项目 | ✓ 同左 |

"scratch 无项目"指 chip 停在 Chats：可以开始一段 Chats 对话，但铸工作区的动作
（终端/TUI）要求先选项目，避免把进程绑到一个任意目录。禁用不是隐藏：按钮仍在位，
只是 `opacity-40`，读屏与 tooltip 仍说明它是哪个动作。


- **行**：透明底；hover `bg-hover`；pressed `bg-accent/60`；选中 `bg-card` + `shadowCard()` +
  文字 600。hover 时行尾菜单/归档从 `opacity-0` 进到 1（120ms），同一条命令也在菜单和
  键盘路径上。
- **页签**：`bg-inset` 条上，活动页签是白 pill（半径 8 + 软阴影 + primary 2pt 下划线）；
  非活动 hover `bg-hover`；pressed 整体 0.8 透明度。
- **Composer**：外层 `border-t + line`，卡片 `bg-card`、`border-border`、半径 12、
  `shadowCard()`；输入区无边框，焦点用 caret 表达；footer 左侧 10.5pt 提示，右侧 30pt
  圆形发送（primary / destructive / muted 三态）。
- **Hero / 项目对话框**：同一张白卡：半径 12、`border-border`、20pt 内边距、15pt 标题、
  12pt 标签、10pt 输入半径、8pt 按钮；Hero 用 `shadowRaised()`，对话框用
  `shadowDialog()`；backdrop 用 `bg-scrim`。
- **Menu**：`bg-popover`、半径 12、`border-border`、`popupStyle` + `shadowRaised()`；行
  半径 8、10pt 横内边距、hover/focus `bg-hover`、pressed `bg-accent`。所有菜单共用一套。
- **Toast**：`bg-toast`、半径 12、`border-border`、`shadowRaised()`、12pt 文案；hover
  `bg-muted`、pressed 0.9；整体可点按关闭。
- **对话框**：`m-auto` 居中；标题 15、正文 12、选项 12、按钮 12；主操作 primary、取消
  outline；Escape/backdrop 由 `Dialog` 负责。
- **滚动条**：属于滚动区域，贴 trailing 边；thumb 用 `scrollbar-thumb` /
  `scrollbar-thumb-hover`。

## 5. 交互状态

| 状态 | 行 | 页签 | 按钮（顶栏/表单） | Composer 发送 |
|---|---|---|---|---|
| Rest | 透明 | 透明 | ghost / outline / primary | muted 圆 |
| Hover | `bg-hover` | `bg-hover` | `bg-hover` / `bg-primary/90` | `opacity-90`（可用时） |
| Pressed | `bg-accent/60` | `opacity-80` | `opacity-70` | `opacity-70` |
| Focus-visible | 2pt `outline-ring` | 2pt `outline-ring` | 2pt `outline-ring` | 2pt `outline-ring` |
| Selected | 白卡 + 软阴影 + 600 | 白 pill + primary 下划线 | — | — |
| Disabled | — | — | 无 hover/pressed | 无 hover/pressed |
| Loading | — | — | 引擎阶段文字 | streaming 时变 Stop |

每个可点元素都有 hover 与 pressed；行用颜色，不用缩放；图标按钮用 0.6–0.8 透明度。
focus 用 outline 而不是 ring，因为选中行的 `boxShadow` 是内联 style，会覆盖 ring。

## 6. 动效清单（Motion inventory）

在写屏之前列，交付前逐条核对。`motion.*` 之外没有自造时长；`motionStyle()` 在
`reduceMotion()` 为真时返回空对象。

| 变化 | 工具 / token | 减少动态效果 | 验证 |
|---|---|---|---|
| 侧栏项目/容器/会话行 hover | transition-colors + shadow，`medium` 180ms ease-out | 立即 | 真实 macOS 截图（Beta 行 hover） |
| 行 pressed | `accent/60` 背景变化，`medium` | 立即 | 静态实现；未截到按下帧 |
| 选中行出现/切换 | 背景 + `shadowCard()`，`medium` | 立即 | 静态截图；过渡帧未截 |
| 行尾操作 hover 显示 | opacity 0→1，`fast` 120ms | 立即 | 截图中随行 hover 出现 |
| 项目头拖放高亮 | `bg-brand-tint`，`fast` | 立即 | 未截（需要拖动） |
| 顶栏/侧栏图标按钮 hover | `bg-hover`，`fast` 120ms | 立即 | 实现；仅部分截到 |
| 按钮 pressed | opacity 0.6–0.8，`fast` | 立即 | 实现 |
| 页签 hover | `bg-hover`，`medium` 180ms | 立即 | 实现 |
| 页签选中切换 | 白 pill 背景 + 阴影，`medium`；无滑动选择条 | 立即 | 真实截图（选中态） |
| 页签 pressed | 整体 `opacity-80` | 立即 | 实现 |
| Composer send ↔ stop | glyph 立即切换；按钮底色 `fast` | 立即 | 实现；需要流式回合才能截到 |
| Composer 输入焦点 | caret primary，无过渡 | — | 实现 |
| 发送可用/不可用 | 背景 + glyph tint，`fast` | 立即 | 真实截图（禁用态） |
| 菜单打开/关闭 | `Menu` 自带 popup 进出；应用不另加 | 运行时 | 未截 |
| 对话框打开/关闭 | `Dialog animation="fade"`；应用不另加 | 运行时 | 调用帧未截 |
| Toast 出现 | 无入场动画：新 toast 直接进入栈 | — | 原因：连续 toast 不做逐条滑入，避免闪烁 |
| 引擎阶段文字 | 无动画（文字本身即时变化） | — | — |
| 流式回复 | 位置/文字实时更新；`Dot` 不呼吸 | — | 原因：状态文字已经表达，不添加常驻动画 |
| 新消息到达 | 无入场动画，列表保持读者位置 | — | 原因：避免长转录反复动画 |
| 容器行拖动 | 拖动中行 `opacity-50`，释放即落位 | — | 代码路径；未截 |
| 滚动条出现/消失 | 原生 120ms 进出，900ms idle | 运行时跳过 | 主题化；未截 |

未验证项不是“已通过”，只是 M6 当前环境只能截静态帧：真实宿主截图覆盖了 rest/hover/
selected/dark/900 断点；过渡中间帧与 streaming/menu/dialog 动画需在交互录制里复核。

## 7. M6 决策

1. **侧栏 232，而非 248。** Steer 在 1100pt 窗口下侧栏 232pt；248/1200 = 20.7%，
   232/1100 = 21.1%，两者比例一致。为了并排同一宽度，统一到 232。
2. **顶部让出系统安全区。** 隐藏标题栏已经占 48pt；侧栏再放 28pt 拖拽条，标题行中心
   ≈77pt，既避开交通灯又贴近 Steer 的 81pt。原 44pt 使标题偏低 16pt。
3. **页签条用 `inset` 底。** 白 pill 需要在稍暗的条上才读得出来；原先条与 pill 都是白，
   选中态只剩一条下划线。
4. **Dialog 加 `m-auto`。** `Dialog` 的桌面层不会自动居中 popup；项目对话框和扩展
   选择框此前贴在窗口左上角。这是 M6 发现并修掉的既有缺陷。
5. **悬停/按下/焦点成对出现。** 行加 hover + pressed + focus-visible；图标按钮统一
   radius 8 与 outline focus；菜单行加 focus/pressed。焦点用 outline，避开选中行内联阴影。
6. **所有浮层共用一套表面。** 菜单、toast、Hero、两种对话框都用 12 半径 +
   `border-border` + 同一组 `shadow*`；没有第二套菜单样式。
7. **滚动条主题化。** `Scrollbar.setTheme` 是唯一入口，thumb 颜色来自 token，随
   light/dark 切换。
8. **动效只到颜色/透明度。** `fast` 120ms、`medium` 180ms；不加页面转场、不加列表波浪、
   不加常驻呼吸点。`motionStyle()` 统一处理减少动态效果。

## 8. Casing II 的验收

与 ZCode 截图并排：底色、圆角、间距、字号、页签挤压、composer 右对齐在肉眼不可辨的范围内；拖拽页签时能看到"正在拖什么"与"会落在哪儿"；容器无 sheet 时侧栏行有退场动效。

## 9. M8 文件、编辑器与 Diff（表面与动效）

M8 不新增 token、半径或阴影：文件树、编辑器与 Diff 都复用 M6 的 `card`/`inset`/`line`/`hover`/`accent`/
`primary` 与 `shadowCard()`/`shadowDialog()`。表面语言沿用同一套：页签条 34pt（DockArea 提供）、面板内容
`bg-card`、hairline 用 `line`、按钮 28pt 高、行 26pt 高。

| 表面 | 几何 | 状态 |
|---|---|---|
| Files 头部 | 左 12 / 右 12，py 8；标题 12/600，路径 10 等宽 `faint`；右侧条目计数 + 刷新 24pt | 计数随目录变化；刷新 hover/pressed |
| 文件树行 | 26pt 高，缩进 14pt/层，左 8；目录箭头 9pt、图标 11.5pt；文件大小 10pt `tabular-nums` | rest 透明；hover `bg-hover`；pressed 0.7；选中 `bg-accent`；展开/收起即时（列表本身无动画） |
| 文件树行尾对比 | 24pt 方形 ghost，图标 12pt `faint` | hover `bg-hover`；pressed 0.6 |
| 树底部条 | 高 26；左 8 / 右 8；选中文档路径 11pt；右侧「对比」28pt outline | 未选时显示「在文件树里选一个文件」 |
| Diff 对话框 | 480 宽、20 内边距、半径 12、`border`、`shadowDialog()`、backdrop `scrim` | 打开/关闭走 `Dialog` 的 `fade`；Escape/backdrop 关闭 |
| Editor 头部 | 高 34；文件名 12/600 + 脏点 6pt `primary`；路径 10 等宽 `faint`；右侧 Find/Save/Reload/Close | Save 主操作（`primary`），无脏/只读/保存中为 40% 透明；冲突 banner 用 `warn` 图标 + 右侧 Reload |
| Editor 查找/替换条 | 高 34，inset 底；两个 28pt 输入（170 宽）+ 匹配数 10.5 `tabular-nums` + 上/下/替换/全部替换 | 查询变化即时高亮；无匹配显示「没有匹配」而非空 |
| Editor | `Editor` 自带主题外观（等宽、muted 行号、faint active line）；只读时仍可选中/复制 | 加载中显示「正在读取文件…」；二进制/过大/冲突共用错误 banner，只读徽标 `warn` |
| Diff 视图 | `DiffView` 自带主题外观；头部两行路径 11.5 + 统计 10.5 `tabular-nums` + split/unified 切换 | 加载/错误居中；相同文件显示「两个文件完全相同」 |

**M8 动效清单**（写屏前列，交付后逐条核对；没有 `motion.*` 之外的时长）：

| 变化 | 工具 / token | 减少动态效果 | 验证 |
|---|---|---|---|
| 文件行 hover | `motionStyle("fast")`（120ms 颜色） | 立即 | headless 未能截帧；代码路径 |
| 文件行 pressed | `active:opacity-70`，`fast` | 立即 | 代码路径 |
| 文件行选中 | `bg-accent` + `fast` | 立即 | headless 状态断言；未截帧 |
| 目录展开/收起 | 无动画（行集合即时变化，`List` 原生滚动） | — | 行为测试（懒加载行） |
| Editor 脏点出现 | 无动画（6pt 圆点即时出现） | — | headless：`editor-dirty-dot` 计数 0→1 |
| Save 可用/不可用 | 背景/透明度 `fast` | 立即 | headless 状态；未截帧 |
| 冲突 banner 出现 | 无入场动画（状态文本即时） | — | headless：`editor-conflict` 出现 |
| 查找条展开 | 无动画（行即时插入） | — | 代码路径 |
| Diff split ↔ unified | `DiffView` 自身重排（无应用动画） | 运行时 | headless 切换后仍显示 |
| Diff 对话框 | `Dialog animation="fade"` | 运行时 | 行为测试（对话框可交互） |
| 页签新增编辑器/Diff | 沿用 M6 的页签 `medium`（180ms 背景/阴影） | 运行时 | 未截帧 |

**验证边界（诚实）**：M8 的可见验证只有 headless 行为测试；`nsh test --target macos` 的开发宿主报
`could not load module 'zu/native'`，截图没有产出。未做 light/dark 双主题截图，因此「Finishing checklist」
的像素项（半径、字体、对齐、hover/pressed 视觉）只核对代码与既有 M6 基线，不声称已逐项截图通过。
运行中的用户 app 未被重启，故本里程碑没有新的真实宿主截图。

## 10. M9 Git（Changes 与 History 的表面与动效）

M9 不新增 token、半径或阴影：Changes 与 History 沿用 M6/M8 的 `card`/`inset`/`line`/`hover`/`accent`/
`primary` 与 `shadowCard()`/`shadowDialog()`/`shadowRaised()`。按钮与输入复用 M8 的 28pt 行内控件语言；
Changes 的文件行 28pt，History 的提交行约 44pt（两行）。

| 表面 | 几何 | 状态 |
|---|---|---|
| Changes 头部 | 左 12 / 右 12，py 6；分支名 12/600 + ahead/behind 10 tabular-nums；仓库根 10 等宽 `faint`；右侧刷新 24pt | ahead 用 `up`、behind 用 `warn`，文字与 tooltip 同时表达，不只靠颜色 |
| 分组标题 | 10/600 `faint` + 「· N」；右侧批量动作 28pt outline，仅在该组有文件时出现 | hover `bg-hover`；pressed 0.7 |
| 文件行 | 28pt；状态字母 10/600 占固定 12pt 车道（M/A/D/R/C/T/U/?）；路径 12 `muted-foreground`，选中 `foreground`；行尾 stage/unstage 24pt 方形 ghost（`plus`/`minus`，12pt `faint`） | rest 透明；hover `bg-hover`；pressed 0.7；选中 `bg-accent`；disabled（动作进行中）40% |
| Diff 头部 | 左 12 / 右 12，py 6；路径 11.5/500；右侧模式（已暂存/工作区）、`+N −M`、split/unified | 模式随选中行；统计来自 git 补丁的解析 |
| 提交行 | inset 底，上边框 `line`；单行输入 30pt + 主按钮 28pt；第二行 10.5 `faint` 的已暂存计数与 Enter 提示 | 无输入或无暂存时主按钮 40% 且无 hover/pressed；提交中标签换「提交中…」 |
| 身份/新建分支对话框 | 440 / 420 宽、20 内边距、半径 12、`border`、`shadowDialog()`、backdrop `scrim`；打开时焦点在第一个输入 | `Dialog animation="fade"`；Escape/backdrop 关闭 |
| 结果提示条 | 列表上方一行，`bg-inset` + 下边框 `line`；图标 `check`/`alert` + 11pt 文案 | 成功与失败各有图标与文字，不只靠颜色 |
| 空/错误/加载态 | 居中：图标 18–20pt + 12pt 标题/正文 + 重试/初始化按钮 | 未初始化仓库给「初始化仓库」主操作 |
| History 提交行 | 两行：subject 12.5；第二行 hash 10 等宽 `faint` · author · 日期 10 tabular-nums | 行不可点，不加 hover（没有可执行动作） |
| 分支菜单 | M6 的统一 `Menu` 表面（`popover`、半径 12、`shadowRaised()`）；当前分支 checked + `menuitemradio`；远程分支 disable；「新建分支…」在底部分隔线后 | 打开态由 `Menu` 负责；Escape/选择关闭 |

**M9 动效清单**（写屏前列，交付后逐条核对；没有 `motion.*` 之外的时长）：

| 变化 | 工具 / token | 减少动态效果 | 验证 |
|---|---|---|---|
| 文件行 hover | `motionStyle("fast")`（120ms 颜色） | 立即 | headless 状态断言；未截帧 |
| 文件行 pressed | `active:opacity-70`，`fast` | 立即 | 代码路径 |
| 文件行选中 | `bg-accent` + `fast` | 立即 | headless：stage 后选中行随分组移动 |
| stage/unstage 图标 pressed | `active:opacity-60`，`fast` | 立即 | 行为测试（stage 后行进入 staged 组） |
| 分组出现/消失 | 无动画（行集合即时变化；不移动选择目标） | — | 行为测试（stage/commit 后分组计数） |
| 提交按钮可用/不可用 | 背景 + 透明度 `fast` | 立即 | headless：提交后行离开 staged 组 |
| 提交中标签 | 文字即时换「提交中…」，无 spinner（操作短、避免常驻动画） | — | 代码路径 |
| 提交/切分支结果提示 | 提示条即时插入，无入场动画（同 M6 toast 的理由） | — | headless：`git-notice` 出现 |
| Diff 加载 → 补丁 | 内容即时替换；`DiffView` 无入场动画 | — | headless：`git-diff-view` 出现 |
| split ↔ unified | `DiffView` 自身重排 | 运行时 | headless：切换后仍显示 |
| 身份/新建分支对话框 | `Dialog animation="fade"` | 运行时 | 代码路径；机器已有全局身份，身份对话框路径未在测试中触发 |
| 页面签（Changes/History） | 沿用 M6 页签 `medium`（180ms 背景/阴影） | 运行时 | 未截帧 |
| checkout 后编辑器内容 | 无动画（文档重载，文字即时替换） | — | headless：`fixture-docs` 从 BASE 变 FEATURE |

**验证边界（诚实）**：M9 的验证同样是 headless 行为测试（真实 `Workbench`、真实仓库、真实 `DiffView`），
没有 light/dark 截图；`nsh test --target macos` 的 development host 仍报
`could not load module 'zu/native'`（与 M8 相同的 nsh 开发宿主限制），因此 Finishing checklist 的像素项
（半径、字体、对齐、hover/pressed 视觉）只按 M6/M8 基线核对代码，不声称已逐项截图通过。运行中的用户 app
没有重启，本里程碑没有真实宿主截图。

## 11. M10 浏览器（表面与动效）

M10 不新增半径、阴影或控件尺寸：Browser sheet 复用 M6 的顶栏/页签条/`card`/`inset`/
`line`/`hover`/`accent`/`primary` 与 `SheetIconButton`/`Chip`/`Glyph`。唯一新 token 是
`web-page`（light/dark 都为 `#ffffff`）：nsh 的 WKWebView 默认透明，页面没有自己的背景时
必须落在 web 画布（白色）上，而不是 app 的深色壳。

| 表面 | 几何 | 状态 |
|---|---|---|
| 浏览器工具栏 | 高 36，左右 8，下边框 `line`；四个 24pt 方形图标（后退/前进/刷新/停止）+ 26pt 地址输入 + 「任意站点」Chip | 后退/前进/刷新/停止按真实 nav state disabled（40% 透明、无 hover/pressed）；地址输入 focus 用 2pt `outline-ring`；Chip 非交互，tooltip 说明任意站点与页面消息边界 |
| loading 轨道 | 高 2，通栏；loading 时 `primary`，静止时 `line` | 颜色 `motionStyle("fast")`；工具栏同时出现「加载中…」文字，状态不只靠颜色 |
| 默认页 | 居中：globe 28pt `faint`、14/600 标题、12 正文、10.5 等宽 `webview.hosts` 行 | 无 URL 时显示；空态不是 WebView，不加载 `about:blank` |
| 错误面板 | 居中：alert 24pt `destructive`、13.5/600 标题、11 等宽错误码、11.5 正文、28pt outline 重试 | `ERR_ACCESS_DENIED`/`ERR_FEATURE_UNAVAILABLE_ON_PLATFORM` 都有码；平台不可用时隐藏重试 |
| 页面消息脚注 | 高 24，上边框 `line`；chat 11pt + 「页面消息 N」+ 10pt 边界说明 | 计数随日志；日志展开时按钮 pressed 态；说明始终可见 |
| 页面消息日志 | 高 112，`bg-inset`，上边框 `line`；头部 22pt + 「清空」，正文 10.5 等宽 `muted-foreground`，最多 50 条 | 无消息显示空态；清空在 0 条时 disabled；日志只在本 sheet，不发送 |
| 页签 | 沿用 M6 的 34pt 页签条；标题 = 页面标题，否则地址，否则「新标签页」 | 选中白 pill + primary 下划线；标题变化即时（页面自己的事件） |
| 非可见页 | 居中 globe 20pt + 11pt 说明「已隐藏：web view 被卸载，显示时按地址重新加载」 | 实际不可见（DockArea 只画活动页签）；用于说明降级语义 |

**M10 动效清单**（写屏前列，交付后逐条核对；没有 `motion.*` 之外的时长）：

| 变化 | 工具 / token | 减少动态效果 | 验证 |
|---|---|---|---|
| 工具栏图标 hover | `motionStyle("fast")`（120ms 颜色） | 立即 | 真实 macOS 截图（rest/disabled）；hover 未截帧 |
| 工具栏图标 pressed | `active:opacity-60`，`fast` | 立即 | 代码路径 |
| 后退/前进/刷新/停止 enabled ↔ disabled | 透明度 + 颜色 `fast`；无布局移动 | 立即 | 真实页面测试断言 enabled；截图可见 disabled |
| 地址输入 focus | 2pt `outline-ring`（无过渡） | — | 代码路径；未截焦点帧 |
| loading 出现/结束 | 轨道 `line` → `primary`，`fast`；「加载中…」文字即时出现/消失 | 立即 | 真实加载截图（静止）；加载中文字在 headless 断言 |
| 页面标题进页签 | 文字即时替换（WebView 事件驱动） | — | 真实页面：Example Domain/Example Domains/DuckDuckGo |
| 页面加载/重挂载 | 原生 WebView 绘制，无应用动画 | — | 真实页面截图 |
| 错误面板出现 | 无入场动画；状态文本即时（同 M6 toast 的理由） | — | 真实 target 截图（fixture 喂同一 reducer） |
| 页面消息日志展开/收起 | 行即时插入/移除（无高度动画），脚注计数即时 | — | 真实 target 截图 + headless 状态断言 |
| 页面消息到达 | 计数与日志文字即时更新；不弹 toast、不闪烁 | — | headless：transport 调用不变 |
| 页签新增浏览器 | 沿用 M6 页签 `medium`（180ms 背景/阴影） | 运行时 | 真实 target 截图（选中态） |
| 深色切换 | 应用 token 随 `setColorScheme` 切换；页面内容由站点/WebKit 决定 | — | 真实 dark 截图；页面自身 `color-scheme` 行为见下 |

**Finishing checklist（M10，按真实截图核对）**：

- **半径**：只复用 8（控件/输入）、10（按钮/行）、12（表面）；无一次性半径；输入与按钮同心。
- **排版**：页签 12.5、标题 14、正文 12、元数据 10.5/10、错误码 11 等宽；最大 14、两级字重；
  次要信息用 `muted-foreground`/`faint`，没有低于 10 的可读正文。
- **间距与对齐**：工具栏 8 横距、36 高；输入与 24pt 图标按钮垂直居中；默认页/错误页居中对齐；
  页脚 24 高、左右 12；日志 112 高、头 22。
- **颜色**：全部来自 token（新增 `web-page`）；loading 同时有文字，错误码是文字，禁用态是
  透明度 + disabled 语义，不只靠颜色。
- **Hover / pressed**：工具栏图标、日志开关、清空、重试都有 hover 与 pressed；disabled 无
  hover/pressed；输入 focus 用 2pt `outline-ring`。
- **状态**：默认页 / loading / 页面 / 失败 / 平台不可用 / 隐藏 / 页面消息空态与有内容态都画了；
  后退/前进/刷新/停止的 enabled 跟随真实 nav state。
- **动效**：全部来自 `motion.*`（120/180ms 颜色/透明度）；无自造时长；`motionStyle()` 处理
  reduce motion；没有常驻动画。
- **深色**：chrome（工具栏/页签/页脚/日志/错误面）通过；`example.com` 页面自身的深色
  `color-scheme` 文字对比问题见下，不计为通过。

**验证边界（诚实）**：M10 有真实 macOS 宿主截图（`nsh test browser.live.test.tsx --target macos`，
浅色/深色/搜索/错误/消息日志，见 [evidence/m10-browser.md](evidence/m10-browser.md)）。Finishing
checklist 的半径/字号/间距/对齐/颜色/hover/pressed/状态/motion 组按截图与代码核对；hover 与按下
中间帧未单独截。深色下 `example.com` 自己画 `#222` 背景但 nsh 0.4.0 的 WKWebView 仍用黑字，
对比度差——这是站点 + web view 上游行为，sheet chrome 正常；不把它算作设计通过。

## 12. M11 LSP（悬停卡与 Problems 的表面与动效）

M11 不新增 token、半径或控件尺寸：悬停卡复用 `popover`/`line`/`code`/`inset` 与
`shadowRaised()`（12 半径，与 M6 菜单/Toast 同一表面语言）；Problems 复用 `card`/
`inset`/`line`/`hover`/`accent`、`SheetAction`/`SheetIconButton`/`Glyph`/`Dot`。
severity 的颜色只用既有 token：error `destructive`、warning `warn`、info `info`、
hint `muted-foreground`——颜色之外每行都有严重度的文字标签（accessibilityLabel）与
来源/错误码文字，不靠颜色单独表意。

| 表面 | 几何 | 状态 |
|---|---|---|
| 悬停卡 | `Overlay` 锚在 `event.pageBounds`（词的范围在根视图的盒子），placement `bottom`、align `start`、offset 6、margin 8；宽 430，最大高 300，超出滚动；内边距 12/10 | 打开即显示，无入场动画（同 M6 toast 的理由）；按卡外、Escape 关闭；`TextView` 支持选取复制，链接报告而不外开 |
| 诊断 | `Editor.diagnostics` 的波浪线 + 行号标记，全部由 `Editor` 绘制（error `destructive`，warning 琥珀，info 蓝，hint muted） | 随 `publishDiagnostics` 更新；编辑后由编辑器按范围携带；非可见 sheet 不丢（诊断在 store，不在组件） |
| Problems 行 | 高约 34：6pt 严重度 Dot、11.5 正文（最多 3 行）、10 等宽 `相对路径:行:列`、右侧 source/code | hover `bg-hover`（120ms 颜色）、pressed `bg-accent`、键盘 focus 2pt `outline-ring`；点击打开文件并 reveal 范围 |
| Problems 头 | 48 高：alert 图标、12/600 标题、10 等宽根路径、10.5 `tabular-nums` 计数、`SheetAction` 全部重启 | 无 server 时「全部重启」disabled（40% + 无 hover） |
| server 条 | `bg-inset`，每行 6pt 状态 Dot + `command · family` + 状态/进度 + 错误文本 + 24pt 重启图标 | starting/ready/indexing/error/stopped 五态；进度文字始终同时出现，不只靠 Dot |
| 空/加载/错误 | 居中：check 18pt（空）、文字标题 12/600 + 11 说明；server 错误另有一条横幅 + 重试 | 空态区分「没有诊断」与「没有可启动的 server」；loading 只在 starting；索引中显示 `$/progress` 标题 |
| 页签 | 沿用 M6 34pt 页签条；标题 `问题 · {folder}`，glyph `alert`/`warn` | 选中白 pill + primary 下划线 |

**M11 动效清单**（写屏前列，交付后逐条核对；没有 `motion.*` 之外的时长）：

| 变化 | 工具 / token | 减少动态效果 | 验证 |
|---|---|---|---|
| Problems 行 hover | `motionStyle("fast")`（120ms 颜色） | 立即 | headless 状态断言；未截帧 |
| Problems 行 pressed | `active:bg-accent`，`fast` | 立即 | 代码路径 |
| 严重度/服务器状态出现 | 即时文字 + Dot 颜色，无布局动画 | — | headless：诊断出现后计数/行文本断言 |
| 诊断到达 | `Editor` 内部重绘波浪线，无应用动画 | — | headless：`editor-diagnostics` 计数从 0 → 2 |
| 悬停卡出现 | 无入场动画；`Overlay` 即时放置 | — | headless：固定 anchor 渲染同一 `HoverCard` |
| 悬停卡关闭 | 即时卸载 | — | 代码路径（press outside / Escape / hover 结束） |
| 索引进度 | 文字即时替换（`$/progress`） | — | headless：受控 server 不推进度，只断言状态文字 |
| 页签新增 Problems | 沿用 M6 页签 `medium`（180ms 背景/阴影） | 运行时 | headless 未截帧 |

**Finishing checklist（M11，按代码与 headless 结果核对；没有真实截图）**：

- **半径**：只复用 8（控件/输入）、10（行）、12（悬停卡/表面）；无一次性半径。
- **排版**：12/600 标题、11.5 正文、10.5/10 元数据、10 等宽路径；最大 12（悬停卡内 12/18）；
  没有低于 10 的可读正文。
- **间距与对齐**：行左右 12、上下 6；头 12/6；server 条 12/6，行内 2；Dot 垂直居中于首行；
  路径与消息左对齐，source/code 右对齐。
- **颜色**：全部来自 token；severity 与 server 状态都有文字，禁用态是透明度 + disabled 语义。
- **Hover / pressed**：行有 hover/pressed；重启按钮有 hover/pressed；disabled 重启无 hover；
  悬停卡可选取、可按卡外/Escape 关闭。
- **状态**：空 / loading / indexing / server error / 无 server / 有诊断 / 已重启都画了；
  计数同时给出 error/warning，不只一个总数。
- **动效**：全部来自 `motion.*`（120/180ms 颜色/透明度）；无自造时长；无入场或常驻动画。
- **深色**：沿用 `popover`/`card`/`inset` 的 token，随 `appearance: system` 切换；未截图。

**验证边界（诚实）**：M11 的验证全是 headless（真实 `Workbench` + 真实 `zu/lsp` 进程；
Problems/诊断/补全/定义是真实路径，悬停卡用同一组件 + 固定 anchor 渲染，服务器是受控
fake）；没有真实 macOS 截图，也没有用真实指针驱动 `Editor` 内部的 hover（headless 的
`app.hover` 只把 `MouseMove` 派给 selector 自身，见 architecture §8.13）。因此本节的
半径/字号/间距/颜色按代码核对，hover/pressed 的中间帧与深色外观未验证；不声称截图通过。
