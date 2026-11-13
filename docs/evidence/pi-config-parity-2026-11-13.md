# Pi official-config parity — live evidence — 2026-11-13

Command: `cd pi-harness && bun run build && bun run acceptance:live`
Environment: real `~/.pi` (67 models, default `bailian/qwen3.8-flash`), repo cwd.

| Check | Result |
|---|---|
| `settings.json` `defaultTools: ["+codemode"]` | `codemode` tool called; returned 42 |
| ACP `session/new.mcpServers` | local `echo` MCP server registered; model called `mcp__fixture__echo` and got `mcp-live-ok` |
| baseline turn | `end_turn`, first token 1,944 ms |
| cold start | 1,367 ms to `session/new`, RSS 168.7 MB |
| model switch | `deepseek/deepseek-flash`, next turn `end_turn` |
| thinking-level model | `deepseek/deepseek-v4-pro` (3 levels) |
| effort switch | `high`; next turn `end_turn` |
| resume, new process | model `deepseek-v4-pro`, level `high` preserved; first token 725 ms |
| approval allow | real `bash` ran; marker exists |
| approval reject | same command blocked; marker absent |
| `/compact` | `compaction_update` completed; context 153,667 → 48,324 |
| extension UI | confirm accept/decline, select, input answers reached the extension |
| subagent | real `scout` settled (7 transcript rows); `worker` abort accepted |
| settled after restart | new process resumed captain and read the same run + 7 rows |
| process teardown | `session/close` + stdin EOF leaves no `pi-acp` |

Gates: `nsh check app` ✓, `check-layers` ✓, `nsh test app` 221/213 (8 skip),
`pi-harness bun test` 54, `bun run smoke` ✓, `script/bundle-mac.sh` ✓.

Additional gates:

- `bun test src/pi` — builtin drift, loader/builtin disable, local package + skill,
  trust branches (no-ui / elicitation / remember / defaultProjectTrust), ACP MCP mapping and registration.
- `app/trust.ui.test.tsx` — the app-root trust dialog answers before a session exists;
  accept and decline both resolve.
- `bun run smoke` — trust elicitation is declined by the raw smoke client; protocol framing still passes.

Known exception: `llama.cpp` builtin is not exported by the SDK root; `official.test.ts` lists it as the
one known gap and fails when the installed CLI's builtin list changes.
