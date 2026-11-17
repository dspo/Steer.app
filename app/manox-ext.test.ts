import { expect, test } from "nsh/test";
import { metricsReducer, type ReasoningTiming, type XManoxState } from "./modules/manox/ext";

// The metrics extension face's fold, pure and host-free: the timing
// registry upserts by part id, a replay of the identical row folds to the
// same state, a baseline replaces, and anything unknown leaves the state
// untouched — the kernel's own unknown-tolerance, mirrored client-side.

const row = (partId: string, durationMs: number): ReasoningTiming => ({
  partId,
  turnId: `t-${partId}`,
  startedAt: "2026-11-16T10:00:00.000Z",
  durationMs,
});

const timing = (partId: string, durationMs: number) => ({
  type: "x-manox/reasoningTiming",
  timing: row(partId, durationMs),
});

const empty: XManoxState = {};

test("two runs upsert two rows, keyed by their part ids", () => {
  const one = metricsReducer(empty, timing("p1", 3000));
  expect(one.reasoningTimings?.["p1"]?.durationMs).toBe(3000);
  const two = metricsReducer(one, timing("p2", 2400));
  expect(Object.keys(two.reasoningTimings ?? {}).sort()).toEqual(["p1", "p2"]);
  // The fold is pure: the earlier states are not mutated.
  expect(one.reasoningTimings?.["p2"]).toBeUndefined();
});

test("a later row for the same part overwrites it", () => {
  const state = metricsReducer(metricsReducer(empty, timing("p1", 3000)), timing("p1", 3200));
  expect(Object.keys(state.reasoningTimings ?? {})).toEqual(["p1"]);
  expect(state.reasoningTimings?.["p1"]?.durationMs).toBe(3200);
});

test("a replay restating the identical row folds to the same state", () => {
  const once = metricsReducer(empty, timing("p1", 3000));
  // The kernel restates a settled run's row on replay; the fold answers the
  // same object so a re-subscribe does not churn the sheet.
  expect(metricsReducer(once, timing("p1", 3000))).toBe(once);
});

test("an unknown action — a newer kernel's extension included — is not a fold", () => {
  const state = metricsReducer(empty, timing("p1", 3000));
  expect(metricsReducer(state, { type: "x-manox/goalSet", goal: "x" })).toBe(state);
  expect(metricsReducer(state, { type: "x-manox-metrics/changed", kind: "conversation", data: {} })).toBe(state);
  expect(metricsReducer(state, {})).toBe(state);
  expect(metricsReducer(state, "not an action")).toBe(state);
});

test("a row without a keyable part id is dropped, not folded", () => {
  const state = metricsReducer(empty, timing("p1", 3000));
  const next = metricsReducer(state, { type: "x-manox/reasoningTiming", timing: { turnId: "t-x", durationMs: 1 } });
  expect(next).toBe(state);
});

test("the subscribe baseline replaces the registry", () => {
  const state = metricsReducer(empty, timing("p1", 3000));
  const baselined = metricsReducer(state, {
    type: "x-manox/baseline",
    state: { reasoningTimings: { p2: row("p2", 1200) } },
  });
  expect(Object.keys(baselined.reasoningTimings ?? {})).toEqual(["p2"]);
  expect(baselined.reasoningTimings?.["p2"]?.durationMs).toBe(1200);
  // A baseline without the registry — the kernel's metrics aggregate face —
  // reads as "nothing", not as a preserved prior fold.
  expect(metricsReducer(state, { type: "x-manox/baseline", state: {} }).reasoningTimings).toEqual({});
  expect(metricsReducer(state, { type: "x-manox/baseline" }).reasoningTimings).toEqual({});
});
