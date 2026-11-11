# §2.3-15：拖拽 tab 的抽象物

日期：2026-11-12。验收对象是 [plan.md](../plan.md) §2.3 的第 15 项。

## 1. 交付（nsh 0.4.0 暴露的两个挂钩）

- **幽灵（`renderDragPreview`）**：拖动时跟随指针的是一张 tab 形状的卡
  ——144 宽、同圆角、`bg-card` + `shadowCard`、带自己的图标与标题
  （`sheetGlyph`/`sheetTitle`）。nsh 的 overlay 让它以 translate 跟指针、
  不吃触摸（`dock_area.rs` 的 drag_preview）。
- **落位指示（`renderDropIndicator`）**：落在页签条的槽位上（`index` 非空、
  `side` 为空）时画 **2pt brand 竖线**（高 22、圆角 1）——"会落在哪两个
  tab 之间"；落到组分割/边缘（`side` 非空）保留现有块状指示
  （`rounded-lg border-2 border-brand bg-brand-tint`，即 `dropIndicatorClass`
  的样子）。

## 2. 验收证据

"拖动时能看到'正在拖什么'与'会落在哪儿'"：拖动中指针处是那张 tab 卡
（标题即所拖 sheet），槽位处是 2pt 竖线、分割/边缘处是块状框——两者的
渲染器都在 `shell.tsx` 的 DockArea 上，`dock-move`/`containers.ui` 的拖拽
与布局用例全绿（262/262），`nsh check`/`cargo check`/打包冒烟 ✓。

## 3. 已知边界（源的占位）

"源 tab 变占位（opacity 0.35）"需要 DockTab 暴露 `dragging` 标志——nsh
0.4.0（pin `506b5392`）的 `DockTab` 只有 panel/group/index/active/closable/
zoomed，拖动中源槽位照常绘制。这属于 nsh 侧改动：按 Q54 的升级规则
（checkout 改动 → bump pin → 引擎测试/UI 测试/DockArea 冒烟 → decisions
记录）单独成批，不在应用侧伪造。幽灵本身已表达"正在拖什么"，验收的可
见性成立。
