# Sheet 模块架构

> 状态：**已落地（2026-11-13，S0–S3）**。门禁：`nsh check app` ✓、`nsh test app` 215 用例 207 通过 / 8 skip、
> `bun script/check-layers.mjs` ✓（ALLOW 为空）、manox 两档门禁 ✓、`pi-harness` 36 单测 ✓。
> 门禁规则内保留本文 §5 明确列出的基础设施例外（`core/shell` 经 `domains/state` 持久化、shell 用
> `domains/instance`/`picker` 两个宿主服务），不是白名单条目。
> 本文取代已删除的 `nsh-pi-dual-harness-DESIGN.md` 的 §3.1/§4.1（pack 分层与对话面分家；该文档的
> 仍成立约束已收进 §8，历史见 git），并扩展 [pi-acp-PROTOCOL.md](pi-acp-PROTOCOL.md) 的 P 线：pi 不再享有「内置」地位，
> 与 manox、终端、浏览器、文件一样，是注册进来的一个 sheet 模块。
> 关系模型与视觉规格仍以 [architecture.md](architecture.md) / [DESIGN.md](DESIGN.md) 为准，本文只定义扩展机制。

## 0. 一句话

**每个 sheet 内容都是一个模块；模块是唯一的扩展单位。**
模块拥有自己的 kind、呈现、状态、入口贡献与能力声明；壳只拥有关系模型（Project → Container → Sheet），
不 import 任何模块。native 不是模块的必备另一半——它是「能力域」的实现方式之一，一个域服务多张 sheet。

## 1. 迁移前的审计（已全部消除）

迁移前只有一层薄 seam（`registerSheetKind` / `registerHeroSubmitter`），且只服务「非内置」：
**pi 是默认，是一堆写进主干的特判**。下表是当时的审计，保留作迁移记录；落点列是旧路径。

| 层 | 现状 | 位置 |
|---|---|---|
| 组装 | `App.tsx` 只注册 manox；pi 没有 pack | `app/App.tsx` |
| Sheet | 闭集 `SheetKind` + 逐 kind 分支；`session`/`subagents`/`home` 在主干的 registry 里 | `app/canvas/sheets.tsx:48-66, 106-166` |
| Hero | 默认 harness 写死 `"pi"`；`hostsPi()`；`loadPiModels`；模型列表对两条腿都取 pi catalog（共用是 Q104 的裁决，不是巧合） | `app/sheets/hero.tsx:85, 103, 328` |
| 容器 | ~~`ContainerKind` 来自旧 pi wire；`kind !== "Pi"` 决定默认布局；`sessions[]` 是 pi 会话~~ | 已改为 `{id,cwd,projectId,sheetOrder}`；pi 模块自持会话投影 |
| 域 store | `sessions` / `subagents` / `slash` / `pi-models` 在主干；`containers.ts` 直接 import `createSession` 等 | `app/stores/*` |
| 传输 | ~~旧 engine wire 仍在主干~~ | 已删除（P4）：`contracts/protocol.ts`、`stores/engine.ts`、`pi-engine` |
| 通知 | intent 以 pi `sessionId` 为路由键 | `app/stores/notifications.ts:187-194` |
| native 直连 | ~~sheet 直接 import `zu/native` 的类型~~ | 已收进 `app/domains/` |

结论：缺的不是一层 registry，而是**「harness 属于 sheet，不属于容器与壳」**这个关系模型，
以及**一条所有 kind 都走的注册路径**。

## 2. 不变量

1. **关系模型只有三样**：`Project → Container → Sheet`。Container 是组织单元（cwd、项目归属、布局），
   没有 harness 身份；Sheet 是唯一带 kind 的实体；kind 属于模块。
