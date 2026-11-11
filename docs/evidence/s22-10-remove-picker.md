# §2.2-10：移除顶栏 picker

日期：2026-11-12。验收对象是 [plan.md](../plan.md) §2.2 的第 10 项。

## 1. 交付

- **UI**：`SessionPicker`（触发器 + 搜索 + 容器/会话两段列表）从 `shell.tsx`
  整体删除；顶栏中心不再有 360pt 的固定座位——一行里只剩左开关与右侧动作
  （VS Code、工具 overflow），中心是窗口拖拽区。切容器只经侧栏
  （项目 → 容器行），不新增别处入口。
- **数据**：`titlebar.ts` 按剩余职责拆开——VS Code 动作留在 **`vscode.ts`**
  （target/url/open），侧栏搜索的匹配规则到 **`search.ts`**
  （`containerMatches`/`sessionMatches`，侧栏过滤与真实过滤路径共用）。
  picker 专属的 `PICKER_LIMIT`/`pickerCandidates`/`pickerSessions`/
  `pickContainer`/`containerProjectName`（对外导出）删除。
- **i18n**：`app.titlebar.sessionPicker`/`noSession`/`pickerPlaceholder`/
  `pickerEmpty` 四个键删除（双语表与 `K` 同步，parity 测试守着）。

## 2. 验收证据

- `App.test.tsx`：`id:session-picker` 计数断言从 1 改为 **0**；顶栏的
  开关/VS Code/工具 overflow 各 1。
- 三个以 picker 为入口的用例删除：`containers.ui`（picker 切容器）、
  `projects.ui`（居中 picker 过滤）、`switch.test`（picker 切换 + 画布内容）。
  切容器仍由侧栏行用例覆盖（`containers.ui`、`switch.test` 的行切换、
  `projects.ui` 的分组与行）。
- `vscode.test.ts`（原 `titlebar.test.ts` 的剩余职责）：URL 形状、target =
  活动项目主根/Chats 时的 cwd/无活动容器为 null、membership 读法。
- `search.test.ts`：侧栏搜索匹配规则（标题/cwd/项目名、空查询全匹配、
  会话的 name/preview/cwd/path）。
- `i18n.test.ts` 的 parity 守住键集合；`contracts.test.ts` 不涉及。

## 3. 门禁

| 门禁 | 结果 |
|---|---|
| `nsh check .` | ✓ |
| `cargo check --all-targets` | ✓ |
| `nsh test .` | ✓ 253/253 |
| `script/bundle-mac.sh` | ✓（Zu.app 133M / Zu.dmg 52M） |

## 4. 已知边界

- 顶栏中心现在是空的窗口拖拽区（DESIGN §3.3 明确"不补位"，⌘K 命令面板是
  后续独立功能）。
- 删除的三个 UI 用例原本也覆盖"picker 的过滤规则"——这条由 `search.test.ts`
  （匹配规则）+ 侧栏搜索的 UI 用例（过滤/清空/无结果）共同承担。
