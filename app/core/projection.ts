import { activePanelIds, panelIds, type DockAreaLayout, type DockNode } from "./dock";

/**
 * The canvas as a projection of one layout: where each tab group is, and
 * where each sheet of it sits. The canvas draws its chrome from the boxes
 * here and its content from the frames — a sheet body is owned by the
 * registry (`canvas/sheet-host.tsx`), never by a canvas, so a layout edit
 * changes where a sheet is placed, never whether it exists.
 *
 * Pure data: no views, no store, no measuring. `DockArea` lays the groups
 * out, so a split's slots are its recorded sizes (the last takes what is
 * left) and the bar takes `barHeight` off the top of each group.
 */

/** A visible tab group's bar, in the canvas's points. */
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

/** A group's content area: the box beside its bar, where its sheets show. */
export type GroupFrame = {
  key: string;
  panels: string[];
  active: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

/** One sheet's place: a clipped frame at its group's content area, and the
 * offset of its body inside it (`0` at rest, a page's width per place away). */
export type SheetFrame = {
  id: string;
  /** The group it belongs to (the frame's identity), or its own id when it
   * is in a canvas that is not on screen. */
  group: string;
  /** Its place among the group's sheets. */
  index: number;
  /** How far it is from the displayed one, in places: the tab that moved. */
  place: number;
  x: number;
  y: number;
  width: number;
  height: number;
  offset: number;
  /** It is its group's displayed sheet on the canvas on screen. */
  shown: boolean;
  /** It is in the canvas on screen (in one of its groups). */
  onScreen: boolean;
  /** It is at most one place from the displayed sheet: the sheets a turn of
   * the tab strip draws while it slides. */
  near: boolean;
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

/** The boxes a canvas's tab bars occupy, for the chrome drawn over them. */
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
  const only =
    zoomed
      ? zoomed
      : width < COMPACT_WIDTH
        ? activePanelIds(layout)[0]
        : null;
  if (only) {
    const found = boxes.find((box) => box.panels.includes(only));
    return found ? [{ ...found, x: 0, y: 0, width, height }] : [];
  }
  return boxes;
}

/** The content areas of a canvas's groups, from the boxes of their bars. */
export function groupFrames(boxes: TabBarBox[], barHeight: number): GroupFrame[] {
  return boxes.map((box) => ({
    key: box.key,
    panels: box.panels,
    active: box.active,
    x: box.x,
    y: box.y + barHeight,
    width: box.width,
    height: Math.max(0, box.height - barHeight),
  }));
}

/**
 * The groups of the canvases put aside, at the canvas's own size: a parked
 * sheet keeps the place it had, so coming back to its canvas finds it where
 * it was (no travel to place) and the frame stays inside its group.
 */
export function parkedGroups(
  held: Record<string, DockAreaLayout>,
  width: number,
  height: number,
  barHeight: number,
): GroupFrame[] {
  const groups: GroupFrame[] = [];
  for (const canvas of Object.values(held)) {
    for (const group of groupFrames(tabBarBoxes(canvas, width, height, null), barHeight)) groups.push(group);
  }
  return groups;
}

/**
 * Where every sheet sits: the canvas's own groups first, then — parked, so
 * they stay mounted — the sheets of the canvases put aside, each in the place
 * it had. A parked sheet is not shown, and only ever slides if its canvas
 * comes back with another tab displayed.
 */
export function sheetFrames(
  onScreen: GroupFrame[],
  parked: GroupFrame[],
  width: number,
  height: number,
): SheetFrame[] {
  const frames: SheetFrame[] = [];
  const seen = new Set<string>();
  for (const group of onScreen) {
    group.panels.forEach((id, index) => {
      if (seen.has(id)) return;
      seen.add(id);
      const shown = index === group.active;
      frames.push({
        id,
        group: group.key,
        index,
        place: index - group.active,
        x: group.x,
        y: group.y,
        width: group.width,
        height: group.height,
        offset: (index - group.active) * group.width,
        shown,
        onScreen: true,
        near: Math.abs(index - group.active) <= 1,
      });
    });
  }
  for (const group of parked) {
    group.panels.forEach((id, index) => {
      if (seen.has(id)) return;
      seen.add(id);
      frames.push({
        id,
        group: group.key,
        index,
        place: index - group.active,
        x: group.x,
        y: group.y,
        width: group.width,
        height: group.height,
        offset: (index - group.active) * group.width,
        shown: false,
        onScreen: false,
        near: false,
      });
    });
  }
  return frames;
}

/** Every sheet the app holds open, across the canvases, in a stable order. */
export function openSheetIds(layout: DockAreaLayout, held: Record<string, DockAreaLayout>): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const id of [...panelIds(layout), ...Object.values(held).flatMap(panelIds)]) {
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}
