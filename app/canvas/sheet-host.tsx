import { computed, createAnimatedValue, effect, reduceMotion, View } from "nsh";
import type { DockAreaLayout } from "../core/dock";
import {
  groupFrames,
  openSheetIds,
  parkedGroups,
  sheetFrames,
  tabBarBoxes,
  type SheetFrame,
} from "../core/projection";
import { SheetBody } from "./sheets";
import { switcher } from "../ui/ui";

/**
 * The canvas's content: every sheet the app holds open, each in a frame
 * placed by the projection (`core/projection.ts`), clipped to its group's
 * content area. The bodies are owned by the sheet registry, not by a canvas:
 * a tab switch slides them, a container switch shows another set, a split
 * moves their frames — and none of them is ever made again, so a web view
 * keeps its page, a terminal its screen and a conversation its place.
 *
 * `DockArea` draws the chrome (tab bars, drags) over a content frame that
 * takes no touches and paints nothing; the sheets are over that frame, under
 * the `+`. Its own drop indicator (the block a split would take) is under
 * them, so a drag to the content area shows less of where it would land.
 */

/** The gallery's `motion.move`, shared with the switcher's pill. */
const MOVE = { stiffness: 504, damping: 38 };

/** The height a group's bar takes off the top of its box. */
const BAR = switcher.height + 2 * switcher.lift;

export function SheetHost(props: {
  layout: DockAreaLayout;
  held: Record<string, DockAreaLayout>;
  width: number;
  height: number;
  zoomed: string | null;
}) {
  const groups = () =>
    groupFrames(tabBarBoxes(props.layout, props.width, props.height, props.zoomed), BAR);
  const ids = () => openSheetIds(props.layout, props.held);
  const parked = () => parkedGroups(props.held, props.width, props.height, BAR);
  const frames = computed(() => {
    const byId = new Map<string, SheetFrame>();
    for (const frame of sheetFrames(groups(), parked(), props.width, props.height)) byId.set(frame.id, frame);
    return byId;
  });
  // The displayed sheets paint last, over the ones sliding beside them: the
  // one the user is on keeps its controls when they press it mid-travel.
  const ordered = computed(() => {
    const all = ids()
      .map((id) => frames().get(id))
      .filter((frame): frame is SheetFrame => !!frame);
    return [...all.filter((frame) => !frame.shown), ...all.filter((frame) => frame.shown)];
  });
  return (
    <View style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, pointerEvents: "box-none" }}>
      <Each of={ordered()} key={(frame) => frame.id}>
        {(frame) => <SheetSlot frame={frame} />}
      </Each>
    </View>
  );
}

/** One sheet: a clipped frame at its group's content area, its body offset
 * inside it by its place (a page's width per tab away from the displayed
 * one, which is how the switcher's travel carries it). */
function SheetSlot(props: { frame: () => SheetFrame }) {
  const frame = () => props.frame();
  const x = createAnimatedValue(frame().offset);
  let place = frame().place;
  effect(() => {
    const next = frame();
    // A tab moved: the sheet slides (its neighbours move with it). A frame
    // that only changed size — a window, a split, a group given another
    // width — is placed, not slid: the tab the sheet is on did not change.
    if (next.place !== place) {
      place = next.place;
      if (reduceMotion()) x.set(next.offset);
      else void x.spring(next.offset, MOVE);
      return;
    }
    x.set(next.offset);
  });
  return (
    <View
      testID={`sheet-frame-${frame().id}`}
      style={{
        position: "absolute",
        left: frame().x,
        top: frame().y,
        width: frame().width,
        height: frame().height,
        overflow: "hidden",
        // The displayed sheet and its two neighbours are visible: a turn of
        // the tab strip draws them as it leaves and arrives. Everything else
        // is `visibility: hidden` — the engine skips it for paint, hits,
        // keyboard focus and assistive technologies alike, so a parked sheet
        // needs none of those fenced off by hand.
        visibility: frame().shown || frame().near ? "visible" : "hidden",
        pointerEvents: frame().shown ? "auto" : "none",
      }}
    >
      <View
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: frame().width,
          height: frame().height,
          translate: x,
          // A sheet that is not the displayed one takes no presses: its
          // body's hit area stays where it was laid out, and `translate`
          // only moves what is painted.
          pointerEvents: frame().shown ? "auto" : "none",
        }}
        focusable={false}
        accessibilityElementsHidden={!frame().shown}
        importantForAccessibility={frame().shown ? "auto" : "no-hide-descendants"}
      >
        <SheetBody id={frame().id} />
      </View>
    </View>
  );
}
