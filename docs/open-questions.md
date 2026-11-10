# 产品 / 架构 / 技术问题清单

> 状态：**Q1–Q28 已裁决；Q29–Q31 待回答**（可行性分析衍生的技术选型）。裁决细节落在三份架构文档的决策记录表；spike 实测见 [spike-report.md](spike-report.md)。

## 裁决总表

| # | 问题 | 裁决 | 落点 |
|---|---|---|---|
| Q1 | 子会话转录归属 | 路径即关系：captain 住 pi 原生存储（pi 可见），subagents 住 `~/.pi/zu/subagents/{captainId}/{ts}_{runId}.jsonl`（pi 视而不见）；**兼容方向不对称** | domain §4.4 |
| Q2 | 跨容器画布 | 单容器画布 + **单窗口**视图切换；多窗口不在设计中 | domain §8、ui U10 |
| Q3 | 注册表格式 | JSON 快照 + 原子 rename + 启动对账 + 状态生命周期分级 | domain §9 |
| Q4 | 布局 stash 三语义点 | 启动恢复上次容器；死资源 sheet 静默移除；空态 = Launcher | ui U7/U8 |
| Q5 | 键盘范围 | 最小集：⌘W / ⌘1-9 / ⌘K | ui U9 |
| Q6 | 第二引擎路径 | 砍掉系统 pi 通道；web 挂账 v5 | engine E9 |
| Q7 | 持久化根 | 全部用户状态落 `~/.pi`；增强落 `zu/`；凭据天然共享 | engine E11、domain §4.4 |
| Q8 | 产品名 / logo | **Zu**（祖冲之）；`<->` + 密率 355/113 | engine E10、ui U13 |
| Q9 | 界面语言 | zh-CN 第一 + en fallback，键表第一天立住 | ui U11 |
| Q10 | 增强写入 captain 的边界 | **C — CustomEntry**（不进上下文、pi 容忍；spike 证真） | domain §4.4、spike §2 |
| Q11 | 归档可见性 | v1 不做；未来候选设置页「归档管理」 | domain §10 |
| Q12 | 托盘 / 通知 | 托盘常驻 + 系统通知 | engine E12、ui U12 |
| Q13 | 子代理定义体系 | markdown + frontmatter；三来源；认 skills 字段；热生效 | domain §8 |
| Q14 | 自更新 | GitHub Releases | engine E13 |
| Q15 | 外部容器种类 | 四类 TUI（Terminal/Claude/Codex/Copilot） | domain §4 |
| Q16 | 托盘生命周期 | 关窗收起不确认；单实例；不自启；通知首版激进 | ui U12 |
| Q17 | 访问机制 | 不引入沙箱轴，用 pi 原生能力 | engine E15、domain §10 |
| Q18 | 无主会话呈现 | 启动对账自动纳入；运行时 watch；外部改动复活 | domain §4.2/§8 |
| Q19 | 定义的项目来源目录 | `.pi/agents/` | domain §8 |
| Q20 | 多窗口打开面 | **澄清**：多窗口不在设计内 | ui U10 |
| Q21 | Zoom 持久性 | **B 持久**（写进容器布局 stash） | ui U14 |
| Q22 | turn 进行中的语义 | 按「简单 > UX > 性能」：切容器丢弃增量、restore 重建；退出弹确认（早期可直接退出） | domain §8 |

## 已裁决详情（Q23–Q28）

> 这一批是「pi 生态集成面」与「分发面」的问题。前几轮聚焦引擎/UI/对象模型的骨架，这些被骨架讨论遮蔽了；它们直接落在 Q7「完全兼容」的边界上，越早定越省事。

### Q23（已定）：加载 — A 全量 + 最小 UI 桥

**裁决**：加载。用户定位是「Zu 是一个自带一系列 pi 扩展的 pi 桌面端」；engine 走 pi 原生资源发现，扩展的 `ctx.ui.*` 桥到 nsh 原生对话框（confirm/select/input；editor/custom 降级）。落点 engine E16、ui 待建清单。

### Q23 原问题（留档）：用户已有的 pi 扩展与 skill，Zu 加载吗？

**背景（机制，这是本批最重要的一条）**：你的 `~/.pi/agent/` 里已经有真实资产——`extensions/`（ghostex-session.ts、otty-integration.ts）、`settings.json` 的 `packages: ["../../projects/dspo/pi-package"]`（本地 npm 扩展包）、`skills/`（一整套钉钉 skill）。pi 的扩展**能注册工具**（`pi.registerTool`）、**能注入上下文**（`pi.appendCustomMessageEntry`）、**能拦截工具调用请求用户确认**（`ctx.ui.confirm`）。

