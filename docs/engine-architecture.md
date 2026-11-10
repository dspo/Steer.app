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
| E5 | 会话 durable 权威：**pi 的 session JSONL 文件**（`SessionManager` 注入自定义目录 → `<appData>/pi/sessions`）；UI 永不镜像转录 | resume = 按文件重建会话；engine 崩溃重启后按需 rehydrate |
| E6 | `EngineConnection` 是 UI 侧**唯一引擎边界**（接口 + `WsHost` 实现 + `Fake` 测试实现）；UI 代码只 import 接口与 `contracts/` 类型 | 类比 Steer 的 AHP store 折影纪律 |
| E7 | 容器注册表、PTY、子会话生命周期归 **sidecar**（它拥有全部进程）；Project/membership 归 **UI**；详见 domain-model.md | |
| E8 | **pi 扩展机制用于调度面**：sidecar 内置扩展注册 captain 的 dispatch/abort/引导工具（实现闭包持有 SessionManager），**不用扩展承载所有权注册表**（扩展随单会话生灭，容器跨会话长寿） | 详见 domain-model.md §5 |

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
  "storage": true
}
```

v1 仅此。UI 不持有 fs 能力（偏好走 Storage 模块）——UI 沙箱被攻破也摸不到项目代码。

## 6. 分发与生命周期

- **释放-执行**：engine 二进制随 app bundle；首启或版本戳变化时释放到 `<dataDir>/engine/pi-engine-<版本>`、chmod +x、exec；留新删旧。
- **懒启动**：第一个容器打开才 spawn；退出顺序：先 abort 全部活跃 turn 再 kill；子进程崩溃 → 指数退避重启 + UI banner。
- **版本自管**：`engine/package.json` 精确 pin `@earendil-works/pi-coding-agent =x.y.z` + `bun.lock` 进 git；升级 = 改 pin 的 PR（引擎测试 + 冒烟 + 兼容性台账逐条重验）；sidecar 内禁 pi 自我更新（`pi update` 不可达）。
- **兼容性台账**：每个绕过 pi 缺口的适配登记「上游什么条件下可删」（借鉴 ThinkRail `pi-compatibility.md` 方法论）。
- **MIT 合规**：NOTICE/About 保留 pi 版权与许可声明。

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
3. **pi 状态与配置隔离**：session 目录可指定已知；settings/扩展发现的隔离机制（env/flag）待证——目标 `<appData>/pi/` 完全自治，不渗用户 `~/.pi`。
4. **nsh sockets 能力的端口授予形态**（固定端口段探测 vs host 级授权）。
5. **asset 释放-执行**在 nsh TSX 里的顺滑度（决定是否需要 Rust nativeModule 退出舱）。

## 11. 开放问题（需要拍板）

### Q6：要不要保留「系统 pi」调试通道与 web 目标？

**背景**：`EngineConnection` 是接口，技术上可以有多个实现。讨论中出现过两条「第二路径」：① 一个直连用户系统装的 `pi --mode rpc` 的实现（每会话一个子进程），作为开发期调试或引擎故障时的逃逸通道；② web target（浏览器客户端连同一个 engine）作为未来第三平台。

**为什么这是个问题**：本仓 adopt 的激进纪律是「不维护第二路径、不留死代码」。保留系统 pi 通道意味着：两套实现都要跟随 wire 演进、每会话一进程的回收地狱在调试形态里复活、测试矩阵翻倍。而 web 目标的影响面不同：它不影响引擎，只要求 **contracts 与 UI 不用浏览器拿不到的能力**——我们的 UI 本来就不用 process API（能力面只有回环 + storage），所以「为 web 留门」的实时成本几乎为零，真正的成本推迟到 v5 才发生。

**选项**：
- A：砍掉系统 pi 通道（唯一路径 = 内嵌 sidecar）；web 挂账 v5，contracts 设计仅要求「不引入 web 不可用的 UI 能力」（当前已满足）。
- B：两个都保留：系统 pi 通道做成 engine 的 `--fallback-system` 模式；web 提前到 v2。

**建议**：A。调试需要真 pi 时直接跑 `bun run engine/src/server.ts`（源码形态，热重启），不需要第二条产品路径。

**需要你回答**：接受 A 吗？（是 / 否，若否说明想要哪条保留）
