import { expect, test } from "nsh/test";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
import { containers, setContainerTransport } from "./core/containers";
import { openModelMenuRequest } from "./modules/pi/slash";
import { membership, projects } from "./core/projects";
import { runSlash, setSlashActions, slashCandidates } from "./modules/pi/slash";
import { seedSession, sessions, setModelTransport, setSessionTransport, viewFor } from "./modules/pi/sessions";

// §2.2-11a: one test per mapping. The table in `slash.ts` decides local /
// prompt / unsupported; the engine legs (`session.setThinking`,
// `session.compact`) are wired commands, checked through the transport.

function seedActive(): string {
  seedSession("s1", [{ role: "assistant", text: "body" }], {
    path: "/tmp/slash.jsonl",
    name: "Slash",
    loaded: true,
    thinkingLevel: "off",
  });
  setSessionTransport(async (type: string, payload: any = {}) => {
    switch (type) {
      case "session.setThinking":
        return { thinkingLevel: payload.level };
      case "session.compact":
        return { started: true };
      case "session.prompt":
        return { accepted: true };
      default:
        throw new Error(`slash fixture transport: ${type}`);
    }
  });
  setModelTransport(async () => {
    throw new Error("no model reads here");
  });
  return "s1";
}

test("the popup lists the local commands filtered by the draft", () => {
  const names = slashCandidates("").map((command) => command.name);
  expect(names).toEqual(["model", "thinking", "compact", "clear", "new", "resume"]);
  expect(slashCandidates("/co").map((command) => command.name)).toEqual(["compact"]);
});

test("/model asks the composer to open the model menu", () => {
  const id = seedActive();
  expect(openModelMenuRequest()).toBeNull();
  runSlash(id, "/model");
  expect(openModelMenuRequest()).toBe("s1");
});

test("/thinking cycles to the next level through the engine", async () => {
  const id = seedActive();
  expect(viewFor(id)?.thinkingLevel).toBe("off");
  await runSlash(id, "/thinking");
  expect(viewFor(id)?.thinkingLevel).toBe("minimal");
  // From the top of the ladder it wraps back to off.
  for (let i = 0; i < 6; i++) await runSlash(id, "/thinking");
  expect(viewFor(id)?.thinkingLevel).toBe("off");
});

test("/compact starts a manual compaction", () => {
  const id = seedActive();
  const prompts: any[] = [];
  setSessionTransport(async (type: string, payload: any = {}) => {
    prompts.push({ type, payload });
    if (type === "session.compact") return { started: true };
    throw new Error(`unexpected ${type}`);
  });
  runSlash(id, "/compact");
  expect(prompts.some((row) => row.type === "session.compact" && row.payload.sessionId === id)).toBe(true);
});

test("/clear empties the local view and keeps the session's file", () => {
  const id = seedActive();
  expect(viewFor(id)?.messages.length).toBeGreaterThan(0);
  runSlash(id, "/clear");
  expect(viewFor(id)?.messages.length).toBe(0);
  // The file path stays: the next open rehydrates the history.
  expect(viewFor(id)?.path).toBe("/tmp/slash.jsonl");
});

test("/new opens the scratch Hero", async () => {
  seedActive();
  let rows: any[] = [];
  setContainerTransport(async (type: string) => {
    if (type === "container.list") return { containers: rows, activeContainerId: null };
    throw new Error(`unexpected ${type}`);
  });
  containers.set([]);
  membership.set({});
  projects.set([]);
  await runSlash("s1", "/new");
  expect(activeContainerIdScratch()).toBe(true);
});

function activeContainerIdScratch(): boolean {
  return containerActiveIsNull();
}

import { activeContainerId } from "./core/containers";
function containerActiveIsNull(): boolean {
  return activeContainerId() === null;
}

test("/resume asks the shell to open the sidebar's search", () => {
  seedActive();
  let opened = "";
  setSlashActions({ openSidebarSearch: () => (opened = "search") });
  runSlash("s1", "/resume");
  expect(opened).toBe("search");
});

test("pi's interactive commands answer with a reason, not a send", () => {
  const id = seedActive();
  const prompts: any[] = [];
  setSessionTransport(async (type) => {
    prompts.push(type);
    throw new Error(`unexpected ${type}`);
  });
  for (const name of ["help", "login", "quit", "settings", "export"]) {
    void runSlash(id, `/${name}`);
    void 0;
  }
  // The transport saw no prompt at all: these are refused, not forwarded.
  expect(prompts).toEqual([]);
  expect(runSlash(id, "/quit")).resolves.toEqual({ kind: "unsupported", name: "quit" });
  expect(prompts).toEqual([]);
  expect(prompts).toEqual([]);
});

test("anything else is pi's own command: sent verbatim through the prompt", async () => {
  const id = seedActive();
  const sent: string[] = [];
  setSessionTransport(async (type: string, payload: any = {}) => {
    if (type === "session.prompt") {
      sent.push(payload.text);
      return { accepted: true };
    }
    throw new Error(`unexpected ${type}`);
  });
  expect(await runSlash(id, "/review the diff")).toEqual({ kind: "prompt" });
  expect(sent).toEqual(["/review the diff"]);
  // A fresh session: the first prompt's optimistic streaming flag would
  // route the second into the followUp lane.
  // The optimistic prompt leaves the view streaming; seed it back to idle,
  // or the second command routes into the followUp lane.
  seedSession("s1", [], { path: "/tmp/slash.jsonl", name: "Slash", loaded: true, streaming: false });
  await runSlash("s1", "/deploy:2 now");
  await sleep(10);
  expect(sent).toEqual(["/review the diff", "/deploy:2 now"]);
});
