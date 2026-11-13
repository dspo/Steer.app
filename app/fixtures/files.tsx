import { keymap, mount, Text, View } from "nsh";
import { DockArea } from "nsh/base";
import {
  activeContainerId,
  containers,
  layout,
  setContainerTransport,
  setLayout,
} from "../core/containers";
import { panelIds, visiblePanels } from "../core/dock";
import { editorDocs, saveActiveEditor } from "../modules/files/editors";
import { SheetBody } from "../canvas/sheets";
import { registerAllModules } from "../modules/register-all";
import { M8_ROOT } from "./m8-paths";

// A headless acceptance fixture for M8: one Pi container whose cwd is a real
// /tmp directory, its file tree as the starting sheet, and the real DockArea
// so opening an editor or a diff appends a real sheet to the canvas. The
// tests seed and read the files through `zu/fs`; nothing here is a mock.

const CONTAINER = "pi:fixture-m8";

// The canvas is not connected to an engine: layout saves are accepted and
// dropped, while the sheet registry and the stores are the app's own.
registerAllModules();
setContainerTransport(async () => ({}));

containers.set([
  {
    id: CONTAINER,
    cwd: M8_ROOT,
    archived: false,
    createdAt: 0,
    updatedAt: 0,
  },
]);
activeContainerId.set(CONTAINER);
layout.set({
  center: { type: "tabs", panels: [`files:${CONTAINER}`], activeIndex: 0 },
});
visiblePanels.set([`files:${CONTAINER}`]);

// The app binds Mod+S in its workbench; the fixture is only the canvas.
keymap.bind("mod+s", () => saveActiveEditor());

function FilesFixture() {
  return (
    <View class="flex-1 bg-background" style={{ flexDirection: "column" }}>
      <DockArea
        class="flex-1"
        layout={layout()}
        renderPanel={(panel) => <SheetBody id={panel.id} />}
        onLayoutChange={({ layout: next }) => setLayout(next)}
        groupClass="flex-1 bg-background"
        tabBarClass="flex-row items-end gap-0.5 border-b border-line bg-inset px-2"
        tabBarStyle={{ height: 34 }}
        contentClass="flex-1 bg-background"
        handleClass="basis-px bg-line"
      />
      <Text testID="fixture-panels" class="text-[10px] font-mono text-faint">
        {panelIds(layout()).join("|")}
      </Text>
      <Text testID="fixture-editors" class="text-[10px] font-mono text-faint">
        {Object.values(editorDocs())
          .map(
            (doc) =>
              `${doc.path.split("/").pop()}:${doc.status}:${doc.dirty ? "dirty" : "clean"}:${doc.readonly ? "ro" : "rw"}`,
          )
          .join("|")}
      </Text>
    </View>
  );
}

mount(FilesFixture);
