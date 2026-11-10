# M9 — Git：实现、门禁与证据

**日期**：2026-11-11
**范围**：`zu/git` native module、Changes/History sheets、顶栏入口、测试与文档。
**基线**：M8 提交 `a856fa0`（99/99 门禁）。M9 在此工作区实现，**未提交**。

## 1. 交付物

| 文件 | 内容 |
|---|---|
| `src/git.rs` | `zu/git` module：`status`/`diff`/`log`/`branches`/`stage`/`unstage`/`commit`/`checkout`/`createBranch`/`init`/`setIdentity`；porcelain v2 `-z` 解析、根=仓库顶层校验、路径策略、2 MiB 补丁上限、错误码与 `exit`/`stderr`；13 条 Rust 单测 |
| `git.ts` | 类型面 + 每容器投影（changes/history/busy/notice）、动作（stage/unstage/commit/checkout/create/init/identity）、`openChangesSheet`/`openHistorySheet` |
| `git-ui.tsx` | `ChangesBody`（分组、stage/unstage、`DiffView` `patch`、提交行、身份对话框、空/加载/错误/初始化态）与 `HistoryBody`（log `List`、分支 `Menu`、新建分支对话框） |
| `sheets.tsx` / `shell.tsx` | `changes:{containerId}` / `history:{containerId}` sheet 注册；顶栏 `open-changes` / `open-history`；新 glyph `commit`/`minus` |
| `ui.tsx` / `files.tsx` | `SheetIconButton`/`SheetAction` 提到 `ui` 层（M8 的 Files/Editor/Diff 改用同一组控件，样式不变） |
| `fixtures/git.tsx`、`fixtures/m9-paths.ts` | 真实 `Workbench` + 一个 cwd 为真实仓库的容器的 headless 夹具 |
| `git.test.ts` / `git.ui.test.tsx` | 7 条 native 测试（自建真实仓库）与 3 条 UI 测试（真实 Workbench） |
| i18n | `K.git` + `locales/zh-CN.ts`/`en.ts`；parity 测试保持 |

## 2. 门禁（全部在 `ZU_PORT=47833 ZU_STATE_DIR=/tmp/zu-m9-test-*` 下跑；用户运行中的 app 未触碰）

| 命令 | 结果 |
|---|---|
| `nsh check .` | ✓ |
| `nsh build .` | ✓（无 class/导出告警） |
| `cargo check --all-targets` | ✓（无 warning） |
| `cargo test --lib` | ✓ 28/28（M8 基线 15 + git 13） |
| `nsh test .` | ✓ 122/122（94 条 TS + 28 条 Rust，runner 一并计数；M8 基线 99） |

新的 TS 测试：`git.test.ts` 7 条、`git.ui.test.tsx` 3 条；Rust 13 条（`src/git.rs`）。

## 3. 真实仓库 transcript

测试通过 `zu/git` 自己建仓、写文件、stage、commit；下面是对 `git` CLI 直接读取同一个仓库的结果
（`/tmp/zu-m9-git-fixture`，UI 测试运行的产物）：

```
$ git -C /tmp/zu-m9-git-fixture log --oneline -8
75d7b1c feature 1794332823494-791894
fc9dddd base 1794332823494-791894
97f8137 baseline 1794332823494-791894
3b529ef ui commit 1794332823494-791894
2b2d16f feature 1794332811856-285695
1c9dd59 base 1794332811856-285695
007bf3b baseline 1794332811856-285695
712b120 base 1794332788037-705817

$ git -C /tmp/zu-m9-git-fixture status --porcelain=v2 --branch
# branch.oid 75d7b1cf73da5618711c4295bc100933e006ded3
# branch.head feature-1794332823494-791894
1 .M N... 100644 100644 100644 85c30401... 85c30401... hunk-1794332788037-705817.txt
1 .M N... 100644 100644 100644 85c30401... 85c30401... hunk-1794332811856-285695.txt
1 .M N... 100644 100644 100644 85c30401... 85c30401... hunk-1794332823494-791894.txt
? ui-1794332788037-705817.txt

$ git -C /tmp/zu-m9-git-fixture branch -vv
  feature-1794332788037-705817 4b22cb6 feature ...
  feature-1794332811856-285695 fc9dddd base ...
* feature-1794332823494-791894 75d7b1c feature ...
  master                       1c9dd59 base ...

$ git -C /tmp/zu-m9-git-fixture show -s --format='%h %an <%ae> %aI %s' HEAD
75d7b1c Zu Test <zu@example.test> 2026-11-11T01:47:05+08:00 feature 1794332823494-791894
```

要点：

- `ui commit …` 是 **UI 测试在 Changes sheet 里按下提交产生的真实 commit**，`git log` 与 `git show` 都能读到；
  author 是测试写入的仓库本地身份 `Zu Test <zu@example.test>`，证明 `setIdentity` 只改仓库 `.git/config`
  （本机全局身份是另一套，未被使用）。
