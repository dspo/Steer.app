# M8 证据：真文件、编辑器与 Diff

日期：2026-11-11（工作树，未提交）。环境：macOS arm64，`nsh 0.4.0 (506b539)`（`~/projects/github/nsh/target/debug/nsh`），
门禁用 `ZU_PORT=47832`、`ZU_STATE_DIR=/tmp/zu-m8-*`；运行中的用户 app 未重启（Rust 改动需要重启才生效，按约束不做）。

## 1. 实现了什么

| 层 | 文件 | 内容 |
|---|---|---|
| native | `src/fs.rs` | `Fs` 模块：`list/stat/read/write/mkdir`；显式工作区根；canonicalize 后拒绝 `..`、根外绝对路径、越界 symlink；2 MiB 读上限、1000 项目录上限；临时文件 + rename 原子写，保留 mode 与 UTF-8 BOM；`write(expected)` 的 `ERR_FS_STALE`（附当前 `mtimeMs`/`size`）；二进制/非 UTF-8 → `ERR_FS_BINARY`；错误带 `code` |
| 类型面 | `fs.ts` | `FileEntry/FileStat/FileContents/FileVersion`、失败码、`canonicalRoot`、`formatBytes`、`relativeTo` |
| 文档 store | `editors.ts` | 稳定 sheet id（`editor:{containerId}:{base64url path}`）、每文档 text/baseline/status/conflict/encoding/version、`stat → write(expected) → read-back` 保存、`ERR_FS_STALE` 转只读、reload/close、Mod+S 目标 |
| 纯逻辑 | `file-tree.ts` | 目录优先排序、展开行扁平化、loading/empty/error 行、行 test id、base64url 与 diff 双路径 |
| UI | `files.tsx` | Files sheet（懒加载树、刷新、选中、对比对话框、空/加载/错误）、Editor sheet（语言高亮、折叠、查找/替换条、脏点、Save/Reload/Close、冲突/只读/二进制/过大）、两文件 Diff sheet（split/unified、`DiffView` 真实统计） |
| 外壳 | `shell.tsx`、`sheets.tsx`、`containers.ts`、`dock.ts`、`ui.tsx`、`i18n.ts`、`locales/*` | 顶栏 `open-files`；sheet 路由与标题；`closeSheet`/`openFilesSheet`；`removeSheet`；chevron 图标；zh/en 文案 |

## 2. 门禁（实际输出）

| 命令 | 结果 |
|---|---|
| `nsh check .` | ✓ `checked zu-app`、`built the Rust crate`，exit 0；`tsc -p . --noEmit` 单独跑也 exit 0 |
| `nsh build .` | ✓ `built App.tsx into .nsh/out (219.8 KB js, 595.4 KB bytecode)`，无警告 |
| `cargo check --all-targets` | ✓ |
| `cargo test --lib` | ✓ **15/15**（`fs::tests` 12 + `pty` 3） |
| `nsh test .` | ✓ **99/99**（基线 67，新增 32；无既有测试被弱化） |

新增测试：

- `src/fs.rs`（12）：`a_parent_segment_is_not_a_path`、`an_absolute_path_outside_the_root_is_refused`、
  `a_symlink_out_of_the_root_is_refused`、`a_write_is_atomic_and_keeps_the_mode`、
  `a_directory_is_made_inside_the_root_and_never_outside_it`、`a_changed_file_is_stale_and_a_matching_one_is_not`、
  `a_binary_file_is_refused`、`an_invalid_utf8_file_is_refused`、`a_file_over_the_limit_is_refused`、
  `a_directory_over_the_limit_is_refused`、`a_listing_puts_directories_first_and_keeps_the_bom_on_a_save`、
  `a_write_through_a_symlink_inside_the_root_keeps_the_link`。
- `fs.test.ts`（8）：真实 `/tmp` 的 write/read/stat、目录优先与子目录 list、原子写无 `.zu-*` 残留、
  stale 拒绝且磁盘未被覆盖、`..`/根外绝对路径拒绝、ENOENT/相对根/二进制错误码、2 MiB 上限（含 size/limit）、BOM 往返与 encoding 校验。
- `file-tree.test.ts`（8）：带冒号容器 id 与含空格/中文路径的 sheet id 往返、diff 双路径往返、base64url 字符集、
  语言映射、树排序/懒展开/错误行、移除 sheet 的 activeIndex、`openFilesSheet` 的壳动作、相对路径显示。
- `files.ui.test.tsx`（4）：下述验收（保存、stale、查找/替换、Diff）。

## 3. 验收：打开 → 编辑 → 保存 → 磁盘一致（通过，非 mock）

`files.ui.test.tsx` 用真实 `DockArea` + 真实 `FilesBody`/`EditorBody`，容器 cwd 指向 `/tmp/zu-m8-fixture`；
文件由测试通过 `zu/fs` 的 `write` 落盘，测试再用 `zu/fs` 的 `read` 读回。