于是有一个绕不开的边界：同一个 captain 会话，用 pi CLI 打开时有这些扩展提供的工具与拦截，用 Zu 打开时如果没有——**模型能力不一致**，而这是 Q7「完全兼容」最容易破的地方（不只是文件能读，而是行为等价）。

**选项**：
- **A 全量加载**：engine 走 pi 原生的资源发现，用户的 extensions/skills/packages 全部生效。行为等价性最好；但扩展可能调用 `ctx.ui.*`（confirm/select/input/editor/custom），Zu 必须实现这些 UI 的桥接，否则扩展阻塞或报错。
- **B 只加载工具与上下文，UI 调用降级**：`ctx.hasUI = false`（pi 的扩展 API 有这个开关，扩展可自行降级）。多数扩展会优雅退化为「自动确认/跳过询问」，少数会报错。
- **C 不加载**：Zu 只跑裸 pi。最干净，但用户装的东西全部失效，且同一会话两前端行为分叉。

**若选 A，还要定 UI 桥的范围**（pi 的 `ctx.ui` 有五种：confirm / select / input / editor / custom）：最小集是前三种（nsh 有 AlertDialog / Picker / Input 原生对应）；`editor` 与 `custom`（扩展自带 TUI 渲染）映射到 nsh 的代价高，可以降级为纯文本对话框或拒绝。

**建议**：**A + 最小 UI 桥（confirm/select/input）**。理由：Q7 定了「完全兼容」，行为等价是这个承诺的实质；UI 桥三种形态 nsh 都有原生对应，成本可控；`editor`/`custom` 明确降级并记录（扩展自己的 TUI 在 GUI 里本来也无法 1:1 呈现）。

**需要你回答**：A / B / C？若 A，`editor`/`custom` 降级可接受吗？

### Q24（已定）：B — 读共享、写独立、模型选择写回

落点 engine E17。

### Q24 原问题（留档）：`settings.json` 共享还是独立？

**背景**：`~/.pi/agent/settings.json` 里有 `defaultProvider` / `defaultModel` / `defaultThinkingLevel` / `retry` / `theme` / `packages`。其中 `theme` 是 pi TUI 的主题（Zu 用不到），`packages` 是扩展清单（Q23 依赖它），`defaultProvider/defaultModel` 是会话语义的一部分。

**三个方向**：
- **A 全共享**：Zu 直接读写这个文件。风险：Zu 写 `theme` 或私有键会污染 pi 的配置；`settings.json` 的 schema 属于 pi，改错会让 pi 报错。
- **B 只读共享 + 写独立**：读它拿 provider/model/packages；Zu 自己的偏好（窗口、通知、布局指针）写 `zu/settings.json`。模型选择是否写回共享？——建议**写回**（模型是会话语义，用户在 Zu 里切了模型，pi CLI 继续该会话时应该一致）。
- **C 完全独立**：Zu 有自己的 settings，用户在 Zu 里要重新配模型。违背「无缝」。

**建议**：**B**（读共享 + 写独立 + 模型选择写回共享的 key），且 Zu 绝不写 pi schema 之外的键到那个文件。

**需要你回答**：B 可以吗？（尤其「模型选择写回共享」这一条——它意味着 Zu 里切模型会改变 pi CLI 的默认。）

### Q25（部分定案）：bundle 内放 sidecar，签名/公证待流程验证

**已答**：可以放 `Zu.app/Contents/Helpers/pi-engine`（直接执行、不释放）；需嵌套签名 + hardened runtime + Bun JIT entitlement + 公证。**衍生问题见 Q28**（nsh 的 execute 白名单不支持变量路径）。

### Q25 原问题（留档）：macOS 代码签名与公证

**背景**：Steer 现在是 **ad-hoc 签名**（`script/bundle-mac`），用户下载 dmg 后需要右键打开或 `xattr -d com.apple.quarantine` 才能运行。Zu 多一个变数：**engine sidecar 是 69MB 的独立二进制**，嵌在 app bundle 里，需要**嵌套签名**（`codesign` 逐层），且 Bun 的 JIT 需要 `com.apple.security.cs.allow-jit` entitlement——否则签了名反而崩。公证（notarization）需要 Apple Developer 账号（$99/年）。

**选项**：
- **A ad-hoc + 文档教用户绕过**：零成本，与 Steer 一致；用户每次下载都要手动操作，反馈会很差。
- **B Developer ID + 公证**：双击即开，分发体验正确；需要付费账号 + CI 里的 notarytool 流程 + 嵌套签名/entitlement 调试。
- **C 先 A 后 B**：早期内部用 A，对外发布前切 B。

**建议**：**C**。签名流程与 engine 的嵌套结构强相关（尤其 sidecar 释放到 dataDir 再 exec 的模式——释放出来的二进制**也需要签名**且要公证覆盖，否则 Gatekeeper 会拦），这套必须在正式发布前打通一次，不能等到发版当天。

