# Sheet 模块架构

> 状态：**目标架构已定（2026-11-13），迁移未开始**。
> 本文取代 [nsh-pi-dual-harness-DESIGN.md](nsh-pi-dual-harness-DESIGN.md) 的 §3.1/§4.1（pack 分层与对话面分家），
> 并扩展 [pi-acp-ARCHITECTURE.md](pi-acp-ARCHITECTURE.md) 的 P 线：pi 不再享有「内置」地位，
> 与 manox、终端、浏览器、文件一样，是注册进来的一个 sheet 模块。
> 关系模型与视觉规格仍以 [architecture.md](architecture.md) / [DESIGN.md](DESIGN.md) 为准，本文只定义扩展机制。

## 0. 一句话

**每个 sheet 内容都是一个模块；模块是唯一的扩展单位。**
模块拥有自己的 kind、呈现、状态、入口贡献与能力声明；壳只拥有关系模型（Project → Container → Sheet），
不 import 任何模块。native 不是模块的必备另一半——它是「能力域」的实现方式之一，一个域服务多张 sheet。

## 1. 要解决的病

当前注册面已经存在（[`app/shell/contrib.tsx`](../app/shell/contrib.tsx) 的 `registerSheetKind` /
`registerHeroSubmitter` / `setSidebarSection`），但它只服务「非内置」：**pi 是默认，是一堆写进主干的特判**。
审计结果（迁移 checklist）：

| 层 | 现状 | 位置 |
|---|---|---|
| 组装 | `App.tsx` 只注册 manox；pi 没有 pack | `app/App.tsx` |
| Sheet | 闭集 `SheetKind` + 逐 kind 分支；`session`/`subagents`/`home` 在主干的 registry 里 | `app/canvas/sheets.tsx:48-66, 106-166` |
| Hero | 默认 harness 写死 `"pi"`；`hostsPi()`；`loadPiModels`；模型列表对两条腿都取 pi catalog | `app/sheets/hero.tsx:85, 103, 328` |
| 容器 | `ContainerKind` 来自旧 pi wire；`kind !== "Pi"` 决定默认布局；`sessions[]` 是 pi 会话；`isPiContainer` | `app/stores/containers.ts:198, 243, 445`；`contracts/protocol.ts` |
| 域 store | `sessions` / `subagents` / `slash` / `pi-models` 在主干；`containers.ts` 直接 import `createSession` 等 | `app/stores/*` |
| 传输 | 旧 engine wire 仍在主干（`ZU_PI_TRANSPORT=engine` 才走）；`shell.tsx` 保留引擎分支 | `app/stores/engine.ts`、`app/shell/shell.tsx:76` |
| 通知 | intent 以 pi `sessionId` 为路由键 | `app/stores/notifications.ts:187-194` |
| native 直连 | sheet 直接 import `zu/native` 的类型 | `app/sheets/git-ui.tsx:30` |

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
  contracts/            # 跨模块词汇：SheetId 规则、module 接口、事件类型（无实现）
  ui/                   # 无状态原语、token、图标、i18n（零领域）
  core/                 # 关系模型：projects / containers / dock / layout / lifecycle / registry
  shell/                # 外壳：workbench、sidebar、titlebar、tab-plus（只画 core 的形状）
  domains/              # 能力的 TS 型面：fs / git / pty / lsp / acp / manox / state / pimodels
  modules/
    home/               # 容器起始页（core module）
    browser/            # kind: webview           能力：—
    terminal/           # kind: terminal          能力：pty
    files/              # kinds: files/editor/diff 能力：fs
    git/                # kinds: changes/history  能力：git
    problems/           # kind: problems          能力：lsp
    pi/                 # kind: session           能力：acp, state, pimodels
    manox/              # kind: manox-chat        能力：manox
  App.tsx               # 唯一装配点
native/
  src/                  # 一个 zu/native 注册面：fs/git/pty/lsp/state/pimodels/acp
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

  /** Hero（容器起始页）的贡献；有就显示，没有就不显示。 */
  hero?: {
    starters?: HeroStarter[];              // 一段对话/动作的入口
    footer?: FooterSlot[];                 // 模型、effort 等输入框底栏槽位
  };
  sidebar?: SidebarSection;                // 侧栏分组（pi 的「全部会话」、manox 的 thread 组）
  titlebar?: ActionContribution[];
  commands?: CommandContribution[];        // ⌘K 与斜杆候选
  search?: SearchProvider;                 // 侧栏搜索的额外来源

  /** 跨模块打开：别人发 intent，不 import 你。 */
  intents?: Record<string, (payload: unknown, ctx: IntentContext) => SheetId | null>;

  /** 容器归档时的资源清理（PTY、LSP、连接）。 */
  onContainerArchive?: (containerId: string) => void;
}
```

贡献面的类型（`HeroStarter`、`SidebarSection`、`ActionContribution`、`CommandContribution`、`SearchProvider`）
沿用/扩展现有 `contrib.tsx` 的 `ContributedTool` / `ContributedSection` / `HeroSubmitter`，
统一收进 `contracts/module.ts`；壳只渲染，不解释内容。

### 4.1 装配

```ts
// App.tsx —— 唯一的装配点
registerModule(homeModule);
registerModule(browserModule);
registerModule(filesModule);
registerModule(gitModule);
registerModule(terminalModule);
registerModule(problemsModule);
registerModule(piModule, { acp, state, pimodels });
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
- **域是能力的唯一实现点**：`fs` 服务 Files/Editor/Diff/Problems/SVG（若将来要监视文件）；
  `git` 服务 Changes/History；`pty` 服务 Terminal 与 TUI 动作；`acp` + `state` + `pimodels` 服务 pi；
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
| 通知 | 模块 → core `notify({sheetId,...})` | 壳按 sheet id 路由；按下 → `open(sheetId)` |

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
| 能力 | `acp`（轮级子进程）、`state`（会话索引）、`pimodels`（模型目录） | `manox`（in-proc AHP） |
| Hero | starter `pi`，footer 贡献模型/effort | starter `manox`，footer 贡献自己的模型（后续） |
| 侧栏 | 「全部会话」搜索/无主会话 | thread 组 |
| 崩溃域 | 进程隔离（每条 turn 一个 `pi-acp`） | 应用内单例；泵边界 `catch_unwind`，panic → transport error → 重连 |
| 权威 | `~/.pi` 会话文件 | `~/.manox` journal |

