import type { DockAreaLayout } from "nsh/base";

/**
 * The canvas's layout data and its helpers. The layout is the app's own
 * value: `DockArea` reports every edit as the whole new layout and the
 * app passes it back, so opening sheets and activating them are pure
 * edits here — nothing docks-specific to reach for.
 */

type DockNode = DockAreaLayout["center"];
type DockRegion = NonNullable<DockAreaLayout["left"]>;

export type { DockAreaLayout, DockNode, DockRegion };

/** The canvas at first: one session sheet (M1 shows the open session). */
export function initialLayout(): DockAreaLayout {
  return {
    center: { type: "tabs", panels: ["session:1"], activeIndex: 0 },
  };
}

/** Walks every tabs node in the whole layout (center then the docks). */
function tabsNodes(layout: DockAreaLayout, visit: (node: Extract<DockNode, { type: "tabs" }>) => void): void {
  const walk = (node: DockNode): void => {
    if (node.type === "tabs") visit(node);
    else node.children.forEach(walk);
  };
  walk(layout.center);
  for (const dock of [layout.left, layout.right, layout.bottom]) {
    if (dock) walk(dock.layout);
  }
}

/** Whether a sheet id is in the layout at all. */
export function hasSheet(layout: DockAreaLayout, id: string): boolean {
  let found = false;
  tabsNodes(layout, (tabs) => {
    if (tabs.panels.includes(id)) found = true;
  });
  return found;
}

/** Displays an open sheet: its group's `activeIndex` moves to it. */
export function activateSheet(layout: DockAreaLayout, id: string): DockAreaLayout {
  let changed = false;
  tabsNodes(layout, (tabs) => {
    const at = tabs.panels.indexOf(id);
    if (at >= 0 && tabs.activeIndex !== at) {
      tabs.activeIndex = at;
      changed = true;
    }
  });
  return changed ? { ...layout } : layout;
}

/**
 * Appends a sheet to the group of `prefer` (the shown sheet), else the
 * first group, and shows it. The canvas holds every panel somewhere, so
 * there is always a tabs node; the (never taken) fallback makes one.
 */
export function appendSheet(layout: DockAreaLayout, id: string, prefer?: string): DockAreaLayout {
  const groups: Extract<DockNode, { type: "tabs" }>[] = [];
  tabsNodes(layout, (tabs) => groups.push(tabs));
  const group = (prefer ? groups.find((tabs) => tabs.panels.includes(prefer)) : undefined) ?? groups[0];
  if (!group) {
    return { ...layout, center: { type: "tabs", panels: [id], activeIndex: 0 } };
  }
  group.panels = [...group.panels, id];
  group.activeIndex = group.panels.length - 1;
  return { ...layout };
}

/** The number of sheets the layout holds (open docks and not). */
export function sheetCount(layout: DockAreaLayout): number {
  let count = 0;
  tabsNodes(layout, (tabs) => {
    count += tabs.panels.length;
  });
  return count;
}

/** Fresh instance numbers, per kind, for the toolbar's new sheets. */
const instances = new Map<string, number>();
export function nextSheetId(kind: string): string {
  const n = (instances.get(kind) ?? 0) + 1;
  instances.set(kind, n);
  return `${kind}:${n + 1}`;
}
