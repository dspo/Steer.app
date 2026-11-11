import { expect, test } from "nsh/test";
import {
  SCRATCH_SHEET,
  activePanelIds,
  appendSheet,
  defaultLayoutForSessions,
  hasSheet,
  homeSheetContainer,
  homeSheetId,
  layoutSessions,
  sheetCount,
  pruneLayout,
  sessionIdOfSheet,
  sessionSheetId,
} from "./dock";

test("a container's default layout holds one sheet per session", () => {
  const layout = defaultLayoutForSessions(["a", "b"]);
  expect(layoutSessions(layout)).toEqual(["a", "b"]);
  expect(sessionSheetId("a")).toBe("session:a");
  expect(sessionIdOfSheet("session:a")).toBe("a");
  expect(sessionIdOfSheet("subagents:1")).toBeNull();
  // Only the displayed tab of the group is visible.
  expect(activePanelIds(layout)).toEqual(["session:a"]);
  const withThird = appendSheet(layout, "session:c", "session:b");
  expect(hasSheet(withThird, "session:c")).toBe(true);
  expect(layoutSessions(withThird)).toEqual(["a", "b", "c"]);
  expect(activePanelIds(withThird)).toEqual(["session:c"]);
});

test("a zoom leaves only the zoomed panel visible (the throttle's input)", () => {
  const layout = defaultLayoutForSessions(["a", "b"]);
  // A second group, as after dragging a sheet to a panel edge.
  layout.center = {
    type: "split",
    axis: "horizontal",
    children: [
      { type: "tabs", panels: ["session:a"], activeIndex: 0 },
      { type: "tabs", panels: ["session:b"], activeIndex: 0 },
    ],
  };
  expect(activePanelIds(layout)).toEqual(["session:a", "session:b"]);
  expect(activePanelIds(layout, "session:b")).toEqual(["session:b"]);
});

test("pruning drops sheets of sessions a container no longer has", () => {
  const layout = defaultLayoutForSessions(["a", "b"]);
  const pruned = pruneLayout(layout, ["a"]);
  expect(layoutSessions(pruned)).toEqual(["a"]);
  const emptied = pruneLayout(layout, []);
  expect(layoutSessions(emptied)).toEqual([]);
  expect(activePanelIds(emptied)).toEqual([]);
});

test("opening the same auxiliary sheet twice keeps one tab", () => {
  const base = defaultLayoutForSessions(["s1"]);
  const once = appendSheet(base, "subagents:c1");
  const twice = appendSheet(once, "subagents:c1");
  expect(sheetCount(twice)).toBe(sheetCount(once));
  expect(twice.center.type === "tabs" && twice.center.panels.filter((p: string) => p === "subagents:c1").length).toBe(1);
});

test("a Hero sheet belongs to its container, or to the scratch canvas", () => {
  expect(homeSheetId("c1")).toBe("home:c1");
  expect(homeSheetId(null)).toBe(SCRATCH_SHEET);
  expect(homeSheetContainer("home:c1")).toBe("c1");
  expect(homeSheetContainer(SCRATCH_SHEET)).toBeNull();
  // A Hero is a sheet like any other: it appends once and activates after.
  const once = appendSheet(defaultLayoutForSessions(["s1"]), "home:c1");
  const again = appendSheet(once, "home:c1");
  expect(sheetCount(again)).toBe(2);
  expect(activePanelIds(again)).toEqual(["home:c1"]);
});
