# 引擎与前后端架构（engine sidecar）

> 状态：设计定稿（2026-11-10 讨论定稿）。随实现推进更新；开放问题见文末。

## 0. 一句话

**Pi 不进 UI 进程、不依赖用户系统安装，而是 vendor 成随应用分发的 Bun 单文件 sidecar**；UI（nsh TSX app）与引擎之间只有一个 `EngineConnection` 边界，走 loopback WebSocket；pi 只做会话权威（session 文件），容器与进程生命周期归 sidecar，组织关系归 UI。

## 1. 三个第一性约束

1. pi 是 Node 生态的 JS 引擎；nsh 的 TSX 引擎是 QuickJS 沙箱（无 npm、非全量 Node）→ **pi 不能塞进 UI 进程**。
2. 我们要**自管 pi 版本**并**经 pi 扩展机制定制** → 引擎必须随应用携带（vendor），不依赖系统安装。
3. nsh 有能力沙箱模型 → UI 进程保持最小能力面（本地回环 + storage），项目文件访问全在引擎侧。

## 2. 决策记录

| # | 决策 | 备注 |
|---|---|---|
| E1 | 引擎形态：**Bun `--compile` 单文件 sidecar**，随 app 分发 | pi 在 Bun 下已验证（ThinkRail 全线 Bun）；pi 包自带预打包 dist（`dist/bundle/cli.js`）；MIT 许可允许携带（NOTICE 保留版权） |
| E2 | **拒绝**：pi 塞进 QuickJS（npm 依赖树 + Node 全量 API 不可行）；依赖系统 pi（版本不可控，已否决）；Rust root（权威是 JS 引擎，无 Rust 数据面可做） | |
| E3 | 引擎进程拓扑：**单 sidecar 进程多路复用 N 会话**（SDK `createAgentSession` × N + `AgentSessionRuntime`），**不是每会话一个进程** | pi 的 `--mode rpc` 是 1 进程 1 会话，无多路复用协议；官方指定进程内集成用 SDK。进程数恒为 1，会话回收/resume 是内存策略（LRU dispose + 文件 rehydrate），不是进程管理 |
| E4 | 传输：**loopback WebSocket + 握手 token**（token 落 `<dataDir>/engine/token`，0600） | sidecar 与 UI 双向事件/命令 |
| E5 | 会话 durable 权威：**pi 的原生会话存储（`~/.pi` 默认布局）**，与原生 pi 完全双向兼容——Zu 打开时自然加载全部 sessions，不问出处；pi CLI 同样看得到（Q10）。UI 永不镜像转录 | resume = 按文件重建会话；engine 崩溃重启后按需 rehydrate |
| E6 | `EngineConnection` 是 UI 侧**唯一引擎边界**（接口 + `WsHost` 实现 + `Fake` 测试实现）；UI 代码只 import 接口与 `contracts/` 类型 | 类比 Steer 的 AHP store 折影纪律 |
| E7 | 容器注册表、PTY、子会话生命周期归 **sidecar**（它拥有全部进程）；**全部用户状态落 `~/.pi/zu/`（E11），经 engine wire 的 state 面**；详见 domain-model.md | |
| E8 | **pi 扩展机制用于调度面**：sidecar 内置扩展注册 captain 的 dispatch/abort/引导工具（实现闭包持有 SessionManager），**不用扩展承载所有权注册表**（扩展随单会话生灭，容器跨会话长寿） | 详见 domain-model.md §5 |
| E9 | **唯一引擎路径**：不保留「系统 pi」直连通道（每会话一进程的形态随之永不再现）；调试用源码形态 `bun run engine/src/server.ts`；web 目标挂账 v5，contracts 约束为「UI 不用 web 不可用能力」（当前已满足，实时成本为零） | 原 Q6，2026-11-10 拍板 |
| E10 | **品牌名 Zu**（祖冲之——纪念其对 π 的贡献）；bundle id `dev.dspo.zu`；logo 开发期暂用 `<Z>` 文本（Steer `<->` 同款构型），命名集中在 nsh.json 与常量 | 原 Q8，2026-11-10 拍板 |
| E11 | **用户状态根 = `~/.pi`，兼容方向不对称**：① **pi → Zu 是硬约束**（E14）：pi 原生的任何会话，Zu 总能列出/显示/打开/加载/预览/继续；② **Zu → pi 允许增强部分不可见**——captain 会话住 pi 原生存储（pi CLI 可见、可 resume），subagents 与 Zu 增强状态住 `~/.pi/zu/` 命名空间（pi 视而不见，spike ③ 验证容忍度）；Zu 状态经 engine wire 的 state 面（UI 的 nsh Storage 裁撤，UI 不持 fs 能力）。**凭据天然共享**，无需导入 | Q7 + Q1/Q10 方向，2026-11-10 三 轮定 |
| E12 | **v1 即托盘 + 系统通知**（Q12C）：托盘常驻（关窗即收起、无确认，后台 run 继续）、turn settle / 子会话交付发通知——引入「应用生命周期 ≠ 窗口生命周期」语义。细则（Q16 定案）：关窗即收起不确认、**单实例强制**、不做登录自启、通知首次**激进**（后续按反馈做减法） | 2026-11-10 二/三轮 |
| E13 | **自更新走 GitHub Releases**（nsh/updater 原生支持该源），与 Steer 同款：tag 触发构建、dmg 发布 | 原 Q14 |
| E14 | **Pi → Zu 兼容是最高优先级不变量**：pi 原生产生的会话，Zu 必须能列出、显示、打开、加载、预览、继续；解析失败跳过不阻塞启动。这条约束优先于任何 Zu 侧模型洁癖（如容器必须已注册） | Q7 补充，2026-11-10 三轮 |
| E15 | **不引入访问模式轴**：v1 无「沙箱访问 vs 完全访问」、无审批面、无 sandbox profile，直接用 pi 原生能力 | 原 Q17 |

