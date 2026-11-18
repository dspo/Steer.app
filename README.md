# Zu

<!-- conformance-badges:start -->
[![esctest2](https://img.shields.io/badge/esctest2-411%2F567-green?style=flat-square)](docs/evidence/conformance.json)
[![libghostty-vt](https://img.shields.io/badge/libghostty--vt-411%2F567-orange?style=flat-square)](docs/evidence/conformance.json)
[![ucs-detect](https://img.shields.io/badge/ucs--detect-measured--2.3.9-green?style=flat-square)](docs/evidence/conformance.json)
[![ghostty rev](https://img.shields.io/badge/ghostty%20rev-042b16b-blue?style=flat-square)](https://github.com/ghostty-org/ghostty)
<!-- conformance-badges:end -->

**Zu**（祖冲之——纪念其对 π 的贡献）是 coding agent 的 macOS 桌面工作台。
一块可拖拽的画布承载工作所需的一切面板：AI 会话、终端、浏览器、文件树、编辑器、
Diff、变更/历史、问题列表。项目在侧栏，工作按容器组织，页签随手切换。

## 为什么是 Zu

coding agent 已经很强，但它们住在浏览器标签页和一次性的终端会话里：上下文难留存、
多任务难并行、审批与预览没有落脚处。Zu 给 agent 一张固定的工作台。

- **会话是持久资产**：每条会话的权威记录都写在磁盘上，关窗、杀进程、隔天再开都不丢；
  重开即续跑，外部工具同样可读——你的历史不属于任何一个应用。
- **双引擎，一个界面**：pi 与 manox 两种会话引擎平级共存。pi 引擎随 app 内置、
  与官方 pi 的会话完全互通；引擎只是面板的一种，界面不区分出身。
- **工作装进容器**：容器把工作目录、布局、终端和会话收在一起，创建时快照、
  随时归档；scratch 画布随手起聊，聊出形状再铸成正式容器。
- **并行不乱**：面板自由拖拽分屏，一个窗口同时推进多路会话、终端与浏览器；
  通知只在你离开时出现，点一下就回到那条会话。

## 会话里有什么

- 模型与档位随时切换，会话中途也能换；
- 文件改动先审批后落盘，审批卡就在对话流里；
- 斜杠命令、上下文压缩、用量统计一应俱全；
- 子代理并行开工，转录随时可查、随时可停。

## 设计立场

安静、精确、可读。层级靠间距、字重与一条 hairline，而不是卡片与阴影的堆叠；
主任务只有一个焦点——画布与输入框，外壳不抢内容；动效只解释变化，不做装饰。

## 状态

核心能力已交付并通过真机验收；发布前剩打包产物的真机启动验证。
开发进度见 [docs/plan.md](docs/plan.md) §0，已知问题见
[docs/architecture.md](docs/architecture.md) §7。

## 深入阅读

架构、协议、设计与决策文档都在 [docs/](docs/)，入口是
[docs/architecture.md](docs/architecture.md)。
