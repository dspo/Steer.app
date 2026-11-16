import { expect, test } from "nsh/test";
import { switcherPillAt } from "../ui/ui";

/**
 * The pill's place is pure geometry: the track's content is shared equally
 * by its tabs (the gallery's `flex: 1`), the `+`'s strip is not theirs, and
 * the selected tab's share is where the pill springs to. The overlay reads
 * the same function, so a switch cannot land the pill off a tab.
 *
 * A 920-wide track: 4pt of border and inset at each end, 34 for the `+`, 2
 * between two tabs.
 */

test("the pill covers the selected tab's share of the track", () => {
  const { left, width } = switcherPillAt(920, 2, 1);
  expect(width).toBe((920 - 8 - 34 - 2) / 2);
  expect(left).toBe(4 + width + 2);
  // The last tab ends exactly at the track's content edge.
  expect(left + width).toBe(920 - 4 - 34);
});

test("the first tab starts at the content edge, and one tab fills the track", () => {
  expect(switcherPillAt(920, 2, 0)).toEqual({ left: 4, width: 438 });
  // No gap with one tab: the content edge to the `+`'s strip.
  expect(switcherPillAt(920, 1, 0)).toEqual({ left: 4, width: 878 });
});

test("many tabs squeeze to 72 and still step by width plus the gap", () => {
  const many = switcherPillAt(920, 20, 19);
  expect(many.width).toBe(72);
  expect(many.left).toBe(4 + 19 * (72 + 2));
});

test("no tabs, no pill", () => {
  expect(switcherPillAt(920, 0, 0)).toEqual({ left: 4, width: 0 });
});
