import { platform, Scroll, Text, token, View } from "nsh";
import type { JSX, TextStyle, ViewStyle } from "nsh";
import { Glyph, shadowRaised } from "./ui";

/**
 * The app's menu look, ported from nsh's own gallery (`examples/nsh-gallery-ui/
 * look/menu.tsx`): `nsh/base` draws no surface, so the app's layer draws one
 * panel per menu level, 26-point rows with a highlight under the pointer and
 * under the keyboard alike, a group title and a separator.
 *
 * Every menu in the app is built from these parts — the picker, the effort
 * chip, the behaviour chips — so the panels, rows and spacing never drift
 * apart.
 */

const pointer = platform.desktop;

/** A row's height, corners and type: compact with a pointer, a finger's on a
 * touch screen. */
export const menuItemSize = pointer
  ? { height: 26, radius: 6, font: 12, note: 10.5, icon: 12 }
  : { height: 46, radius: 10, font: 15, note: 13, icon: 18 };

/** A row's inset from the panel's sides. */
const inset = 8;

/** A row under the pointer or the keyboard: the theme's neutral `accent`. */
export function menuHighlight(): ViewStyle {
  return { backgroundColor: token("accent") };
}

/** The surface a level's items sit on: the floating tier's edge, 10-point
 * corners, 4 points around its rows, and at least `minWidth` across. The
 * panel is what gives the level its size — a menu whose items are laid out
 * without one paints but does not hear presses. `flush` moves the padding to
 * the `Scroll` inside it (a menu that scrolls). */
export function MenuPanel(props: {
  flush?: boolean;
  minWidth?: number;
  style?: ViewStyle;
  children: JSX.Element;
}) {
  return (
    <View
      style={{
        minWidth: props.minWidth ?? 180,
        padding: props.flush ? 0 : 4,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: token("border"),
        backgroundColor: token("popover"),
        boxShadow: shadowRaised(),
        ...props.style,
      }}
    >
      {props.children}
    </View>
  );
}

/** A row's box: 26 points tall, 8 apart, 8 in from the panel's sides. */
export function menuItemLook(options?: { style?: ViewStyle }) {
  return {
    style: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 8,
      height: menuItemSize.height,
      paddingHorizontal: inset,
      borderRadius: menuItemSize.radius,
      ...options?.style,
    },
    hoverStyle: menuHighlight(),
    focusStyle: menuHighlight(),
    activeStyle: { backgroundColor: token("accent"), opacity: 0.85 },
    disabledStyle: { opacity: 0.35 } as ViewStyle,
  };
}

/** A row's label: one line, taking the row's free width. */
export function menuItemLabel(options?: { danger?: boolean }): TextStyle {
  return {
    numberOfLines: 1,
    flexGrow: 1,
    flexShrink: 0,
    fontSize: menuItemSize.font,
    color: options?.danger ? token("destructive") : token("foreground"),
  };
}

/** A row's note at its trailing edge: one line, faint. */
export function menuItemNote(): TextStyle {
  return { numberOfLines: 1, flexShrink: 0, fontSize: menuItemSize.note, color: token("faint") };
}

/** A group's title in a menu: nothing to press. */
export function MenuLabel(props: { text: string }) {
  return (
    <Text
      style={{
        fontSize: menuItemSize.note,
        fontWeight: "600",
        color: token("faint"),
        paddingHorizontal: inset,
        paddingTop: 6,
        paddingBottom: 2,
      }}
    >
      {props.text}
    </Text>
  );
}

/** A line between groups: a hairline in the theme's line color. */
export function menuSeparator(): ViewStyle {
  return {
    height: 1,
    marginTop: 4,
    marginBottom: 5,
    marginHorizontal: 4,
    backgroundColor: token("line"),
  };
}

/** The row that opens a submenu (a `Submenu`'s `trigger`): a label, an
 * optional note, and a faint chevron at its end. */
export function SubmenuRow(props: { label: string; note?: string; testID?: string }) {
  const look = menuItemLook();
  return (
    <View
      testID={props.testID}
      accessibilityLabel={[props.label, props.note].filter(Boolean).join(" · ")}
      hoverStyle={look.hoverStyle}
      focusStyle={look.focusStyle}
      activeStyle={look.activeStyle}
      style={look.style}
    >
      <Text style={menuItemLabel()}>{props.label}</Text>
      <If when={!!props.note}>
        <Text style={menuItemNote()}>{props.note ?? ""}</Text>
      </If>
      <Glyph name="chevron-right" size={9} tint={token("faint")} />
    </View>
  );
}

/** The row a touch screen's sheet shows above a submenu's items to go back. */
export function SubmenuBack(props: { label: string }) {
  const look = menuItemLook();
  return (
    <View hoverStyle={look.hoverStyle} activeStyle={look.activeStyle} style={look.style}>
      <Glyph name="chevron-right" size={11} tint={token("brand")} />
      <Text style={{ ...menuItemLabel(), color: token("brand") }}>{props.label}</Text>
    </View>
  );
}

/** The scrolling body of a menu that can outgrow its panel: the `Scroll`
 * inside a `flush` panel, as the gallery draws a long menu. */
export function MenuScroller(props: { maxHeight?: number; children: JSX.Element }) {
  return (
    <Scroll style={{ maxHeight: props.maxHeight ?? 300 }} contentStyle={{ padding: 6 }}>
      {props.children}
    </Scroll>
  );
}
