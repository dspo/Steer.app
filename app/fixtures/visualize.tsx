import { mount, signal, Text, View } from "nsh";
import { activeContainerId, containers } from "../core/containers";
import { visiblePanels } from "../core/dock";
import { registerModule } from "../core/registry";
import { seedSession } from "../modules/pi/sessions";
import { SessionBody } from "../modules/pi/view";
import { toolEntry, userEntry } from "../modules/pi/transcript";
import { VisualizeCard } from "../modules/pi/visualize-card";
import { registerToolCard } from "../modules/pi/tool-cards";

/** A3's card fixture: intents are recorded so UI tests assert the payload. */
const calls = signal<Array<{ name: string; payload: any }>>([]);
(globalThis as any).__visualizeCalls = calls;

registerModule({
  id: "visualize-fixture-files",
  capabilities: [],
  kinds: [],
  intents: {
    "editor.open": (payload) => {
      calls.set([...calls(), { name: "editor.open", payload }]);
      return "editor:fixture";
    },
    "diff.open": (payload) => {
      calls.set([...calls(), { name: "diff.open", payload }]);
      return "diff:fixture";
    },
  },
});
registerModule({
  id: "visualize-fixture-browser",
  capabilities: [],
  kinds: [],
  intents: {
    "browser.open": (payload) => {
      calls.set([...calls(), { name: "browser.open", payload }]);
      return "webview:fixture";
    },
  },
});

registerToolCard("visualize", ({ details, entryId }) => (
  <VisualizeCard details={details} id={entryId ? `visualize-${entryId}` : undefined} />
));
containers.set([{ id: "cont-a", cwd: "/tmp/zu", archived: false, createdAt: 0, updatedAt: 0 }]);
activeContainerId.set("cont-a");

seedSession(
  "visualize",
  [
    userEntry("u1", "show the mockup"),
    toolEntry("t1", "visualize", "completed", {
      name: "visualize",
      toolKind: "other",
      meta: {
        details: {
          kind: "file",
          path: ".zu/artifacts/mockup.html",
          caption: "home page",
        },
      },
    }),
    toolEntry("t2", "visualize", "completed", {
      name: "visualize",
      toolKind: "other",
      meta: {
        details: {
          kind: "file",
          path: "docs/report.md",
          before: "docs/report.before.md",
        },
      },
    }),
  ],
  { path: "/tmp/zu-visualize.jsonl", cwd: "/tmp/zu" },
);
visiblePanels.set(["session:visualize"]);

mount(() => (
  <View class="flex-1" style={{ height: "100%" }}>
    <Text testID="debug-calls">{`calls:${JSON.stringify(calls())}`}</Text>
    <SessionBody id="visualize" sheetId="session:visualize" />
  </View>
));