2. **壳零模块语义**：`shell/` 与 `core/` 不 import `modules/`；壳渲染 registry，不判断 kind 的业务含义。
3. **模块互不 import**：跨模块打开走 intent（§7）；共享的只有 `ui/` 的无状态原语与 `core/` 的关系 API。
4. **native 是能力，不是搭档**：模块声明 `capabilities`；能力由域实现；只有域可以 import `zu/native`。
5. **状态在模块 store 里，不在组件里**：切 tab/切容器会卸载组件（Q43/Q55/Q62），组件只读 store。
6. **未知 kind 降级，不抛错**：布局可能来自更新的构建；壳画占位并可关闭。

## 3. 目标结构

```
app/
  core/                 # 关系模型：registry / containers / dock / projects / lifecycle / notifications / shell-actions / types
  shell/                # 外壳：workbench、sidebar、titlebar、tab-plus、project-dialog、settings/search/updates
  canvas/               # sheet 解析（registry 查找）与容器标题、`+`
  domains/              # 能力的 TS 型面（唯一 import zu/native）：fs / git / lsp / pty / state / acp / manox / picker / instance
  modules/
    home/               # kind: home              能力：—（起始页，core 注册）
    browser/            # kind: webview           能力：—
    terminal/           # kind: terminal          能力：pty
    files/              # kinds: files/editor/diff 能力：fs
    git/                # kinds: changes/history  能力：git
    problems/           # kind: problems          能力：lsp
    pi/                 # kinds: session/subagents 能力：acp, state
    manox/              # kind: manox-chat        能力：manox
  App.tsx               # 唯一装配点（startModules()）
contracts/
  module.ts             # 模块契约（跨模块词汇）
  ahp/                  # vendored AHP
native/
  src/                  # 一个 zu/native 注册面：acp/fs/git/pty/lsp/state/manox/picker/instance
  manox/                # manox/native 注册面
```

依赖方向（唯一）：

```
ui        → contracts
core      → ui, contracts
domains   → contracts（+ native 型面）
modules   → core, domains, ui, contracts
shell     → core, ui, contracts          ← 不 import modules
App.tsx   → shell, modules               ← 唯一 import modules 的地方
modules   ⇸ modules                      ← 禁止互 import
```

## 4. 契约

```ts
// contracts/module.ts —— 词汇与接口，无实现
export type SheetId = string;              // "kind:instance"，kind 是第一个冒号之前的部分

export interface SheetKindSpec {
  kind: string;                            // "session" | "svg" | "manox-chat"
  title: (id: SheetId) => string;          // 响应式；容器标题也用它
  body: (props: SheetProps) => JSX.Element;
  glyph: GlyphName | { icon: () => JSX.Element };
  tint?: TintToken;
  /** 关闭策略：默认允许；需要 pin/审批的 kind 自己决定。 */
  closable?: (id: SheetId) => boolean;
  /** 布局恢复时：id 背后的资源还活着吗？false → 静默移除（Q4 的既有语义）。 */
  restore?: (id: SheetId) => boolean | Promise<boolean>;
  /** 该 kind 对 id 的唯一解释权；解析失败即未知（壳画占位）。 */
  parse: (id: SheetId) => unknown | null;
}

export interface SheetProps {
  id: SheetId;
  containerId: string | null;              // scratch 画布为 null
  visible: boolean;                        // 来自 visiblePanels()，模块自行降级
}

export interface SheetModule {
  id: string;                              // "pi" | "manox" | "terminal" | ...
  kinds: SheetKindSpec[];                  // 一个模块可拥有多个 kind

  /** 能力声明：装配点据此注入域；也是门禁的检查依据。 */
  capabilities?: string[];                 // ["fs"], ["pty"], []

  /** 起始页（对象实例化面板）的贡献：一个模块可以贡献多个对象。 */
  launchers?: Launcher[];                  // { id, label, glyph|brand, group, order, asksProject, instantiate }
  sidebar?: SidebarSection;                // 侧栏分组：**当前 seam 已移除**（7d2d523），
                                           // S0 不恢复；等「合并的项目投影」有真实消费者再定形状
  titlebar?: ActionContribution[];
  commands?: CommandContribution[];        // ⌘K 与斜杆候选
  search?: SearchProvider;                 // 侧栏搜索的额外来源

  /** 跨模块打开：别人发 intent，不 import 你。 */
  intents?: Record<string, (payload: unknown, ctx: IntentContext) => SheetId | null>;

  /** 容器归档时的资源清理（PTY、LSP、连接）。 */
  onContainerArchive?: (containerId: string) => void;
}
```

