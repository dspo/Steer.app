# Pi × ACP live acceptance — 2026-11-13

Command: `cd pi-harness && bun run scripts/acp-live-acceptance.ts`
(distro built from the A0–F0 tree; `bun run build` first.)

Environment: the developer's real `~/.pi` providers (67 models; default
`bailian/qwen3.8-flash`), cwd = this repository. Every check below is a real
`dist/pi-acp` process over stdio ndjson; no fakes.

| Check | Result |
|---|---|
| baseline turn | `end_turn`, streamed text, first token 849 ms |
| cold spawn | 336 ms to `session/new`, RSS 165.9 MB |
| in-session model switch | `deepseek/deepseek-flash`, next turn `end_turn` |
| reasoning model found | `deepseek/deepseek-v4-pro` (3 thinking levels) |
| in-session effort switch | `high`; next turn `end_turn` |
| resume, new process | model `deepseek-v4-pro`, level `high` preserved; first token 207 ms |
| approval **allow** | `bash printf … > allow.txt` asked, allowed, file exists |
| approval **reject** | `bash printf … > reject.txt` asked, rejected, file absent |
| `/compact` | `compaction_update` completed; context 151,389 → 46,463 of 1,000,000 |
| extension UI | `/ask-ui` and `/ask-fields`: confirm accept/decline, select=`beta`, input=`live-input` all reached the extension |
| subagent dispatch | `scout` run settled, 5 transcript rows |
| subagent abort | a running `worker` run's abort accepted |
| settled after restart | a new process resumed the captain and read the same run + 5 rows |
| process teardown | `session/close` + stdin EOF leaves no `pi-acp` process |

Kill check: `LIVE_CRASH_ONLY=1 bun run scripts/acp-live-acceptance.ts`

| Check | Result |
|---|---|
| SIGKILL mid-turn | the in-flight prompt rejected (`the harness process exited`) |
| resume after kill | the same session id answered `end_turn` in a new process |

Notes:

- The live run used a 4×3500-line filler to exceed pi's compaction
  `keepRecentTokens` (20k). One huge message cannot compact: pi only cuts at
  message boundaries, so the protocol reduced almost nothing. Several large
  messages dropped 151k → 46k.
- `abort` is a request; the script asserts the call is accepted, not that the
  model stopped before its next token.
- The app's container-archive and quit paths call the same
  `closeContainerSessions`/`closeAllSessions` functions this session-close
  check exercises; the GUI menu itself was not driven here.
