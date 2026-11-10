# Wire protocol v1

The engine (a Bun sidecar around pi's SDK) and the shell (TSX) talk over one
loopback WebSocket. This document and [`protocol.ts`](protocol.ts) are the
contract: a change to one is a change to the other in the same commit.
`PROTOCOL_VERSION` is the version of the envelope and the command/event names;
adding an optional field is compatible, anything else bumps `v`.

## Connection

1. The shell starts the sidecar through the `zu/native` module, which hands back
   the port and the handshake token.
2. The shell opens `ws://127.0.0.1:{port}` and sends:

   ```json
   { "v": 1, "type": "hello", "token": "…" }
   ```

3. The engine answers with a welcome, or with an `error` and closes:

   ```json
   { "v": 1, "type": "welcome",
     "payload": { "protocol": 1, "pi": "1.5.0", "generation": 7,
                  "pid": 1234, "startedAt": 1794277000000 } }
   ```

   `generation` increments every time the engine process starts; it is
   persisted in `~/.pi/zu/engine.generation`, so a shell that reconnects can
   tell a restart from a network hiccup.

   A version mismatch is fatal for the connection, not retried:

   ```json
   { "v": 2, "type": "error",
     "payload": { "code": "protocol_mismatch",
                  "message": "protocol v2 does not match v1" } }
   ```

   The shell shows the message and asks the user to update, rather than
   guessing at the other side's meaning. `hello` itself carries the sender's
   version; the engine answers in its own.

4. The shell sends `state.subscribe`, whose reply is the current
   `StateSnapshot`; from then on this connection receives events. Commands may
   be sent before subscribing (the engine answers them), but extension UI
   requests go only to subscribed connections.

## Envelopes

| Direction | Shape |
|---|---|
| command | `{ v, id, sessionId?, type, payload? }` |
| reply | `{ v, id, type: "reply", payload: { command, ok, data?, error?, code? } }` |
| event | `{ v, type, sessionId?, data? }` |
| engine → shell request | `{ v, id, type: "ui.request", sessionId?, data: { method, params, timeoutMs } }` |
| shell → engine answer | `{ v, id, type: "ui.response", payload: { ok, result?, error? } }` |

`id` is the sender's correlation key. A reply repeats the command's `id`; an
extension UI request's answer repeats the request's `id`. The shell rejects a
command that timed out after the engine's reply arrives, so replies and
timeouts never race into a second resolution.

`sessionId` is present on everything that belongs to a session (session
commands and events, extension UI requests). `engine.*` and `state.*`
commands have none.

## Commands

`idempotent` means the same command and payload run twice leaves the same
state. `replay` says what a duplicate copy means: `safe` (same result, no extra
effect), `duplicate` (the effect happens again), `ignored` (the copy is
dropped after the first was matched).

### engine.*

| Command | Idempotent | Replay | Reply |
|---|---|---|---|
| `engine.ping` | yes | safe | `{ at }` |
| `engine.info` | yes | safe | `StateSnapshot` + `uptimeMs`, `sessions` |
| `engine.health` | yes | safe | `{ at, generation, uptimeMs, sessions }` |

### session.*

| Command | Payload | Idempotent | Replay | Reply |
|---|---|---|---|---|
| `session.list` | — | yes | safe | `{ sessions: SessionMeta[] }` |
| `session.create` | `{ cwd }` | no | duplicate | `SessionData` |
| `session.open` | `{ path }` | yes (by path) | safe | `SessionData` |
| `session.info` | `{ sessionId }` | yes | safe | `{ sessionId, path, name?, running, customTypes }` |
| `session.extensions` | `{ sessionId }` | yes | safe | `{ extensions, errors }` |
| `session.prompt` | `{ sessionId, text }` | no | duplicate | `{ accepted: true }` |
| `session.steer` | `{ sessionId, text }` | no | duplicate | `{ accepted: true }`; an idle session errors |
| `session.followUp` | `{ sessionId, text }` | no | duplicate | `{ accepted: true }`; an idle session errors |
| `session.abort` | `{ sessionId }` | yes | safe | `{}`; aborting an idle session is a no-op |
| `session.close` | `{ sessionId }` | yes | safe | `{}` |

`session.prompt` resolves as soon as pi accepts the turn; the turn's progress
arrives as events. `session.steer` and `session.followUp` are allowed only
while a turn runs and map to pi's `streamingBehavior`.

### project.*

A project is user-created: one or more absolute roots, exactly one primary.
`projects.json` stores `{ v, projects, membership }`; membership is the only
source of a container's project (absent means Chats), never inferred from cwd.
A container's cwd is the primary root's snapshot at creation, so editing roots
never moves a live container.

| Command | Payload | Idempotent | Replay | Reply |
|---|---|---|---|---|
| `project.list` | — | yes | safe | `{ projects, membership }` |
| `project.create` | `{ name?, roots: [{ path, primary? }] }` | no | duplicate | `{ project, projects, membership }` |
| `project.update` | `{ projectId, name?, roots? }` | yes | safe | `{ project, projects, membership }` |
| `project.setMembership` | `{ containerId, projectId: string \| null }` | yes | safe | `{ container, projects, membership }` |

`project.create` rejects zero roots, non-absolute paths, non-directories, and
more than one primary. With no primary the first root becomes primary; with no
name the primary's basename is followed. `project.setMembership` takes `null`
for Chats.

### container.*

A container is M3's first relational object: a group of panels with a kind,
a cwd and one or more pi sessions (the captain is `sessions[0]`). The engine
owns the registry; the shell owns the layout stash and asks for it by id.

| Command | Payload | Idempotent | Replay | Reply |
|---|---|---|---|---|
| `container.list` | — | yes | safe | `{ containers, activeContainerId }` |
| `container.create` | `{ cwd?, projectId? }` | no | duplicate | `{ container, session }`; also makes it active. With `projectId`, cwd is the project's primary snapshot |
| `container.show` | `{ containerId }` | yes | safe | `{ container }`; sets the active container |
| `container.attachSession` | `{ containerId, path }` | yes (by path) | safe | `{ container, session }` |
| `container.archive` | `{ containerId }` | yes | safe | `{ containers, activeContainerId }`; aborts and disposes its sessions |
| `container.unarchive` | `{ containerId }` | yes | safe | `{ containers, activeContainerId }` |

`container.archive` is the single teardown path. The record, its session files
and its layout are never deleted (Q34); only the engine's in-memory sessions and
live runs go away. Archiving the active container moves `activeContainerId` to
the most recently updated live one (or `null`).

### layout.*

Layouts are the shell's data, stored by the engine under `~/.pi/zu/layouts/`
so the UI keeps no filesystem access. Each record is
`{ v, containerId, layout, zoom, updatedAt }`; `zoom` is the zoomed panel's id
or `null` (DockArea keeps zoom outside its layout tree).

| Command | Payload | Idempotent | Replay | Reply |
|---|---|---|---|---|
| `layout.get` | `{ containerId }` | yes | safe | `{ containerId, layout: null }` when none |
| `layout.put` | `{ containerId, layout, zoom }` | yes | safe | the stored record; last write wins |

### state.*

| Command | Idempotent | Replay | Reply |
|---|---|---|---|
| `state.snapshot` | yes | safe | `StateSnapshot` |
| `state.subscribe` | yes | safe | `StateSnapshot`; starts events on this connection |

### ui.*

`ui.response` is not a command: it answers an outstanding `ui.request`,
repeating its `id`. A response with no outstanding request, or a second
response to the same request, is ignored (replay: `ignored`) — the request is
gone and the engine has already resolved it with its timeout's default.

## StateSnapshot

```ts
{
  generation: number,          // engine process generation
  protocol: number,
  pi: string,
  pid: number,
  startedAt: number,
  containers: ContainerRecord[], // archived ones included; projectId from membership
  activeContainerId: string | null,
  openSessions: [{ sessionId, path, cwd, name?, containerId?, running }],
  activeRuns: string[],        // session ids with a running turn
  unread: Record<string, number>
}
```

The snapshot is what the shell rebuilds from after any reconnect: it drops
state for sessions the engine no longer has, reopens the active session by its
file path, and marks a turn that was running before the disconnect as
interrupted. The transcript itself is never mirrored here; pi's session file
stays the authority.

## Events

All except `engine.*` carry `sessionId`.

| Event | Data | Meaning |
|---|---|---|
| `engine.heartbeat` | `{ at, generation, uptimeMs, sessions }` | every 5 s while subscribed; the shell treats 15 s without one as a dead engine |
| `message.delta` | `{ delta }` | a streamed assistant text chunk |
| `message.complete` | `{ role, text, at? }` | a finished, non-system message |
| `agent.state` | `{ state: "running" \| "idle" }` | turn boundaries (`agent_settled`, not `agent_end`) |
| `session.info` | `{ name?, thinkingLevel? }` | pi session metadata changed |
| `tool.start` | `{ toolName, toolCallId }` | a tool call started |
| `tool.update` | `{ toolName, toolCallId }` | a partial tool result arrived |
| `tool.end` | `{ toolName, toolCallId, isError }` | a tool call finished |
| `queue.update` | `{ steering, followUp }` | pi's queued messages changed |
| `compaction.start` | `{ reason }` | compaction started |
| `compaction.end` | `{ reason, aborted, willRetry, errorMessage? }` | compaction ended |
| `retry.start` | `{ attempt, maxAttempts, delayMs, errorMessage }` | a retry was scheduled |
| `retry.end` | `{ attempt, success, finalError? }` | a retry succeeded or gave up |
| `ui.request` | `{ method, params, timeoutMs }` | an extension needs a decision |
| `ui.notify` | `{ message, type: "info" \| "warning" \| "error" }` | an extension notification |
| `ui.status` | `{ key, text? }` | an extension status line; absent text clears it |
| `ui.title` | `{ title }` | an extension asked for the window title |
| `ui.unsupported` | `{ method }` | an extension UI method the shell cannot show; logged |
| `error` | `{ message, code? }` | a failure outside a reply |

`session.info` is both a command and an event name; direction and the envelope
shape tell them apart.

## Extension UI matrix

The engine binds pi's extensions explicitly
(`session.bindExtensions({ uiContext, mode: "rpc" })`), so a loaded extension
never gets pi's silent no-op UI by accident.

| pi method | Engine | Shell |
|---|---|---|
| `confirm` | `ui.request` `method: "confirm"` | native `AlertDialog` (Yes / No) |
| `select` | `ui.request` `method: "select"` | in-app dialog with one pressable row per option |
| `input` | `ui.request` `method: "input"` | in-app dialog with a single-line `Input` |
| `editor` | `ui.request` `method: "editor"` | in-app dialog with a multi-line `Input` |
| `notify` | `ui.notify` | toast in the shell |
| `setStatus` | `ui.status` | status line, by key |
| `setTitle` | `ui.title` | main window title |
| `custom`, `setWidget`, `setFooter`, `setHeader`, `onTerminalInput`, `setEditorText`, `getEditorText`, `pasteToEditor`, `setWorkingMessage`, `setWorkingVisible`, `setWorkingIndicator`, `setHiddenThinkingLabel`, `setWorkingMessage`, `setEditorComponent`, theme and autocomplete methods | no-op | `ui.unsupported`, logged in `~/.pi/zu/engine.log`; never silent |

A dialog's timeout comes from pi's `opts.timeout` when given, else
`UI_REQUEST_TIMEOUT_MS` (120 s). On timeout the engine resolves pi's default
(`false` for `confirm`; `undefined` for `select`, `input`, `editor`) and drops
the request. The shell's late answer is ignored.

Project trust is an extension-visible decision too: before a session loads
project-local resources, the engine asks through the same `select` method and
records the answer in pi's trust store (`~/.pi/agent/trust.json`). A project
without trust-requiring resources never prompts.
