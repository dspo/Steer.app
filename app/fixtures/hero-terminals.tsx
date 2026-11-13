import { mount, Text, View } from "nsh";
import { Workbench } from "../shell/shell";
import {
  containers,
  containerError,
  layout,
  loadContainers,
  setContainerTransport,
} from "../core/containers";
import { error as sessionError, seedSession } from "../modules/pi/sessions";
import { terminalInfo } from "../domains/pty";
import { sheetOrder } from "../core/containers";
import { registerAllModules } from "../modules/register-all";

registerAllModules();

/**
 * §2.1.1 F2: a Pi container's Hero opens terminals *of that container*.
 * One container, one captain session, the Hero as the only sheet; the
 * Hero's Terminal and Claude actions become two terminal sheets of `c1`, and
 * archiving the container ends both PTYs. The probe row reads the store, so
 * the test sees sheet ids and live PTYs, not just what a tab drew.
 */

seedSession("s1", [{ role: "assistant", text: "captain body" }], {
  path: "/tmp/zu-hero-terminals.jsonl",
  name: "Captain",
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
    sessions: [{ sessionId: "s1", path: "/tmp/zu-hero-terminals.jsonl", name: "Captain" }],
  },
] as any[];

const layouts: Record<string, { layout: any; zoom: string | null }> = {
  c1: { layout: { center: { type: "tabs", panels: ["home:c1"], activeIndex: 0 } }, zoom: null },
};

let active = "c1";

async function transport(type: string, payload: any = {}): Promise<any> {
  switch (type) {
    case "container.list":
      return { containers: records, activeContainerId: active };
    case "container.show": {
      active = payload.containerId;
      return { container: records.find((row) => row.id === payload.containerId) };
    }
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
      return { containers: records, activeContainerId: active };
    }
    default:
      throw new Error(`fixture transport: ${type}`);
  }
}

/** The store read out loud: the canvas's sheets, the rows and the PTYs. */
function Probe() {
  const panels = () => {
    const ids: string[] = [];
    const walk = (node: any): void => {
      if (node.type === "tabs") ids.push(...node.panels);
      else node.children.forEach(walk);
    };
    walk(layout().center);
    return ids.join(",");
  };
  const live = () => containers().filter((row) => !row.archived).length;
  return (
    <Text testID="fixture-state" class="text-[10px] font-mono text-foreground">
      {`panels=${panels()} containers=${live()} pty=${Object.keys(terminalInfo()).length} keys=${Object.keys(terminalInfo()).join("+")}`}
    </Text>
  );
}

sheetOrder.set({ c1: ["session:s1", "home:c1"] });
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
