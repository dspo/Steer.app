import { expect, test } from "nsh/test";
import { createTitleStore } from "../core/title-store";

// The shared program-title store's semantics (issue #73 D3/D4/D5): trimmed
// writes with whitespace-only clearing synchronously, per-session coalescing
// to the latest within the flush window (the final value never lost), and a
// prune that drops leftovers while keeping the live ids.

test("writes are trimmed and whitespace-only clears synchronously", () => {
  const store = createTitleStore({ open: () => {}, close: () => {} });
  store.setProgramTitle("s1", "  Zu: 阶段名  ");
  store.flushPendingTitle();
  expect(store.programTitle("s1")).toBe("Zu: 阶段名");
  store.setProgramTitle("s1", "   ");
  // No flush needed: a clear lands right away (the tab falls back at once).
  expect(store.programTitle("s1")).toBe("");
});

test("coalescing merges per session: two sessions in one window both land", () => {
  const store = createTitleStore({ open: () => {}, close: () => {} });
  store.setProgramTitle("s1", "阶段一");
  store.setProgramTitle("s2", "阶段二");
  store.setProgramTitle("s1", "阶段一终");
  store.flushPendingTitle();
  expect(store.programTitle("s1")).toBe("阶段一终");
  expect(store.programTitle("s2")).toBe("阶段二");
});

test("pruning drops channels, entries and pending writes for deleted sessions", () => {
  const opened: string[] = [];
  const closed: string[] = [];
  const store = createTitleStore({
    open: (id) => void opened.push(id),
    close: (id) => void closed.push(id),
  });
  // A titled session (live), a titled session (deleted), and a channel
  // that never set a title (deleted): all three are prune targets.
  store.openChannel("live");
  store.setProgramTitle("live", "live title");
  store.openChannel("titled-dead");
  store.setProgramTitle("titled-dead", "dead title");
  store.openChannel("silent-dead");

  store.pruneTitles(["live"]);
  expect(opened.sort()).toEqual(["live", "silent-dead", "titled-dead"]);
  expect(closed.sort()).toEqual(["silent-dead", "titled-dead"]);
  expect(store.programTitle("live")).toBe("live title");
  expect(store.programTitle("titled-dead")).toBe("");
  expect(store.programTitle("silent-dead")).toBe("");
});

test("a pending title does not land after its session was pruned", () => {
  const closed: string[] = [];
  const store = createTitleStore({
    open: () => {},
    close: (id) => void closed.push(id),
  });
  store.openChannel("ghost");
  store.setProgramTitle("ghost", "ghost title");
  // The delete beats the 120ms flush window: the pending write must never
  // land.
  store.pruneTitles([]);
  expect(store.programTitle("ghost")).toBe("");
  expect(closed).toEqual(["ghost"]);
  store.flushPendingTitle();
  expect(store.programTitle("ghost")).toBe("");
});

test("closeChannel clears the title (D4: deletion, not archiving)", () => {
  const store = createTitleStore({ open: () => {}, close: () => {} });
  store.setProgramTitle("s1", "Zu: 阶段名");
  store.flushPendingTitle();
  expect(store.programTitle("s1")).toBe("Zu: 阶段名");
  store.closeChannel("s1");
  expect(store.programTitle("s1")).toBe("");
});
