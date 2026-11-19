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
//   STUB_NEW_FAIL_ONCE=1 session/new fails the first ask, succeeds after —
//                        a retry spawns a fresh process, so it passes
//   STUB_NEW_TAKEN=1     session/new refuses any client-minted id with
//                        `session_id_taken` (the occupancy check's answer)
//   STUB_NEW_DELAY=ms    session/new waits before answering (a slow bind)
//   STUB_INIT_DELAY=ms   initialize waits before answering (a slow
//                        handshake: the cancel-before-bind window, issue #56)
//   STUB_RESUME_FAIL=1   session/resume answers with a coded error
//   STUB_RESUME_NOT_FOUND=1  session/resume answers session_not_found — an
//                        empty session has no file to resume (issue #56)
//   STUB_RESUME_DELAY=ms session/resume waits before answering
//   STUB_EXIT_DELAY=ms   stdin close waits before exiting (a late process)
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
const askCreateId = 9003;
let pending: string | null = null;
let askRetired = false;
// STUB_NEW_FAIL_ONCE: the first session/new of this process fails, like a
// harness whose first bind died; a retry spawns a fresh process.
let newFailsLeft = process.env.STUB_NEW_FAIL_ONCE ? 1 : 0;

// Per-process config state: the harness is the live session, so changing one
// selector must not reset the other (issue #64 review, P3).
let currentModel = "p/m";
let currentThought = "high";

const on = (name: string) => !!process.env[name];
/** A numeric env knob (`0` when unset or not a number) — `on` is the
 * boolean form, so `Number(on(...))` would always be 1. */
const amount = (name: string) => Number(process.env[name] ?? "") || 0;

