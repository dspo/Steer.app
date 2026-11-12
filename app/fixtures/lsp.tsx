import { mount, signal, Text, View } from "nsh";
import { Workbench } from "../shell/shell";
import {
  activeContainerId,
  containerError,
  layout,
  loadContainers,
  setContainerTransport,
} from "../stores/containers";
import { editorDocs, editorSheetId } from "../stores/editors";
import { phase } from "../stores/engine";
import { error as sessionError } from "../stores/sessions";
import { baseName } from "../stores/fs";
import {
  diagnosticsFor,
  lastReveal,
  lspServers,
  problemsFor,
  setLspCommandResolver,
} from "../stores/lsp";
import { M11_UI_CONTAINER, M11_UI_ROOT, M11_UI_SERVER } from "./m11-paths";
import { HoverCard } from "../sheets/lsp-ui";

// The M11 UI acceptance fixture: the real `Workbench` around one container
// whose cwd is a real /tmp project. The language server is a **controlled
// child process** (`fixtures/m11-fake-lsp.ts`, written to /tmp by the test),
// not a mock inside the app: it is started through `zu/lsp`, speaks real
// `Content-Length` framing, and answers hover/definition/completion. The
// native test (`lsp.test.ts`) is the one that uses the real rust-analyzer.
//
// The debug lines expose the stores (server state, diagnostics, the last
// requested reveal) so a wait does not depend on a glyph or the language.

setLspCommandResolver((family) =>
  family === "rust" ? { command: "node", args: [M11_UI_SERVER] } : null,
);

const records = [
  {
    id: M11_UI_CONTAINER,
    kind: "Pi",
    cwd: M11_UI_ROOT,
    archived: false,
    createdAt: 1,
    updatedAt: 1,
    sessions: [],
  },
] as any[];

const mainPath = `${M11_UI_ROOT}/src/main.rs`;
const layouts: Record<string, { layout: any; zoom: string | null }> = {
  [M11_UI_CONTAINER]: {
    layout: {
      center: {
        type: "tabs",
        panels: [`files:${M11_UI_CONTAINER}`, editorSheetId(M11_UI_CONTAINER, mainPath)],
        activeIndex: 1,
      },
    },
    zoom: null,
  },
};

let active: string | null = M11_UI_CONTAINER;

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
  activeContainerId.set(M11_UI_CONTAINER);
  phase.set("connected");
  sessionError.set(null);
  containerError.set(null);
  mount(LspFixture);
});

const showHover = signal(false);

function LspFixture() {
  return (
    <View class="flex-1 bg-background" style={{ flexDirection: "column" }}>
      <Workbench />
      <Text testID="fixture-lsp" class="text-[10px] font-mono text-faint">
        {Object.values(lspServers())
          .map(
            (server) =>
              `${server.family}:${server.state}:${server.documents}:${server.pid ?? 0}:${server.error ?? ""}`,
          )
          .join("|")}
      </Text>
      <Text testID="fixture-docs" class="text-[10px] font-mono text-faint">
        {Object.values(editorDocs())
          .map((doc) => `${baseName(doc.path)}:${doc.status}`)
          .join("|")}
      </Text>
      <Text testID="fixture-diagnostics" class="text-[10px] font-mono text-faint">
        {Object.values(editorDocs())
          .map((doc) => {
            const path = doc.realPath || doc.path;
            return `${baseName(doc.path)}:${diagnosticsFor(M11_UI_CONTAINER, path).length}`;
          })
          .join("|")}
      </Text>
      <Text testID="fixture-problems" class="text-[10px] font-mono text-faint">
        {problemsFor(M11_UI_CONTAINER)
          .map((row) => `${row.severity}:${row.line}:${row.message}`)
          .join("|")}
      </Text>
      <View
        role="button"
        testID="fixture-hover"
        accessibilityLabel="show the controlled hover card"
        class="h-5 w-40 bg-inset"
        onPress={() => showHover.set(!showHover())}
      >
        <Text class="text-[10px] text-faint">hover card</Text>
      </View>
      <If when={showHover()}>
        <HoverCard
          markdown="### fake hover&#10;&#10;fake hover: fn main() -> ()"
          anchor={{ origin: { x: 320, y: 320 }, size: { width: 90, height: 18 } }}
          onClose={() => showHover.set(false)}
        />
      </If>
      <Text testID="fixture-reveal" class="text-[10px] font-mono text-faint">
        {lastReveal()
          ? `${lastReveal()!.sheetId}:${lastReveal()!.range.start.line}:${lastReveal()!.range.start.column}`
          : "none"}
      </Text>
    </View>
  );
}
