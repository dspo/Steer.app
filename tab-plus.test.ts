import { expect, test } from "nsh/test";
import type { DockAreaLayout, DockNode } from "./stores/dock";
import { tabBarBoxes } from "./canvas/tab-plus";

/**
 * The `+` overlay's placement is pure layout data: a tab bar is as wide as
 * its group, splits give each visible child its slot (the last takes what is
 * left), a zoom shows one group, and compact shows the displayed one.
 */

const tabs = (...panels: string[]): DockNode => ({ type: "tabs", panels, activeIndex: 0 });

test("one group's bar spans the canvas", () => {
  const layout: DockAreaLayout = { center: tabs("a", "b") };
  expect(tabBarBoxes(layout, 1000, 800)).toEqual([
    { x: 0, y: 0, width: 1000, height: 800, anchor: "a", key: "a" },
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

test("an unsized split shares the width, and the last group takes the rest", () => {
  const layout: DockAreaLayout = {
    center: { type: "split", axis: "horizontal", children: [tabs("a"), tabs("b")] },
  };
  const boxes = tabBarBoxes(layout, 1000, 800);
  expect(boxes[0].width).toBe(499.5);
  expect(boxes[1].x).toBe(500.5);
  expect(boxes[1].width).toBe(499.5);
});

test("a vertical split places the lower group's bar below the split", () => {
  const layout: DockAreaLayout = {
    center: { type: "split", axis: "vertical", children: [tabs("a"), tabs("b")], sizes: [200, null] },
  };
  const boxes = tabBarBoxes(layout, 900, 600);
  expect(boxes.map((box) => [box.anchor, box.y, box.height])).toEqual([
    ["a", 0, 200],
    ["b", 201, 399],
  ]);
});

test("a zoomed group owns the area, and compact shows the displayed group", () => {
  const layout: DockAreaLayout = {
    center: { type: "split", axis: "horizontal", children: [tabs("a"), tabs("b")] },
  };
  expect(tabBarBoxes(layout, 1000, 800, "b")).toEqual([
    { x: 0, y: 0, width: 1000, height: 800, anchor: "b", key: "b" },
  ]);
  expect(tabBarBoxes(layout, 560, 800)).toEqual([
    { x: 0, y: 0, width: 560, height: 800, anchor: "a", key: "a" },
  ]);
});

test("an emptied canvas has no bar to put a + on", () => {
  expect(tabBarBoxes({ center: tabs() }, 1000, 800)).toEqual([]);
  expect(tabBarBoxes({ center: tabs("a") }, 0, 800)).toEqual([]);
});