保留的设计约束（原双 harness 设计里仍然成立的）：

- **in-proc 的代价是结构性的**：manox 宿主半边 panic 的爆炸半径是整壳；`native/manox` 的
  `catch_unwind` + 重连腿是缓解而非隔离，必须保留 panic 注入测试。
- **读面权威在磁盘**：两个 harness 都零活进程可读；manox 的折叠对账门禁（快照腿 vs journal 重放腿喂
  同一份 vendored reducer）保留。
- **范围纪律**：manox 的「能对话」清单仍是边界；不因为架构统一而扩大产品面。
- **pi 的 ACP 迁移**（P0–P3 已完成，P4 待做）不变，见 [pi-acp-ARCHITECTURE.md](pi-acp-ARCHITECTURE.md)。

## 9. 现有 sheet 的归类

| 现状 | 模块 | 能力 | 备注 |
|---|---|---|---|
| `session`、chat-view、composer、`subagents` | `pi` | acp/state/pimodels | 对话面整体随模块迁入 |
| `manox-chat`、manox composer | `manox` | manox | 已经接近目标形状 |
| `terminal`、四类 TUI | `terminal` | pty | 「外部容器」变成 intent |
| `webview` | `browser` | — | 零 native 的完整公民 |
| `files`/`editor`/`diff` | `files` | fs | 三张 sheet 一个模块一个域 |
| `changes`/`history` | `git` | git | 同上 |
| `problems` | `problems` | lsp | 诊断状态在域 |
| `home` | `home`（core） | — | 起始页由壳拥有，内容由贡献组合 |

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

1. **依赖图**：`ui ← core ← shell`、`modules → core/domains/ui`、`modules ⇸ modules`、
   `core/shell ⇸ modules/domains`；任一违例失败。做成 `nsh check` 的前置脚本或 CI 步骤。
2. **native 收口**：`zu/native` / `manox/native` 的 import 只允许在 `app/domains/`（grep 级）。
3. **未知 kind**：布局注入一个不存在的 kind，壳画占位、不抛错。
4. **模块装配测试**：注册 → intent 打开 → 拿到 id → body 用假域渲染。
5. **契约测试**：每个 `kinds[]` 的 `parse`/`restore` 对坏 id 返回 null/false，不抛。

## 12. 迁移

每阶段独立验收、全量回绿；行为不变优先于结构好看。

| 阶段 | 内容 | 验收 |
|---|---|---|
| **S0 门禁与契约** | `contracts/module.ts`、`core/registry`、`registerModule`；`home` 与 `browser` 先走新路径 | 依赖门禁上线；browser 零 native 跑通；全量测试绿 |
| **S1 域收口** | 拆 `app/domains/`；`sheets/*-ui.tsx` 不再 import native 类型 | `zu/native` 只出现在 `domains/`；测试绿 |
| **S2 工作台模块化** | files/git/terminal/problems 搬成模块；删 `SheetKind` 闭集与壳侧分支 | `canvas/sheets.tsx` 只剩 registry + 占位；所有 kind 走同一路径 |
| **S3 harness 模块化** | pi/manox 搬成模块；容器去 `kind`/`sessions`；通知按 sheet id；删旧 wire（P4） | 两条 harness 都不在主干；`App.tsx` 只 import 模块；旧 wire 零残留 |

迁移期间的兼容：布局与 `registry.json` 的旧形状（`kind`、`sessions[]`）在读时迁移，
写入只用新形状；`restore` 对旧 id 返回 false 即静默移除。

## 13. 风险与边界

1. **同等公民 ≠ 功能对等**：模型、斜杆、子代理是 pi 的能力；manox 有 elicitation；终端没有会话。
   契约给的是同一套挂载点，不是同一组功能。壳里出现「如果不是 pi 就……」就是设计错了。
2. **native 是稀缺资源**：默认模板是纯 TS 模块；只有进程、宿主策略、Rust 依赖才开域。
3. **一次性大搬迁会打断全部门禁**：按 S0–S3 每步搬一类，测试跟着模块走（`app/modules/<id>/*.test.ts`），
   主干测试用假模块。
4. **状态归属**：模块 store 必须是单例，组件卸载不丢；否则拖 tab/切容器就是数据丢失。
5. **文档**：模块的实现文档放 `docs/modules/<id>.md`（按需），架构只保留共同规则。
