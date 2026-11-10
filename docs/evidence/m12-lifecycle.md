# M12 证据：常驻、通知与自更新（2026-11-11）

> 本文件记录 M12 **实际跑过**的东西、命令原文与结果，以及**没有跑过**的验收项。
> 原则：没有跑过的写「未验证」，没有源/没有 release 的写「不可测」，不拿 fake
> service 冒充真实安装。

## 0. 环境与范围

| 项 | 值 |
|---|---|
| 机器 | macOS（`uname -m` = `arm64`），用户自己的 Zu 正在运行（`nsh run --target macos`，host pid 23477，引擎在 47823） |
| 约束 | **没有** kill/重启用户 app，**没有**再起一个开发服务器；所有测试用 `ZU_PORT=47836`/独立 `ZU_STATE_DIR` |
| nsh | checkout 构建 `~/projects/github/nsh/target/debug/nsh`，pin `506b5392`（0.4.0 + Terminal） |
| 源码 | `src/instance.rs`、`instance.ts`、`lifecycle.ts`、`lifecycle-ui.tsx`、`notifications.ts`、`updates.ts`、`updates-ui.tsx`、`engine.ts`、`App.tsx`、`shell.tsx`、`nsh.json`、`script/bundle-mac.sh`、`assets/tray.svg` |

## 1. 门禁（精确输出）

```
$ nsh check .
✓ checked zu-app (641ms)
✓ built the Rust crate zu-app (204ms)
 info nsh::check no type errors in /Users/chenzhongrun/projects/dspo/nsh-pi

$ nsh build .
✓ built the Rust crate zu-app (189ms)
✓ built App.tsx into .nsh/out (408.5 KB js, 1.1 MB bytecode, 1 asset, 392ms)

$ cargo check --all-targets
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.13s

$ cargo test --lib
test result: ok. 44 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.37s

$ ZU_PORT=47836 ZU_STATE_DIR=/tmp/zu-m12-final-… nsh test .
✓ 172 tests: 172 passed, 0 failed (1m 19s)
```

- 基线为 141 条（104 TS + 37 Rust）；M12 增加 **24 TS + 7 Rust = 31 条**，没有削弱既有测试。
  - 新增 TS：`notifications.test.ts`（8）、`updates.test.ts`（8）、`updates.ui.test.tsx`（3）、`lifecycle.test.ts`（1）、`lifecycle.ui.test.tsx`（1）、`lifecycle.window.test.tsx`（1）、`lifecycle.quit.test.tsx`（1）、`lifecycle.app.test.tsx`（1）。lifecycle 的三个 app/fixture 测试各自用 `Engine.setStateDir()` 隔离状态目录并在 finally 释放 claim/停引擎，跑完 47836 无监听。
  - 新增 Rust：`instance::tests`（6）+ `a_port_held_by_another_process_is_not_available`（1）。
- `nsh test` 跑完 47836 上没有残留监听（`lsof -nP -iTCP:47836 -sTCP:LISTEN` 为空）。

### 打包冒烟

```
$ NSH=~/projects/github/nsh/target/debug/nsh script/bundle-mac.sh
→ engine sidecar                    … bun build --compile …
→ app                               ✓ packaged build/Zu.app
→ sidecar into Contents/Helpers
✓ Contents/Helpers carries the engine sidecar and its WASM
→ ad-hoc signatures (nested: the sidecar, then the app)
→ dmg
✓ build/Zu.app   133M
✓ build/Zu.dmg    52M

$ NSH_UPDATE_ARCHIVE=1 script/bundle-mac.sh
→ update archive (includes Contents/Helpers)
  /…/build/Zu-0.1.0-macos-aarch64.tar.gz
  release: nsh update-manifest …/Zu-0.1.0-macos-aarch64.tar.gz --notes CHANGES.md --key keys/update.secret

$ tar -tzf build/Zu-0.1.0-macos-aarch64.tar.gz | grep Contents/Helpers
Zu.app/Contents/Helpers/
Zu.app/Contents/Helpers/pi-engine
Zu.app/Contents/Helpers/quickjs.wasm
Zu.app/Contents/Helpers/photon_rs_bg.wasm
```

包内 `Resources/nsh/app.json` 的窗口段带 `"closeOnPress":false`，`capabilities.json` 带
`"notifications":true`、`"openUrl":false`（没有为新功能偷偷加外开能力）。

## 2. 单实例（Rust 实测）

