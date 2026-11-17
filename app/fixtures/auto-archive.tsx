import { mount, Text, View } from "nsh";
import { Workbench } from "../shell/shell";
import {
  activeContainerId,
  containerError,
  layout,
  loadContainers,
  setContainerTransport,
} from "../core/containers";
import { panelIds } from "../core/dock";
import { error as sessionError, seedSession } from "../modules/pi/sessions";
import { assistantEntry } from "../modules/pi/transcript";
import { registerAllModules } from "../modules/register-all";

registerAllModules();

/**
 * Q69's own fixture: one Pi container whose canvas is a session and its
 * Hero. Closing both sheets leaves it nothing, and the fixture reads the
 * store, so the test sees the archive call, the rows and the exit wrapper.
 */

seedSession("s1", [assistantEntry("fx-assistant", "only body")], {
  path: "/tmp/zu-auto-archive.jsonl",
  name: "Only",
  loaded: true,
});

const records = [
  {
    id: "c1",
    kind: "Pi",
    cwd: "/tmp",
    archived: false,
    createdAt: 1,
    updatedAt: 1,
    sessions: [{ sessionId: "s1", path: "/tmp/zu-auto-archive.jsonl", name: "Only" }],
  },
] as any[];

const layouts: Record<string, { layout: any; zoom: string | null }> = {
  c1: {
    layout: { center: { type: "tabs", panels: ["session:s1", "home:c1"], activeIndex: 0 } },
    zoom: null,
  },
};

let active = "c1";
const calls: string[] = [];

async function transport(type: string, payload: any = {}): Promise<any> {
  calls.push(`${type}:${payload.containerId ?? ""}`);
  switch (type) {
    case "container.list":
      return { containers: [...records], activeContainerId: active };
    case "container.show":
      active = payload.containerId;
      return { container: records.find((row) => row.id === payload.containerId) };
    case "layout.get":
      return { containerId: payload.containerId, ...(layouts[payload.containerId] ?? { layout: null, zoom: null }) };
    case "layout.put":
      layouts[payload.containerId] = { layout: payload.layout, zoom: payload.zoom };
      return { containerId: payload.containerId, ...layouts[payload.containerId] };
    case "container.archive": {
      const target = records.find((row) => row.id === payload.containerId);
      if (target) target.archived = true;
      const next = records.find((row) => !row.archived);
      if (active === payload.containerId) active = next?.id ?? null;
      // A fresh array: the store's signal must see the removal.
      return { containers: [...records], activeContainerId: active };
    }
    default:
      throw new Error(`auto-archive fixture transport: ${type}`);
  }
}

function Probe() {
  return (
    <Text testID="fixture-state" class="text-[10px] font-mono text-foreground">
      {`panels=${panelIds(layout()).join(",")} active=${activeContainerId() ?? "scratch"} rows=${records
        .filter((row) => !row.archived)
        .length} calls=${calls.join(",")}`}
    </Text>
  );
}

setContainerTransport(transport);
void loadContainers().then(() => {
  sessionError.set(null);
  containerError.set(null);
  mount(() => (
    <View class="flex-1" style={{ flexDirection: "column", minHeight: 0 }}>
      <Probe />
      <View class="flex-1" style={{ minHeight: 0 }}>
        <Workbench />
      </View>
    </View>
  ));
});
