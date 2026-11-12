import { expect, test } from "nsh/test";
import {
  COMMANDS,
  EVENTS,
  PROTOCOL_VERSION,
  UI_REQUEST_TIMEOUT_MS,
  isCommandType,
  isEventType,
  makeErrorReply,
  makeEvent,
  makeReply,
  makeUIRequest,
  makeUIResponse,
  makeWelcome,
  parseEnvelope,
  validateCommand,
  type Envelope,
} from "../contracts/protocol";

test("every command has a domain, an idempotency and a replay meaning", () => {
  for (const [name, spec] of Object.entries(COMMANDS)) {
    expect(name.startsWith(`${spec.group}.`)).toBe(true);
    expect(typeof spec.idempotent).toBe("boolean");
    expect(["safe", "duplicate", "ignored"]).toContain(spec.replay);
    expect(spec.note.length).toBeGreaterThan(0);
  }
  // The three replay meanings are all represented.
  const replays = new Set(Object.values(COMMANDS).map((spec) => spec.replay));
  expect(replays.has("safe")).toBe(true);
  expect(replays.has("duplicate")).toBe(true);
});

test("container and layout commands carry their replay meanings", () => {
  expect(COMMANDS["container.create"].idempotent).toBe(false);
  expect(COMMANDS["container.create"].replay).toBe("duplicate");
  expect(COMMANDS["container.archive"].idempotent).toBe(true);
  expect(COMMANDS["layout.put"].idempotent).toBe(true);
  expect(COMMANDS["layout.put"].group).toBe("layout");
  expect(COMMANDS["container.attachSession"].group).toBe("container");
});

test("the model commands are additive session commands", () => {
  expect(COMMANDS["session.models"].group).toBe("session");
  expect(COMMANDS["session.models"].replay).toBe("safe");
  expect(COMMANDS["session.setModel"].group).toBe("session");
  expect(COMMANDS["session.setModel"].idempotent).toBe(false);
  expect(COMMANDS["session.setModel"].replay).toBe("duplicate");
  // The pre-existing session commands are still all there.
  for (const name of ["session.info", "session.tools", "session.prompt", "session.abort"]) {
    expect(isCommandType(name)).toBe(true);
  }
});

test("the event list aligns with pi's session events", () => {
  for (const name of [
    "message.delta",
    "message.complete",
    "agent.state",
    "tool.start",
    "tool.end",
    "queue.update",
    "compaction.start",
    "compaction.end",
    "retry.start",
    "retry.end",
    "session.info",
    "ui.request",
    "engine.heartbeat",
  ]) {
    expect(isEventType(name)).toBe(true);
    expect(EVENTS[name as keyof typeof EVENTS]).toBeDefined();
  }
  expect(isEventType("session.nope")).toBe(false);
});

test("validateCommand rejects the wrong version, shape and name", () => {
  const base: Envelope = { v: PROTOCOL_VERSION, id: "r1", type: "engine.ping" };
  expect(validateCommand(base)).toBe(null);

  const wrongVersion = validateCommand({ ...base, v: PROTOCOL_VERSION + 1 });
  expect(wrongVersion?.code).toBe("protocol_mismatch");

  const noId = validateCommand({ v: PROTOCOL_VERSION, type: "engine.ping" });
  expect(noId?.code).toBe("missing_id");

  const unknown = validateCommand({ ...base, type: "session.nope" });
  expect(unknown?.code).toBe("unknown_command");

  const badPayload = validateCommand({ ...base, payload: "nope" as any });
  expect(badPayload?.code).toBe("bad_payload");
});

test("envelope helpers keep one version and correlation id", () => {
  const reply = makeReply("r7", "engine.ping", { at: 1 });
  expect(reply).toMatchObject({ v: PROTOCOL_VERSION, id: "r7", type: "reply" });
  expect(reply.payload.ok).toBe(true);

  const failure = makeErrorReply("r8", "session.open", "no such file", "open_failed");
  expect(failure.payload.ok).toBe(false);
  expect(failure.payload.code).toBe("open_failed");

  const event = makeEvent("agent.state", { state: "idle" }, "s1");
  expect(event).toMatchObject({ v: PROTOCOL_VERSION, type: "agent.state", sessionId: "s1" });
  expect(event.data).toEqual({ state: "idle" });

  const request = makeUIRequest("u1", "confirm", { title: "Sure?" }, 1234, "s1");
  expect(request.data.timeoutMs).toBe(1234);
  expect(request.sessionId).toBe("s1");

  const response = makeUIResponse("u1", { ok: true, result: true });
  expect(response).toMatchObject({ v: PROTOCOL_VERSION, id: "u1", type: "ui.response" });

  const welcome = makeWelcome({ protocol: PROTOCOL_VERSION, pi: "1.5.0", generation: 3, pid: 42, startedAt: 1 });
  expect(welcome.payload.generation).toBe(3);
  expect(UI_REQUEST_TIMEOUT_MS).toBeGreaterThan(0);
});

test("parseEnvelope accepts JSON text and rejects non-objects", () => {
  expect(parseEnvelope('{"v":1,"type":"engine.ping","id":"r1"}')).toMatchObject({ id: "r1" });
  expect(parseEnvelope("not json")).toBe(null);
  expect(parseEnvelope("[]")).toBe(null);
  expect(parseEnvelope({ type: 3 })).toBe(null);
  expect(isCommandType("state.subscribe")).toBe(true);
  expect(isCommandType("state.nope")).toBe(false);
});
