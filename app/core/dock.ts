import { signal } from "nsh";
import type { DockAreaLayout } from "nsh/base";

/**
 * The canvas's layout data and its pure helpers (docs/sheet-module-ARCHITECTURE.md
 * §3). The layout is the app's own value: `DockArea` reports every edit as the
 * whole new layout and the app passes it back, so opening sheets and activating
 * them are pure edits here.
 *
 * This file is kind-agnostic: ids are opaque (`kind:instance`), and nothing
 * here knows what a session, a terminal or a browser is. Kind-specific id
 * helpers live with the module that owns the kind.
 */

type DockNode = DockAreaLayout["center"];
type DockRegion = NonNullable<DockAreaLayout["left"]>;

export type { DockAreaLayout, DockNode, DockRegion };

/** The scratch canvas's Hero sheet: the one sheet no container owns. */
export const SCRATCH_SHEET = "home:scratch";

/** A canvas's Hero sheet: the container's start page, or the scratch one. */
export function homeSheetId(containerId: string | null): string {
  return containerId ? `home:${containerId}` : SCRATCH_SHEET;
}

/** The container a Hero sheet belongs to, or `null` for the scratch canvas. */
export function homeSheetContainer(id: string): string | null {
  if (id === SCRATCH_SHEET) return null;
  return id.startsWith("home:") ? id.slice("home:".length) : null;
}

/** The visible sheet ids, kept current by the shell for throttling. */
export const visiblePanels = signal<string[]>([]);

/** A one-group layout for `sheetIds`, the first displayed. */
export function defaultLayoutForSheets(sheetIds: string[]): DockAreaLayout {
  return {
    center: { type: "tabs", panels: [...sheetIds], activeIndex: 0 },
  };
}

/** The panels a user can see now: each open group's displayed tab, or the zoomed one. */
export function activePanelIds(layout: DockAreaLayout, zoomedPanel: string | null = null): string[] {
  const visible: string[] = [];
  const walk = (node: DockNode): boolean => {
    if (node.type !== "tabs") {
      for (const child of node.children) if (walk(child)) return true;
      return false;
    }
    if (zoomedPanel) {
      if (!node.panels.includes(zoomedPanel)) return false;
      visible.push(zoomedPanel);
      return true;
    }
    const active = node.panels[node.activeIndex ?? 0];
    if (active) visible.push(active);
    return false;
  };
  walk(layout.center);
  for (const dock of [layout.left, layout.right, layout.bottom]) {
    if (!dock || dock.open === false) continue;
    walk(dock.layout);
  }
  return visible;
}

/** Every sheet id in the layout, in tree order. */
export function panelIds(layout: DockAreaLayout): string[] {
  const ids: string[] = [];
  const walk = (node: DockNode): void => {
    if (node.type === "tabs") ids.push(...node.panels);
    else node.children.forEach(walk);
  };
  walk(layout.center);
  for (const dock of [layout.left, layout.right, layout.bottom]) {
    if (dock) walk(dock.layout);
  }
  return ids;
}

/** Whether a sheet id is in the layout at all. */
export function hasSheet(layout: DockAreaLayout, id: string): boolean {
  return panelIds(layout).includes(id);
}

/** Displays an open sheet: its group's `activeIndex` moves to it. */
function activateSheet(layout: DockAreaLayout, id: string): DockAreaLayout {
  let changed = false;
  const walk = (node: DockNode): void => {
    if (node.type === "tabs") {
      const at = node.panels.indexOf(id);
      if (at >= 0 && node.activeIndex !== at) {
        node.activeIndex = at;
        changed = true;
      }
      return;
    }
    node.children.forEach(walk);
  };
  walk(layout.center);
  for (const dock of [layout.left, layout.right, layout.bottom]) {
    if (dock) walk(dock.layout);
  }
  return changed ? { ...layout } : layout;
}

/**
 * Appends a sheet to the group of `prefer` (the shown sheet), else the first
 * group, and shows it. The canvas holds every panel somewhere, so there is
 * always a tabs node; the (never taken) fallback makes one.
 */
