# §2.2-9：侧栏可拖拽

日期：2026-11-12。验收对象是 [plan.md](../plan.md) §2.2 的第 9 项。

## 1. 交付

**热区**：侧栏与卡片之间的 10pt 沟槽里放一个 4pt 的拖拽手柄
（`id:sidebar-handle`，`PanResponder`：grant 记起点、move 即时改宽、release
再写一次）。宽度 `clampSidebarWidth` 钳在 **200–360**，默认 232。

**持久化**：新协议命令 `settings.get` / `settings.put`（`contracts/protocol.ts`
的 `settings` 组），落盘 `zu/settings.json`——与 registry/layouts 同目录、同样的
原子写。`settings.put` 引擎侧也钳宽、合并写入（未知键保留，新构建的设置不会被
旧构建抹掉）；`bootShell` 启动时 `loadSettings()` 读回。UI 侧的状态在
`settings.ts`（load / clamp / put，transport 可替换供测试）。

拖拽即时生效：move 直接 `setSidebarWidth`（signal → 侧栏宽度重渲染）；文件写入
是 fire-and-forget，失败只影响下次重启的初值。

## 2. 验收证据

- `settings.test.ts`：
  - 钳制：150→200、400→360、280.7→281、NaN→232；
  - 应用 + 持久化：`setSidebarWidth(331)` 立即生效且 transport 收到
    `{ sidebarWidth: 331 }`；
  - 读回：重启路径 `loadSettings()` 读到 300；坏值 5000 被钳到 360；
  - **live 引擎**：`settings.get` 空文件 → `settings.put {420}` → 回 360 →
    `settings.get` 读回 360（`zu/settings.json` 真实读写，独立 state 目录）。
- `auto-archive.ui.test.tsx` 断言手柄渲染在侧栏与卡片之间。
- 协议：`contracts.test.ts` 的命令元数据遍历（新的 `settings` 组）通过；
  `protocol.md` 记了 `settings.get`/`settings.put` 两行与 merge 语义。

拖拽手势本身在 headless 测试里没有输入通路（runner 只有 press/type），所以
"拖"的行为由 store 的钳制/持久化用例 + 手柄渲染用例覆盖；曲线（即时的
signal 驱动）是 `sidebarWidth()` 的响应式重渲染。

## 3. 门禁

| 门禁 | 结果 |
|---|---|
| `nsh check .` | ✓ |
| `cargo check --all-targets` | ✓ |
| `nsh test .` | ✓ 256/256 |
| `script/bundle-mac.sh` | ✓（Zu.app 133M / Zu.dmg 52M） |

## 4. 已知边界

- 拖拽过程每帧发一次 `settings.put`（release 后再发一次）：写盘是本地原子写，
  量级可忽略；若将来觉得多，可在 release 后合并为一次。
- 手柄无光标样式（nsh 的 style 不暴露 cursor）；hover 时以 `bg-line` 提示。
