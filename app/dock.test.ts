import { expect, test } from "nsh/test";
import {
  SCRATCH_SHEET,
  activePanelIds,
  appendSheet,
  hasSheet,
  homeSheetContainer,
  homeSheetId,
  panelIds,
  replaceSheet,
  sheetCount,
  pruneLayout,
} from "./core/dock";
import { defaultLayoutForSessions, layoutSessions, sessionIdOfSheet, sessionSheetId } from "./modules/pi/sheets";

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
  const pruned = pruneLayout(layout, new Set(["session:a"]));
  expect(layoutSessions(pruned)).toEqual(["a"]);
  const emptied = pruneLayout(layout, new Set());
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

test("a Hero action replaces the Hero's own tab in place", () => {
  const base = appendSheet(defaultLayoutForSessions(["s1"]), "home:c1");
  expect(panelIds(base)).toEqual(["session:s1", "home:c1"]);
  const next = replaceSheet(base, "home:c1", "webview:c1:1");
  // The Hero is gone (not beside the target), and the browser is shown.
  expect(panelIds(next)).toEqual(["session:s1", "webview:c1:1"]);
  expect(activePanelIds(next)).toEqual(["webview:c1:1"]);
  // A target already open in another group moves into the Hero's slot: a
  // sheet is one instance, and the action's tab is where the Hero was.
  const split = {
    center: {
      type: "split" as const,
      axis: "horizontal" as const,
      children: [
        { type: "tabs" as const, panels: ["session:s1", "home:c1"], activeIndex: 1 },
        { type: "tabs" as const, panels: ["session:s2"], activeIndex: 0 },
      ],
    },
  };
  const moved = replaceSheet(split, "home:c1", "session:s2");
  expect(panelIds(moved)).toEqual(["session:s1", "session:s2"]);
  expect(activePanelIds(moved)).toEqual(["session:s2"]);
  // Without the Hero (it was closed), the target still opens.
  const reopened = replaceSheet(defaultLayoutForSessions(["s1"]), "home:c1", "webview:c1:2");
  expect(panelIds(reopened)).toEqual(["session:s1", "webview:c1:2"]);
  expect(activePanelIds(reopened)).toEqual(["webview:c1:2"]);
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
