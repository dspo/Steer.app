import { mount, Text, View } from "nsh";
import { Workbench } from "../shell/shell";
import { activeContainerId, containers, layout, setContainerTransport, sheetOrder, syncVisible } from "../core/containers";
import { setPlanTransport } from "../modules/pi/todos";
import { assistantEntry } from "../modules/pi/transcript";
import { seedSession } from "../modules/pi/sessions";
import { defaultLayoutForSheets } from "../core/dock";
import { registerAllModules } from "../modules/register-all";
import type { PlanFile } from "../modules/pi/protocol";

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
    cwd: "/tmp/plan-demo",
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

/** The plan the fake harness holds. The transport applies the panel's ops
 * the way the store would (the subset the tests exercise) and answers with
 * the new plan, so every op has a visible effect. */
let currentPlan: PlanFile = {
  v: 1,
  todos: [
    { id: "t-1", title: "Sketch the exporter", status: "pending", origin: "agent" },
    { id: "t-2", title: "user note", status: "pending", origin: "user" },
  ],
  groups: [
    {
      id: "g-1",
      title: "Ship the exporter",
      todos: [
        { id: "t-3", title: "Write the module", status: "in_progress", origin: "agent" },
        { id: "t-4", title: "Review with the user", status: "pending", origin: "agent" },
      ],
    },
  ],
};

/** What the agent left behind: the lane gone, one step done, its own step
 * started. Only a poll can see this swap. */
const agentPlan: PlanFile = {
  v: 1,
  todos: [],
  groups: [
    {
      id: "g-1",
      title: "Ship the exporter",
      todos: [
        { id: "t-3", title: "Write the module", status: "done", origin: "agent" },
        { id: "t-9", title: "Deployed from the agent", status: "in_progress", origin: "agent" },
      ],
    },
  ],
};

/** Everything done: the banner must disappear (no entry, by design). */
const finishedPlan: PlanFile = {
  v: 1,
  todos: [],
  groups: [
    {
      id: "g-1",
      title: "Ship the exporter",
      todos: [
        { id: "t-3", title: "Write the module", status: "done", origin: "agent" },
        { id: "t-9", title: "Deployed from the agent", status: "done", origin: "agent" },
      ],
    },
  ],
};

function applyOp(op: any): void {
  if (op.kind === "add") {
    currentPlan = {
      ...currentPlan,
      todos: [...currentPlan.todos, { id: "t-9", title: op.title, status: "pending", origin: op.origin ?? "user" }],
    };
  } else if (op.kind === "update") {
    const patch = (todo: any) => (todo.id === op.id ? { ...todo, status: op.status ?? todo.status } : todo);
    currentPlan = {
      ...currentPlan,
      todos: currentPlan.todos.map(patch),
      groups: currentPlan.groups.map((group) => ({ ...group, todos: group.todos.map(patch) })),
    };
  } else if (op.kind === "remove") {
    currentPlan = {
      ...currentPlan,
      todos: currentPlan.todos.filter((todo) => todo.id !== op.id),
      groups: currentPlan.groups
        .map((group) => ({ ...group, todos: group.todos.filter((todo) => todo.id !== op.id) }))
        .filter((group) => group.todos.length > 0),
    };
  } else if (op.kind === "promote") {
    const draft = currentPlan.todos.find((todo) => todo.id === op.id);
    if (!draft) return;
    currentPlan = {
      ...currentPlan,
      todos: currentPlan.todos.filter((todo) => todo.id !== op.id),
      groups: [...currentPlan.groups, { id: "g-9", title: draft.title, todos: [draft] }],
    };
  }
}

setPlanTransport(async (type, payload: any = {}) => {
  switch (type) {
    case "plan.list":
      return { enabled: true, plan: currentPlan };
    case "plan.write": {
      applyOp(payload.op);
      return { plan: currentPlan };
    }
    default:
      throw new Error(`plan fixture: ${type}`);
  }
});
setContainerTransport(async (type: string, payload: any = {}) => {
  switch (type) {
    case "layout.put":
      return { containerId: payload.containerId, layout: payload.layout, zoom: payload.zoom };
    default:
      throw new Error(`plan fixture container: ${type}`);
  }
});

/** The fixture's control over the workbench: the agent-side plan swaps only
 * a poll can notice, and the all-done swap the banner must disappear on. */
function Fixture() {
  return (
    <View style={{ flex: 1 }}>
      <Workbench />
      <View
        role="button"
        testID="fixture-flip-plan"
        style={{ position: "absolute", bottom: 40, left: 8, backgroundColor: "#eee", padding: 6, zIndex: 10 }}
        onPress={() => {
          currentPlan = agentPlan;
        }}
      >
        <Text>agent rewrote the plan</Text>
      </View>
      <View
        role="button"
        testID="fixture-finish-plan"
        style={{ position: "absolute", bottom: 8, left: 8, backgroundColor: "#eee", padding: 6, zIndex: 10 }}
        onPress={() => {
          currentPlan = finishedPlan;
        }}
      >
        <Text>agent finished the plan</Text>
      </View>
    </View>
  );
}

mount(Fixture);