`Launcher` 的 `instantiate(context)` 收到属性解析后的 `{ containerId, projectId, cwd, sheetId }`：
home 只做属性解析与渲染，模块自己决定新建什么、放进哪个容器。`asksProject` 为真的对象（对话）在
没有项目上下文时由 home 弹「聊天 / 项目 / 新建项目」。`SidebarSection` 当前不存在（7d2d523 移除了
`ContributedSection`），S0 不恢复，等合并的项目投影需要时再定形状。壳只渲染，不解释内容。

### 4.1 装配

```ts
// App.tsx —— 唯一的装配点
registerModule(homeModule);
registerModule(browserModule);
registerModule(filesModule);
registerModule(gitModule);
registerModule(terminalModule);
registerModule(problemsModule);
registerModule(piModule, { acp, state });
registerModule(manoxModule, { manox });
```

`registerModule` 把 kind 写进 `core/registry`、把贡献挂到壳的槽位；能力是显式传入的域对象，
因此测试可以传替身，而不必启动真 native。

### 4.2 渲染

```tsx
// canvas/sheets.tsx 迁移后的全部逻辑
const spec = registry.kind(kindOf(id));
if (!spec) return <UnknownSheet id={id} />;
return spec.body({ id, containerId, visible: isVisible(id) });
```

没有 per-kind 分支、没有闭集 union、没有壳侧 id 解释。

## 5. 能力域与 native

- **规则**：`zu/native` 只允许出现在 `app/domains/`。sheet 与模块只 import 域型面。
- **基础设施例外（唯一）**：`core/containers.ts`、`core/projects.ts` 与 `shell/settings.ts` 经 `domains/state` 持久化
  （registry、projects、layout、settings）。`state` 是基础设施而不是面向模块的能力；`bun script/check-layers.mjs`
  显式允许 `core/shell → domains/state`（以及 shell 的 `instance`/`picker` 宿主服务），其余零例外。
- **域是能力的唯一实现点**：`fs` 服务 Files/Editor/Diff/Problems/SVG（若将来要监视文件）；
  `git` 服务 Changes/History；`pty` 服务 Terminal 与 TUI 动作；`acp` + `state` 服务 pi；
  `manox` 服务 manox 对话。
- **什么时候才开新 native 域**：需要进程、宿主策略（canonicalize/越界拒绝）、或 Rust 依赖（in-proc 内核）。
  纯 TS 能做的（SVG 解析、地址规范化、状态机）不进 native。
- **注册粒度**：一个 crate 一个 `#[native_module]`（现有 `zu/native`、`manox/native`），
  域在注册面里加一个 module/class，不按 sheet 拆 namespace。

## 6. 生命周期

| 时机 | 谁做 | 做什么 |
|---|---|---|
| 打开 | 模块 `intent` 或 starter | 铸 `SheetId`，core 把它插进当前容器布局并激活 |
| 建容器 | 模块 intent → core | `createContainer({cwd, projectId})`；「外部终端容器」是 terminal 模块的 intent，不是壳的容器种类 |
| 恢复 | core 读布局 → 每个模块 `restore(id)` | false 的 sheet 静默移除；布局只存 id |
| 关闭 | core | 从布局移除；模块自己决定是否释放资源（PTY 属于域，不随 sheet 卸载） |
| 归档 | core → 模块 `onContainerArchive` | 结束 PTY、LSP、连接；模块不碰布局 |
| 不可见 | core 提供 `visible` | 模块自行降级（浏览器卸载 WebView、会话只画占位） |
| 通知 | 模块 → `stores/notifications.notifySettled({sheetId,...})` | 壳按 sheet id 路由；按下 → 切容器并 `openSheet(sheetId)` |
| 显示 | core → `onContainerShown(containerId)` | pi 种子它的会话投影并 hydrate 可见转录 |
| 布局变化 | core → `onLayoutChanged(openIds)` | terminal 关掉消失的 PTY |
| 初始化 | `startModules` → `initialize()` | pi 启动会话索引扫描 |

