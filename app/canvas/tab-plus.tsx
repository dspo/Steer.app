import { token, View } from "nsh";
import type { DockAreaLayout } from "../core/dock";
import { tabBarBoxes } from "../core/projection";
import { K, t } from "../ui/i18n";
import { Glyph, motionStyle } from "../ui/ui";

/**
 * The `+` at the right edge of every tab bar: it opens the canvas's Hero
 * sheet in that group. `DockArea` (nsh 0.4.0) renders tabs and nothing after
 * them, so the button is an overlay the shell places over each group's bar.
 * Its geometry is the projection's (`core/projection.ts`).
 *
 * The shell opens no docks; a layout with one would put the center's boxes
 * beside the dock, which this does not model, so it draws no `+` there
 * rather than a wrong one.
 */

/**
 * The overlay: one ghost `+` in each group's bar, at its right edge. The
 * shell reserves that strip with the bar's own trailing padding so a tab
 * never sits under it.
 */
export function TabBarPlus(props: {
  layout: DockAreaLayout;
  width: number;
  height: number;
  zoomed: string | null;
  onOpen: (anchor: string) => void;
}) {
  const boxes = () => tabBarBoxes(props.layout, props.width, props.height, props.zoomed);
  return (
    <View class="absolute inset-0" style={{ pointerEvents: "box-none" }}>
      <Each of={boxes()} key={(box) => box.key}>
        {(box) => (
          <View
            role="button"
            testID={`tab-plus-${box().key}`}
            accessibilityLabel={t(K.canvas.openHero)}
            tooltip={t(K.canvas.openHero)}
            class="items-center justify-center rounded-md hover:bg-hover active:opacity-60 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
            style={{
              position: "absolute",
              left: box().x + box().width - 26,
              top: box().y + 7,
              width: 20,
              height: 20,
              ...motionStyle("fast"),
            }}
            onPress={() => props.onOpen(box().anchor)}
          >
            <Glyph name="plus" size={11} tint={token("muted-foreground")} />
          </View>
        )}
      </Each>
    </View>
  );
}
