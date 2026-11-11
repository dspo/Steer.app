# 动工前核实：locale、tab 插入位置、字体

> 2026-11-11。三条都影响 Casing II 的实现方式，实测后确认可行，无需 spike。

## 1. 系统 locale（Q71）

`nsh` 导出 `locale: Accessor<string>`（BCP 47，如 `"zh-Hans-CN"`）与 `localeSettings()`；文档在
`website/docs/device-and-environment.md:23-24`，类型在 `.nsh/types/nsh/index.d.ts:1169-1185`。
随系统变化而更新。

**结论**：语言跟随时读 `locale()`：`zh*` → zh-CN，其余 → en。之前 `i18n.ts` 的注释说"0.4.0
运行时不暴露 localeSettings"——那是上一轮针对 `nsh/i18n` 模块的判断；`locale()` 本身可用。

## 2. DockArea 的 tab 插入位置（Q78）

`DockDropIndicator`（`.nsh/types/nsh/base.d.ts:652`）：

```ts
export interface DockDropIndicator {
  group: number;          // the tab group it lands on
  side?: Placement | null; // the edge it splits off (`null`: into the group)
  index?: number | null;   // the slot in the group's tab bar it goes to
}
```

`renderDropIndicator` 收到它。**结论**：页签之间的落位竖线可以直接用 `index` 画，不需要上游增强。

## 3. 字体字重匹配（Q72）

`website/docs/fonts.md`：

- 同一 family 的多个文件按 weight 选面（`## Weights and italics`, 98-140）；
- **"When no registered face has the exact weight asked for, the nearest one is used"**——正是邻近映射；
- TSX import 一个 `.ttf/.otf/.woff/.woff2` 得到 family 名，首帧前注册。

**结论**：Lilex 只需 `Lilex-Light.ttf`(300) 与 `Lilex-Medium.ttf`(500) 两个文件，同 family；
正文 400 就近取 300、加粗 600+ 就近取 500。不需要按 weight 逐个 import，也不需要运行时决策。
