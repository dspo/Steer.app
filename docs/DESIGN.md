# Zu 轮廓设计系统（M6 · Casing）

**参照**：[Steer.app](https://steer.app) 的浅色外壳。目标是同一张界面在 1100pt 宽下并排看时，
表面语言、密度与反馈一致，而不是复制它的功能。本文记录 M6 的 token、几何、表面语言和动效清单；
实现落在 `theme.json`、`ui.tsx` 与各屏的 TSX 中。

## 1. 设计立场

安静、精确、可读。层级靠间距、字重和一条 hairline，而不是到处加卡片、颜色或阴影。主任务
（继续对话 / 输入下一条消息）只保留一个焦点：画布和 composer。外壳不抢内容。

- 颜色只从 `theme.json` 的语义 token 取；`*.tsx` 里没有 raw hex / `rgb()` / `black` / `white`。
- 半径来自有限阶梯：8（控件）、10（行）、12（表面/对话框/composer）。
- 阴影只给浮起的东西：选中行、Launcher/对话框、菜单、toast。平面区域靠背景和 hairline 分界。
- 字体走 12 / 12.5 / 13 / 14 / 14.5 / 15 / 18 的窄阶梯；正文 14.5 / 22，次要信息 10.5–12。
- 动效只解释变化：120ms 颜色/透明度，180ms 背景 + 阴影。没有装饰性动画。

## 2. Token

`theme.json`（light / dark 各一份，均含 `shadow`、`shadow-strong`、`toast`、`scrim`）：

| 角色 | Light | Dark | 用途 |
|---|---|---|---|
| `background` | `#ffffff` | `#131316` | 画布、composer 外沿 |
| `card` | `#ffffff` | `#1b1b1f` | 选中行、composer 卡片、对话框 |
| `sidebar` | `#fafafd` | `#171719` | 项目/会话栏 |
| `inset` | `#f7f7f9` | `#101013` | 页签条、Launcher 底、工具卡 |
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
shadowRaised()  // 0 1px 2px + 0 8px 24px shadow      Launcher / 菜单 / toast
shadowDialog()  // 0 2px 6px + 0 18px 44px shadow-strong  对话框
motion.fast     // 120ms ease-out：background/opacity/color/border
motion.medium   // 180ms ease-out：background/opacity/box-shadow
motionStyle()   // 用户在系统里减少动态效果时返回 {}
```

`applyScrollbarTheme()` 在 `App.tsx` 启动时把 `Scrollbar.setTheme` 设成同一套 token：
3pt 轨道、圆角 thumb、`scrolling` 模式、120ms 进出、900ms 停顿；减少动态效果时由运行时
跳过动画。

## 3. 外壳几何

在 1100 × 800 与 900 × 600 两个尺寸实测（macOS 开发宿主，2× 截图）：

| 区域 | 值 | 说明 |
|---|---|---|
| 窗口 | 默认 1200 × 800，最小 900 × 600 | `nsh.json` |
| 隐藏标题栏 | 48 | 交通灯由系统画；内容区自带安全区 |
| 侧栏 | 232pt | Steer 在 1100pt 下为 232；先前 248 是同一比例的 1200pt 估算 |
| 侧栏顶部 | 系统安全区 + 28pt 拖拽条 | 标题行中心约 77pt（Steer 约 81） |
| 顶栏 | 48pt | 容器标题 + 项目/路径 + 引擎控件 |
| 页签条 | 34pt | `bg-inset`；活动页签 32pt 白 pill + 2pt primary 下划线 |
| 状态条 | 24pt | 计数在左，错误/引擎信息/提示在右，错误可收缩 |
| 侧栏行 | 高约 47pt（两行），左右 8pt 边距，半径 10 | 选中为白卡 + `shadowCard()` |
| Composer 卡 | 半径 12，内边距 10/8/6，输入 ≥52，footer 30 | 外沿左右 12、上下 8–10 |
| Launcher 卡 | 560 × auto，半径 12，内边距 20 | 软阴影，居中于 `inset` 底 |
| 对话框 | 480 / 440 宽，半径 12，内边距 20 | `m-auto` 居中（M6 修复了贴左上角） |

对齐脊线：侧栏内容左边 14 / 行文字 17；顶栏左 16、右 12；画布内容左 16；状态条左 16、
右 12。页签条与内容共享左 8 + tab padding 10。

## 4. 表面语言

- **行**：透明底；hover `bg-hover`；pressed `bg-accent/60`；选中 `bg-card` + `shadowCard()` +
  文字 600。hover 时行尾菜单/归档从 `opacity-0` 进到 1（120ms），同一条命令也在菜单和
  键盘路径上。
- **页签**：`bg-inset` 条上，活动页签是白 pill（半径 8 + 软阴影 + primary 2pt 下划线）；
  非活动 hover `bg-hover`；pressed 整体 0.8 透明度。
- **Composer**：外层 `border-t + line`，卡片 `bg-card`、`border-border`、半径 12、
  `shadowCard()`；输入区无边框，焦点用 caret 表达；footer 左侧 10.5pt 提示，右侧 30pt
  圆形发送（primary / destructive / muted 三态）。
- **Launcher / 项目对话框**：同一张白卡：半径 12、`border-border`、20pt 内边距、15pt 标题、
  12pt 标签、10pt 输入半径、8pt 按钮；Launcher 用 `shadowRaised()`，对话框用
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
6. **所有浮层共用一套表面。** 菜单、toast、Launcher、两种对话框都用 12 半径 +
   `border-border` + 同一组 `shadow*`；没有第二套菜单样式。
7. **滚动条主题化。** `Scrollbar.setTheme` 是唯一入口，thumb 颜色来自 token，随
   light/dark 切换。
8. **动效只到颜色/透明度。** `fast` 120ms、`medium` 180ms；不加页面转场、不加列表波浪、
   不加常驻呼吸点。`motionStyle()` 统一处理减少动态效果。

## 8. 与 Steer 的剩余差异

并排看仍能看出、但不属于 M6 范围（不加功能、不改数据面）：

- **内容结构**：Steer 是单文档卡 + 顶部一条标签；Zu 保留 `DockArea` 的面板/页签/拖拽与
  48pt 引擎顶栏，因此 chrome 更高、横向分割更多。
- **窗口标题栏（运行时限制）**：M6 已把 `nsh.json` 的 `titleBar` 设为 `hidden`，并在启动时用
  `Window.set({ titleBar: { style: "hidden", height: 48, … } })` 再设一次；但当前 nsh 0.4.0
  的发布运行时不实现隐藏标题栏（`titleBar().height` 仍为 0，窗口仍显示系统标题条）。因此
  侧栏顶部用反应式 `titleBar().height + 8`：现在回退为 8pt，未来运行时支持后自动变成 56pt。
  这是 M6 与 Steer 最明显的结构性差异，不是样式遗漏。
- **侧栏行**：Steer 行内有模型/时间 chip 和分组的第二层信息；Zu 只有路径、会话数、消息数、
  相对时间。
- **Composer**：Steer 的 footer 有模型/权限 chip；Zu 只有快捷键提示 + 圆形发送。
- **动效**：Steer 有共享的滑动选择条和更长的过渡；Zu 目前是逐项颜色过渡（本里程碑的
  约束），菜单/对话框沿用 NSH 运行时的进出。
- **窗口材质**：Steer 的侧栏/卡片在高光下有更细的边界；Zu 用纯色 + hairline，未引入
  material/glass。
