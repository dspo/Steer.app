// A minimal ACP agent stub for the app's transport tests: it answers
// initialize / session/new / session/load / session/resume / session/close /
// session/set_config_option / session/set_mode / session/prompt /
// _zu/subagents/list with canned frames over ndjson stdio, exactly like
// dist/pi-acp would, and exits 0 on stdin EOF. Unknown methods with an id get
// -32601. A session/cancel notification settles the pending prompt with
// `cancelled`.
//
// Runs under bun (spawned via app/fixtures/stub-command.ts): the stub is
// TypeScript in the repo's own toolchain, no shell involved.
//
// Modes by env, so one stub serves every case:
//   STUB_LOAD_REPLAY=1   session/load streams a user+agent chunk replay
//   STUB_FILE_REPLAY=1   session/load streams the session file's own rows
//   STUB_PROMPT_UPDATES=1  a prompt streams one agent chunk before settling
//   STUB_MIDTURN_EXIT=1  the process exits instead of settling a prompt
//   STUB_NEW_FAIL=1      session/new answers with a coded error
//   STUB_UNIQUE_SESSION=1  session/new answers a unique id (per spawn), not the fixed stub-0000-0001
//   STUB_ASK=1           the prompt asks the client for tool approval
//   STUB_ELICIT=1        the prompt asks the client for structured input
//   STUB_PENDING_ASKS=1  _zu/ask/pending lists one parked ask (B2 mailbox)
//   STUB_ASK_ANSWER=1    _zu/ask/answer answers `delivered:"late"` and retires
//                        the canned ask — later _zu/ask/pending lists nothing,
//                        like a real harness whose receipts retired it (B2)

// This file runs under real bun (the tests spawn it through bun, via
// stub-command.ts) — not in the app VM. But `nsh check` type-checks every
// app file with the VM's ambient types, and the VM's `process` knows no
// pid or stdin. This shadow is the bun side of that line — the shapes the
// stub uses; the Node builtins it imports are declared in the .d.ts beside
// this file.
declare const process: {
  readonly env: Record<string, string | undefined>;
  readonly pid: number;
  readonly stdin: unknown;
  readonly stdout: { write(text: string): unknown };
  exit(code?: number): never;
};

import { readdirSync, readFileSync, statSync } from "node:fs";
import { createInterface } from "node:readline";
// "path" without the prefix: the app's ambient types declare it (LLRT
// shapes), and bun resolves it to the same node:path.
import { join } from "path";

const permissionId = 9001;
const elicitationId = 9002;
let pending: string | null = null;
let askRetired = false;

const on = (name: string) => !!process.env[name];

function configOptions(value = "p/m"): string {
  return `"configOptions":[{"id":"model","name":"Model","category":"model","type":"select","currentValue":"${value}","options":[{"value":"p/m","name":"p/m"},{"value":"p/other","name":"p/other"}]}]`;
}

function modes(current = "ask"): string {
  return `"modes":{"currentModeId":"${current}","availableModes":[{"id":"ask","name":"Ask"},{"id":"auto","name":"Auto"}]}`;
}

function announceCommands(sid: string): void {
  write(
    `{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"${sid}","update":{"sessionUpdate":"available_commands_update","availableCommands":[{"name":"compact","description":"Compact the context."}]}}}`,
  );
}

function write(frame: string): void {
  process.stdout.write(`${frame}\n`);
}

/** The session file's own rows, streamed like the real distro does: the file
 * is found by its id (the tests write them under /tmp) and each message row
 * replays as its chunk, file order preserved — so a transcript assertion
 * reads the fixture file, not canned text. Text and role are extracted raw
 * (the frame embeds them verbatim), matching what the tests write. */
