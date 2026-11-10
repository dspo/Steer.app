import { mount, Text, View } from "nsh";
import { Workbench } from "../shell";
import {
  activeContainerId,
  containerError,
  layout,
  loadContainers,
  setContainerTransport,
} from "../containers";
import { editorDocs } from "../editors";
import { phase } from "../engine";
import { error as sessionError } from "../sessions";
import { baseName } from "../fs";
import { GIT_CONTAINER, GIT_ROOT } from "./m9-paths";

// The M9 acceptance fixture: the real `Workbench` (its top bar is the entry
// the acceptance names) around one container whose cwd is a real repository.
// The test makes the repository through `zu/git` and reads it back the same
// way; nothing here is a mock of status, diff or log.
//
// The starting sheet is the file tree so the canvas has a real sheet before
// the test presses `open-changes` / `open-history`; the two debug lines show
// the editor store's documents (their text included) and the current panel
// ids, so a wait does not depend on the shell's language.

const records = [
  {
    id: GIT_CONTAINER,
    kind: "Pi",
    cwd: GIT_ROOT,
    archived: false,
    createdAt: 1,
    updatedAt: 1,
    sessions: [],
  },
] as any[];

const layouts: Record<string, { layout: any; zoom: string | null }> = {
  [GIT_CONTAINER]: {
    layout: {
      center: { type: "tabs", panels: [`files:${GIT_CONTAINER}`], activeIndex: 0 },
    },
    zoom: null,
  },
};

let active: string | null = GIT_CONTAINER;

async function transport(type: string, payload: any = {}): Promise<any> {
  switch (type) {
    case "container.list":
      return { containers: records, activeContainerId: active };
    case "container.show":
      active = payload.containerId;
      return { container: records.find((row) => row.id === payload.containerId) };
    case "layout.get":
      return {
        containerId: payload.containerId,
        ...(layouts[payload.containerId] ?? { layout: null, zoom: null }),
      };
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

void loadContainers().then(() => {
  activeContainerId.set(GIT_CONTAINER);
  phase.set("connected");
  sessionError.set(null);
  containerError.set(null);
  mount(GitFixture);
});

function GitFixture() {
  return (
    <View class="flex-1 bg-background" style={{ flexDirection: "column" }}>
      <Workbench />
      <Text testID="fixture-panels" class="text-[10px] font-mono text-faint">
        {panelIds().join("|")}
      </Text>
      <Text testID="fixture-docs" class="text-[10px] font-mono text-faint">
        {Object.values(editorDocs())
          .map((doc) => `${baseName(doc.path)}:${doc.status}:${doc.text.trim()}`)
          .join("|")}
      </Text>
    </View>
  );
}

/** The panels the current layout holds, in order. */
function panelIds(): string[] {
  const ids: string[] = [];
  const collect = (node: any): void => {
    if (!node) return;
    if (node.type === "tabs") ids.push(...node.panels);
    else node.children.forEach(collect);
  };
  collect(layout().center);
  return ids;
}
