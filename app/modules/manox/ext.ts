/**
 * The manox extension face's client fold (the `x-manox-*` channels the
 * kernel declares under AHP's `x-` namespace): state the protocol has no
 * native slot for. The metrics channel is the only consumer so far — it
 * carries the reasoning-timing registry, the settled run's durable clock a
 * folded thinking block quotes — and the state here is deliberately
 * minimal: a field the client does not read is not modeled.
 *
 * Unknown-tolerant by contract (the kernel's own fold, ext/reducer.rs): an
 * action this build does not know leaves the state untouched — never a
 * warning — so a newer kernel's extension chatter stays quiet here while
 * the protocol channels keep theirs. The fold is pure: no signals, the
 * caller owns reactivity.
 */

/** One settled reasoning run's timing row (the wire's camelCase shape). */
export interface ReasoningTiming {
  partId: string;
  turnId: string;
  startedAt: string;
  /** First-to-last delta in milliseconds. `0` is the contract's
   * sub-millisecond settle — the run closed within the same millisecond as
   * its first delta, and "0s" would misread it. */
  durationMs: number;
}

/** The extension channel state this client reads (the wire's `XManoxState`,
 * minimized to the fields a sheet renders). */
export interface XManoxState {
  /** Settled reasoning runs' timing rows, keyed by the reasoning part id.
   * Written once at the run's close and never cleared. */
  reasoningTimings?: Record<string, ReasoningTiming>;
}

/** The kernel's extension actions this fold knows. */
const BASELINE = "x-manox/baseline";
const REASONING_TIMING = "x-manox/reasoningTiming";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** Whether a timing row is keyable and whole (a row without a string
 * `partId` cannot be keyed and is dropped, as the kernel's fold does). */
function isTimingRow(value: unknown): value is ReasoningTiming {
  return isRecord(value) && typeof value["partId"] === "string" && typeof value["durationMs"] === "number";
}

/**
 * The metrics channel's fold: `x-manox/baseline` replaces the registry (the
 * host pushes it right after `subscribe` — extension channels answer with
 * no snapshot, so it is the only way a reopened sheet learns old runs'
 * timings), `x-manox/reasoningTiming` upserts by `partId` (a replay
 * restates the identical row and folds to the same state), anything else —
 * known extension actions for other fields included — returns the same
 * state.
 */
export function metricsReducer(state: XManoxState, action: unknown): XManoxState {
  const type = isRecord(action) && typeof action["type"] === "string" ? action["type"] : "";
  if (type === BASELINE) {
    const next = isRecord(action) ? action["state"] : undefined;
    const rows = isRecord(next) && isRecord(next["reasoningTimings"]) ? next["reasoningTimings"] : {};
    return { reasoningTimings: rows as Record<string, ReasoningTiming> };
  }
  if (type === REASONING_TIMING) {
    const row = isRecord(action) ? action["timing"] : undefined;
    if (!isTimingRow(row)) return state;
    const rows = state.reasoningTimings ?? {};
    const existing = rows[row.partId];
    if (existing && JSON.stringify(existing) === JSON.stringify(row)) return state;
    return { ...state, reasoningTimings: { ...rows, [row.partId]: row } };
  }
  return state;
}
