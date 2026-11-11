# §2.2-8：一体化外壳（S3）

日期：2026-11-12。验收对象是 [plan.md](../plan.md) §2.2 的第 8 项与
[DESIGN.md](../DESIGN.md) §3。

## 1. 交付（对照 DESIGN §3 的表）

| 区域 | 之前 | 现在 |
|---|---|---|
| 窗口底 | `background` | 全窗 `sidebar`（Workbench 根、顶栏、侧栏同材质，卡片四周的空隙都是它） |
| 顶栏 | 36pt + `border-b border-line` + `bg-background` | **40pt、无分隔线**、无独立底色；左开关、右 VS Code/工具不变 |
| 侧栏 | 232pt + `border-r border-line` | 232pt、**无右边框**；与卡片之间 10pt |
| 内容卡片 | 无卡片（DockArea 直接铺 `bg-background`） | **`card` 白卡，radius 14，`overflow hidden`**，四周 8–10pt（上 8、其余 10）；tab bar、panels、composer 全在卡内 |
| 卡内页签条 | `bg-inset` | **`bg-card` + 底部 hairline**（融入卡片；活动页签靠 `shadowCard` + 2pt `primary` 下划线区分，正是 §3.2 的定义） |
| Composer | 卡片内左右 24、底部 24 | 左右 24、**底部 16**（`chat-view.tsx` 的 composer wrapper） |

几何实现：卡片的 `onLayout` 就是 `TabBarPlus` 的测量基准——`+` 的几何仍是
DockArea 自己的坐标，卡片边距不造成偏移（`tab-plus.test.ts` 的纯函数不变）。

## 2. 验收证据

**截图**（`--target macos`，fixture 真窗）：
`docs/evidence/ui-s2-scratch-hero.png` 已用新壳重拍——窗口一层 `sidebar` 底、
40pt 顶栏无分隔线、侧栏无边框、白卡 radius 14 四周留缝、页签条融在卡内。
与 ZCode 截图并排的底色/圆角/间距/字号对齐以此为凭（浅色主题）。

**测试**：252 条全量绿（`nsh test .` 连跑两次；`engine.test.ts` 的 steer 用例
偶发依赖供应商首 token，与外壳无关，失败信息自带会话行与错误）。
`tab-plus.test.ts`（`+` 的几何）、`containers.ui`（切换/缩放）、
`auto-archive.ui`（空态画布改 `bg-card` 后的归档路径）不受影响。

## 3. 门禁

| 门禁 | 结果 |
|---|---|
| `nsh check .` | ✓ |
| `cargo check --all-targets` | ✓ |
| `nsh test .` | ✓ 252/252 |
| `script/bundle-mac.sh` | ✓（Zu.app 133M / Zu.dmg 52M） |

## 4. 已知边界

- 深色模式下卡内 panel 仍各画各的底（`bg-background`/`bg-card` 混用）；浅色里
  两者同为白色不可见。统一卡内表面是后续视觉批次的事（§2.3 的字体/图标之后）。
- 截图是 fixture 真窗（顶部多一行 fixture 探测文本），不是打包后的产品窗口。
- 红绿灯的对齐（直径 12、间距 8、左边距 16）是第 12 项。
