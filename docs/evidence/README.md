# 验证产物（evidence）

> 只放**可再生的验证产物**：截图、真实运行的输出、未验证项的记录。不写「我们如何走到这里」；
> 过程叙事以 git 历史为准（2026-11-13 收敛前的批次文档已删除）。

## 保留的文件

| 文件 | 为什么留 |
|---|---|
| `m7-terminal-captures.md` | 终端仿真的实测缺陷（`VtEmulator` 缩小不重排）与 TUI 冒烟记录，仍是条件性里程碑 M-tty 的输入 |
| `m10-browser.md` | 真实 macOS 宿主加载网页的实测记录；DESIGN §11 引用 |
| `m11-lsp.md` | rust-analyzer / tsserver / gopls 的真实输出与「未达成」清单 |
| `m12-lifecycle.md` | 托盘、通知、更新、签名中**没有跑过**的验收项；发布前必读 |
| `feasibility.md` | nsh 能力面的可行性核对（PTY/Ghostty/LSP 汇聚到 native 的结论） |
| `terminal-emulator.md` | Q29 的换核调研（trait 上限锁死收益） |

截图（`*.png`）是各 sheet 的视觉记录；`app/tests/*.ui.test.tsx` 的 `app.screenshot(...)` 可重拍。

## 再生方式

```sh
nsh test app                         # headless 用例写 docs/evidence/*.png
nsh test app --target macos          # 真实宿主的 webview/终端截图
```

历史批次与决策过程的原文在 git：`git log --diff-filter=D -- docs/evidence/`。
