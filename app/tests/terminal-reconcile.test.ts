import { expect, test } from "nsh/test";
import {
  activeContainerId,
  heldLayouts,
  layout,
  loadContainers,
  setContainerTransport,
  setLayout,
  switchContainer,
} from "../core/containers";
import { panelIds, type DockAreaLayout } from "../core/dock";
import { registerModule } from "../core/registry";
import { closeTerminal, ensureTerminal, registerTerminal, terminalInfo, terminalSheetId } from "../domains/pty";
import { registerAllModules } from "../modules/register-all";
import type { SheetModule } from "../../contracts/module";

registerAllModules();

// A probe module observes what setLayout tells modules. The fix belongs to
// the notification payload: modules own resources across every canvas, so a
// parked container's sheets must be in the list or a tab looks closed.
let notified: string[] = [];
const probe: SheetModule = {
  id: "test:terminal-reconcile",
  kinds: [],
  onLayoutChanged: (ids) => { notified = ids; },
};
registerModule(probe);

// Issue #22: `setLayout` is a canvas-local edit, but modules own resources
// across all canvases. A parked container's terminal must not be mistaken for
// a closed tab when another canvas opens a sheet or moves a panel.

const A = "cA";
const B = "cB";
const sheetB = terminalSheetId(B, 1);
const records = [A, B].map((id) => ({
  id,
  kind: "Pi",
  cwd: `/tmp/${id}`,
  archived: false,
  createdAt: 1,
  updatedAt: 1,
  sessions: [],
  // The terminal module's `restore` asks which container owns a sheet.
  // Without the order record, switching to B drops its terminal before it
  // can be parked, so this fixture would never exercise the real scenario.
  sheetOrder: id === B ? [sheetB] : ["home:cA"],
}));
const layouts: Record<string, DockAreaLayout> = Object.fromEntries(
  records.map((row) => [
    row.id,
    { center: { type: "tabs", panels: [row.id === B ? sheetB : "home:cA"], activeIndex: 0 } } as DockAreaLayout,
  ]),
) as Record<string, DockAreaLayout>;

setContainerTransport(async (type: string, payload: any = {}) => {
  switch (type) {
    case "container.list":
      return { containers: records, activeContainerId: A };
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

test("a layout edit on one canvas keeps a parked container's terminal alive", async () => {
  await loadContainers();
  expect(activeContainerId()).toBe(A);

  // B holds a Pi TUI; leave it parked, then edit A's canvas.
  await switchContainer(B);
  await switchContainer(A);
  expect(heldLayouts()[B]).toBeDefined();
  expect(panelIds(layout())).not.toContain(sheetB);

  // A layout edit (opening a sheet here) used to notify modules with only
  // A's panels, which made the terminal module close B's PTY.
  const next = {
    ...layout(),
    center: { type: "tabs", panels: [...panelIds(layout()), "files:cA"], activeIndex: 0 },
  } as DockAreaLayout;
  setLayout(next);
  expect(notified).toContain(sheetB);
});

// The consume side, end to end: the terminal module's reconcile walks the
// live handles, so only a spawned PTY can tell the killed from the kept —
// with the global payload in place, the parked terminal's PTY (and its
// `terminalInfo` entry, which a kill takes with it) must still be running.
test("a layout edit on one canvas keeps a parked terminal's PTY running", async () => {
  await loadContainers();
  expect(activeContainerId()).toBe(A);

  registerTerminal(sheetB, "shell");
  // An existing cwd: a PTY spawn into a missing directory just fails.
  ensureTerminal(sheetB, { id: B, cwd: "/tmp" });
  try {
    await switchContainer(B);
    await switchContainer(A);
    expect(heldLayouts()[B]).toBeDefined();
    expect(terminalInfo()[sheetB]?.running).toBe(true);

    setLayout({
      ...layout(),
      center: { type: "tabs", panels: [...panelIds(layout()), "files:cA"], activeIndex: 0 },
    } as DockAreaLayout);
    expect(terminalInfo()[sheetB]?.running).toBe(true);
  } finally {
    closeTerminal(sheetB);
  }
});
