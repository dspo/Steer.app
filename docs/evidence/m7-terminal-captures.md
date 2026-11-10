# M7 终端验收记录（2026-11-11）

命令都在仓库根跑，`ZU_PORT=47830 ZU_STATE_DIR=/tmp/zu-m7-*` 隔离 engine 状态；用户的 app 不重启、不占用它的端口。

## 门禁

```text
$ nsh check .
✓ checked zu-app
✓ built the Rust crate zu-app

$ nsh build .
✓ built App.tsx into .nsh/out (161.1 KB js, 422.1 KB bytecode)

$ cargo check --all-targets
Finished `dev` profile ...

$ cargo test --lib
running 3 tests
test pty::tests::a_character_split_across_reads_survives ... ok
test pty::tests::an_incomplete_tail_waits_for_the_next_read ... ok
test pty::tests::invalid_bytes_become_replacement_characters ... ok
test result: ok. 3 passed

$ nsh test .
✓ 67 tests: 67 passed, 0 failed (1m 23s)
```

## PTY（`pty.test.ts`，4/4）

```text
✓ a PTY runs a command and streams its output
✓ a PTY accepts input, resizes and reports its process
✓ closing a PTY kills its program
✓ the default shell is $SHELL
```

第二条测试里，进入 shell 后 `resize(100, 40)`，再在 shell 里跑 `stty size`，回读是 `40 100`（测试断言）；说明 `Pty.resize` 真的改到了 kernel 的 window size。

## Terminal 视图（`terminal.ui.test.tsx`，3/3）

fixture 用 `nsh/base` 的 `Terminal`，屏幕内容经 `TerminalRef.text()` 读回（不是复制回调）：

```text
✓ a PTY reaches the Terminal view, resizes with it and closes
✓ vim draws in the real terminal and quits
✓ htop draws its alternate screen and quits
```

观察到：

- `printf 'M7_TERMINAL_VIEW_OK\n'` 出现在 `TerminalRef.text()` 里；`stty` 的尺寸与 `Pty.size` 一致（窗口 1000×650 时 `137x25`，`stty size` = `25 137`）。
- OSC 标题 `\033]0;M7_TERMINAL_TITLE\007` 经 `onTitleChange` 进入 store。
- vim：`~` 列、状态行、`[New File]` 都绘制；`:q!` 后主屏恢复，alt screen 未污染 scrollback。
- htop：全屏绘制（function bar 与 CPU/Mem 区），`q` 后 shell 恢复。
- 关闭 PTY：`closeTerminal` 后 `terminalInfo` 的 running=false，进程 `alive()` 翻转；`pty.test.ts` 另测 `sleep 30` 被 `close()` 结束。

## Claude Code TUI（`terminal.claude.test.tsx`，1/1）

同一 fixture 里输入 `claude`。屏幕上实际出现（`TerminalRef.text()` 摘录）：

```text
 ▐▛███▛█   Claude Code v2.1.278
▝▜██████▀  deepseek-v4.1-flash[1m] with high effort · API Usage Billing
  ▝▝ ▝▝    /private/tmp
...
❯ Try "refactor <filepath>"
```

Ctrl+C 后回到 shell，再跑 `printf 'M7_CLAUDE_EXITED\n'` 成功。**一次真实对话没有完成**：手工输入 prompt 后 CLI 显示

```text
✻ API error · Retrying in 1s · attempt 1/10
```

没有模型回复。因此本记录只证明「TUI 渲染 + 中断 + 回到 shell」，不证明 M7 的「完成一次真实对话」。

## resize 缺陷实测

在 165 列的终端输出 300 个 `A`（`printf 'A%.0s' {1..300}`）：

```text
WIDE   165,135,165,135      # 两行命令各 165+135
NARROW 95,95,95,95          # 缩到 95 列后每行只剩 95，110 字符丢失
```

`VtEmulator::State::resize` 只 `row.resize(cols)`，不重排；全屏 TUI 靠 SIGWINCH 自己重画，所以 vim/htop 不受影响，shell scrollback 会丢字。这是本次唯一实测到的渲染缺陷，已记入 [terminal-emulator.md](terminal-emulator.md) §8。

## 没有做的验证

- 无截图：headless 运行器不绘制，`app.screenshot()` 没有像素；用户的 app 是旧构建且按约束不能重启，所以没有用 `--target macos` 另开窗口。
- 没有验证 Codex/Copilot 的 TUI 本体（命令存在，但本次只跑了 Claude Code 与 vim/htop）；它们走同一条 `Pty`/`Terminal` 路径。