## 7. 跨模块交互

模块之间禁止 import。两种合法通道：

1. **intent**：`dispatchIntent("editor.open", { containerId, path })` → 目标模块注册的 handler 返回 `SheetId`。
2. **core 的关系 API**：`activeContainer()`、`openSheet(id)`、`createContainer()`、`closeSheet(id)`。

例：文件树双击文件 → `editor.open`；git 的 Changes → `diff.open`；终端里点击 URL → `browser.open`。
谁拥有 kind，谁决定 id 怎么铸。

## 8. Harness 模块：pi 与 manox

两者是**同级模块**，不是「内置 + 扩展」：

| | pi | manox |
|---|---|---|
| kind | `session`（+ `subagents`） | `manox-chat` |
| 能力 | `acp`（轮级子进程）、`state`（会话索引） | `manox`（in-proc AHP）；模型经 native 桥注册 pi 的 provider（Q104） |
| 起始页 | launcher `zu`（对话）与 `pi`（原生 TUI）；不预选模型/effort | launcher `manox`（对话；cwd 来自上下文） |
| 搜索 | `search` 贡献会话索引（`modules/pi/search.ts`） | 无独立搜索源 |
| 子代理 | kind `subagents`；目标形态见 [pi-acp-IMPLEMENTATION.md](pi-acp-IMPLEMENTATION.md) §7 | — |
| 崩溃域 | 进程隔离（每条 turn 一个 `pi-acp`） | 应用内单例；泵边界 `catch_unwind`，panic → transport error → 重连 |
| 权威 | `~/.pi` 会话文件 | `~/.manox` journal |

保留的设计约束（原双 harness 设计里仍然成立的）：

- **in-proc 的代价是结构性的**：manox 宿主半边 panic 的爆炸半径是整壳；`native/manox` 的
  `catch_unwind` + 重连腿是缓解而非隔离，必须保留 panic 注入测试。
- **读面权威在磁盘**：两个 harness 都零活进程可读；manox 的折叠对账门禁（快照腿 vs journal 重放腿喂
  同一份 vendored reducer）保留。
- **范围纪律**：manox 的「能对话」清单仍是边界；不因为架构统一而扩大产品面。
- **pi 的 ACP 迁移**（P0–P4 已完成）见 [pi-acp-PROTOCOL.md](pi-acp-PROTOCOL.md)；
  下一步的会话运行时/权限/子代理见 [pi-acp-IMPLEMENTATION.md](pi-acp-IMPLEMENTATION.md)。

## 9. 现有 sheet 的归类

| 现状 | 模块 | 能力 | 备注 |
|---|---|---|---|
| `session`、chat-view、composer、`subagents` | `pi` | acp/state | 对话面整体随模块迁入 |
| `manox-chat`、manox composer | `manox` | manox | 已经接近目标形状 |
| `terminal`、四类 TUI | `terminal` | pty | 「外部容器」变成 intent |
| `webview` | `browser` | — | 零 native 的完整公民 |
| `files`/`editor`/`diff` | `files` | fs | 三张 sheet 一个模块一个域 |
| `changes`/`history` | `git` | git | 同上 |
| `problems` | `problems` | lsp | 诊断状态在域 |
| `home` | `home`（core） | — | 起始页由壳拥有：解析容器/项目/cwd 属性，tile 由各模块的 `launchers` 贡献 |

## 10. 新增一种 sheet：SVG 预览器