- `* feature-…` 是 UI 测试通过 History 的分支菜单 checkout 后 `git branch` 的当前分支。
- 仓库里还有之前测试运行留下的 `hunk` 修改与 untracked 文件；测试每次都使用带时间戳的文件名/分支名，
  因此可重复运行，断言只针对本次的文件与提交。

## 4. 测试选择器的真实输出

```
$ ZU_PORT=47833 ZU_STATE_DIR=/tmp/zu-m9-test-… nsh test git.test.ts
✓ status, stage, commit and log are git's own answers
✓ an empty commit message is refused with its code
✓ a worktree change diffs into hunks, and an untracked file has one too
✓ branches list, create and check out, and the working tree follows
✓ a path outside the workspace and an invalid branch are refused
✓ a workspace that is not a repository reports its own code
✓ a folder inside a repository is refused instead of showing part of it
7 tests: 7 passed, 0 failed

$ … nsh test git.ui.test.tsx
✓ the top bar opens Changes; staging and committing are real git
✓ the worktree hunk is drawn by the real DiffView
✓ the branch menu checks out; Changes, History and the open editor follow
3 tests: 3 passed, 0 failed
```

UI 测试的断言全部落在真实执行上：

1. `open-changes` 从真实 `Workbench` 顶栏打开 sheet；untracked 文件出现在列表；按下行尾 stage 后行进入
   staged 组；`DiffView` 显示 `git diff --cached` 的补丁（`UI_BEFORE`）；输入提交信息并按提交后，
   `Git.log(GIT_ROOT, 5)`（同一个 `zu/git`，即真实 `git log`）里出现该 subject，author 为 `Zu Test`，
   status 不再 staged/ unstaged 该文件；History 列表出现该提交。
2. 对已提交文件做真实修改后，Changes 选中该文件 → `DiffView` 画出 `BETA`/`delta` 两行与 `+2 −1`；
   切 unified 后仍显示。
3. 两个分支有不同文件内容（`BASE`/`FEATURE`）：Files sheet 打开编辑器读到 `BASE`；History 分支菜单
   checkout 后 `Git.status` 的 branch 变为 feature，编辑器（干净文档）重载为 `FEATURE`，Changes 头部
   分支同步，文件不再出现在任何分组。

## 5. 验收映射

| 验收项（roadmap M9） | 结果 | 证据 |
|---|---|---|
| 改文件 → Changes 显示 | ✓ | `git.ui.test.tsx` 第 1/2 条；`git.test.ts` 的 status 用例 |
| stage | ✓ | UI 行尾 stage 后行移动；native `Git.stage` 用例 |
| 提交（`git log` 验证） | ✓ | UI 提交 → `Git.log` + 上文 CLI transcript |
| 切分支 | ✓ | History 菜单 checkout → `Git.status` + `git branch -vv` |
| M8 的「看一次 git diff，hunk 正确」 | ✓ 由 M9 补齐 | `git.ui.test.tsx` 第 2 条：真实 worktree diff 的 hunk 行与 `+2 −1` |

## 6. 未覆盖 / 已知边界（诚实）

- **身份对话框**在测试中没有被触发：本机全局 git 身份可用，提交不会失败；测试通过 `Git.setIdentity`
  直接写仓库本地身份并断言 commit author。对话框本身只有代码路径与静态复核。
- **stage all / unstage all / 初始化仓库** 的按钮有实现、有 API 测试，但没有 UI 测试点击。
- **二进制文件与 >2 MiB 补丁**：`ERR_GIT_TOO_LARGE` 与「无文本差异」是代码路径；Rust 单测覆盖了 parse/args/
  路径策略，没有构造 2 MiB 补丁的用例。
- **冲突文件**：status 会列出、可以 stage 为已解决；选中冲突行时显示「先解决再暂存」的说明
  （`ERR_GIT_CONFLICT`），因为 git 对冲突给出的是合并 diff，不是 `DiffView` 读的统一补丁。没有用真实
  冲突仓库跑过这条分支。
- **无 macOS 截图**：可见验证只有 headless。M9 实测了一次
  `nsh test git.ui.test.tsx --target macos`：development host 构建成功，但报
  `could not load module 'zu/native' (only registered native modules and bundle chunks can be imported at run time)`
  （与 M8 的 nsh 开发宿主限制相同，不是 M9 代码错误）。因此 Finishing checklist 的像素项按 M6/M8 基线
  核对代码，不声称逐项截图通过。运行中的用户 app 未重启。
- **仓库子目录**：容器 cwd 若是仓库子目录，Changes 返回 `ERR_GIT_NOT_REPO`（有意边界），不显示 `../` 路径。
- 未做网络操作；未改全局 git 配置；未启动第二个 server；用户运行中的 app 未重启。
