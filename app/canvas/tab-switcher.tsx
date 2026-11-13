import { createAnimatedValue, effect, reduceMotion, token, View } from "nsh";
import type { DockAreaLayout } from "nsh/base";
import { shadowCard, switcher, switcherPillAt, switcherTrack, SWITCHER_CONTENT_INSET } from "../ui/ui";
import { tabBarBoxes, type TabBarBox } from "./tab-plus";

/**
 * The sheets' section switcher, painted under the tabs: the gallery's
 * `tabsLook` track and **one** pill, which the selected tab's index springs
 * across (`motion.move`: 504 / 38 — the gallery's own spring). A tab is only
 * its label; the pill is not a tab's background but a single layer here, so
 * it can travel between them.
 *
 * It has to be a separate layer: `DockArea` paints every tab above its bar
 * and exposes no indicator of its own. Declared before `DockArea` and
 * `pointerEvents: none`, this overlay sits under the labels and over the
 * card, which is exactly the gallery's stacking.
 */

/** The gallery's `motion.move` (its `theme.ts`), the pill's travel. */
const MOVE = { stiffness: 504, damping: 38 };

/** The switcher's paint for every group on the canvas. */
export function TabSwitcher(props: {
  layout: DockAreaLayout;
  width: number;
  height: number;
  zoomed: string | null;
}) {
  const boxes = () => tabBarBoxes(props.layout, props.width, props.height, props.zoomed);
  return (
    <View
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: props.width,
        height: props.height,
        pointerEvents: "none",
      }}
    >
      <Each of={boxes()} key={(box) => box.key}>
        {(box) => <SwitcherBox box={box} />}
      </Each>
    </View>
  );
}

/** One group's track and the pill that travels along it. */
function SwitcherBox(props: { box: () => TabBarBox }) {
  // `Each` hands each row its item as an accessor; reading it inside these
  // bindings is what makes a switch (a new `layout`) reach them.
  const box = () => props.box();
  const trackWidth = () => Math.max(0, box().width - switcher.margin);
  const pill = () => switcherPillAt(trackWidth(), box().panels.length, box().active);
  /** How far the pill travels from the track's content edge. */
  const target = () => pill().left - SWITCHER_CONTENT_INSET;

  // The pill's own offset: a spring, restarted from wherever it is (a change
  // mid-way keeps the velocity it had, as the gallery's does).
  const travel = createAnimatedValue(target());
  effect(() => {
    const next = target();
    if (reduceMotion()) travel.set(next);
    else void travel.spring(next, MOVE);
  });

  return (
    <View
      style={{
        position: "absolute",
        left: box().x + switcher.margin,
        top: box().y + switcher.lift,
        width: trackWidth(),
        height: switcher.height,
        ...switcherTrack(),
        overflow: "hidden",
      }}
    >
      <View
        testID={`switcher-pill-${box().key}`}
        style={{
          position: "absolute",
          left: SWITCHER_CONTENT_INSET,
          top: SWITCHER_CONTENT_INSET,
          width: pill().width,
          height: switcher.pill,
          borderRadius: switcher.pill / 2,
          borderWidth: 1,
          borderColor: token("border"),
          backgroundColor: token("card"),
          boxShadow: shadowCard(),
          // `translate` takes an animated value natively (the gallery's
          // `TabTitle` moves its icon the same way); `transform` steps would
          // be read once.
          translate: travel,
        }}
      />
    </View>
  );
}
