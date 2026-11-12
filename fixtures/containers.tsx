import { mount } from "nsh";
import { Workbench } from "../shell";
import { containerError, loadContainers, setContainerTransport } from "../stores/containers";
import { phase } from "../stores/engine";
import { error as sessionError } from "../stores/sessions";
import { seedSession } from "../stores/sessions";

/**
 * Two containers without an engine: the container store talks to an
 * in-memory transport that implements the same commands as `contracts/` and
 * stores layouts by container id. It exercises switching, per-container
 * layouts, sheet throttling and archive in the real DockArea.
 */

seedSession("s1", [{ role: "assistant", text: "alpha body" }], {
  path: "/tmp/alpha.jsonl",
  name: "Alpha",
  loaded: true,
});
seedSession("s2", [{ role: "assistant", text: "beta body" }], {
  path: "/tmp/beta.jsonl",
  name: "Beta",
  loaded: true,
});
seedSession("s3", [{ role: "assistant", text: "gamma body" }], {
  path: "/tmp/gamma.jsonl",
  name: "Gamma",
  loaded: true,
});

const records = [
  {
    id: "c1",
    kind: "Pi",
    cwd: "/tmp/alpha",
    archived: false,
    createdAt: 1,
    updatedAt: 2,
    sessions: [{ sessionId: "s1", path: "/tmp/alpha.jsonl", name: "Alpha" }, { sessionId: "s3", path: "/tmp/gamma.jsonl", name: "Gamma" }],
  },
  {
    id: "c3",
    kind: "Pi",
    cwd: "/tmp/zoom",
    archived: false,
    createdAt: 1,
    updatedAt: 0,
    sessions: [{ sessionId: "s3", path: "/tmp/gamma.jsonl", name: "Gamma" }, { sessionId: "s1", path: "/tmp/alpha.jsonl", name: "Alpha" }],
  },
  {
    id: "c2",
    kind: "Pi",
    cwd: "/tmp/beta",
    archived: false,
    createdAt: 1,
    updatedAt: 1,
    sessions: [{ sessionId: "s2", path: "/tmp/beta.jsonl", name: "Beta" }],
  },
] as any[];

const layouts: Record<string, { layout: any; zoom: string | null }> = {
  c1: {
    layout: {
      center: {
        type: "tabs",
        panels: ["session:s1", "session:s3"],
        activeIndex: 0,
      },
    },
    zoom: null,
  },
  c2: {
    layout: { center: { type: "tabs", panels: ["session:s2"], activeIndex: 0 } },
    zoom: null,
  },
  c3: {
    layout: {
      center: {
        type: "split",
        axis: "horizontal",
        children: [
          { type: "tabs", panels: ["session:s1"], activeIndex: 0 },
          { type: "tabs", panels: ["session:s3"], activeIndex: 0 },
        ],
      },
    },
    zoom: "session:s3",
  },
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

setContainerTransport(transport);
void loadContainers().then(() => {
  // No engine in this fixture: the shell's status line is the only piece
  // that would otherwise show "connecting"/"offline".
  phase.set("connected");
  sessionError.set(null);
  containerError.set(null);
  mount(Workbench);
});
