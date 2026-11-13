import { token, View } from "nsh";
import { activePanelIds, type DockAreaLayout, type DockNode } from "../core/dock";
import { K, t } from "../ui/i18n";
import { Glyph, motionStyle } from "../ui/ui";

/**
 * The `+` at the right edge of every tab bar: it opens the canvas's Hero
 * sheet in that group. `DockArea` (nsh 0.4.0) renders tabs and nothing after
 * them, so the button is an overlay the shell places over each group's bar.
 * Its geometry comes from the layout alone — splits put their children side
 * by side (or stacked), every slot but the last takes its recorded size, and
 * the last takes what is left — so it needs no measurement round trip.
 *
 * The shell opens no docks; a layout with one would put the center's boxes
 * beside the dock, which this does not model, so it draws no `+` there
 * rather than a wrong one.
 */

/** A visible tab group's tab bar, in the canvas's coordinates. */
export type TabBarBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  /** A panel of the group: the Hero opens beside it (any member works). */
  anchor: string;
  /** The group's first panel, so the box keeps its identity across switches. */
  key: string;
  /** The group's tabs, in order: the switcher shares the track by them. */
  panels: string[];
  /** Which of `panels` the group displays. */
  active: number;
};

/** nsh's split handle (`handleClass="basis-px"`). */
const HANDLE = 1;
/** nsh's compact threshold: below 600pt the area shows one group at a time. */
const COMPACT_WIDTH = 600;

function hasPanels(node: DockNode): boolean {
  return node.type === "tabs" ? node.panels.length > 0 : node.children.some(hasPanels);
}

type Rect = { x: number; y: number; width: number; height: number };

function walk(node: DockNode, rect: Rect, out: TabBarBox[]): void {
  if (!hasPanels(node)) return;
  if (node.type === "tabs") {
    out.push({
      ...rect,
      anchor: node.panels[0],
      key: node.panels[0],
      panels: [...node.panels],
      active: node.activeIndex ?? 0,
    });
    return;
  }
  const slots = node.children
    .map((child, index) => ({ child, size: node.sizes?.[index] ?? null }))
    .filter((slot) => hasPanels(slot.child));
  if (slots.length === 0) return;
  const horizontal = node.axis === "horizontal";
  const total = horizontal ? rect.width : rect.height;
  const space = Math.max(0, total - HANDLE * (slots.length - 1));
  // Every slot but the last takes its recorded size; the last takes the
  // rest. A slot with no size shares what the sized ones leave.
  const loose = slots.slice(0, -1).filter((slot) => slot.size === null).length;
  const sized = slots.slice(0, -1).reduce((sum, slot) => sum + (slot.size ?? 0), 0);
  const share = loose > 0 ? Math.max(0, (space - sized) / (loose + 1)) : 0;
  let at = horizontal ? rect.x : rect.y;
  let used = 0;
  slots.forEach((slot, index) => {
    const last = index === slots.length - 1;
    const size = last ? Math.max(0, space - used) : (slot.size ?? share);
    used += size;
    const child: Rect = horizontal
      ? { x: at, y: rect.y, width: size, height: rect.height }
      : { x: rect.x, y: at, width: rect.width, height: size };
    walk(slot.child, child, out);
    at += size + HANDLE;
  });
}

/** The boxes a canvas's tab bars occupy, for the `+` overlay. */
export function tabBarBoxes(
  layout: DockAreaLayout,
  width: number,
  height: number,
  zoomed: string | null = null,
): TabBarBox[] {
  if (width <= 0 || height <= 0) return [];
  const boxes: TabBarBox[] = [];
  walk(layout.center, { x: 0, y: 0, width, height }, boxes);
  // A zoomed group takes the whole area; so does the one compact presents.
  // Only its own group's bar is on screen, full width.
  const only = zoomed ? zoomed : width < COMPACT_WIDTH ? activePanelIds(layout)[0] : null;
  if (only) {
    const found = boxes.find((box) => box.panels.includes(only));
    return found ? [{ ...found, x: 0, y: 0, width, height }] : [];
  }
  return boxes;
}

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
