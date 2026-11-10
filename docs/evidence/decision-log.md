# 决策过程记录

> 依据文档。记录每条决策的来龙去脉：当时的约束、考虑过的选项、为什么落在这个点。
> 最终裁决见 [../decisions.md](../decisions.md)；设计正文见 [../architecture.md](../architecture.md)。

## 第一轮：骨架（Q1–Q6）

**Q1 子会话转录归属。** 约束是「主会话与子会话的关系要不言自明」。选项：注册表记边（关系在数据里）vs 路径编码（关系在文件系统里）。初选路径即关系；第二轮曾误判「目录隔离与完全兼容冲突」而撤销；第三轮用户澄清「允许 pi 看不到我们增强的部分」——**撤销是误判**，因为兼容是方向不对称的：pi → Zu 必须全能，Zu → pi 允许增强不可见。最终回到路径即关系，captain 住 pi 原生存储保持可见。

**Q2 跨容器画布。** 约束是所有权矩阵的复杂度（sheet 属于容器 A 却显示在 B 的布局里，teardown 与未读都会分叉）。选项：单容器画布 / sheet 全局化。裁定单容器；Q20 进一步澄清「多窗口从未在设计里」——侧栏 item 就是容器入口，切换即同窗口内换面板组。

**Q3 注册表格式。** 选项：JSON 快照 + 原子 rename vs append-only JSONL。快照的崩溃面被原子 rename 覆盖，且注册表大部分字段可从外部事实对账重建；日志的 compaction 成本不值得。附带的「状态生命周期分级」来自用户提醒：**并非所有状态都值得跨重启**——终端明确不恢复。

**Q4 布局 stash。** 三个语义点逐个定：启动恢复上次容器（连续性）；死资源 sheet 静默移除（用户授权「简单实现优先」）；空态 = Launcher（与「先 composer 后容器」合并，少一个页面状态）。

**Q5 键盘范围。** 完整集（含 `⌘D` 分栏）的每个键都带来文档、测试、与系统习惯的冲突成本；v1 取最小集。

**Q6 第二引擎路径。** 保留系统 pi 通道意味着两套实现跟随 wire 演进、per-session 进程的回收地狱在调试形态复活。调试需求用源码形态满足即可。

## 第二轮：持久化与生态（Q7–Q15）

**Q7 持久化根。** 用户否决了「完全隔离」：**所有持久化活动放 `~/.pi`，与原生 pi 完全兼容**；增强部分要么 pi 不看、要么我们对 pi 视而不见。直接后果：Zu 的 nsh Storage 裁撤（UI 不持 fs），全部状态经 engine wire 落 `~/.pi/zu/`；凭据天然共享，无需导入。

**Q8 品牌。** 与 pi CLI 同名会长期歧义（搜索、口头交流）。**Zu**（祖冲之）既纪念 π 的贡献，又避开同名。logo 沿用 Steer 的 `<->` 构型，加载密率 355/113（横线上 355、下 113）。

**Q9 语言。** 键表纪律越晚立越贵；对齐 Steer 的 zh-CN 第一 + en fallback。

**Q10 增强写入面。** 三个选项：不写（pi 侧干净但历史不可见）/ 普通消息（污染上下文）/ 自定义条目（待证）。spike 证实 `CustomEntry` 不进上下文且 pi 容忍，于是定 C；`CustomMessageEntry` 因参与上下文被排除。

**Q11 归档可见性。** v1 不做；用户倾向未来放进设置页的「归档管理」。

**Q12/Q16 托盘与通知。** 选「托盘 + 通知」是因为核心循环是「派活 → 后台跑 → 回来收」，通知是这个循环的闭环。细则按「早期激进、后续做减法」：关窗收起不确认、单实例、不自启、通知多报。

**Q13 子代理定义。** 调研 ThinkRail（`packages/pi-subagents/src/definitions.ts`）：markdown + YAML frontmatter，三来源 builtin/personal/project，字段含 tools/model/thinking/maxTurns/skills。用户定：采纳同款形态、认 persona 的 skills 字段、定义热生效。

**Q14 自更新。** 与 Steer 同款 GitHub Releases；仓库公开（Q26）使其可匿名拉取。

**Q15 外部容器种类。** 只做四类 TUI；VS Code / ChatGPT 这类 GUI 直发不做，避免「非容器动作混进容器语义」。

