import { mount, signal, Text, View } from "nsh";
import { DockArea, type DockAreaLayout, type DockAreaRef } from "nsh/base";

/**
 * A sheet's state survives a move between panels: the panel is keyed by its
 * id, so `renderPanel` keeps the component instance when the tree changes.
 */
const layout = signal<DockAreaLayout>({
  center: { type: "tabs", panels: ["a", "b"], activeIndex: 0 },
});
let area: DockAreaRef | undefined;
const moved = signal("same group");

function Counter() {
  const taps = signal(0);
  return (
    <View
      role="button"
      testID="a-tap"
      accessibilityLabel="a tap"
      class="m-4 items-center rounded-md border border-line px-4 py-3"
      onPress={() => taps.set(taps() + 1)}
    >
      <Text class="text-foreground">{`a taps ${taps()}`}</Text>
    </View>
  );
}

async function splitB(): Promise<void> {
  if (!area) return;
  const group = await area.groupOf("a");
  if (group !== null) {
    area.splitAt(group, "b", "right");
    moved.set("split");
  }
}

async function mergeB(): Promise<void> {
  if (!area) return;
  const group = await area.groupOf("a");
  if (group !== null) {
    area.movePanel("b", { group });
    moved.set("merged");
  }
}

function App() {
  return (
    <View class="flex-1 bg-background" style={{ flexDirection: "column" }}>
      <View class="flex-row items-center gap-2 p-2">
        <View role="button" testID="split-b" accessibilityLabel="split b" class="rounded-md border border-line px-3 py-1" onPress={() => void splitB()}>
          <Text>split b</Text>
        </View>
        <View role="button" testID="merge-b" accessibilityLabel="merge b" class="rounded-md border border-line px-3 py-1" onPress={() => void mergeB()}>
          <Text>merge b</Text>
        </View>
        <Text class="text-muted-foreground">{moved()}</Text>
      </View>
      <DockArea
        ref={(ref) => (area = ref)}
        class="flex-1"
        layout={layout()}
        onLayoutChange={({ layout: next }) => layout.set(next)}
        groupClass="flex-1 border border-line"
        tabBarClass="flex-row border-b border-line"
        contentClass="flex-1"
        renderPanel={(panel) =>
          panel.id === "a" ? <Counter /> : <View class="p-4"><Text>{`panel ${panel.id}`}</Text></View>
        }
        renderTab={(tab) => <View class="px-3 py-2"><Text>{tab.panel}</Text></View>}
      />
    </View>
  );
}

mount(App);
