# 产品 / 架构 / 技术问题清单

> 三份架构文档之外的待决与下轮再议问题，集中在此。每条附机制背景与方向；**回答后把结论并入对应文档的决策记录表，本条随之更新**。编号接续已裁决的 Q1–Q15。

## 已裁决（2026-11-10 第二轮，详情见各文档）

| # | 问题 | 裁决 | 落点 |
|---|---|---|---|
| Q7 | 持久化根与原生 pi 兼容 | 全部落 `~/.pi`，完全双向兼容；Zu 增强落 `zu/` 命名空间 | engine E11、domain §4.4/§9 |
| Q8 | 产品名 | **Zu**（祖冲之）；logo 暂 `<Z>` | engine E10，已落码 |
| Q9 | 界面语言 | zh-CN 第一 + en fallback，键表第一天立住 | ui U11 |
| Q11 | 归档可见性 | v1 不做；未来候选设置页「归档管理」 | domain §10 |
| Q12 | 托盘/通知 | **C：托盘 + 系统通知** | engine E12、ui U12 |
| Q14 | 自更新 | GitHub Releases，与 Steer 同款 | engine E13 |
| Q15 | 外部容器种类 | 只做四类（Terminal/Claude/Codex/Copilot TUI） | domain §4 已载 |

---

## 下一轮讨论

### Q10（续）：Zu 与原生 pi 的「互通兼容包络」

**方向已定**：双向互通是产品目标——Zu 打开时自然加载 `~/.pi` 里的全部 sessions（不问出处），pi CLI 同样看得到、可以尝试打开，不兼容由打开方自行报错。

**下一轮要定的是包络细则**——即 Zu 的哪些增强会触碰会话文件、触碰后 pi 打开时的行为是否可接受：

1. **会话名约定**：子会话命名 `zu:{captainShortId}:{runId}`（domain §4.4）——pi CLI 会话列表会显示这些名字。可接受吗？还是希望子会话在 pi CLI 里完全隐形（那需要自定义条目方案，待 spike ③②）？
2. **Zu 增强工具的痕迹**：dispatch/inject 等调度动作若需要落转录（如 Steer 的 `run/guided` → 转录 note 行），用什么形式写进 pi 会话文件（自定义条目 vs 普通消息条目 vs 只进注册表不进文件）？写法直接影响 pi CLI 回放时的观感。
3. **访问机制**：Zu 计划增强「沙箱访问 vs 完全访问」——若某容器以受限授权创建，pi CLI 直接打开它会**绕过** Zu 的授权面（pi 自己的 project trust 与 Zu 的授权不是一套）。这个差异是否可接受、要不要在会话里标记「由 Zu 沙箱创建」让 pi CLI 至少能警告？

### Q13（续）：子代理定义体系

**方向已定**：下一轮继续。**ThinkRail 调研结论**（`packages/pi-subagents/src/definitions.ts`）：

- 定义文件 = **markdown + YAML frontmatter**（Claude Code agents 同款形态）：frontmatter 携带 `name / description / tools / model / thinking / maxTurns / inheritProjectContext / skills / extensions`，正文即 system prompt。
- 三来源：`builtin`（代码内置）/ `personal`（用户配置目录）/ `project`（项目目录）。
- 解析容错：字段校验 + thinking 级别枚举 + 名称列表解析，坏文件跳过。

**下一轮要定**：① Zu 采纳同款 markdown+frontmatter 形态吗（三来源目录怎么映射到 `~/.pi/zu/`：`agents/builtin|personal|project`？）；② 与 pi 既有 skill 文件的关系（互不认 or skill 可被引用为 persona 的 skills 字段，ThinkRail 已有 `skills` 字段先例）；③ 定义变更的生效时机（engine 热扫描 vs 重启生效）。

### Q16：托盘常驻的生命周期语义（承 Q12=C）

**背景**：托盘常驻意味着**关窗 ≠ 退出**：窗口关了，应用进程与 engine 活着，后台 run 继续；用户通过托盘菜单退出。这引入一组此前不存在的问题，需要在动工前逐条定死：

1. **关窗行为**：点关闭按钮 = 隐藏窗口（macOS 惯例）还是弹确认（有活跃 run 时）？活跃 run 跑到一半用户强制退出怎么办（engine 的 teardown 瀑布已有，UI 入口要接）？
2. **单实例**：二次启动（Dock 再点 / `open Zu.app`）= 激活已有实例（带参数转发）还是允许多实例？多实例会共享 `~/.pi` 状态根，engine 会话文件写入竞争由 pi 锁兜底，但容器注册表（`zu/registry.json`）需要自己的锁或单实例强制。
3. **登录自启**（Login Items）：要不要？（后台 agent 产品的常见诉求，但 v1 可以不做）
4. **通知点位的免打扰**：哪些事件发通知（turn settle / 子会话交付 / 全部容器 vs 仅聚焦容器），静默时段要不要？

**建议**：1 = 关窗隐藏 + 活跃 run 时托盘角标提示、强制退出走确认；2 = 单实例强制（注册表无锁成本）；3 = v1 不做；4 = 两类通知 + 全局开关。逐条确认或改。

### Q17：Zu 的工具增强与访问机制（「沙箱访问 vs 完全访问」）

**背景**：你在 Q10 中点名了这条增强线——Zu 可能给 pi 增加工具与访问机制，典型即**沙箱访问 vs 完全访问**的分野（Steer 侧对应 fence/seatbelt 授权面与审批流）。这既是产品能力也是 Q10 兼容包络的变量（受限容器被 pi CLI 直开即绕过授权）。

**下一轮要定方向**：① v1 是否引入访问模式轴（完全访问 = pi 原生行为；受限 = Zu 沙箱，机制待选——macOS sandbox profile / pi 自身的工具白名单）；② 授权审批 UX（工具调用前询问、按容器记忆、永远询问三档？Steer 的审批面可作参考）；③ 该轴与容器 kind/定义（Q13 定义文件可带权限字段）如何组合。此题较大，建议单开一轮。

---

**已清账**：Q1–Q6（第一轮）、Q7–Q9/Q11/Q12/Q14/Q15（第二轮）已并入各文档决策记录；本轮遗留 Q10（续）/Q13（续）/Q16/Q17 待下轮。
