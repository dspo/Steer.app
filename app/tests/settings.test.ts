import { expect, test } from "nsh/test";
import {
  clampSidebarWidth,
  loadSettings,
  setSettingsTransport,
  setSidebarWidth,
  sidebarWidth,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
} from "../shell/settings";

// §2.2-9: the sidebar's width is window furniture (`zu/settings.json` via
// `settings.*`). The shell clamps a drag into 200–360, and a restart reads
// the file back.

test("a drag's width clamps into the draggable range", () => {
  expect(clampSidebarWidth(150)).toBe(SIDEBAR_MIN_WIDTH);
  expect(clampSidebarWidth(400)).toBe(SIDEBAR_MAX_WIDTH);
  expect(clampSidebarWidth(280.7)).toBe(281);
  expect(clampSidebarWidth(Number.NaN)).toBe(232);
});

test("a width applies at once and persists through the engine", async () => {
  const written: any[] = [];
  setSettingsTransport(async (type, payload: any = {}) => {
    if (type === "settings.put") {
      written.push(payload);
      return { v: 1, sidebarWidth: payload.sidebarWidth };
    }
    return { v: 1 };
  });
  setSidebarWidth(331);
  expect(sidebarWidth()).toBe(331);
  expect(written).toEqual([{ sidebarWidth: 331 }]);
  setSettingsTransport(null);
});

test("a restart reads the stored width, and clamps a bad one", async () => {
  const store: Record<string, any> = { v: 1, sidebarWidth: 300 };
  setSettingsTransport(async (type, payload: any = {}) => {
    if (type === "settings.put") {
      store.sidebarWidth = payload.sidebarWidth;
      return { ...store };
    }
    return { ...store };
  });
  sidebarWidth.set(232);
  await loadSettings();
  expect(sidebarWidth()).toBe(300);

  // The file never holds an unusable number: the engine clamps, and so does
  // the shell's read.
  store.sidebarWidth = 5000;
  await loadSettings();
  expect(sidebarWidth()).toBe(SIDEBAR_MAX_WIDTH);
  setSettingsTransport(null);
});
