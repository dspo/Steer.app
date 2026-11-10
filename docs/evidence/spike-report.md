# Spike 报告（2026-11-10）

验证环境：pi `1.5.0`（Homebrew 全局安装）、Node `v26.0.0`、Bun `1.3.14`、macOS arm64。
脚本位于 `/tmp/zu-spike/`（一次性验证，未入库；命令在本文可重放）。

结论先行：**engine 架构（E1/E3/E11）的全部地基假设成立，Q10 可定案为 C（CustomEntry）**。

## 1. 结果总表

| # | 假设 | 结果 | 证据 |
|---|---|---|---|
| ① | `bun build --compile` 能把 pi SDK 打进单文件 | **成立（上游同路径）** | `bun add @earendil-works/pi-coding-agent@1.5.0`（122 包，7s）→ `bun build --compile engine-probe.ts`：**2075 模块，69 MB 二进制，运行正常**，会话与 custom entry 正确落盘 |
| ② | `createAgentSession` 在 Bun 下真实跑一轮 | **未验证**（需真实凭据/费用） | 接口与类型确认存在；v1 首个真实会话时验证 |
| ③① | pi 对 `~/.pi/zu/` 未知目录的容忍 | **零干扰** | 建 `~/.pi/zu/subagents/test-captain/probe.jsonl` 后 `pi --version`、`pi list` 均 exit 0、无警告 |
| ③② | pi 会话加载器容忍 custom entry | **成立** | 含 `type:"custom"` 的会话文件：SDK 重载解析正常；`pi --session <file> --model nonexistent/none -p` 一路走到模型解析并报 "Model not found"——**没有会话解析错误** |
| ③③ | `SessionManager` 能定向到自定义目录 | **成立** | `SessionManager.create(cwd, sessionDir)` → `usesDefaultSessionDir() === false`，`listAll(sessionDir)` 可枚举 |
| ③④ | 原生会话存储布局 | **确认** | `~/.pi/agent/sessions/--<encoded-cwd>--/<timestamp>_<session-id>.jsonl`（路径分隔符编码为 `-`） |
| ③⑤ | 子会话可指定 id 与父边 | **成立（超出预期）** | `NewSessionOptions { id, parentSession }`：文件名变 `<ts>_run-abc123.jsonl`，header 带 `"id":"run-abc123"` 与 `"parentSession":"<captain 文件路径>"` |

## 2. Q10 定案：C（CustomEntry）

pi 的 `SessionManager.appendCustomEntry(customType, data)` 写入的 `type:"custom"` 条目：

- **不参与 LLM 上下文**（pi 文档原话：`Does NOT participate in LLM context`）——模型上下文干净的顾虑消失；
- pi 加载器完全容忍（实测 ③②），未知 `customType` 不报错；
- pi 交互模式可用 `pi.registerEntryRenderer(customType, renderer)` 渲染（**可选**：Zu 可发布一个轻量 pi 扩展，让愿意的用户在 CLI 里看到 Zu 事件——这是纯粹的增量，不影响兼容）。

因此 Zu 的调度事件（`dispatch` / `inject` / `delivered`）：

```json
{"type":"custom","customType":"zu.dispatch","data":{"captainId":"…","runId":"…","definition":"reviewer"},"id":"…","parentId":"…","timestamp":"…"}
```

写进 captain 会话文件；Zu 侧完整解析并在名册/转录投影中渲染；pi CLI 默认视而不见，用户装 Zu 的 pi 扩展后可见。

**放弃的方案**：`CustomMessageEntry`（`appendCustomMessageEntry`）虽然 `display: true` 能在 TUI 显示，但它**参与上下文**——会污染下次续跑的 prompt，方案 B 不可取。

## 3. 对架构文档的确认