**需要你回答**：C 可以吗？Apple Developer 账号是否已有/可申请？

### Q26（已定）：A — 公开

落点 engine E18。

### Q26 原问题（留档）：仓库公开性

**背景**：Q14 定 GitHub Releases 作为更新源。nsh/updater 从 Releases 拉资产，若仓库私有则需要 token 内嵌（泄露风险）。另外开源与否影响：LICENSE（pi 是 MIT，我们若分发衍生需保留 NOTICE）、贡献者流程、上游协作方式（Zu 的增强有没有机会回流 pi 上游）。

**选项**：**A 公开**（MIT/Apache；updater 匿名可用，可吸引贡献者与上游协作）；**B 私有 + token**（内部分发，updater 需要凭据管理）；**C 公开但暂不接受外部贡献**。

**建议**：**A**。这是 pi 的桌面端，pi 本身开源，闭源会限制「上游协作」这条长期价值路径。

**需要你回答**：A / B / C？

### Q27（已定）：支持 telemetry，但不在早期里程碑

落点 engine E19；先确认 pi 的开关方式，默认不上报。

### Q27 原问题（留档）：遥测策略

**背景**：pi 的依赖里有 `@earendil-works/pi-telemetry`。默认行为需要确认（是否默认上报、上报什么、能否关闭）。Zu 作为桌面端会有自己的崩溃/使用数据诉求，但「用户的 coding agent 在本地跑」这件事让隐私预期很高。

**选项**：**A 全关**（Zu 侧禁用 pi 遥测，不加自己的；最保守）；**B 只留崩溃上报**（可关闭）；**C 跟随 pi 默认**。

**建议**：**A**。先关，等有明确的产品需求（例如线上问题定位）再谈，且届时必须显式 opt-in。需要 v1 时确认 pi-telemetry 的开关方式（env / settings 键 / 编译期剔除），并入 spike 清单。

**需要你回答**：A / B / C？

### Q28（已定）：B — Rust nativeModule

**裁决**：mixed 模板 + `#[native_module]` 暴露 `spawnEngine()`，Rust 侧 `current_exe()` 定位 `../Helpers/pi-engine`。该模块同时是 PTY / Ghostty 仿真核 / LSP 客户端的统一落脚点（见 [feasibility.md](feasibility.md)）。

### Q28 原问题（留档）：sidecar 怎么被启动？（nsh 能力白名单的实测限制）

**背景（这是 Q25 的技术发现，必须拍板）**：sidecar 放 `Zu.app/Contents/Helpers/pi-engine` 没问题，但**让 nsh 的 TSX 去执行它**受一条限制：nsh 的 `capabilities.process.execute` 只接受**裸命令名或绝对路径**（`valid_command`，nsh `crates/nsh-core/src/access.rs:1103`），并且运行时是**精确字符串比对**（`allows_process`，`:1469`），**不支持 `${dataDir}` / `${resourcesDir}` 等变量**——这一点在源码里确认过，与 `fs` 能力（支持 `${dataDir}`）不同。而 bundle 路径随安装位置变化（`/Applications`、`~/Applications`、任意目录）。

**方案**：
- **A `sh -c` 逃生口**：`execute: ["sh"]`，TSX 里 `spawn("sh", ["-c", "<engine 绝对路径>"])`。零 Rust 改动、v1 立刻可用。代价：白名单退化为「任意命令可执行」（`sh -c` 什么都能跑），安全上是自己削弱自己的沙箱——但 Zu 的代码是自有的、可信的，实际风险有限。需注意路径引号（安装路径可能含空格）。
- **B Rust nativeModule（mixed 模板）**：`nsh.json` 加 `"rust": "."`，`src/lib.rs` 用 `#[native_module]` 暴露 `spawnEngine()/stopEngine()`，Rust 侧 `current_exe()` 定位 `../Helpers/pi-engine` 并 spawn。沙箱语义正确、路径解析稳。代价：仓库从「纯 TSX」变成 mixed（引入 Cargo 构建），且这个 native module 会成为后续 PTY（v4）的落脚点。
- **C 上游加 `${resourcesDir}` 支持**：给 nsh 提 PR 让 `execute` 支持 bundle 资源占位符。最干净的长态，但依赖上游接受与发版节奏。

**我的建议**：**B**。理由：A 会让 `execute: ["sh"]` 永远留在 manifest 里，且 PTY（v4）无论如何都需要 Rust nativeModule（Bun 无内建 PTY），提前引入 mixed 模板不是额外成本而是把必经之路走早；C 可作为后续优化（若上游接受，Rust 模块可简化为纯 TSX 调用）。

