import { mount } from "nsh";
import { Workbench } from "../shell/shell";
import { containerError, loadContainers, setContainerTransport } from "../core/containers";
import { error as sessionError, setSessionTransport } from "../modules/pi/sessions";
import { registerAllModules } from "../modules/register-all";

/**
 * A container whose Hero has no session yet, with a session transport that
 * refuses to make one: the shell's start path fails where a missing pi
 * harness fails, without a harness and without an engine.
 */

registerAllModules();

const CONTAINER = "pi:hero-failure";
const HERO = `home:${CONTAINER}`;

const records = [
  {
    id: CONTAINER,
    kind: "Pi",
    cwd: "/tmp/zu-hero-failure",
    archived: false,
    createdAt: 1,
    updatedAt: 1,
    sessions: [],
  },
] as any[];

const layouts: Record<string, { layout: any; zoom: string | null }> = {
  [CONTAINER]: {
    layout: { center: { type: "tabs", panels: [HERO], activeIndex: 0 } },
    zoom: null,
  },
};

async function transport(type: string, payload: any = {}): Promise<any> {
  switch (type) {
    case "container.list":
      return { containers: records, activeContainerId: CONTAINER };
    case "container.show":
      return { container: records.find((row) => row.id === payload.containerId) };
    case "layout.get":
      return { containerId: payload.containerId, ...(layouts[payload.containerId] ?? { layout: null, zoom: null }) };
    case "layout.put":
      layouts[payload.containerId] = { layout: payload.layout, zoom: payload.zoom };
      return { containerId: payload.containerId, ...layouts[payload.containerId] };
    case "project.list":
      return { projects: [], membership: {} };
    default:
      throw new Error(`fixture transport: ${type}`);
  }
}

setContainerTransport(transport);
// A fixture transport takes the session commands off ACP, so a refused
// `session.create` is the same failure the harness being absent is.
setSessionTransport(async (type) => {
  if (type === "session.create") throw new Error("the pi harness was not found");
  throw new Error(`fixture session transport: ${type}`);
});

void loadContainers().then(() => {
  sessionError.set(null);
  containerError.set(null);
  mount(Workbench);
});
