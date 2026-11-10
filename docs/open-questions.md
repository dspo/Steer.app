# 产品 / 架构 / 技术问题清单

> 状态：**Q1–Q22 全部裁决完毕，当前无未决问题。** 每条裁决的细节落在三份架构文档的决策记录表；spike 实测结论见 [spike-report.md](spike-report.md)。新问题出现时在本文件追加，回答后并入对应文档。

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

## 留档：需要 v1 验证的风险（非待决问题）

来自 spike 报告 §4，属于「实现时验证」而非「需要拍板」：

1. `createAgentSession` 在 Bun 下的完整真实会话（WASM 运行期加载）。
2. `parentSession` 在 pi CLI 里的 fork 观感（若不可接受，退化为路径 + custom entry）。
3. pi 升级对 `~/.pi/agent/sessions` 布局的影响（登记进兼容性台账）。
4. Zu engine 与用户终端 pi CLI 对同一 captain 的并发写（`proper-lockfile` 语义冒烟）。
