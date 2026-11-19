import { expect, test } from "nsh/test";
import {
  activeContainerId,
  closeSheet,
  heldLayouts,
  layout,
  loadContainers,
  setContainerTransport,
  setLayout,
  switchContainer,
} from "../core/containers";
import { notifyContainerArchived } from "../core/registry";
import type { DockAreaLayout } from "../core/dock";
import { setAcpCommandOverride } from "../modules/pi/acp/acp";
import { closeAllSessions, liveSession, openExistingSession } from "../modules/pi/acp/host";
import { registerAllModules } from "../modules/register-all";
import { stubCommand } from "../fixtures/stub-command";

registerAllModules();

// Issue #22, the session side: `setLayout` now reports every canvas's sheets
// (the terminal module reconciles globally), so the pi module's release
// ledger must stay scoped to the canvas being shown — otherwise a layout
// edit files a parked canvas's session under the shown container, and
// archiving the shown container releases a session it does not own.

const A = "cA";
const B = "cB";
const sheetA = "session:s-a";
const sheetB = "session:s-b";
const records = [A, B].map((id) => ({
  id,
  kind: "Pi",
  cwd: `/tmp/${id}`,
  archived: false,
  createdAt: 1,
  updatedAt: 1,
  sessions: [],
}));
const layouts: Record<string, DockAreaLayout> = Object.fromEntries(
  records.map((row) => [
    row.id,
    { center: { type: "tabs", panels: [row.id === B ? sheetB : sheetA], activeIndex: 0 } } as DockAreaLayout,
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

test("releasing closed sessions stays scoped to the canvas shown", async () => {
  setAcpCommandOverride(stubCommand());
  try {
    // Two live stub sessions, one per canvas (the stub echoes the resumed
    // id, so the fixture's sheet ids hold).
    await openExistingSession("s-a", "/tmp", { load: false });
    await openExistingSession("s-b", "/tmp", { load: false });
    await loadContainers();
    expect(activeContainerId()).toBe(A);
    await switchContainer(B);
    await switchContainer(A);
    expect(heldLayouts()[B]).toBeDefined();

    // A layout edit while B is parked files the ledger, then A's own tab
    // closes: its session goes, the parked canvas's session stays.
    setLayout(layout());
    closeSheet(sheetA);
    expect(liveSession("s-a")).toBeUndefined();
    expect(liveSession("s-b")).toBeDefined();

    // Archiving the shown container must not reach across either.
    notifyContainerArchived(A);
    expect(liveSession("s-b")).toBeDefined();
  } finally {
    await closeAllSessions();
    setAcpCommandOverride(null);
  }
});