## 3. 拓扑

```
┌────────────────────────────┐        ┌──────────────────────────────┐
│ Pi.app（nsh TSX，AppKit）  │        │ pi-engine（Bun 单文件）      │
│  screens → stores →        │  wire  │  AgentSessionManager         │
│  EngineConnection ─────────┼──WS──► │   ├─ createAgentSession ×N   │
│  （唯一引擎边界）          │loopback│   ├─ 内置扩展（dispatch 等） │
│  能力面：storage + 回环 +  │ +token │   ├─ PTY / 资源生命周期      │
│  execute [pi-engine]       │        │   └─ state: <appData>/pi/    │
└────────────────────────────┘        └──────────────────────────────┘
         │ UI 侧（nsh Storage）                    │ durable 权威
         ▼                                        ▼
   Project 注册表 / membership /            pi session JSONL 文件
   视图布局（按容器 stash）                 （runtime，永不镜像）
```

## 4. wire（contracts/）

UI 与引擎之间唯一的 import 面：TS 类型 + 小纯运行时，两边共享，带协议版本号（握手响应携带 `{ engine, pi, protocol }`，feature gate 按 `protocol` 不按 pi 版本）。

- **命令**：`container.list / container.open / container.archive`、`session.prompt / steer / followUp / abort`、`session.resume / fork`、`pty.open / resize / write / close`、`engine.info`
- **事件**：`message.delta / message.complete`、`tool.update`（pending→running→done/cancelled + 结构化载荷）、`agent.state`（thinking→executing→awaiting）、`cost.update`、`container.updated`（含未读计数）、`resource.gone`、`error`

对齐 pi SDK 语义的两个协议要点：**turn 结束锚 `agent_settled`**（`agent_end` 只是一次低层 run 的结束，retry/compaction/steering 之后还会继续）；prompt 的 `disposition` 区分 started/handled（handled 时不要等 settled）。

## 5. 能力声明（nsh.json）

```json
"capabilities": {
  "process": { "exit": false, "execute": ["${dataDir}/engine/pi-engine"] },
  "network": { "sockets": ["127.0.0.1:*"] },
  "notifications": true
}
```

UI **不持 fs、不持 storage 能力**（E11：全部用户状态经 engine wire 的 state 面落 `~/.pi/zu/`）；notifications 供后台完成提醒（E12）；托盘走 nsh desktop 模块（E12）。`execute` 的对象是引擎二进制——它属**应用安装工件**（app 数据目录），非用户状态；用户状态根只有 `~/.pi`。

## 6. 分发与生命周期

