import { expect, test } from "nsh/test";
import type { DockAreaLayout, DockNode } from "./core/dock";
import {
  groupFrames,
  openSheetIds,
  parkedGroups,
  sheetFrames,
  tabBarBoxes,
} from "./core/projection";

/**
 * The canvas is a projection of a layout: a tab bar is as wide as its group,
 * splits give each visible child its slot (the last takes what is left), a
 * zoom shows one group, compact shows the displayed one — and each sheet's
 * frame follows from that alone.
 */

const tabs = (...panels: string[]): DockNode => ({ type: "tabs", panels, activeIndex: 0 });
const BAR = 38;

test("one group's bar spans the canvas", () => {
  const layout: DockAreaLayout = { center: tabs("a", "b") };
  expect(tabBarBoxes(layout, 1000, 800)).toEqual([
    { x: 0, y: 0, width: 1000, height: 800, anchor: "a", key: "a", panels: ["a", "b"], active: 0 },
  ]);
});

test("a horizontal split gives each bar its group's right edge", () => {
  const layout: DockAreaLayout = {
    center: { type: "split", axis: "horizontal", children: [tabs("a"), tabs("b")], sizes: [300, null] },
  };
  const boxes = tabBarBoxes(layout, 1000, 800);
  expect(boxes.map((box) => [box.anchor, box.x, box.width])).toEqual([
    ["a", 0, 300],
    // The 1pt handle sits between them; the last group takes the rest.
    ["b", 301, 699],
  ]);
});

test("a zoomed group owns the area, and compact shows the displayed group", () => {
  const layout: DockAreaLayout = {
    center: { type: "split", axis: "horizontal", children: [tabs("a"), tabs("b")] },
  };
  expect(tabBarBoxes(layout, 1000, 800, "b")).toEqual([
    { x: 0, y: 0, width: 1000, height: 800, anchor: "b", key: "b", panels: ["b"], active: 0 },
  ]);
  expect(tabBarBoxes(layout, 560, 800)).toEqual([
    { x: 0, y: 0, width: 560, height: 800, anchor: "a", key: "a", panels: ["a"], active: 0 },
  ]);
});

test("an emptied canvas has no bar to put a + on", () => {
  expect(tabBarBoxes({ center: tabs() }, 1000, 800)).toEqual([]);
  expect(tabBarBoxes({ center: tabs("a") }, 0, 800)).toEqual([]);
});

test("a group's content area is its box under its bar", () => {
  const [group] = groupFrames(tabBarBoxes({ center: tabs("a", "b") }, 1000, 800), BAR);
  expect([group.x, group.y, group.width, group.height]).toEqual([0, BAR, 1000, 800 - BAR]);
});

test("every sheet of a group has a frame, a page's width per place away", () => {
  const groups = groupFrames(tabBarBoxes({ center: tabs("a", "b", "c") }, 900, 600), BAR);
  const frames = sheetFrames(groups, [], 900, 600);
  expect(frames.map((frame) => [frame.id, frame.offset, frame.shown, frame.near])).toEqual([
    ["a", 0, true, true],
    ["b", 900, false, true],
    ["c", 1800, false, false],
  ]);
  // All of them share the group's content area: the clip is the group's.
  expect(frames.map((frame) => [frame.x, frame.y, frame.width, frame.height])).toEqual([
    [0, BAR, 900, 600 - BAR],
    [0, BAR, 900, 600 - BAR],
    [0, BAR, 900, 600 - BAR],
  ]);
});

test("the displayed tab is the one at rest, and the others slide around it", () => {
  const layout: DockAreaLayout = { center: { type: "tabs", panels: ["a", "b", "c"], activeIndex: 1 } };
  const frames = sheetFrames(groupFrames(tabBarBoxes(layout, 900, 600), BAR), [], 900, 600);
  expect(frames.map((frame) => [frame.id, frame.offset, frame.shown, frame.near])).toEqual([
    ["a", -900, false, true],
    ["b", 0, true, true],
    ["c", 900, false, true],
  ]);
});

test("a split gives each group its own content area", () => {
  const layout: DockAreaLayout = {
    center: { type: "split", axis: "horizontal", children: [tabs("a"), tabs("b")], sizes: [300, null] },
  };
  const frames = sheetFrames(groupFrames(tabBarBoxes(layout, 1000, 800), BAR), [], 1000, 800);
  expect(frames.map((frame) => [frame.id, frame.x, frame.width])).toEqual([
    ["a", 0, 300],
    ["b", 301, 699],
  ]);
  // Each is at rest in its own group: a page's width is its group's.
  expect(frames.every((frame) => frame.offset === 0 && frame.shown)).toBe(true);
});

test("the sheets of a canvas put aside keep their place", () => {
  const active = groupFrames(tabBarBoxes({ center: tabs("a") }, 900, 600), BAR);
  const parked = parkedGroups(
    { other: { center: { type: "tabs", panels: ["c", "d"], activeIndex: 1 } } as DockAreaLayout },
    900,
    600,
    BAR,
  );
  const frames = sheetFrames(active, parked, 900, 600);
  // A parked sheet is not shown, and is where its canvas left it: no travel
  // to place when that canvas comes back.
  expect(frames.map((frame) => [frame.id, frame.place, frame.offset, frame.shown, frame.onScreen])).toEqual([
    ["a", 0, 0, true, true],
    ["c", -1, -900, false, false],
    ["d", 0, 0, false, false],
  ]);
  // It keeps its group's content area, not the whole canvas.
  expect([frames[1].x, frames[1].y, frames[1].width, frames[1].height]).toEqual([0, BAR, 900, 600 - BAR]);
});

test("a sheet the canvas shows wins over a stale copy put aside", () => {
  const active = groupFrames(tabBarBoxes({ center: tabs("a") }, 900, 600), BAR);
  const parked = parkedGroups({ other: { center: tabs("a", "b") } as DockAreaLayout }, 900, 600, BAR);
  const frames = sheetFrames(active, parked, 900, 600);
  expect(frames.filter((frame) => frame.id === "a")).toHaveLength(1);
  expect(frames.find((frame) => frame.id === "a")?.shown).toBe(true);
});

test("the open sheets are the canvases' own, each once", () => {
  const active: DockAreaLayout = { center: tabs("a", "b") };
  const held = { other: { center: tabs("c", "a") } as DockAreaLayout };
  expect(openSheetIds(active, held)).toEqual(["a", "b", "c"]);
  expect(openSheetIds(active, {})).toEqual(["a", "b"]);
});
