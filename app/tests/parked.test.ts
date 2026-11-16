import { expect, test } from "nsh/test";
import {
  activeContainerId,
  closeSheet,
  heldLayouts,
  layout,
  loadContainers,
  openScratch,
  setContainerTransport,
  switchContainer,
} from "../core/containers";
import { panelIds } from "../core/dock";
import { openSheetIds } from "../core/projection";
import { registerAllModules } from "../modules/register-all";

registerAllModules();

// What stays mounted when a canvas is put aside, and what must not: a canvas
// that is shown owns its sheets through `layout`, so no parked copy of it may
// outlive the tab it holds (a closed tab would keep its page or PTY running),
// and the parked set is bounded.

const SHOWING = "c1";
const records = [SHOWING, "c2", "c3", "c4", "c5", "c6"].map((id) => ({
  id,
  kind: "Pi",
  cwd: `/tmp/${id}`,
  archived: false,
  createdAt: 1,
  updatedAt: 1,
  sessions: [],
}));

/** Two sheets on `c2` (so one can close without archiving), one elsewhere. */
const sheets: Record<string, string[]> = {
  c1: ["webview:c1:1"],
  c2: ["webview:c2:1", "webview:c2:2"],
  c3: ["webview:c3:1"],
  c4: ["webview:c4:1"],
  c5: ["webview:c5:1"],
  c6: ["webview:c6:1"],
};

const layouts: Record<string, any> = Object.fromEntries(
  records.map((row) => [
    row.id,
    { center: { type: "tabs", panels: sheets[row.id], activeIndex: 0 } },
  ]),
);

setContainerTransport(async (type: string, payload: any = {}) => {
  switch (type) {
    case "container.list":
      return { containers: records, activeContainerId: SHOWING };
    case "container.show":
      return { container: records.find((row) => row.id === payload.containerId) };
    case "layout.get":
      return { containerId: payload.containerId, layout: layouts[payload.containerId] ?? null, zoom: null };
    case "layout.put":
      layouts[payload.containerId] = payload.layout;
      return { containerId: payload.containerId, layout: payload.layout, zoom: payload.zoom };
    case "project.list":
      return { projects: [], membership: {} };
    default:
      throw new Error(`fixture transport: ${type}`);
  }
});

test("a put-aside canvas keeps its sheets, and only its own", async () => {
  await loadContainers();
  const union = () => openSheetIds(layout(), heldLayouts());

  // Visit c2, leave it (it parks with both sheets), and come back: the
  // canvas on screen owns its sheets through `layout` again, so its parked
  // copy must be gone — otherwise a tab closed now would live on in it.
  await switchContainer("c2");
  await switchContainer("c3");
  expect(heldLayouts()["c2"]).toBeDefined();
  await switchContainer("c2");
  expect(activeContainerId()).toBe("c2");
  expect(heldLayouts()["c2"]).toBeUndefined();
  expect(heldLayouts()["c1"]).toBeDefined();
  expect(union()).toContain("webview:c1:1");

  // Closing a tab on the canvas on screen takes its sheet out of the union:
  // a stale parked copy would keep a frame (and its page) alive for a tab no
  // canvas shows.
  closeSheet("webview:c2:2");
  expect(union()).not.toContain("webview:c2:2");
  expect(panelIds(layout())).not.toContain("webview:c2:2");

  await switchContainer("c3");
  await switchContainer("c4");
  await switchContainer("c5");
  await switchContainer("c6");
  const parked = Object.keys(heldLayouts()).filter((id) => id !== "scratch");
  expect(parked.length).toBeLessThanOrEqual(4);
  expect(parked).not.toContain("c1"); // least recently shown, evicted

  // The scratch canvas parks like a container: its sheets stay mounted.
  await openScratch();
  expect(activeContainerId()).toBe(null);
  expect(heldLayouts()["scratch"]).toBeUndefined();
  await switchContainer("c1");
  expect(heldLayouts()["scratch"]).toBeDefined();
  expect(union()).toContain("home:scratch");
});