export function appendSheet(layout: DockAreaLayout, id: string, prefer?: string): DockAreaLayout {
  // A sheet is one instance: asking again shows the one already in the layout.
  if (hasSheet(layout, id)) return activateSheet(layout, id);
  const groups: Extract<DockNode, { type: "tabs" }>[] = [];
  const collect = (node: DockNode): void => {
    if (node.type === "tabs") groups.push(node);
    else node.children.forEach(collect);
  };
  collect(layout.center);
  for (const dock of [layout.left, layout.right, layout.bottom]) {
    if (dock) collect(dock.layout);
  }
  const group = (prefer ? groups.find((tabs) => tabs.panels.includes(prefer)) : undefined) ?? groups[0];
  if (!group) {
    return { ...layout, center: { type: "tabs", panels: [id], activeIndex: 0 } };
  }
  group.panels = [...group.panels, id];
  group.activeIndex = group.panels.length - 1;
  return { ...layout };
}

/**
 * Drops sheets whose module says the resource is gone (silently), and
 * de-duplicates repeated ids. Empty groups fall back to an empty center.
 */
export function pruneLayout(layout: DockAreaLayout, keep: Set<string>): DockAreaLayout {
  const prune = (node: DockNode): DockNode | null => {
    if (node.type !== "tabs") {
      const children = node.children.map(prune).filter((child): child is DockNode => !!child);
      if (children.length === 0) return null;
      return { ...node, children };
    }
    const seen = new Set<string>();
    const panels = node.panels.filter((panel) => {
      if (seen.has(panel)) return false;
      seen.add(panel);
      return keep.has(panel);
    });
    if (panels.length === 0) return null;
    const activeIndex = Math.min(node.activeIndex ?? 0, panels.length - 1);
    return { ...node, panels, activeIndex };
  };
  const center = prune(layout.center) ?? { type: "tabs", panels: [], activeIndex: 0 };
  const next: DockAreaLayout = { ...layout, center };
  for (const side of ["left", "right", "bottom"] as const) {
    const dock = layout[side];
    if (!dock) continue;
    const pruned = prune(dock.layout);
    next[side] = pruned ? { ...dock, layout: pruned } : null;
  }
  return next;
}

/**
 * Puts `to` where `from` was, in `from`'s group and at its slot, and shows
 * it: a Hero's action replaces the Hero tab instead of leaving it beside the
 * target. Without `from` (it was closed), `to` is appended and shown.
 */
export function replaceSheet(layout: DockAreaLayout, from: string, to: string): DockAreaLayout {
  if (from === to) return activateSheet(layout, to);
  const base = hasSheet(layout, to) ? removeSheet(layout, to) : layout;
  let replaced = false;
  const walk = (node: DockNode): void => {
    if (node.type !== "tabs") {
      node.children.forEach(walk);
      return;
    }
    const at = node.panels.indexOf(from);
    if (at < 0) return;
    node.panels = node.panels.map((panel) => (panel === from ? to : panel));
    node.activeIndex = at;
    replaced = true;
  };
  walk(base.center);
  for (const dock of [base.left, base.right, base.bottom]) {
    if (dock) walk(dock.layout);
  }
  return replaced ? { ...base } : appendSheet(base, to);
}

/** The number of sheets the layout holds (open docks and not). */
export function sheetCount(layout: DockAreaLayout): number {
  return panelIds(layout).length;
}

/**
 * Removes a sheet from the layout: its tab goes, an emptied group goes with
 * it, and an emptied center stays as an empty tabs node. `zoom` is the
 * caller's separate signal.
 */
export function removeSheet(layout: DockAreaLayout, id: string): DockAreaLayout {
  const remove = (node: DockNode): DockNode | null => {
    if (node.type === "tabs") {
      const panels = node.panels.filter((panel) => panel !== id);
      if (panels.length === 0) return null;
      return { ...node, panels, activeIndex: Math.min(node.activeIndex ?? 0, panels.length - 1) };
    }
    const children = node.children.map(remove).filter((child): child is DockNode => !!child);
    if (children.length === 0) return null;
    return { ...node, children };
  };
  const next: DockAreaLayout = {
    ...layout,
    center: remove(layout.center) ?? { type: "tabs", panels: [], activeIndex: 0 },
  };
  for (const side of ["left", "right", "bottom"] as const) {
    const dock = layout[side];
    if (!dock) continue;
    const pruned = remove(dock.layout);
    next[side] = pruned ? { ...dock, layout: pruned } : null;
  }
  return next;
}
