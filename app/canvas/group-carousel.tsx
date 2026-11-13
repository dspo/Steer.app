import { token, View } from "nsh";
import { Carousel, CarouselContent, CarouselItem } from "nsh/base";
import { showSheet } from "../core/containers";
import type { DockAreaLayout } from "../core/dock";
import { SheetBody } from "./sheets";
import { switcher } from "../ui/ui";
import { tabBarBoxes, type TabBarBox } from "./tab-plus";

/**
 * Each group's content as the gallery's carousel (`nsh/base`'s `Carousel`,
 * as the gallery's Carousel -> Onboarding uses it): every sheet of the group
 * is a slide, the group's tab strip is its pager, and `index` is the layout's
 * displayed tab. A tab press scrolls the slides natively, animated; a swipe
 * (`Carousel`'s own gesture) selects the sheet back through `showSheet`.
 *
 * It replaces `renderPanel`'s content: `DockArea` keeps the tab strip, the
 * drags, the groups and the drop indicators, and renders an empty slot per
 * panel. Both slides are drawn while they move — which is the one thing a
 * panel's own `hidden` slot can never give.
 */

/** The tab strip's height, margins included: a group's content starts below. */
const BAR = switcher.height + 2 * switcher.lift;

export function GroupCarousels(props: {
  layout: DockAreaLayout;
  width: number;
  height: number;
  zoomed: string | null;
}) {
  const boxes = () => tabBarBoxes(props.layout, props.width, props.height, props.zoomed);
  return (
    // `box-none`: the layer takes no presses, each carousel in it does.
    <View style={{ position: "absolute", left: 0, top: 0, width: props.width, height: props.height, pointerEvents: "box-none" }}>
      <Each of={boxes()} key={(box) => box.key}>
        {(box) => <GroupCarousel box={box} />}
      </Each>
    </View>
  );
}

/** One group's slides: its sheets, one per view, with the displayed one in place. */
function GroupCarousel(props: { box: () => TabBarBox }) {
  const box = () => props.box();
  const wide = () => box().width;
  const tall = () => Math.max(0, box().height - BAR);
  const shown = (id: string) => box().panels[box().active] === id;

  return (
    <View
      testID={`sheet-carousel-${box().key}`}
      style={{
        position: "absolute",
        left: box().x,
        top: box().y + BAR,
        width: wide(),
        height: tall(),
        backgroundColor: token("background"),
        overflow: "hidden",
      }}
    >
      <Carousel
        index={box().active}
        accessibilityLabel="Sheets"
        onChange={({ index }) => {
          const id = box().panels[index];
          if (id !== undefined && !shown(id)) showSheet(id);
        }}
        style={{ flex: 1 }}
      >
        <CarouselContent style={{ height: tall() }}>
          <Each of={box().panels} key={(id) => id}>
            {(id) => (
              <CarouselItem style={{ width: wide(), height: tall() }}>
                {/* A sheet off screen keeps its state but leaves the keyboard's
                    and a screen reader's way: it is not what the canvas shows. */}
                <View
                  style={{ flex: 1, minHeight: 0 }}
                  focusable={false}
                  accessibilityElementsHidden={!shown(id())}
                  importantForAccessibility={shown(id()) ? "auto" : "no-hide-descendants"}
                >
                  <SheetBody id={id()} />
                </View>
              </CarouselItem>
            )}
          </Each>
        </CarouselContent>
      </Carousel>
    </View>
  );
}
