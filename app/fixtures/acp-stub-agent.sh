#!/bin/sh
# A minimal ACP agent stub for the app's transport tests: it answers
# initialize / session/new / session/load / session/resume / session/close /
# session/set_config_option / session/set_mode / session/prompt /
# _zu/subagents/list with canned frames over ndjson stdio, exactly like
# dist/pi-acp would, and exits 0 on stdin EOF. Unknown methods with an id get
# -32601. A session/cancel notification settles the pending prompt with
# `cancelled`.
#
# Modes by env, so one stub serves every case:
#   STUB_LOAD_REPLAY=1   session/load streams a user+agent chunk replay
#   STUB_FILE_REPLAY=1   session/load streams the session file's own rows
#   STUB_PROMPT_UPDATES=1  a prompt streams one agent chunk before settling
#   STUB_MIDTURN_EXIT=1  the process exits instead of settling a prompt
#   STUB_NEW_FAIL=1      session/new answers with a coded error
#   STUB_UNIQUE_SESSION=1  session/new answers a unique id (per spawn), not the fixed stub-0000-0001
#   STUB_ASK=1           the prompt asks the client for tool approval
#   STUB_ELICIT=1        the prompt asks the client for structured input

permission_id=9001
elicitation_id=9002
pending=""

config_options() {
  value="${1:-p/m}"
  printf '"configOptions":[{"id":"model","name":"Model","category":"model","type":"select","currentValue":"%s","options":[{"value":"p/m","name":"p/m"},{"value":"p/other","name":"p/other"}]}]' "$value"
}

modes() {
  current="${1:-ask}"
  printf '"modes":{"currentModeId":"%s","availableModes":[{"id":"ask","name":"Ask"},{"id":"auto","name":"Auto"}]}' "$current"
}

announce_commands() {
  sid="$1"
  printf '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"%s","update":{"sessionUpdate":"available_commands_update","availableCommands":[{"name":"compact","description":"Compact the context."}]}}}\n' "$sid"
}

