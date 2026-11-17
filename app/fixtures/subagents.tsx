import { mount, View } from "nsh";
import { Workbench } from "../shell/shell";
import { activeContainerId, containers, layout, setContainerTransport, sheetOrder, syncVisible } from "../core/containers";
import { openSubagents, setSubagentTransport } from "../modules/pi/subagents";
import { assistantEntry } from "../modules/pi/transcript";
import { seedSession } from "../modules/pi/sessions";
import { defaultLayoutForSheets } from "../core/dock";
import { registerAllModules } from "../modules/register-all";

registerAllModules();

seedSession("s1", [assistantEntry("fx-assistant", "captain body")], {
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
layout.set(defaultLayoutForSheets(["session:s1"]));
sheetOrder.set({ c1: ["session:s1"] });
syncVisible();

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

// The titlebar no longer carries a roster entry: the app opens it when a
// run starts (`subagent.started`). The fixture needs a way in, so it draws
// its own control over the workbench.
function Fixture() {
  return (
    <View style={{ flex: 1 }}>
      <Workbench />
      <View
        role="button"
        testID="fixture-open-roster"
        accessibilityLabel="Open the roster"
        style={{ position: "absolute", right: 6, bottom: 6, width: 44, height: 44, zIndex: 10, backgroundColor: "#ff0000" }}
        onPress={() => void openSubagents()}
      />
    </View>
  );
}

mount(Fixture);