function findReplayFile(sid: string): string | null {
  let found: string | null = null;
  const visited = new Set<string>();
  const walk = (dir: string): void => {
    if (found) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return; // unreadable directories are not findings, as `find 2>/dev/null` had it
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      let stats;
      try {
        stats = statSync(full); // -L: symlinks are followed
      } catch {
        continue;
      }
      const key = `${stats.dev}:${stats.ino}`;
      if (visited.has(key)) continue; // a symlink cycle is not a finding either
      visited.add(key);
      if (stats.isDirectory()) walk(full);
      else if (stats.isFile() && entry.endsWith(`_${sid}.jsonl`)) {
        found = full;
        return;
      }
    }
  };
  walk("/tmp");
  return found;
}

function replayFileRows(sid: string): void {
  const replayFile = findReplayFile(sid);
  if (!replayFile) return;
  for (const row of readFileSync(replayFile, "utf8").split("\n")) {
    if (!row.includes(`"type":"message"`)) continue;
    const role = /"role":"[a-z]*"/.exec(row)?.[0]?.split(`"`)[3] ?? "";
    const text = /"text":"[^"]*"/.exec(row)?.[0]?.split(`"`)[3] ?? "";
    const chunk = role === "user" ? "user_message_chunk" : "agent_message_chunk";
    write(
      `{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"${sid}","update":{"sessionUpdate":"${chunk}","content":{"type":"text","text":"${text}"}}}}`,
    );
  }
}

function handle(line: string): void {
  const id = /"id":(\d+)/.exec(line)?.[1] ?? null;
  // `${sid:=default}` in the sh treats an empty capture as unset too.
  const sid = /"sessionId":"([^"]*)"/.exec(line)?.[1] || "stub-0000-0002";

  if (line.includes(`"method":"initialize"`)) {
    write(
      `{"jsonrpc":"2.0","id":${id},"result":{"protocolVersion":1,"agentCapabilities":{"loadSession":true,"sessionCapabilities":{"resume":{},"close":{}}},"authMethods":[],"agentInfo":{"name":"acp-stub","version":"0.0.0"}}}`,
    );
  } else if (line.includes(`"method":"session/new"`)) {
    if (on("STUB_NEW_FAIL")) {
      write(`{"jsonrpc":"2.0","id":${id},"error":{"code":-32000,"message":"session_new_failed","data":{"code":"stub_refused"}}}`);
    } else {
      // A fixed id keeps acp.test's literal assertions working; a unique
      // one (per spawn = per pid) lets a test mint several containers that
      // must not collapse into one `pi:<sessionId>` registry row.
      const newsid = on("STUB_UNIQUE_SESSION") ? `stub-${process.pid}_0001` : "stub-0000-0001";
      write(`{"jsonrpc":"2.0","id":${id},"result":{"sessionId":"${newsid}",${configOptions()},${modes()}}}`);
      announceCommands(newsid);
    }
  } else if (line.includes(`"method":"session/load"`)) {
    if (on("STUB_LOAD_REPLAY")) {
      write(
        `{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"${sid}","update":{"sessionUpdate":"user_message_chunk","content":{"type":"text","text":"earlier question"}}}}`,
      );
      write(
        `{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"${sid}","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"earlier answer"}}}}`,
      );
    }
    if (on("STUB_FILE_REPLAY")) replayFileRows(sid);
    announceCommands(sid);
    write(`{"jsonrpc":"2.0","id":${id},"result":{${configOptions()},${modes()}}}`);
  } else if (line.includes(`"method":"session/resume"`)) {
    announceCommands(sid);
    write(`{"jsonrpc":"2.0","id":${id},"result":{${configOptions()},${modes()}}}`);
  } else if (line.includes(`"method":"session/close"`)) {
    write(`{"jsonrpc":"2.0","id":${id},"result":{}}`);
  } else if (line.includes(`"method":"session/set_config_option"`)) {
    const chosen = /"value":"([^"]*)"/.exec(line)?.[1] || "p/m";
    write(
      `{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"${sid}","update":{"sessionUpdate":"config_option_update",${configOptions(chosen)}}}}`,
    );
    write(`{"jsonrpc":"2.0","id":${id},"result":{${configOptions(chosen)}}}`);
  } else if (line.includes(`"method":"session/set_mode"`)) {
    const chosenMode = /"modeId":"([^"]*)"/.exec(line)?.[1] || "ask";
    write(
      `{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"${sid}","update":{"sessionUpdate":"current_mode_update","currentModeId":"${chosenMode}"}}}`,
    );
    write(`{"jsonrpc":"2.0","id":${id},"result":{}}`);
  } else if (line.includes(`"method":"_zu/subagents/list"`)) {
    write(`{"jsonrpc":"2.0","id":${id},"result":{"runs":[{"id":"run-stub","agent":"worker","status":"done"}]}}`);
  } else if (line.includes(`"method":"_zu/ask/pending"`)) {
    if (on("STUB_PENDING_ASKS") && !askRetired) {
      write(
        `{"jsonrpc":"2.0","id":${id},"result":{"asks":[{"toolCallId":"tc-pending","args":{"questions":[{"question":"Which database?","header":"Database","multiSelect":false,"options":[{"label":"Postgres","description":"relational"}]}]}}]}}`,
      );
    } else {
      write(`{"jsonrpc":"2.0","id":${id},"result":{"asks":[]}}`);
    }
  } else if (line.includes(`"method":"_zu/ask/answer"`)) {
    if (on("STUB_ASK_ANSWER")) {
      askRetired = true;
      write(`{"jsonrpc":"2.0","id":${id},"result":{"delivered":"late"}}`);
    } else {
      write(`{"jsonrpc":"2.0","id":${id},"result":{}}`);
    }
  } else if (line.includes(`"method":"session/prompt"`)) {
    pending = id;
    if (on("STUB_MIDTURN_EXIT") && line.includes(`"text":"boom"`)) process.exit(7);
    if (on("STUB_HOLD_PROMPT")) return;
    if (on("STUB_PROMPT_UPDATES")) {
      write(
        `{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"${sid}","update":{"sessionUpdate":"tool_call","toolCallId":"tc1","title":"read x","name":"read","kind":"read","status":"in_progress"}}}`,
      );
      write(
        `{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"${sid}","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"hello from the stub"}}}}`,
      );
      write(
        `{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"${sid}","update":{"sessionUpdate":"tool_call_update","toolCallId":"tc1","status":"completed"}}}`,
      );
    }
    if (on("STUB_ASK")) {
      write(
        `{"jsonrpc":"2.0","id":${permissionId},"method":"session/request_permission","params":{"sessionId":"${sid}","toolCall":{"toolCallId":"tc-ask","title":"run the dangerous thing","kind":"execute"},"options":[{"optionId":"allow_once","name":"Allow once","kind":"allow_once"},{"optionId":"reject","name":"Reject","kind":"reject_once"}]}}`,
      );
      return;
    }
    if (on("STUB_ELICIT")) {
      write(
        `{"jsonrpc":"2.0","id":${elicitationId},"method":"elicitation/create","params":{"sessionId":"${sid}","message":"Which environment?","requestedSchema":{"type":"object","properties":{"environment":{"type":"string","enum":["staging","prod"]}},"required":["environment"]}}}`,
      );
      return;
    }
    write(`{"jsonrpc":"2.0","id":${pending},"result":{"stopReason":"end_turn"}}`);
    pending = null;
  } else if (line.includes(`"id":9001`)) {
    write(`{"jsonrpc":"2.0","id":${pending},"result":{"stopReason":"end_turn"}}`);
    pending = null;
  } else if (line.includes(`"id":9002`)) {
    write(`{"jsonrpc":"2.0","id":${pending},"result":{"stopReason":"end_turn"}}`);
    pending = null;
  } else if (line.includes(`"method":"session/cancel"`)) {
    if (pending !== null) {
      write(`{"jsonrpc":"2.0","id":${pending},"result":{"stopReason":"cancelled"}}`);
      pending = null;
    }
  } else if (line.includes(`"id"`) && id !== null) {
    write(`{"jsonrpc":"2.0","id":${id},"error":{"code":-32601,"message":"method not found","data":{"code":"method_not_found"}}}`);
  }
}

const lines = createInterface({ input: process.stdin });
lines.on("line", handle);
lines.on("close", () => process.exit(0));