`src/instance.rs` 的测试（`cargo test --lib`，全部通过）：

| 测试 | 证明 |
|---|---|
| `the_first_claim_wins_and_the_same_process_claims_once` | 首次 claim 建锁（文件首行是 pid）且 `acquired`；同进程第二次 `acquired:true, already:true`，不是第二个实例 |
| `a_live_owner_blocks_a_second_instance_without_killing_it` | 活 owner（pid 1）存在时 `acquired:false, ownerPid:1`，且**文件内容一字不动**（不杀、不抢） |
| `a_dead_owners_lock_is_reclaimed` | pid 4000000（必死）的锁被回收，`stale:true`，新锁写自己的 pid |
| `a_truncated_lock_is_reclaimed` | 空/截断锁被回收，不会永久卡住启动 |
| `release_removes_only_our_own_lock` | 别的 pid 不能释放我们的锁；自己 release 后文件消失；再 release 返回 false |
| `concurrent_claims_yield_exactly_one_owner` | 两个线程同时 claim，**恰好一个** acquired；另一个看到活的 winner。创建路径是先写临时文件再 `hard_link`，所以竞争里没有人看到半写锁（早期 `create_new` + `write` 的实现会被这个测试抓到：两个都 acquired） |

`lifecycle.test.ts`：headless 打开真实 `App.tsx`，之后测试进程 `Instance.claim()` 得
`acquired:true, already:false`——**headless 没有抢锁**（否则 `already` 为 true）。该测试用
`Engine.setStateDir()` 指向自己的临时状态目录，并在结束时 release/停引擎；这不是为了绕过
断言，而是因为用户正在运行的 dev app 已经持有真实 `~/.pi/zu/instance.lock`（见下）。

**真实状态目录上的旁证（非本轮启动）**：运行中的 dev host（pid 34715）在 04:21 写下了
`~/.pi/zu/instance.lock`（内容首行 `34715`），即**新的桌面启动路径已经在真实 app 上 claim**
（dev server 自己热更新到新 bundle，不是本任务启动的）。随后一次忘了隔离 `ZU_STATE_DIR`
的 `lifecycle.quit` 测试得到 `claimed false already false`（fixture 打印
`claimed false already false`）——真实的活 owner 拦截路径按预期工作，测试没有杀/抢这个进程。
因此所有 M12 测试现在都用 `Engine.setStateDir()`/`ZU_STATE_DIR` 指向自己的目录。

`lifecycle.ui.test.tsx`（`fixtures/lifecycle.tsx`，dup claim + `AlreadyRunning`）：
屏幕上是「Zu 已在运行」、owner pid `4321`、锁路径 `/tmp/zu-m12/instance.lock`、从
Dock/菜单栏回去的提示与 Quit 按钮。真实第二个进程**没有启动**：会与用户正在运行的 app 抢
47823，且约束禁止 restart/kill 用户 app；跨进程拦截的证据是上面的活 owner/并发测试。

`lifecycle.quit.test.tsx`（`fixtures/lifecycle-quit.tsx`）：fixture 像真实启动那样
`Instance.claim()`，应用菜单的 Quit（`⌘Q`，调用同一个 `quitApp`）之后，claim 被释放——
测试里的新 claim 得到 `acquired:true, already:false, stale:false`。headless 的
`Application.quit()` 是 no-op，所以**「进程真的退出」本身没有被这条测试证明**，只证明了
quit 路径先释放锁再请求退出。

`Engine.portAvailable()` 的 Rust 测试：占住一个 ephemeral 端口时返回 false。
`engine.ts` 在「连不上 + 端口不自由」时显示
`端口 47836 已被占用：另一个 Zu 或进程在用它。`（英文同理），而不是笼统的协议超时。

> 运行期的真实观察：一次早先的测试运行（`engine.test.ts` 的扩展用例超时）退出后留下了
> 一个 ppid=1 的 `pi-engine` 占着 47836，导致下一轮 live 用例全部失败。`Engine.portAvailable()`
> 的文案把这种状态显示出来了；这不是 M12 引入的，孤儿 sidecar 的回收属于引擎监督的独立问题，
> 这里只记录、不冒充已修（见 §6）。

## 3. 关窗 = 收起（真实 headless 窗口模型）

`lifecycle.app.test.tsx` 打开**真实 `App.tsx`**，`platform:"macos"`，`network:"live"`，用真实
sidecar 与真窗口模型：

