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

test("pruning drops leftovers without a live id and keeps the live ones", () => {
  const store = createTitleStore({ open: () => {}, close: () => {} });
  store.setProgramTitle("live", "live title");
  store.setProgramTitle("ghost", "ghost title");
  store.flushPendingTitle();
  store.pruneTitles(["live"]);
  expect(store.programTitle("live")).toBe("live title");
  expect(store.programTitle("ghost")).toBe("");
});
