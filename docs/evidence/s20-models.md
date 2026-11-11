# §2.0 P0：模型注册与「无模型」状态

日期：2026-11-11。验收对象是 [plan.md](../plan.md) §2.0 的 P0-1 与 P0-2。

## 1. 现场：菜单空，命令行列不出模型

`pi --list-models` 在同一台机器上打印 67 个模型（6 个已登录 provider：
`bailian` 8、`bigmodel` 2、`deepseek` 3、`github-copilot` 14、`openai-codex` 8、
`opencode-go` 32），而 UI 的模型菜单是空的。

用引擎自身的 wire 协议复现（`src/server.ts` + 临时 state 目录，`hello` →
`session.create` → `session.models`）：

```json
{"providers":[], "current":{"provider":"bailian","id":"qwen3.8-flash",…}, "thinkingLevel":"off"}
```

同一进程里直接调 `session.modelRuntime.getAvailable()` 得到 67 个模型，
`checkAuth` 对 6 个 provider 全部有凭证——所以不是凭证、不是 catalog、不是网络。

## 2. 根因

`engine/src/server.ts` 的 `modelsData` 用

```ts
available = Array.isArray(runtime?.getAvailable) ? [...(await runtime.getAvailable())] : [];
```

做守卫。`runtime.getAvailable` 是方法，`Array.isArray` 对它**永远是 false**，
于是引擎从不调用 pi，静默返回空列表（`catch` 又把任何真实失败也变成空列表）。
这是「会话没有可用模型」的唯一原因：UI、协议与凭证都正常。

第二个、潜在的问题：pi 在没有可用模型时会保留一个占位模型，`session.info`
把它当真实模型发出去（`provider:"unknown", id:"unknown"`），composer 于是显示
「unknown · unknown」。

## 3. 改动

**引擎（P0-1）**

- 进程级**一个** `ModelRuntime`，在模块初始化时显式创建（`modelRegistry`），
  每个 `createAgentSession` 都 `await` 它并把它传进去——不再靠每个会话的副作用。
  创建失败时记录并退回 pi 的默认路径，日志说明原因。
- `modelsData` 直接调 `getAvailable()`（守卫改为真实调用）；默认读 registry 的
  snapshot（启动那次刷新已经付过账），`refresh: true` 才重新做一次 auth 检查，
  snapshot 为空时总是重新检查。这样签名登录后无需重启即可恢复，且菜单首开是
  常数时间。
- 空列表带 `reason`：`no_catalog` / `no_credentials` / `no_models` /
  `unavailable`（带 pi 的原文）。
- `modelData` 不再把 `unknown/unknown` 占位模型当模型发出去；`session.info`
  的 `model` 缺失就是 shell 的「无模型」状态。

**协议**：`SessionModelsData.reason?`、`SessionModelsPayload.refresh?`
（都是可选增量字段，`v` 不变）；`contracts/protocol.md` 写明 registry 归属、
snapshot/refresh 语义与四个 reason 码。

**界面（P0-2）**

- composer 在引擎明确回答「没有模型」时显示一句可操作的说明（按 reason 给出
  登录/目录/条目三种文案），**保留输入**，只把发送停住，并带一个「重试」；
  重试成功后说明消失、菜单可用、选中模型即可发送——不需要重启。
- 模型菜单不再显示空列表：`model-reason` 行是真实原因 + 「重试」。
- 空结果不再进缓存（`loadSessionModels`），所以再次打开菜单会真正再问一次；
  composer 每个实例只问一次，不会刷请求。

## 4. 验收证据

**与 CLI 一致**（P0-1 第一条）：`engine/scripts/models-parity.mjs`
（`cd engine && bun run models:parity`）按 app 的方式起引擎、按 picker 的方式
发 `session.models`，与 `pi --list-models` 逐条比对：

```
pi --list-models: 67  session.models: 67
the two lists are equal
```

**引擎测试**（`engine.test.ts`）：

- `a session lists its models and can switch one`：现在断言 `providers` 非空、
  模型总数 > 0、无 `reason`、composer 命名的模型就在列表里、`refresh: true`
  再次得到同样的 catalog（这条若无修复会直接失败）。
- `with no credentials the model list says why it is empty`：把 pi 的 home 指向
  空目录（新增的 `Engine.setAgentDir`，测试专用，模式同 `setStateDir`），
  断言 `providers: []`、`reason.code === "no_credentials"`、`session.info.model`
  缺失（占位模型不再出现）。

**界面测试**（`models.ui.test.tsx` → `fixtures/chat-no-model.tsx`）：
无模型时说明可见、输入可打字、发送禁用；菜单显示同一原因且没有 provider 行；
重试后说明消失、provider 出现、选择模型后触发条变成 `bailian · qwen3.8-flash`。

**门禁**

| 门禁 | 结果 |
|---|---|
| `nsh check .` | ✓ |
| `cargo check --all-targets` | ✓ |
| `nsh test .` | ✓ 237/237，连跑两次 |
| `script/bundle-mac.sh` | ✓（Zu.app 133M / Zu.dmg 52M，Helpers 三个文件在位） |

## 5. 已知边界

- 没有可用模型时 composer 的发送是停住的（消息发不出去），但输入与草稿保留；
  恢复路径是「重试 → 选模型」，不是自动替换模型。
- `refresh` 会重新做 pi 的 auth 检查（OAuth provider 可能联网），所以只有
  用户点重试/重开菜单时才走；日常读取走 snapshot。
- 同一台机器上 `pi` 与引擎共用一个 pi home；如果两侧 pi 版本不同，`models.json`
  的 schema 兼容性由 pin（`engine/package.json` 1.5.0）保证。