```
app/modules/svg/manifest.ts     # kind "svg"，title/body/parse/restore
app/modules/svg/store.ts        # 打开参数、缩放（若有）
app/modules/svg/view.tsx        # 渲染（nsh View/Canvas 或 WebView）
App.tsx                         # + registerModule(svgModule)
```

**不新增**：native crate、域、容器种类。若将来要监视文件变化，扩展 `fs` 域（所有文件类 sheet 共享），
而不是给 svg 开一个 native 模块。

同一个模板适用于：图片查看器、PDF 预览、日志查看器、指标面板。需要进程的（例如某种 REPL）才加域。

## 11. 门禁

1. **依赖图**：`modules → core/domains/ui`、`modules ⇸ modules`、`core/shell ⇸ modules`；
   任一违例失败。`bun script/check-layers.mjs`（S0 起常绿，零白名单）。
2. **native 收口**：`zu/native` / `manox/native` 的 import 只允许在 `app/domains/`（grep 级）。
3. **未知 kind**：布局注入一个不存在的 kind，壳画占位、不抛错（`canvas/sheets.tsx`）。
4. **模块契约测试**：`app/tests/sheet-modules.test.tsx` 覆盖注册、重复 kind、未知 kind、`restore` 剪枝、
   titlebar/搜索贡献与 intent 分发。

## 12. 迁移

每阶段独立验收、全量回绿；行为不变优先于结构好看。

| 阶段 | 内容 | 验收 |
|---|---|---|
| S0 ✅ | `contracts/module.ts`、`core/registry`、`registerModule`；home/browser 注册 | 门禁上线；全量绿 |
| S1 ✅ | `app/domains/`；`zu/native` 只在 domains | `check-layers` 零违例 |
| S2 ✅ | files/git/terminal/problems 模块化；删闭集 | `canvas/sheets.tsx` 只剩 registry + 占位 |
| S3 ✅ | pi/manox 模块化；容器去 `kind`/`sessions`；通知按 sheet id；旧 wire 删除 | `App.tsx` 只 import 模块；壳零 harness 词汇 |

兼容：旧 `registry.json` 的 `kind`/`sessions[]` 字段被忽略（读时无感）；`sheetOrder` 在记录里持久化，
写入只用新形状；`restore` 对已死资源返回 false 即静默移除。

## 12.1 范围外（已归档）

以下能力不属于本架构的验收，也不由 S0–S3 承诺：

- ACP 的 `session/request_permission` 与扩展 UI 桥（旧引擎实现随 P4 删除）；
- 会话内 `/model`、`/thinking`、`/compact` 的 ACP 映射；
- 子代理 dispatch 数据面（ACP distro 尚未提供，P5 的 generic agents）。

它们的实现设计（A0–F0）见 [pi-acp-IMPLEMENTATION.md](pi-acp-IMPLEMENTATION.md)，执行状态见
[plan.md](plan.md) §2。本架构保证的是：这些能力回来时，接线点是模块（pi / 扩展宿主）而不是壳。

## 13. 风险与边界

1. **同等公民 ≠ 功能对等**：模型、斜杆、子代理是 pi 的能力；manox 有 elicitation；终端没有会话。
   契约给的是同一套挂载点，不是同一组功能。壳里出现「如果不是 pi 就……」就是设计错了。
2. **native 是稀缺资源**：默认模板是纯 TS 模块；只有进程、宿主策略、Rust 依赖才开域。
3. **一次性大搬迁会打断全部门禁**：按 S0–S3 每步搬一类。测试留在 `app/` 根（`nsh test` 的发现面），
   模块契约由 `app/tests/sheet-modules.test.tsx` 守住；UI 测试通过 fixtures 装配全部模块。
4. **状态归属**：模块 store 必须是单例，组件卸载不丢；否则拖 tab/切容器就是数据丢失。
5. **文档**：模块的实现文档放 `docs/modules/<id>.md`（按需），架构只保留共同规则。