while IFS= read -r line; do
  id=$(printf '%s' "$line" | grep -o '"id":[0-9]*' | head -n 1 | tr -dc '0-9')
  sid=$(printf '%s' "$line" | grep -o '"sessionId":"[^"]*"' | head -n 1 | cut -d'"' -f4)
  : "${sid:=stub-0000-0002}"

  case "$line" in
    *'"method":"initialize"'*)
      printf '{"jsonrpc":"2.0","id":%s,"result":{"protocolVersion":1,"agentCapabilities":{"loadSession":true,"sessionCapabilities":{"resume":{},"close":{}}},"authMethods":[],"agentInfo":{"name":"acp-stub","version":"0.0.0"}}}\n' "$id"
      ;;
    *'"method":"session/new"'*)
      if [ -n "$STUB_NEW_FAIL" ]; then
        printf '{"jsonrpc":"2.0","id":%s,"error":{"code":-32000,"message":"session_new_failed","data":{"code":"stub_refused"}}}\n' "$id"
      else
        # A fixed id keeps acp.test's literal assertions working; a unique
        # one (per spawn = per pid) lets a test mint several containers that
        # must not collapse into one `pi:<sessionId>` registry row.
        if [ -n "$STUB_UNIQUE_SESSION" ]; then
          newsid="stub-$$_0001"
        else
          newsid="stub-0000-0001"
        fi
        printf '{"jsonrpc":"2.0","id":%s,"result":{"sessionId":"%s",%s,%s}}\n' "$id" "$newsid" "$(config_options)" "$(modes)"
        announce_commands "$newsid"
      fi
      ;;
    *'"method":"session/load"'*)
      if [ -n "$STUB_LOAD_REPLAY" ]; then
        printf '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"'$sid'","update":{"sessionUpdate":"user_message_chunk","content":{"type":"text","text":"earlier question"}}}}\n'
        printf '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"'$sid'","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"earlier answer"}}}}\n'
      fi
      if [ -n "$STUB_FILE_REPLAY" ]; then
        # What the real distro does: stream the file's own rows. The session
        # file is found by its id (the tests write them under /tmp) and each
        # message row replays as its chunk, file order preserved — so a
        # transcript assertion reads the fixture file, not canned text.
        replay_file=$(find -L /tmp -name "*_${sid}.jsonl" -type f 2>/dev/null | head -n 1)
        if [ -n "$replay_file" ]; then
          while IFS= read -r row; do
            case "$row" in
              *'"type":"message"'*)
                role=$(printf '%s' "$row" | grep -o '"role":"[a-z]*"' | head -n 1 | cut -d'"' -f4)
                text=$(printf '%s' "$row" | grep -o '"text":"[^"]*"' | head -n 1 | cut -d'"' -f4)
                if [ "$role" = "user" ]; then
                  chunk="user_message_chunk"
                else
                  chunk="agent_message_chunk"
                fi
                printf '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"%s","update":{"sessionUpdate":"%s","content":{"type":"text","text":"%s"}}}}\n' "$sid" "$chunk" "$text"
                ;;
            esac
          done < "$replay_file"
        fi
      fi
      announce_commands "$sid"
      printf '{"jsonrpc":"2.0","id":%s,"result":{%s,%s}}\n' "$id" "$(config_options)" "$(modes)"
      ;;
    *'"method":"session/resume"'*)
      announce_commands "$sid"
      printf '{"jsonrpc":"2.0","id":%s,"result":{%s,%s}}\n' "$id" "$(config_options)" "$(modes)"
      ;;
    *'"method":"session/close"'*)
      printf '{"jsonrpc":"2.0","id":%s,"result":{}}\n' "$id"
      ;;
    *'"method":"session/set_config_option"'*)
      chosen=$(printf '%s' "$line" | grep -o '"value":"[^"]*"' | head -n 1 | cut -d'"' -f4)
      : "${chosen:=p/m}"
      printf '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"%s","update":{"sessionUpdate":"config_option_update",%s}}}\n' "$sid" "$(config_options "$chosen")"
      printf '{"jsonrpc":"2.0","id":%s,"result":{%s}}\n' "$id" "$(config_options "$chosen")"
      ;;
    *'"method":"session/set_mode"'*)
      chosen_mode=$(printf '%s' "$line" | grep -o '"modeId":"[^"]*"' | head -n 1 | cut -d'"' -f4)
      : "${chosen_mode:=ask}"
      printf '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"%s","update":{"sessionUpdate":"current_mode_update","currentModeId":"%s"}}}\n' "$sid" "$chosen_mode"
      printf '{"jsonrpc":"2.0","id":%s,"result":{}}\n' "$id"
      ;;
    *'"method":"_zu/subagents/list"'*)
      printf '{"jsonrpc":"2.0","id":%s,"result":{"runs":[{"id":"run-stub","agent":"worker","status":"done"}]}}\n' "$id"
      ;;
    *'"method":"session/prompt"'*)
      pending="$id"
      if [ -n "$STUB_MIDTURN_EXIT" ] && printf '%s' "$line" | grep -q '"text":"boom"'; then
        exit 7
      fi
      if [ -n "$STUB_HOLD_PROMPT" ]; then
        continue
      fi
      if [ -n "$STUB_PROMPT_UPDATES" ]; then
        printf '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"%s","update":{"sessionUpdate":"tool_call","toolCallId":"tc1","title":"read x","name":"read","kind":"read","status":"in_progress"}}}\n' "$sid"
        printf '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"%s","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"hello from the stub"}}}}\n' "$sid"
        printf '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"%s","update":{"sessionUpdate":"tool_call_update","toolCallId":"tc1","status":"completed"}}}\n' "$sid"
      fi
      if [ -n "$STUB_ASK" ]; then
        printf '{"jsonrpc":"2.0","id":%s,"method":"session/request_permission","params":{"sessionId":"%s","toolCall":{"toolCallId":"tc-ask","title":"run the dangerous thing","kind":"execute"},"options":[{"optionId":"allow_once","name":"Allow once","kind":"allow_once"},{"optionId":"reject","name":"Reject","kind":"reject_once"}]}}\n' "$permission_id" "$sid"
        continue
      fi
      if [ -n "$STUB_ELICIT" ]; then
        printf '{"jsonrpc":"2.0","id":%s,"method":"elicitation/create","params":{"sessionId":"%s","message":"Which environment?","requestedSchema":{"type":"object","properties":{"environment":{"type":"string","enum":["staging","prod"]}},"required":["environment"]}}}\n' "$elicitation_id" "$sid"
        continue
      fi
      printf '{"jsonrpc":"2.0","id":%s,"result":{"stopReason":"end_turn"}}\n' "$pending"
      pending=""
      ;;
    *'"id":9001'*)
      printf '{"jsonrpc":"2.0","id":%s,"result":{"stopReason":"end_turn"}}\n' "$pending"
      pending=""
      ;;
    *'"id":9002'*)
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
