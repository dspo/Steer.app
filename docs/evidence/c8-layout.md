# C8：三包布局（`app/` + `native/` + `pi-harness/`，`contracts/` 留根）

> 2026-11-12。决策 Q96；动机、方案与工具链依据见 [decisions.md](../decisions.md) Q96 与 [architecture.md](../architecture.md) §3.6/§3.8。
> 本文只记录「做了什么、怎么验证、踩到什么」。

## 动机

仓库根上裸着 84 个条目：nsh 的入口/清单（`nsh.json`、`App.tsx`、`theme.json`、`tsconfig.json`）、mixed 模板的
crate 面（`Cargo.toml`、`src/`、`target/`）、55 个测试文件，与五层前端目录混在一层。目标形态：三包各归其位，
共享面独立。

## 落点

| 包 | 内容 | 来源 |
|---|---|---|
| `app/` | `nsh.json`（`"rust": "../native"`）、`App.tsx`、`theme.json`、`tsconfig.json`、五层（shell/canvas/sheets/stores/ui）、`assets/tray.svg`、55 个 `*.test.ts(x)`、`fixtures/` | 原 root 平移 |
| `native/` | `Cargo.toml`/`Cargo.lock`/`src/`（zu-native crate）、`assets/fonts/`（`assets!()` 要求资产在 crate 自己的 `assets/` 内）、`target/` | 原 root `Cargo.*`+`src/`+`assets/fonts` |
| `pi-harness/` | 完整 pi 发行版（pin 的 pi 1.5.0 + wire 胶水 + 内置扩展 + `dist/` sidecar） | 原 `engine/` 原样改名 |
| 根 | `contracts/`（UI↔harness 共享面，不属于任何一侧）、`docs/`、`script/`、`README.md` | 不动 |

关键机制依据（nsh CLI 源码，checkout `~/projects/github/nsh`）：

- 每条命令接受 `[ENTRY]` = 应用目录（tooling.md）→ `nsh run app` / `nsh check app` / `nsh test app`。
- `"rust"` 解析是 `canonicalize(nsh.json 目录.join(path))`（`rust_app.rs`），无目录逃逸守卫 → `"../native"` 成立；
  生成的 `.nsh/rust` workspace 用 canonical 绝对路径引用 crate，生成物在 `app/.nsh/`。
- native import specifier 由 `#[native_module("zu/native")]` 声明，与 crate 目录无关 → TSX 侧零改动。
- 测试发现在应用目录内递归 → 测试进 `app/` 后内部相对导入（`./stores/*` 等）一个未改。

代码改动（移动之外的唯一实质修改）：

1. `native/src/lib.rs`：dev 模式 sidecar 回退 `engine/dist/pi-engine` → `../pi-harness/dist/pi-engine`
   （`CARGO_MANIFEST_DIR` 随 crate 变为 `native/`）；同文件测试读 `nsh.json` → `../app/nsh.json`；错误文案 `cd engine` → `cd pi-harness`。
2. contracts 导入深度：app 侧 18 个文件 `../contracts`→`../../contracts`、`./contracts`→`../contracts`；
   pi-harness 侧 3 个文件**深度恰好不变**（`../../contracts`）。
3. `app/tsconfig.json` exclude：`engine`→`../pi-harness`（contracts 在 app 外，由导入关系进入 tsc 程序）。
4. `.gitignore`：`engine/*` → `pi-harness/*`（`.nsh/`、`target/` 无前导斜杠，任意层级都命中）。
5. `script/bundle-mac.sh`：`pi-harness` 路径 + `nsh package` 改为从 `app/` 目录执行。
6. `app/engine.test.ts`：硬编码的 ui-probe 绝对路径补 `app/`（见下文「踩坑」）。
7. 文档：README（状态锚点/代码地图/Run it/文档治理）、architecture §3.6/§3.8、decisions Q96、plan §5 C8。

## 门禁（2026-11-12）

- `nsh check app` ✓ —— `checked zu-app (1.2s)`（crate cargo check）+ `built the Rust crate zu-app (1m 1s)`
  （describe workspace 构建）。**`"rust": "../native"` 实证成立**；tsc 随命令运行、失败才会报（check.rs），exit 0。
- `cd pi-harness && bun run build` ✓ —— check-version + bundle 2079 模块 + 75MB 单文件 + 两个 WASM。
- `nsh test app` ✓ —— 212 条 TS（含 live pi/引擎/LSP 用例）+ 53 条 Rust 单测，全绿
  （见「踩坑」：首轮 211/212，为测试内硬编码旧探针路径，非布局问题）。
- `script/bundle-mac.sh` ✓ —— sidecar 进 `Contents/Helpers` + 嵌套 ad-hoc 签名 + dmg。

## 踩坑

1. **`engine.test.ts` 硬编码绝对路径**：ui-probe 扩展路径写死 `/Users/…/nsh-pi/fixtures/extensions/ui-probe.ts`，
   fixtures 入 `app/` 后失效 → 探针用例两次 1m3s 超时（211/212）。修为 `…/app/fixtures/extensions/ui-probe.ts`
   后同用例 326ms 通过。教训：绝对路径夹具是布局变更的隐形雷；同文件还有一处读根上 README 的绝对路径（README 留根，不受影响）。
2. **pi-harness/node_modules 在门禁中途消失**（目录 mtime 与 `nsh test` 启动时刻吻合，nsh CLI 源码无删除逻辑，
   疑为 bun 侧自动安装中断残留）：`bun install` 按 `bun.lock` 秒级恢复（122 包，缓存命中），构建不受影响。
   若再现，先 `bun install` 再查。
3. 首轮 `.nsh/`、`target/` 处理：根 `.nsh/` 删除重建（旧 workspace 引用旧 crate 绝对路径，必须重新生成）；
   `target/` 整体移入 `native/`（registry 依赖缓存保留，crate check 仅 1.2s）。

## 遗留

- 历史 M0–M12 记录与旧 evidence 中的 `engine/`、`src/` 路径保持原样（记录当时事实），只有「活」文档同步到新布局。
- nsh 发布版若未来给 `"rust"` 加目录逃逸守卫，回退布局是 crate 放 `app/native/`（官方文档认可的子目录形式）。