**需要你回答**：A / B / C？（若选 B，我下一轮就把 mixed 模板的骨架搭起来。）

## 留档：需要 v1 验证的风险（非待决问题）

1. `createAgentSession` 在 Bun 下的完整真实会话。
2. `parentSession` 在 pi CLI 里的 fork 观感。
3. pi 升级对 `~/.pi/agent/sessions` 布局的影响（兼容性台账）。
4. Zu engine 与终端 pi CLI 对同一 captain 的并发写。
5. 签名/公证：嵌套签名 + Bun JIT entitlement 的实际可行性（Q25）。
6. 用户扩展（ghostex-session.ts 等）在 `ctx.hasUI = true` 下经 wire 桥正常工作（Q23）。

## 待回答（Q29–Q31，可行性分析衍生）

> 背景见 [feasibility.md](feasibility.md)。三项都影响 Q28 落地后的第一个里程碑。

### Q29：Ghostty 仿真核什么时候替换 nsh 的 VtEmulator？

**背景**：nsh 的 `Terminal` 自带 `VtEmulator`（`vte` crate，alacritty 的解析器，684 行 Rust 实现），TUI 基本够用；`TerminalEmulator` trait 与 `TerminalEmulatorFactory` 允许换 libghostty-vt（注释点名许可）。替换的技术路径已明确（feasibility §1），但它是**额外工作量**：vt cell → `TerminalLine`/`TerminalRun` 映射、事件语义对齐、与 `steer-ghostty` 的 static link 合并。

**选项**：
- **A v1 用内置 VtEmulator，Ghostty 作为后续独立里程碑**：TUI 先跑起来，用真 claude/codex 冒烟看是否有渲染缺陷（alt screen、宽字符、鼠标）。风险：若内置实现有硬伤，返工一次。
- **B 一开始就上 libghostty-vt**：终态一步到位，与 Steer 共享仿真核。风险：v1 变重，且要先把两个 build script（nsh 的 libghostty 静态链接 + steer-ghostty）合并。

**建议**：**A**——先用真 TUI 冒烟暴露内置实现的缺陷，再决定是否值得替换；Ghostty 的核心价值（性能、完整 VT）在 TUI 场景不一定立刻显现。

**需要你回答**：A / B？

### Q30：LSP 客户端放 Rust native module 还是 engine？

**背景**：「完整 IDE」的唯一大件。nsh 的 Editor 本身齐备（高亮/折叠/多光标/find-replace/诊断/装饰），但**没有 LSP 客户端**——gallery 的「语言服务器」是正则模拟。真 LSP 需要起子进程 + stdio JSON-RPC + 增量同步（didChange）+ 多服务器管理。

**选项**：
- **A Rust native module**：`lsp-types` crate + `std::process`；与 PTY 同层，`Callback::post` 推送诊断。约 2-4k 行 Rust。
- **B engine（Bun）**：用 npm 生态（`vscode-languageserver-protocol` 等），经 wire 推给 UI。生态现成，但 engine 是 pi 的领域，塞 LSP 会让它的职责变杂。
- **C 不做 LSP**：编辑器只有高亮与编辑，没有补全/跳转/诊断。IDE 定位打折。

**建议**：**A**。理由：LSP 与 PTY 共享「长生命周期子进程 + 异步流」模型，同一个 native module 里复用基础设施；engine 保持纯净（只跑 pi）。

**需要你回答**：A / B / C？

### Q31：Rust native module 的职责边界

**背景**：Q28=B 之后，这个模块要同时管：engine sidecar 的 spawn/回收、PTY 的创建与生命周期、可选的 Ghostty 仿真核、LSP 子进程、Git 调用。它是一个「桌面能力的总入口」，如果边界不清，会变成第二个上帝对象。

**需要你定的边界**（可多选/组合）：
1. **只做「进程与句柄」**：一切对外部进程的操作（engine、PTY、LSP、git）都在这里，UI 经 TSX 调用。好处：唯一出口，便于审计；坏处：模块大。
2. **按域拆分多个 native module**（`zu/engine`、`zu/pty`、`zu/lsp`、`zu/git`），共享一个内部 crate。好处：职责清晰；坏处：注册面变多。
3. **生命周期归属**：所有子进程的 owner 是「sheet」还是「容器」？（PTY 的 owner 是容器——容器死全回收；engine 是进程级单例；LSP 按 workspace 共享；git 是一次性调用。）需要明确「谁 kill 谁」。

**建议**：**2 + 3**——按域拆注册面（每个域一个小模块，但共用一个 `zu-native` crate），生命周期表写进架构文档：engine = 进程级单例；PTY = 容器；LSP = workspace；git = 一次性。

**需要你回答**：1 / 2 / 3 的组合，或你的边界想法。