1. 等状态条显示「运行中」，`Engine.status()` 为 `running`；
2. `app.window("main").pressClose()` → `windowState().visible === false`，
   **窗口仍 open（state 非 null）**；
3. 500 ms 后 `Engine.status()` 仍为 `running`（关窗没有 teardown 引擎/会话）；
4. `⌘0`（应用菜单 Window → Show，与托盘 Show 共用 `showMain`）→ 窗口可见且状态条回到「运行中」；
5. 用顶栏的 `engine-stop` 走 shell 自己的 disconnect → 显示「未启动」，测试最后
   `Instance.release()` + `Engine.stop()` 清场（跑完 47849 无监听）。

`lifecycle.window.test.tsx`（`fixtures/lifecycle-window.tsx`，真实 `LifecycleHost`）：
close → `visible:false` 且 state 非 null；`⌘0` 恢复；`hideMain()` → 隐藏；`⌘0` 再恢复；
再 close 仍隐藏。**重复 hide/show 不丢窗口、不重建窗口**。

窗口状态原文（探测时打印，省略不变字段）：

```
before      {"visible":true,  "focused":true,  "mode":"normal", …}
after close {"visible":false, "focused":false, "mode":"normal", …}   ← state 仍非 null
after ⌘0    {"visible":true,  "focused":true,  "mode":"normal", …}
```

**未验证**：托盘图标与菜单点击（nsh headless 没有托盘模型）、真实 AppKit 窗口的 Show、
进程真正 exit。

## 4. 通知（逻辑实测，投递未验证）

`nsh.json` 增加 `capabilities.notifications: true`。`notifications.ts` 的策略与测试：

| 测试 | 证明 |
|---|---|
| 前台/失焦/隐藏 | 可见且聚焦 → 不发；可见但失焦 → 发；隐藏 → 发；正文取最后一条 assistant 文本，title 是 `Zu · <session name>` |
| 替换与去重 | 同一 session 的两次 settle 用同一个 id `zu:session:<id>`，系统替换；同正文 5 s 内不发第二次 |
| 权限 | `default → denied`：只弹一次 request，之后不再问；`default → granted`：第一次就发 |
| 子代理 | `zu:subagent:<runId>`，title 含 agent 名，body 是 verdict |
| 按开 | 按下后关闭该通知；没有 connected engine 时把目标留在队列里，不抛错、不假装打开 |
| id | 只认 `zu:session:` / `zu:subagent:`；外来 id 忽略；空 id 忽略 |
| headless | 窗口探测为 null 时，连权限都不读，no-op |

实现要点：只认 `agent.state` 的 **running→idle 边沿**（快照补记 running，断线清空，所以
重连/中断不算完成）；per-session id 替换 + 5 s 正文去重；`ensureNotificationPermission` 只在
第一次需要时 requestPermission；press → `showMain()` + 按 id 排队，等 `phase() === "connected"`
且 `containersLoaded()` 后 `openPath`（会话）或切容器 + 开名册 + `selectRun`（子代理），最多
重试 20 次，冷启动按下也能恢复。

**未验证**：真实 macOS 通知横幅与点击。原因：本轮不能重启用户正在运行的 app；开发运行的
macOS app 不是 signed bundle，`Notifications.permission()` 会报 `unavailable`。headless 的
`Notifications` 也没有系统投递。所以上面只证明策略与调用参数，不证明系统真的弹了通知。

## 5. 更新（状态机实测，安装不可测）

**没有** `nsh.json` 的 `"updater"`：仓库里没有真实 source、公钥和 release。按约束不伪造，
`checkForUpdate()` 在开发运行里只返回 `null`；UI 通过 `shellInfo().version === null`（无 updater
的打包 app 或 dev）与 `appInfo().development` 区分「开发构建」和「未配置更新源」，**不显示
“已是最新”**。

`updates.test.ts`（fake service）覆盖：dev 不检查（`checks === 0`）、未配置、
check→available→download（收到 1024/2048）→ready→install（`installs === 1`，状态保持
`installing`，**不显示已安装**）、null→up-to-date、check 失败→error、download 失败→error 且
progress 清空、`canInstall:false` 不下载、install 失败→error、`formatBytes` 的 B/KB/MB。

`updates.ui.test.tsx`（`fixtures/updates.tsx`，fake service + fake notifier）覆盖：
dev 状态显示「开发构建不检查更新…」且 Check 按钮 `enabled === false`；packaged 状态显示
「当前版本 0.1.0（build 1）」→ 发现 0.2.0 + notes → 下载显示 `512 KB / 1 MB` → 显示已校验 →
安装后显示「正在安装；成功时应用会重启。」且没有「已安装」文案；通知权限行从「尚未授权…」
按「允许通知」变为「已允许…」。