- **释放-执行**：engine 二进制随 app bundle；首启或版本戳变化时释放到 `<dataDir>/engine/pi-engine-<版本>`、chmod +x、exec；留新删旧。
- **懒启动**：第一个容器打开才 spawn；退出顺序：先 abort 全部活跃 turn 再 kill；子进程崩溃 → 指数退避重启 + UI banner。
- **版本自管**：`engine/package.json` 精确 pin `@earendil-works/pi-coding-agent =x.y.z` + `bun.lock` 进 git；升级 = 改 pin 的 PR（引擎测试 + 冒烟 + 兼容性台账逐条重验）；sidecar 内禁 pi 自我更新（`pi update` 不可达）。
- **兼容性台账**：每个绕过 pi 缺口的适配登记「上游什么条件下可删」（借鉴 ThinkRail `pi-compatibility.md` 方法论）。
- **MIT 合规**：NOTICE/About 保留 pi 版权与许可声明。
- **注册表持久化**：容器注册表 = JSON 快照 + 原子 rename + 启动对账（注册表指向的会话文件缺失 → 该容器标记 dead）；落 `~/.pi/zu/registry.json`；**状态生命周期分级**（哪些对象跨重启、哪些与进程同寿——终端明确不恢复）见 domain-model.md §9。
- **自更新**：GitHub Releases（E13，原 Q14），与 Steer 同款 tag 触发管线。

## 7. 构建 / CI / 开发回路

- `engine/build.ts`：`bun install --frozen-lockfile` → `bun build --compile --target=bun-darwin-arm64` → `dist/`（后续加平台是改一行 target）。体积预期 ~100MB 级（Bun 运行时固有），桌面可接受。
- CI：engine 构建进缓存 → `nsh package` 把 `engine/dist` 打进 bundle。
- 开发回路两条热循环并行：engine `bun run engine/src/server.ts`（热重启）；UI `nsh dev`（热重载）。

## 8. 里程碑

| 阶段 | 交付 | 验证什么 |
|---|---|---|
| **v0**（已完成） | panel+sheet 工作台 outline | nsh 习语、主题、DockArea 交互 |
| **v1 引擎闭环** | sidecar + pin pi + 一个内置 hello 扩展 + UI 连上第一个真会话 | **spike 全部证真/证伪**（见 §10） |
| **v2 容器与调度面** | 容器注册表 + dispatch 扩展 + 多会话 + workspaces | 关系对象模型落地 |
| **v3 workbench 实化** | specs/changes 面板、Launcher、侧栏接真数据 | 组织面完整 |
| **v4 终端** | mixed template + Rust nativeModule 出 PTY + `TerminalEmulator` 缝 | 重型 sheet 的成色 |
| **v5 web 白得** | `nsh run --target web` 连同一 engine | 第三平台（挂账，见 Q6） |

## 9. 测试策略

- **UI 全链路无头可测**：`Fake` 引擎注入，`nsh test` 按用户步骤驱动，不依赖 pi、不依赖网络。
- **engine 集成测试**：bun test 打真 pi（env 门控），验 wire 词汇的真实覆盖。
- **wire 一致性**：contracts 是唯一共享类型面，两侧编译期对齐。

## 10. Spike 清单（v1 前必须证真，每条都可能改设计）

1. **`bun build --compile` 打 pi**：pi 依赖含 `photon-node`（WASM 图像）与 `quickjs-wasi`——确认 compile 产物带资源跑通一次真实会话。（整个方案的地基）
2. **`createAgentSession` 程序化面**：会话创建/steer/abort/事件类型在 Bun 下的实际形态；`SessionManager` 能否注入自定义目录（子会话分层的生死，见 domain-model.md Q1）。ThinkRail `packages/server` 是参考实现。
3. **`~/.pi` 兼容性验证**：① pi 对其状态根内未知目录（如 `zu/`）的容忍度；② pi 原生会话存储的实际布局与命名（spike ① 的地基）——captain 要住这里、Zu 要扫描这里；③ `SessionManager` 能否把子会话定向到 `zu/subagents/{captainId}/`（Q1 路径方案的实现可行性）。**注**：原「会话文件自定义条目」项已降级——路径即关系（domain §4.4）不再依赖文件内元数据。
4. **nsh sockets 能力的端口授予形态**（固定端口段探测 vs host 级授权）。
5. **asset 释放-执行**在 nsh TSX 里的顺滑度（决定是否需要 Rust nativeModule 退出舱）。

## 11. 开放问题 → 裁决记录

- **Q6（系统 pi 通道与 web 目标）→ 已裁决为 E9**（2026-11-10）：砍掉系统 pi 通道，唯一路径 = 内嵌 sidecar；web 挂账 v5。
- 本文档暂无未决问题。产品/架构/技术层面的新问题集中在 **docs/open-questions.md**（Q7 起），由产品负责人逐条回答后并入各文档决策记录。