- **E1（bun compile sidecar）**：成立，且**pi 上游自己就用 bun compile 分发**（`build:binary`、`isBunBinary`、`copy-binary-assets` 拷贝 WASM 资产）——我们照抄其资产布局即可。69 MB 是 Bun 运行时基线，可接受。
- **E3（单进程多会话）**：`SessionManager` 是纯内存对象，多实例无进程成本，与 SDK 多会话模型一致。
- **E11（状态根 `~/.pi`）**：成立，且 `~/.pi/zu/` 被 pi 完全忽略。
- **Q1（路径即关系）**：实测确定路径形态（见下），并额外获得 header 级父边。
- **Q18（对账自动纳入）**：`SessionManager.listAll()` / `list(cwd, sessionDir)` 是现成枚举面；`cwd` 编码进目录名，天然可按项目分组。
- **Q19（`.pi/agents/`）**：与 pi 的资源发现约定一致（`~/.pi/agent/{extensions,skills}` 同构）。

### 最终文件布局（实测修正）

```
~/.pi/agent/sessions/--{encodedCwd}--/{timestamp}_{sessionId}.jsonl
    # captain：pi 原生位置。pi CLI 可见、可 --session 打开、可 resume
~/.pi/zu/
  registry.json                                   # 容器注册表（JSON 快照 + 原子 rename）
  projects.json                                   # Project + membership
  layouts/{containerId}.json                      # 视图 stash（含 zoom）
  agents/{builtin,personal,project}/…             # 子代理定义（markdown + frontmatter）
  subagents/{captainId}/{timestamp}_{runId}.jsonl # 1 级子会话：路径三要素自证
```

子会话文件的三重自证（实测 ③⑤）：

| 层 | 内容 |
|---|---|
| 路径 | `subagents/{captainId}/` —— 父容器 |
| 文件名 | `{timestamp}_{runId}.jsonl` —— 成员地址 |
| header | `{"id":"runId","parentSession":"<captain 文件路径>","cwd":…}` —— pi 原生父引用 |

pi CLI 默认不扫 `~/.pi/zu/subagents/`（其枚举面是 `~/.pi/agent/sessions`），所以子会话在 pi 的 `/resume` 里天然隐形；若用户强行 `--session` 打开，header 的 `parentSession` 让它至少能自洽显示来源。

## 4. 剩余风险（v1 需验证）

1. **`createAgentSession` 真实运行**：Bun 下扩展加载、模型调用、工具执行的完整路径未跑过真实会话。spike ① 只证明打包与 `SessionManager` 路径。
   **关于 WASM 的澄清**（此处措辞曾被误读为 web 需求）：涉及的 WASM 是 **WASI 运行时**，与 web target 无关——`photon-node` 是图像处理（读图/缩放，lazy load），`quickjs-wasi` 是 codemode 的 QuickJS 沙箱 VM（跑 JS 工具脚本），两者在 Node 与 Bun 上都是同一套。更关键的是 **pi 上游自己就用 bun compile 分发**：`isBunBinary`（检测 `$bunfs`）、`build:binary` 脚本、`copy-binary-assets`（把 `photon_rs_bg.wasm`、`quickjs.wasm` 拷到二进制旁）。所以这不是我们的实验性路径，而是**照抄上游的资产布局**即可。
2. **`parentSession` 的语义观感**：pi 把它当 fork 源；Zu 拿来表达 subagent 父边，pi CLI 可能显示 "forked from …"。若观感不可接受，退化为「只用路径 + custom entry 表达父边」。
3. **pi 升级对存储布局的影响**：`--=>--` 编码规则、`agent/sessions` 两级目录属于 pi 内部约定，升级可能变。兼容性台账须登记。
4. **并发写**：Zu engine 与用户终端里的 pi CLI 同时写同一 captain 文件，依赖 pi 自己的锁语义（`proper-lockfile` 在其依赖列表里）。v1 做一次并发冒烟。

## 5. 重放命令

```sh
# ③① 容忍度
mkdir -p ~/.pi/zu/subagents/test && pi --version && pi list

# ③②/③③/③⑤ 会话 API（脚本见 /tmp/zu-spike/session-spike.mjs、id-spike.mjs）
node /tmp/zu-spike/session-spike.mjs

# ① 编译
cd /tmp/zu-spike/compile && bun add @earendil-works/pi-coding-agent@1.5.0
bun build --compile engine-probe.ts --outfile engine-probe && ./engine-probe
```