// The model options carry the harness's `_meta` facts (issue #54) and the
// thought ladder is one of the stub's own: two levels, so a pick moves the
// selector visibly.
function configOptions(model = currentModel, thought = currentThought): string {
  return `"configOptions":[{"id":"model","name":"Model","category":"model","type":"select","currentValue":"${model}","options":[{"value":"p/m","name":"p/m","_meta":{"contextWindow":1000000,"providerName":"P","authSource":"stored"}},{"value":"p/other","name":"p/other","_meta":{"contextWindow":200000,"providerName":"P","authSource":"environment","authLabel":"P_API_KEY"}}]},{"id":"thought_level","name":"Thinking","category":"thought_level","type":"select","currentValue":"${thought}","options":[{"value":"off","name":"off"},{"value":"high","name":"high"}]}]`;
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
  // Each file row is its own entry: the chunk carries the row's identity,
  // like the real distro's `_meta.pi` (#20).
  let n = 0;
  for (const row of readFileSync(replayFile, "utf8").split("\n")) {
    n += 1;
    if (!row.includes(`"type":"message"`)) continue;
    const role = /"role":"[a-z]*"/.exec(row)?.[0]?.split(`"`)[3] ?? "";
    const text = /"text":"[^"]*"/.exec(row)?.[0]?.split(`"`)[3] ?? "";
    const chunk = role === "user" ? "user_message_chunk" : "agent_message_chunk";
    write(
      `{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"${sid}","update":{"sessionUpdate":"${chunk}","content":{"type":"text","text":"${text}"},"messageId":"${sid}-row-${n}","_meta":{"pi":{"entryId":"${sid}-row-${n}"}}}}}`,
    );
  }
}

async function handle(line: string): Promise<void> {
  const id = /"id":(\d+)/.exec(line)?.[1] ?? null;
  // `${sid:=default}` in the sh treats an empty capture as unset too.
  const sid = /"sessionId":"([^"]*)"/.exec(line)?.[1] || "stub-0000-0002";

  if (line.includes(`"method":"initialize"`)) {
    const initDelay = amount("STUB_INIT_DELAY");
    if (initDelay > 0) await new Promise((done) => setTimeout(done, initDelay));
    write(
      `{"jsonrpc":"2.0","id":${id},"result":{"protocolVersion":1,"agentCapabilities":{"loadSession":true,"sessionCapabilities":{"resume":{},"close":{}}},"authMethods":[],"agentInfo":{"name":"acp-stub","version":"0.0.0"}}}`,
    );
  } else if (line.includes(`"method":"session/new"`)) {
    if (on("STUB_NEW_FAIL") || newFailsLeft > 0) {
      if (on("STUB_NEW_FAIL_ONCE")) newFailsLeft -= 1;
      write(`{"jsonrpc":"2.0","id":${id},"error":{"code":-32000,"message":"session_new_failed","data":{"code":"stub_refused"}}}`);
      return;
    }
    // A slow bind widens the starting page's window: a cancel (sheet close)
    // can land while the answer is in flight (issue #56).
    const newDelay = amount("STUB_NEW_DELAY");
    if (newDelay > 0) await new Promise((done) => setTimeout(done, newDelay));
    // Issue #56: a client-minted id rides `_meta` and is honored — a UUID,
    // exactly what the real harness validates; a malformed one is refused.
    // A fixed id keeps acp.test's literal assertions working; a unique one
    // (per spawn = per pid) lets a test mint several containers that must
    // not collapse into one `pi:<sessionId>` registry row.
    const minted = /"_meta":\{"sessionId":"([^"]+)"\}/.exec(line)?.[1];
    if (minted !== undefined && on("STUB_NEW_TAKEN")) {
      write(`{"jsonrpc":"2.0","id":${id},"error":{"code":-32602,"message":"session_id_taken","data":{"code":"session_id_taken","sessionId":"${minted}"}}}`);
      return;
    }
    if (minted !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(minted)) {
      write(`{"jsonrpc":"2.0","id":${id},"error":{"code":-32602,"message":"invalid_session_id","data":{"code":"invalid_session_id"}}}`);
      return;
    }
    const newsid = minted ?? (on("STUB_UNIQUE_SESSION") ? `stub-${process.pid}_0001` : "stub-0000-0001");
    write(`{"jsonrpc":"2.0","id":${id},"result":{"sessionId":"${newsid}",${configOptions()},${modes()}}}`);
    announceCommands(newsid);
  } else if (line.includes(`"method":"session/load"`)) {
    if (on("STUB_LOAD_REPLAY")) {
      // What the real distro does since the transcript facts (#20): the
      // replay's chunks carry `_meta.pi` (entryId, at) and the assistant
      // entry closes with a settle marker.
      write(
        `{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"${sid}","update":{"sessionUpdate":"user_message_chunk","content":{"type":"text","text":"earlier question"},"messageId":"e1","_meta":{"pi":{"at":1760000000000,"entryId":"e1"}}}}}`,
      );
      write(
        `{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"${sid}","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"earlier answer"},"messageId":"e2","_meta":{"pi":{"at":1760000000500,"entryId":"e2"}}}}}`,
      );
      write(
        `{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"${sid}","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":""},"messageId":"e2","_meta":{"pi":{"settled":true,"entryId":"e2","at":1760000000500,"stopReason":"end_turn"}}}}}`,
      );
    }
    if (on("STUB_FILE_REPLAY")) replayFileRows(sid);
    announceCommands(sid);
    write(`{"jsonrpc":"2.0","id":${id},"result":{${configOptions()},${modes()}}}`);
  } else if (line.includes(`"method":"session/resume"`)) {
    if (on("STUB_RESUME_FAIL")) {
      write(`{"jsonrpc":"2.0","id":${id},"error":{"code":-32000,"message":"resume_failed","data":{"code":"stub_refused"}}}`);
      return;
    }
    // An empty session's shape (issue #56): pi casts the session file on
    // the first message, so a released one has nothing to resume — the
    // coded `-32002` the real harness answers, which the client rebuilds
    // from with `session/new`.
    if (on("STUB_RESUME_NOT_FOUND")) {
      write(`{"jsonrpc":"2.0","id":${id},"error":{"code":-32002,"message":"session_not_found","data":{"code":"session_not_found","sessionId":"${sid}"}}}`);
      return;
    }
    // A slow resume widens the release race window (issue #64 review, P2).
    const resumeDelay = amount("STUB_RESUME_DELAY");
    if (resumeDelay > 0) await new Promise((done) => setTimeout(done, resumeDelay));
    announceCommands(sid);
    write(`{"jsonrpc":"2.0","id":${id},"result":{${configOptions()},${modes()}}}`);
  } else if (line.includes(`"method":"session/close"`)) {
    write(`{"jsonrpc":"2.0","id":${id},"result":{}}`);
  } else if (line.includes(`"method":"session/set_config_option"`)) {
    const chosen = /"value":"([^"]*)"/.exec(line)?.[1] || "p/m";
    const configId = /"configId":"([^"]*)"/.exec(line)?.[1] || "model";
    if (configId === "thought_level") currentThought = chosen;
    else currentModel = chosen;
    write(
      `{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"${sid}","update":{"sessionUpdate":"config_option_update",${configOptions()}}}}`,
    );
    write(`{"jsonrpc":"2.0","id":${id},"result":{${configOptions()}}}`);
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
        `{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"${sid}","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"hello from the stub"},"messageId":"m1"}}}`,
      );
      write(
        `{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"${sid}","update":{"sessionUpdate":"tool_call_update","toolCallId":"tc1","status":"completed"}}}`,
      );
      write(
        `{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"${sid}","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":""},"messageId":"e1","_meta":{"pi":{"settled":true,"entryId":"e1","at":1760000001000,"durationMs":200,"stopReason":"end_turn"}}}}}`,
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
    if (on("STUB_ASK_CREATE") && line.includes("which db")) {
      // A1: the ask_user_question card. Settles only after the client
      // answers, so a passing turn proves the response rode the wire. Other
      // prompts settle directly (a superseding send must not re-ask).
      write(
        `{"jsonrpc":"2.0","id":${askCreateId},"method":"_zu/ask/create","params":{"sessionId":"${sid}","toolCallId":"tc-ask-create","questions":[{"question":"Which database?","header":"Database","multiSelect":false,"options":[{"label":"Postgres","description":"Boring and proven"},{"label":"SQLite","description":"Zero ops"}]}]}}`,
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
  } else if (line.includes(`"id":9003`)) {
    // The ask card's answer came back; only now does the turn settle, so a
    // passing turn proves the response rode the wire.
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
lines.on("close", () => {
  // A cancelled resume's process may exit after the retry that adopted a
  // newer session for the same id; the delay makes that ordering testable.
  const delay = amount("STUB_EXIT_DELAY");
  setTimeout(() => process.exit(0), delay);
});
