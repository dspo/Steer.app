import { expect, test } from "nsh/test";
import { planEnabled, planEnabledById } from "../modules/pi/todos";

/**
 * The banner is the plan's only entry (A2). A session whose `todos` tools are
 * disabled must not show it, and before the harness answers its first
 * `_zu/todos/list` the app does not know either way — so the safe default is
 * off, not on.
 */
test("the plan entry is off until the harness reports the tools enabled", () => {
  const previous = planEnabledById();
  try {
    planEnabledById.set({});
    expect(planEnabled("sess")).toBe(false);
    planEnabledById.set({ sess: true });
    expect(planEnabled("sess")).toBe(true);
    planEnabledById.set({ sess: false });
    expect(planEnabled("sess")).toBe(false);
  } finally {
    planEnabledById.set(previous);
  }
});