## 第三轮：兼容与对象模型细节（Q17–Q22）

**Q17 访问机制。** 用户明确「之前说的沙箱访问只是举例」，v1 直接用 pi 原生能力，不引入授权轴与审批面。

**Q18 无主会话。** Q7 放开持久化根后的必然后果：pi CLI 创建的会话没有注册表记录。选项：自动对账纳入 / 单独分区 / 不显示。选自动纳入（「Zu 看起来就是一个 pi 前端」），运行时 watch，外部改动复活归档容器。

**Q19 项目来源目录。** `.pi/agents/`：在「Zu 是 pi 的 desktop 端」定位下，资源放 pi 的约定位置。

**Q21 Zoom 持久。** 用户选持久：切走切回保持。

**Q22 turn 进行中。** 决策准则「实现简单 > UX > 性能」：切容器丢弃非当前容器的增量、restore 时从转录重建；退出弹确认（早期可直接退出）。

## 第四轮：pi 生态与分发（Q23–Q28）

**Q23 用户扩展加载。** 用户的 `~/.pi/agent/` 里已有真实资产（extensions、packages、skills）。不加载会造成「同一会话在两前端行为分叉」——因为扩展能注册工具、能拦截审批。选全量加载；`ctx.ui.*` 五种形态中，confirm/select/input 有 nsh 原生对应，editor/custom 降级。

**Q24 settings 读写。** `settings.json` 混着会话语义（provider/model/thinking）、扩展清单（packages）与 pi TUI 专属（theme）。读共享、写独立；模型选择写回共享以保持会话语义一致。

**Q25/Q26 分发。** sidecar 放 `Contents/Helpers` 直接执行（不释放），嵌套签名 + JIT entitlement + 公证；仓库公开（updater 匿名可用、便于上游协作）。

**Q27 遥测。** 支持但不在早期里程碑，默认不上报。

**Q28 sidecar 启动方式。** 调研发现 nsh 的 `capabilities.process.execute` 只认裸命令名或绝对路径、精确比对、不支持 `${dataDir}`（`access.rs:1103/1469`），而 bundle 路径随安装位置变化。三选项：`sh -c`（削弱沙箱）、Rust native module、上游加占位符。选 native module，因为 PTY 无论如何都需要它。

## 第五轮：可行性（Q29–Q31）

**Q29 终端仿真核。** 关键发现：`TerminalEmulator` trait 的能力上限锁死了换核收益——`TerminalModes` 仅 2 字段、`TerminalCursor` 无形状、事件只有 Title/Bell/Reply，所以换 Ghostty 只拿到解析正确性（含发现的 alt screen 污染 scrollback 缺陷），拿不到鼠标/超链接/光标形状。性能也不是理由（line 级 trait 决定了每次渲染的转换成本换核也省不掉）。裁定：M2 先用内置冒烟 + 修 alt 缺陷；「Ghostty + 扩 trait/组件」作为 M-tty 一次换到位，避免换两遍。

**Q30 LSP 位置。** 与 PTY 共享「长生命周期子进程 + 异步流」基础设施，放同一个 Rust native module；engine 保持只跑 pi。

**Q31 native module 边界。** 它同时管 engine/PTY/LSP/Git，必须是「按域拆注册面 + 生命周期表」，否则会变成第二个上帝对象。

## 附：被否决的方向（避免重复讨论）

| 方向 | 否决理由 |
|---|---|
| pi 塞进 QuickJS | npm 依赖树 + Node 全量 API，不可行 |
| 依赖用户系统的 pi | 版本不可控、扩展面被全局配置污染 |
| Rust root（全 Rust） | 权威是 JS 引擎，没有 Rust 数据面可做 |
| 每会话一个进程 | 回收/resume 变进程编排；pi 无多路复用协议，SDK 才是正解 |
| 多窗口 | 不在产品设计中（Q20 澄清） |
| 沙箱授权轴 | v1 用 pi 原生能力即可（Q17） |
| 目录隔离 captain | 会让 pi CLI 看不见 captain，违反 Q7 的可见性（Q1 修正） |
| `CustomMessageEntry` 写调度事件 | 参与 LLM 上下文，污染续跑（Q10） |
| libgit2/git2 | shell out git 零依赖且与 pi 工具行为一致 |