**未验证 / 不可测**：真实 `checkForUpdate`、签名 manifest、SHA-256、替换 `.app`、
`installAndRestart` 成功路径。发布前需要（仓库里**未**配置，仅记录步骤）：

```jsonc
// nsh.json —— 二选一；publicKey 可选但建议，私钥 keys/update.secret 不进仓库
{ "version": "0.2.0", "build": 2,
  "updater": { "github": "dspo/nsh-pi" } }
// 或自托管
{ "version": "0.2.0", "build": 2,
  "updater": { "url": "https://dl.example.com/zu/latest.json", "publicKey": "<nsh keygen keys/update 的 .pub>" } }
```

```sh
nsh keygen keys/update                      # 只提交 keys/update.pub，.secret 留在发布机/CI
nsh package . --target macos                # 版本/构建号递增
NSH_UPDATE_ARCHIVE=1 script/bundle-mac.sh   # 整个 .app（含 Contents/Helpers）→ tar.gz
nsh update-manifest build/Zu-<ver>-macos-aarch64.tar.gz --notes CHANGES.md --key keys/update.secret
# 上传 tar.gz、latest.json、latest.json.sig 到 GitHub Release（draft/prerelease 不会被提供）
```

不配置 `"updater"` 时 `nsh package` 不产 manifest，`nsh/updater` 也无从检查；这正是本仓库
现在的状态。**更新归档必须包含 `Contents/Helpers`**：脚本断言三个文件，并在
`NSH_UPDATE_ARCHIVE=1` 时用整个 `.app` 打包，因此归档里能看到 `Zu.app/Contents/Helpers/*`。

## 6. 未验证 / 已知缺口

| 项 | 状态 | 原因 |
|---|---|---|
| 真实第二个进程被拦 | 部分验证 | Rust 活 owner/并发 claim + 第二实例 UI fixture；没启动第二个真实进程（会抢用户 app 的 47823） |
| 托盘图标/菜单点击 | 未验证 | nsh headless 无托盘模型 |
| 真实 macOS 窗口 close→hide→Show（AppKit） | 部分验证 | headless macos 窗口模型已验；真实 NSWindow 未验（用户 app 不能重启） |
| 系统通知投递与点击 | 未验证 | 需要 signed bundle + 重启，且 headless 不投递 |
| 关窗后真跑完一个模型回合并发通知 | 未验证 | 无模型凭据；只验证了关窗后引擎仍 running 与通知决策 |
| 真实更新下载/签名校验/安装重启 | 不可测 | 仓库没有 updater source/公钥/release；UI 用 fake service 验证状态机 |
| 真实进程 exit（⌘Q/Dock Quit） | 部分验证 | Quit handler 释放 claim 已测；headless `Application.quit()` 是 no-op，进程退出是平台行为 |
| 孤儿 `pi-engine` 的回收 | 既有问题，未修 | 观察到一个早先测试主机留下的 ppid=1 sidecar 占端口；M12 只加明确了端口占用文案，没有改引擎监督/回收 |


## 主 agent 复核（2026-11-11）

在隔离的 `ZU_PORT=47837`、`ZU_STATE_DIR=/tmp/zu-m12-visual` 上启动打包后的 `build/Zu.app`，未触碰用户 app（47823）：

- 第一实例：窗口 normal，`Helpers/pi-engine` 子进程启动。
- 第二实例（同 state dir）：窗口标题「Zu 已在运行」，显示 owner pid `53537` 与锁路径 `/tmp/zu-m12-visual/instance.lock`，没有第二个 engine；点「退出」可关。
- 第一实例 `Cmd+W`：Cua 报告的窗口 `is_on_screen:false`，进程仍在，`Helpers/pi-engine` 仍存活；`⌘0` 后窗口重新 `is_on_screen:true`。
- `NSH_UPDATE_ARCHIVE=1` 的 `build/Zu-0.1.0-macos-aarch64.tar.gz`（48 MB）含 `Zu.app/Contents/Helpers/{pi-engine,photon_rs_bg.wasm,quickjs.wasm}`。

仍未验证：托盘图标/菜单点击、真实系统通知投递与按压、真实 updater 安装（无 source/key/release）。
