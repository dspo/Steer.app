import { mount, Text, View } from "nsh";
import { Workbench } from "../shell/shell";
import {
  activeContainerId,
  containerError,
  layout,
  loadContainers,
  openHomeSheet,
  setContainerTransport,
} from "../core/containers";
import { error as sessionError } from "../modules/pi/sessions";
import {
  applyBrowserNavigation,
  browserPage,
  logBrowserMessage,
  reportBrowserError,
} from "../modules/browser/store";
import { panelIds, visiblePanels } from "../core/dock";
import { registerAllModules } from "../modules/register-all";

registerAllModules();

/**
 * The M10 browser fixture: the real `Workbench` around one container. The
 * top bar opens browser sheets; the buttons below it feed the same reducers
 * the `WebView` events feed, so a headless run (which draws no web view) can
 * still assert the tab title, the enabled history buttons, the error code and
 * the page-message log. The two debug lines show the browser store and the
 * transport calls, so a wait never depends on the shell's language.
 *
 * Nothing here mocks a page: a real page loads only on a real target
 * (`--target macos`), where the browser spec's live test runs.
 */

const CONTAINER = "pi:browser-fixture";
const OTHER_CONTAINER = "pi:browser-fixture-2";

const records = [
  {
    id: CONTAINER,
    kind: "Pi",
    cwd: "/tmp/zu-browser",
    archived: false,
    createdAt: 1,
    updatedAt: 2,
    sessions: [],
  },
  {
    id: OTHER_CONTAINER,
    kind: "Pi",
    cwd: "/tmp/zu-browser-2",
    archived: false,
    createdAt: 1,
    updatedAt: 1,
    sessions: [],
  },
] as any[];

const layouts: Record<string, { layout: any; zoom: string | null }> = {
  [CONTAINER]: {
    layout: { center: { type: "tabs", panels: [], activeIndex: 0 } },
    zoom: null,
  },
  [OTHER_CONTAINER]: {
    layout: { center: { type: "tabs", panels: [], activeIndex: 0 } },
    zoom: null,
  },
};

const calls: string[] = [];

async function transport(type: string, payload: any = {}): Promise<any> {
  calls.push(type);
  switch (type) {
    case "container.list":
      return { containers: records, activeContainerId: CONTAINER };
    case "container.show":
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
  activeContainerId.set(CONTAINER);
  sessionError.set(null);
  containerError.set(null);
  mount(BrowserFixture);
});

/** The browser sheet on screen, else the first one in the layout. */
function activeBrowserId(): string | null {
  const shown = visiblePanels().find((id) => id.startsWith("webview:"));
  if (shown) return shown;
  return panelIds(layout()).find((id) => id.startsWith("webview:")) ?? null;
}

function seedNavigation(): void {
  const id = activeBrowserId();
  if (!id) return;
  applyBrowserNavigation(id, {
    url: "https://example.com/",
    title: "Example Domain",
    loading: false,
    canGoBack: true,
    canGoForward: false,
  });
}

function seedError(): void {
  const id = activeBrowserId();
  if (!id) return;
  reportBrowserError(id, {
    code: "ERR_ACCESS_DENIED",
    message: "navigation to https://private.example/ is not granted",
  });
}

function seedMessage(): void {
  const id = activeBrowserId();
  if (!id) return;
  logBrowserMessage(id, '{"type":"hello","text":"hello from the page"}');
}

function FixtureButton(props: { id: string; label: string; onPress: () => void }) {
  return (
    <View
      role="button"
      testID={props.id}
      accessibilityLabel={props.label}
      class="h-5 items-center justify-center rounded-md border border-line px-2 hover:bg-hover active:opacity-60 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
      onPress={props.onPress}
    >
      <Text class="text-[10px] text-foreground">{props.label}</Text>
    </View>
  );
}

function browserDebug(): string {
  const ids = panelIds(layout()).filter((id) => id.startsWith("webview:"));
  return ids
    .map((id) => {
      const page = browserPage(id);
      return [
        id,
        page.url ?? "-",
        page.title || "-",
        page.loading ? "loading" : "idle",
        `${page.canGoBack ? "b" : "-"}${page.canGoForward ? "f" : "-"}`,
        page.error?.code ?? "-",
        page.messages.length,
      ].join("|");
    })
    .join(" ");
}

function BrowserFixture() {
  return (
    <View class="flex-1 bg-background" style={{ flexDirection: "column" }}>
      <Workbench />
      <View class="flex-row items-center gap-1.5 px-3" style={{ height: 24 }}>
        <FixtureButton id="open-hero" label="hero" onPress={() => openHomeSheet()} />
        <FixtureButton id="seed-nav" label="seed nav" onPress={seedNavigation} />
        <FixtureButton id="seed-error" label="seed error" onPress={seedError} />
        <FixtureButton id="seed-message" label="seed message" onPress={seedMessage} />
      </View>
      <Text testID="fixture-browser" class="px-3 text-[9.5px] font-mono text-faint">
        {browserDebug()}
      </Text>
      <Text testID="fixture-calls" class="px-3 text-[9.5px] font-mono text-faint">
        calls: {calls.join(",")}
      </Text>
    </View>
  );
}
