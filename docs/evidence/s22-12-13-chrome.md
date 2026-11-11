# §2.2-12 / 13：红绿灯与 Chrome 式页签宽度

日期：2026-11-12。验收对象是 [plan.md](../plan.md) §2.2 的第 12、13 项。

## 12 红绿灯

`App.tsx` 的隐藏标题栏配置把系统窗口控件放在 **左边距 16、垂直居中于 40pt**
（`controlsOffset: { x: 16, y: 14 }`，40 − 12 / 2）。直径与间距是 macOS 自己
的（12pt、8pt）——"原生比例"由系统绘制保证，Zu 只负责放对位置。顶栏左翼的
内容起点读 `titleBar().left`（宿主上报的让位宽度）+12，不会压到红绿灯。

截图（`--target macos`）里系统控件不进位图，"与原生窗口并排看不出差异"以
offset 数值 + 系统绘制为凭；真机并排对比留给发布前的目检。

## 13 tab 宽度 Chrome 式

`renderTab` 的固定 144pt 改为 DESIGN §3.2 的一组：**minWidth 72、maxWidth 240、
flexGrow 0、flexShrink 1**；标题本来就有 `numberOfLines: 1`，挤压时截断。
panel 变窄或 tab 增多时按比例均匀压缩。`TabBarPlus` 的 `+` 画在组标题条右端
（30pt 预留带），与单个 tab 的宽度无关，几何不受影响（`tab-plus.test.ts` 不变）。

截图 `docs/evidence/ui-s2-scratch-hero.png` 已用新宽度重拍（单 tab 收缩到
内容宽，不再固定 144）。

## 验收证据与门禁

- `containers.ui.test.tsx` 8 条（切换/缩放/归档/`+`）全绿——页签宽度变化后
  DockArea 的行为不变；`tab-plus.test.ts`（`+` 的纯几何）不变。
- `nsh check` ✓、`cargo check --all-targets` ✓、`nsh test .` ✓ 262/262（一次
  steer 用例遇供应商慢首 token，重跑全绿）、`script/bundle-mac.sh` ✓
  （133M / 52M）。

## 已知边界

- 红绿灯的直径/间距无法由应用配置（系统原生）；若未来 nsh 暴露样式化控件，
  再对齐 DESIGN 的精确数值。
- 均匀挤压的视觉断言依赖真窗（headless 读不到样式）；以重拍的截图为凭。
