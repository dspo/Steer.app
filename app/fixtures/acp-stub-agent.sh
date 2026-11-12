#!/bin/sh
# A minimal ACP agent stub for the app's transport tests: it answers
# initialize / session/new / session/load / session/prompt with canned
# frames over ndjson stdio, exactly like dist/pi-acp would, and exits 0 on
# stdin EOF. Unknown methods with an id get -32601. A session/cancel
# notification settles the pending prompt with `cancelled`.
#
# Modes by env, so one stub serves every case:
#   STUB_LOAD_REPLAY=1   session/load streams a user+agent chunk replay
#   STUB_PROMPT_UPDATES=1  a prompt streams one agent chunk before settling
#   STUB_MIDTURN_EXIT=1  the process exits instead of settling a prompt
#   STUB_NEW_FAIL=1      session/new answers with a coded error

pending=""
while IFS= read -r line; do
  id=$(printf '%s' "$line" | grep -o '"id":[0-9]*' | head -n 1 | tr -dc '0-9')

  case "$line" in
    *'"method":"initialize"'*)
      printf '{"jsonrpc":"2.0","id":%s,"result":{"protocolVersion":1,"agentCapabilities":{"loadSession":true},"authMethods":[],"agentInfo":{"name":"acp-stub","version":"0.0.0"}}}\n' "$id"
      ;;
    *'"method":"session/new"'*)
      if [ -n "$STUB_NEW_FAIL" ]; then
        printf '{"jsonrpc":"2.0","id":%s,"error":{"code":-32000,"message":"session_new_failed","data":{"code":"stub_refused"}}}\n' "$id"
      else
        printf '{"jsonrpc":"2.0","id":%s,"result":{"sessionId":"stub-0000-0001"}}\n' "$id"
      fi
      ;;
    *'"method":"session/load"'*)
      if [ -n "$STUB_LOAD_REPLAY" ]; then
        printf '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"stub-0000-0002","update":{"sessionUpdate":"user_message_chunk","content":{"type":"text","text":"earlier question"}}}}\n'
        printf '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"stub-0000-0002","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"earlier answer"}}}}\n'
      fi
      printf '{"jsonrpc":"2.0","id":%s,"result":{}}\n' "$id"
      ;;
    *'"method":"session/prompt"'*)
      pending="$id"
      if [ -n "$STUB_MIDTURN_EXIT" ]; then
        exit 7
      fi
      if [ -n "$STUB_HOLD_PROMPT" ]; then
        continue
      fi
      if [ -n "$STUB_PROMPT_UPDATES" ]; then
        printf '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"stub-0000-0001","update":{"sessionUpdate":"tool_call","toolCallId":"tc1","title":"read x","name":"read","kind":"read","status":"in_progress"}}}\n'
        printf '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"stub-0000-0001","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"hello from the stub"}}}}\n'
        printf '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"stub-0000-0001","update":{"sessionUpdate":"tool_call_update","toolCallId":"tc1","status":"completed"}}}\n'
      fi
      printf '{"jsonrpc":"2.0","id":%s,"result":{"stopReason":"end_turn"}}\n' "$pending"
      pending=""
      ;;
    *'"method":"session/cancel"'*)
      if [ -n "$pending" ]; then
        printf '{"jsonrpc":"2.0","id":%s,"result":{"stopReason":"cancelled"}}\n' "$pending"
        pending=""
      fi
      ;;
    *'"id"'*)
      if [ -n "$id" ]; then
        printf '{"jsonrpc":"2.0","id":%s,"error":{"code":-32601,"message":"method not found","data":{"code":"method_not_found"}}}\n' "$id"
      fi
      ;;
  esac
done

exit 0
