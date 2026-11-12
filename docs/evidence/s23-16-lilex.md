# §2.3-16：Lilex 字体

日期：2026-11-12。验收对象是 [plan.md](../plan.md) §2.3 的第 16 项。

## 1. 交付

Lilex 的两个字重（`Lilex-Light.ttf` 300 + `Lilex-Medium.ttf` 500，OFL 许可
随附）由 **zu-app 这个 Rust crate 自己壳带**：文件放 `assets/fonts/`，
`src/lib.rs` 的原生模块经 `registry.assets(assets!())` 把 crate 的 `assets/`
登记进 UI set——引擎在**首帧前**把其中的字体按文件 name table 的 family
注册（两个字重的 family 同为 `Lilex`），`nsh run`/`nsh test` 的 dev server
按登记伺服它们，`nsh package` 把它们拷进包。TS 侧只有
[`fonts.ts`](../../fonts.ts) 的 `SHEET_FONT = "Lilex"` 一个常量，四类 sheet
内容以它为 `fontFamily`：会话正文与 Markdown（`chat-view.tsx`）、编辑器与
Diff（`files.tsx`）、终端（`sheets.tsx`）。轮廓（顶栏、侧栏、页签、composer、
按钮）不传这个 family，仍是系统字体；Lilex 无 CJK 字形，中文由系统的
fallback 链补。

**为什么不是 TSX 的字体 import**：import 的 asset URI 由打包器按
**entry 所在目录**求相对路径——真 App（`App.tsx` 在根上）没有问题，但
UI 测试的 fixture 在 `fixtures/` 下，从 app 根引入的字体得到绝对路径
URI，`--target macos` 的测试宿主 404、未处理的 rejection 让用例失败。
crate 的 `assets!()` 走注册表，四个 host（headless、`--target macos`
fixture、`nsh run`、打包）都按同一条路径伺服，无运行时注册、无闪烁。

## 2. 验收证据

- Rust 单测 `font_tests::lilex_ships_under_one_family`（`src/lib.rs`，
  `asset!` 编译期读 name table）：两个字重的 family 同为 `"Lilex"`——
  守住 TS 常量与字体文件不漂移。
- `fonts.test.ts`：sheet 内容引用的 family 就是 crate 壳带的 `"Lilex"`。
- 截图 `docs/evidence/ui-s23-16-lilex.png`（`--target macos`，chat idle
  fixture）：正文与用户气泡是 Lilex（g/a 的字形与系统 SF 明显不同），
  composer 占位与页脚仍是系统字体。
- 截图 `docs/evidence/ui-s23-16-lilex-shell.png`（`--target macos`，
  containers fixture 的全壳）：侧栏（会话/新建/Alpha/Beta/Gamma）、页签、
  composer 全是系统字体；画布里的 "alpha body" 是 Lilex——正是验收的
  「内容区用 Lilex，标题栏/侧栏仍是系统字体」。

## 3. 门禁

`nsh check` ✓、`cargo check --all-targets` ✓（无告警）、`nsh test .` 全量绿、
`script/bundle-mac.sh` ✓——数字见 [plan.md](../plan.md) §当前进度。

## 4. 已知边界

- 邻近映射（正文 400 → Light 300、加粗 600+ → Medium 500）由平台字体机
  制按 family 内权重就近挑字重，`fonts.test.ts`/Rust 单测守住同 family
  这一前提；两种外观下都是同一对 TTF。
- Lilex 只进 §3.4 列的四类 sheet 内容；Problems、Changes/History 等
  其他面板与轮廓保持系统字体（DESIGN §3.4 未列）。
