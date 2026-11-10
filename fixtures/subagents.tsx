import { mount } from "nsh";
import { Workbench } from "../shell";
import { activeContainerId, containers, layout, setContainerTransport, syncVisible } from "../containers";
import { setSubagentTransport } from "../subagents";
import { seedSession } from "../sessions";
import { defaultLayoutForSessions } from "../dock";
import { phase } from "../engine";

seedSession("s1", [{ role: "assistant", text: "captain body" }], {
  path: "/tmp/captain.jsonl",
  name: "Captain",
  loaded: true,
});
containers.set([
  {
    id: "c1",
    kind: "Pi",
    cwd: "/tmp",
    archived: false,
    createdAt: 1,
    updatedAt: 1,
    sessions: [{ sessionId: "s1", path: "/tmp/captain.jsonl", name: "Captain" }],
  },
] as any);
activeContainerId.set("c1");
layout.set(defaultLayoutForSessions(["s1"]));
syncVisible();
phase.set("connected");

const runs = [
  {
    runId: "r1",
    captainId: "s1",
    containerId: "c1",
    agent: "worker",
    task: "implement the thing",
    status: "settled",
    startedAt: 1,
    settledAt: 2,
    verdict: "completed",
    output: "sub output",
  },
  {
    runId: "r2",
    captainId: "s1",
    containerId: "c1",
    agent: "scout",
    task: "find the code",
    status: "running",
    startedAt: 3,
  },
];

setSubagentTransport(async (type, payload: any = {}) => {
  switch (type) {
    case "subagent.list":
      return { runs };
    case "subagent.transcript":
      return {
        run: runs.find((run) => run.runId === payload.runId),
        messages: [
          { role: "user", text: "implement the thing" },
          { role: "assistant", text: "sub output" },
        ],
      };
    case "subagent.abort":
      return {};
    default:
      throw new Error(`subagent fixture: ${type}`);
  }
});
setContainerTransport(async (type: string, payload: any = {}) => {
  switch (type) {
    case "layout.put":
      return { containerId: payload.containerId, layout: payload.layout, zoom: payload.zoom };
    default:
      throw new Error(`subagent fixture container: ${type}`);
  }
});

mount(Workbench);