1. `Fs.write(M8_ROOT,"note.txt","M8_BEFORE\n")` 落盘。
2. 打开 fixture，等待 `files-root` 与 `file-row-note.txt`，按下文件行 → 画布 append 编辑器 sheet。
3. 等待编辑文档 `note.txt:ready:clean:rw`（fixture 状态行读取 `editors.ts` 的 store，不依赖界面语言）。
4. `app.type("id:editor-view","M8_EDIT\n")` 进入真实 `Editor`；等待 `:ready:dirty:rw` 且 `editor-dirty-dot` 计数 1。
5. `app.keyboard.press("mod+s")` → `saveActiveEditor()` → `stat` → `write(expected)` → `read` 回读校验。
6. 轮询 `Fs.read("/tmp/zu-m8-fixture","note.txt")` 直到含 `M8_EDIT`；断言仍含 `M8_BEFORE`（插入而非覆盖），
   且 store 回到 `clean`、脏点消失。

### 3.1 查找/替换（通过）

同一 fixture 打开 `find.txt`（两行 `M8_BEFORE`），按编辑器头部 Find，输入 `M8_BEFORE`，等待
`Editor` 的 `onSearchChange` 报 2 个匹配；替换框输入 `M8_AFTER`，按「全部替换」，文档变脏；
Mod+S 后 `zu/fs` 读回磁盘恰为 `M8_AFTER one\nM8_AFTER two\n`。

## 4. 验收：外部修改冲突（通过）

- 同一流程打开 `stale.txt`，随后测试用 `zu/fs` 写入 `"EXTERNAL LONGER TEXT\n"`（改变 size）。
- 按 Mod+S：`stat` 发现版本不符（或 `write` 返回 `ERR_FS_STALE`），文档转 `conflict` + `readonly`；
  断言 `editor-conflict` 出现、`Fs.read` 仍是外部文本（**没有覆盖**）。
- 按 `editor-conflict-reload`：重新读盘，冲突清除、恢复可编辑；再输入 `RELOADED\n` 并 Mod+S，
  断言磁盘同时含 `RELOADED` 与 `EXTERNAL LONGER TEXT`。

## 5. 验收：DiffView（两文件 hunk，通过；git diff 未做）

- `before.txt = "alpha\nbeta\ngamma\n"`，`after.txt = "alpha\nBETA\ngamma\ndelta\n"`。
- 文件行尾对比 → 对话框（A 预填被选文件，输入 B 绝对路径）→ `diff-open` → 真实 `DiffView` sheet。
- 等待 `DiffView` 的 `onStatsChange`：界面统计为 `+2 −1 · 1`（`diff-stats`），`diff-same` 不存在；
  文本行含 `BETA`、`delta`；切 unified 后仍渲染。
- **未做**：工作区 `git diff`。M8 没有 `zu/git`，不会 shell out 或伪造 git hunk；见 roadmap M8/M9 与 Q57。

## 6. 状态覆盖

| 状态 | 落点 | 证据 |
|---|---|---|
| loading | 文件树根/子目录、编辑器、Diff | `读取中…` 行 / `editor-loading` / `diff-loading`（代码与 UI 测试路径） |
| empty | 空目录、空 root | `files.empty` 行 |
| error | 目录读取失败、路径逃逸、ENOENT | `files-error` 行、`editor-error`、`diff-error-state`；Rust/TS 错误码测试 |
| binary | 含 NUL 或非 UTF-8 | `ERR_FS_BINARY`（Rust 单测 + `fs.test.ts`），编辑器只读状态 |
| too large | > 2 MiB | `ERR_FS_TOO_LARGE`（Rust 单测 + `fs.test.ts` 断言 size/limit），编辑器只读状态 |
| stale | `stat`/`write(expected)` 不符 | `editor-conflict`、`editor-readonly`、reload 恢复（UI 测试） |
| dirty / saving / saved | 编辑器状态行与脏点 | UI 测试断言 0→1→0；保存中按钮文案 |
| read-only | 冲突、错误、二进制、过大 | `Editor readOnly` + `editor-readonly` 徽标 |

## 7. 限制与 M9 剩余

1. **git worktree diff 未做**：M8 的验收第二句（「看一次 git diff，hunk 正确」）不达成。已实现的是两文件 DiffView；
   M9 的 `zu/git` 提供 `status`/`diff` 后再驱动 Changes 面板。
2. **没有真实宿主截图**：用户 app 正在运行且不改动它；headless 没有帧循环/像素。尝试过
   `nsh test --target macos files.ui.test.tsx`（截图调用以 `ZU_M8_SHOTS=1` 打开），开发宿主报
   `could not load module 'zu/native'`，因此没有产出截图（该测试文件正常走 headless）。`docs/DESIGN.md` §9
   记录了 M8 的动效清单与「未逐项截图」的边界，不声称像素级验证通过。
3. **未接 LSP**：M11；`zu/fs` 的 `read` 已按「LSP 复用同一份内容」设计，但 M8 不启动语言服务器。
4. **编码**：只支持 UTF-8 与 UTF-8 BOM；其他编码读取即 `ERR_FS_BINARY`，不做转码。
5. **文件树只读**：没有新建/重命名/删除 UI（`mkdir` 仅提供根内一级创建，测试与将来的新建入口用）；
   编辑器关闭会丢弃未保存文本（没有确认对话框，M9/M12 再补）。
6. **目录上限为硬错误**：超过 1000 项的目录显示错误而不是截断；按需再加分页。
