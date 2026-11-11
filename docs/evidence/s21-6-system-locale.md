# §2.1-6：语言跟随系统

日期：2026-11-12。验收对象是 [plan.md](../plan.md) §2.1 的第 6 项。

## 1. 交付

- 删除顶栏的语言按钮（`id:language` 与 `K.titlebar.language` 两个键、
  `toggleShellLocale` 一并移除）——壳里没有任何"和系统 disagree"的入口。
- `App` 首帧前调用 `followSystemLocale()`（`i18n.ts`）：读 nsh 的 `locale()`
  （BCP 47，反应式的系统值），`localeToShellLocale` 做 `zh* → zh-CN`、
  其余 → `en` 的映射。运行中系统的语言变化不跟随——壳不会在用户的指针下换语言，
  重启后生效。
- 映射本身是纯函数：`i18n.test.ts` 断言 `zh`、`zh-Hant-TW`、`zh-CN` → zh-CN，
  `en-US`、`en`、`fr`、`DE-de` → en。
- 两条 UI 测试（`locale.ui.test.tsx`，fixture `fixtures/locale-{zh,en}.tsx`）：
  fixture 用 nsh 的 `setLocale` 扮演系统（这正是 `locale()` 的来源），再走
  `followSystemLocale()` 的真实启动读取，然后断言壳的文案——中文系统画
  "开始你的对话"且没有 "Start a conversation"；英文系统反之，并且顶栏 `⋯`
  菜单里没有语言行。

## 2. 测试的连带调整

壳的语言从"写死的 zh-CN 默认值"变成"系统的"，所以打开真 `App.tsx` 的测试
（App/external/startup/lifecycle.app/container-hero/switch）在 en-US 的 headless
运行时会读到英文文案。它们的文案断言改成双语的：`copy.ts` 的 `copy(zh, en)`
读与 app 相同的系统 locale（`shellCopyLocale()`），选择器和断言用它拼出——
在任何机器上都断言"壳正在画的那一种"。映射与双语入口由上面的两条 UI 测试
负责，不靠这些用例。

fixture 挂载的测试（不经过 App 的启动）仍是 `zh-CN` 的模块默认值，文案断言
保持中文不变。两个被语言按钮撑起来的用例删除：App.test 的
"the shell speaks English when the user prefers it"、external.ui 的
"an external kind keeps its kind label in the shell's language"（英文的
external 工具行现在由 locale-en fixture 断言）。

## 3. 门禁

| 门禁 | 结果 |
|---|---|
| `nsh check .` | ✓ |
| `cargo check --all-targets` | ✓ |
| `nsh test .` | ✓ 250/250 |
| `script/bundle-mac.sh` | ✓ 见 §2.1 完成记录 |

## 4. 已知边界

- 只跟随系统，没有应用内切换、没有持久化选择（§3 挂账）。
- 运行中改系统语言不生效（重启后生效）；nsh 的 `locale()` 是反应式的，若以后
  要跟随，`followSystemLocale` 可以改为订阅——目前按 Q71 只读一次。
