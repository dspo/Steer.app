import { Canvas, type CanvasRenderingContext2D, reduceMotion, Text, token, View, type ViewStyle } from "nsh";
import { Scrollbar } from "nsh/base";

/**
 * The outline's own line glyphs, stroked in a 20 × 20 box (the gallery's
 * Canvas-glyph pattern). Outline only: names are the panes they stand for.
 */
export type GlyphName =
  | "pi"
  | "folder"
  | "chat"
  | "branch"
  | "archive"
  | "tree"
  | "diff"
  | "terminal"
  | "gear"
  | "plus"
  | "send"
  | "file"
  | "check"
  | "caret-right"
  | "caret-down"
  | "chevron-left"
  | "chevron-right"
  | "reload"
  | "close"
  | "globe"
  | "pulse"
  | "stop"
  | "alert"
  | "commit"
  | "minus"
  | "sidebar"
  | "more"
  | "search"
  | "sort"
  | "code"
  | "arrow-up"
  | "shield"
  | "shield-alert"
  | "shield-check"
  | "square";

type Draw = (c: CanvasRenderingContext2D) => void;

const line = (c: CanvasRenderingContext2D, points: number[]) => {
  c.beginPath();
  c.moveTo(points[0], points[1]);
  for (let i = 2; i < points.length; i += 2) c.lineTo(points[i], points[i + 1]);
  c.stroke();
};
const rect = (c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
  c.beginPath();
  c.roundRect(x, y, w, h, r);
  c.stroke();
};
const arc = (c: CanvasRenderingContext2D, x: number, y: number, r: number, from = 0, to = Math.PI * 2) => {
  c.beginPath();
  c.arc(x, y, r, from, to);
  c.stroke();
};
/** The permission modes' shield body; the variants add their mark inside. */
const shield = (c: CanvasRenderingContext2D) => {
  c.beginPath();
  c.moveTo(10, 3.5);
  c.lineTo(15.5, 5.5);
  c.lineTo(15.5, 10);
  c.bezierCurveTo(15.5, 13, 13.2, 15.2, 10, 16.5);
  c.bezierCurveTo(6.8, 15.2, 4.5, 13, 4.5, 10);
  c.lineTo(4.5, 5.5);
  c.closePath();
  c.stroke();
};

/** The shell's motion tokens: short, eased color/opacity changes, never motion for its own sake. */
const motion = {
  fast: {
    transitionProperty: "background-color, opacity, color, border-color",
    transitionDuration: 120,
    transitionTimingFunction: "ease-out" as const,
  },
  medium: {
    transitionProperty: "background-color, opacity, box-shadow, border-color",
    transitionDuration: 180,
    transitionTimingFunction: "ease-out" as const,
  },
};

/** A motion token's style, empty when the user asked for less motion. */
export function motionStyle(token: keyof typeof motion = "fast") {
  return reduceMotion() ? {} : motion[token];
}

/** The very soft lift under a selected row or a quiet card. */
export function shadowCard(): string {
  return `0 1px 2px ${token("shadow")}`;
}

/** A surface that sits above the page: menus, hero cards, toasts. */
export function shadowRaised(): string {
  return `0 1px 2px ${token("shadow")}, 0 8px 24px ${token("shadow")}`;
}

/** The topmost decision layer: dialogs. */
export function shadowDialog(): string {
  return `0 2px 6px ${token("shadow")}, 0 18px 44px ${token("shadow-strong")}`;
}

/** The shade inside a sunk surface: a track's or a well's top lip. */
export function shadowInset(): string {
  return `inset 0 1px 1px ${token("shadow-inset")}`;
}

/**
 * The section switcher's geometry (DESIGN §3.2), in points. One table so the
 * painted overlay (`canvas/tab-switcher.tsx`) and the tab bar's layout
 * (`shell/shell.tsx`) cannot drift: the pill is exactly where a tab's content
 * starts.
 */
export const switcher = {
  /** The capsule track's height. */
  height: 34,
  /** The pill inside it: the track minus its border and 3pt inset, twice. */
  pill: 26,
  /** The track's inner gap, from its border to a tab. */
  inset: 3,
  /** The track's border, on every side. */
  border: 1,
  /** Between two tabs. */
  gap: 2,
  /** The strip the `+` overlay keeps at the track's right end. */
  plus: 34,
  /** The card's gap above and below the track. */
  lift: 2,
  /** The card's gap at the track's left. */
  margin: 3,
  /** The narrowest a tab squeezes to before its title truncates. */
  minTab: 72,
} as const;

/** A tab's content starts this far inside the track (its border and inset). */
export const SWITCHER_CONTENT_INSET = switcher.border + switcher.inset;

/**
 * The pill's place on a track of `trackWidth`: the share one tab gets and
 * where the selected one starts. The tabs are equal (the gallery's `flex: 1`),
 * so one width serves them all; the `+`'s strip is not theirs. Pure, so the
 * overlay and `tab-switcher.test.ts` cannot drift.
 */
export function switcherPillAt(
  trackWidth: number,
  count: number,
  active: number,
): { left: number; width: number } {
  if (count <= 0) return { left: SWITCHER_CONTENT_INSET, width: 0 };
  const available =
    trackWidth - 2 * SWITCHER_CONTENT_INSET - switcher.plus - switcher.gap * (count - 1);
  const width = Math.max(switcher.minTab, available / count);
  return { left: SWITCHER_CONTENT_INSET + active * (width + switcher.gap), width };
}

/**
 * The switcher's track, clean-room after the gallery's `tabsLook`: a capsule
 * sunk into the card (`shadowInset`) with a hairline edge. Painted by the
 * overlay, not by the bar: `DockArea` draws the tabs above its own bar, so a
 * pill that travels between them can only live in a layer underneath —
 * `canvas/tab-switcher.tsx` draws both this and the pill.
 */
export function switcherTrack(): ViewStyle {
  return {
    height: switcher.height,
    borderRadius: switcher.height / 2,
    borderWidth: switcher.border,
    borderColor: token("border"),
    backgroundColor: token("inset"),
    boxShadow: shadowInset(),
  };
}

/**
 * The tab bar's own style: layout only (no paint), so the overlay's track and
 * pill show through. The paddings are the track's border and inset on the
 * left and, on the right, those plus the `+`'s strip.
 */
export function switcherBar(): ViewStyle {
  return {
    height: switcher.height,
    flexDirection: "row",
    alignItems: "center",
    gap: switcher.gap,
    paddingLeft: SWITCHER_CONTENT_INSET,
    paddingRight: SWITCHER_CONTENT_INSET + switcher.plus,
    marginLeft: switcher.margin,
    marginTop: switcher.lift,
    marginBottom: switcher.lift,
  };
}

/**
 * One tab's own box: the pill's size and radius, so its label sits exactly
 * where the traveling pill is, with no paint of its own (the overlay's pill
 * shows through; a hover wash on an unselected tab is the tab's only fill).
 */
export function switcherTab(): ViewStyle {
  return {
    height: switcher.pill,
    borderRadius: switcher.pill / 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingHorizontal: 9,
  };
}

/** One switcher tab's pill, for the drag ghost (the tab itself is bare). */
export function switcherPill(): ViewStyle {
  return {
    height: switcher.pill,
    borderRadius: switcher.pill / 2,
    borderWidth: 1,
    borderColor: token("border"),
    backgroundColor: token("card"),
    boxShadow: shadowCard(),
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingHorizontal: 9,
  };
}

/**
 * The frame one switcher tab's host needs so a few tabs share the track and
 * many still squeeze (the gallery's `fill`): the tab grows into an equal
 * share of the bar, never past `minWidth` (a title truncates there).
 */
export function switcherTabFrame(): ViewStyle {
  return { flexGrow: 1, flexBasis: 0, minWidth: switcher.minTab };
}

/**
 * The shell's scroll bars, in the app's own tokens: a thin thumb at the
 * scrolling region's trailing edge, shown while scrolling and faded by the
 * same short durations as the rest of the casing. Called once by `App.tsx`.
 */
export function applyScrollbarTheme(): void {
  Scrollbar.setTheme({
    mode: "scrolling",
    motion: { idle: 900, enter: 120, exit: 120, entrance: "fade" },
    minThumbLength: 40,
    vertical: {
      class: "absolute inset-y-0 right-0 w-3 p-1",
      thumbClass: "w-full rounded-full bg-scrollbar-thumb hover:bg-scrollbar-thumb-hover transition-colors duration-150",
    },
    horizontal: {
      class: "absolute inset-x-0 bottom-0 h-3 p-1",
      thumbClass: "h-full rounded-full bg-scrollbar-thumb hover:bg-scrollbar-thumb-hover transition-colors duration-150",
    },
  });
}

const glyphs: Record<GlyphName, Draw> = {
  // π: the top bar, then the two legs, the right one dipping below.
  pi: (c) => {
    line(c, [4, 6.5, 16, 6.5]);
    line(c, [6.5, 6.5, 6.5, 16]);
    line(c, [13.5, 6.5, 13.5, 12.5]);
    arc(c, 11, 12.5, 2.5, 0, Math.PI);
  },
  folder: (c) => {
    c.beginPath();
    c.moveTo(3.5, 15.5);
    c.lineTo(3.5, 5);
    c.lineTo(8, 5);
    c.lineTo(9.5, 6.8);
    c.lineTo(16.5, 6.8);
    c.lineTo(16.5, 15.5);
    c.closePath();
    c.stroke();
  },
  chat: (c) => {
    c.beginPath();
    c.moveTo(4, 5.5);
    c.lineTo(16, 5.5);
    c.lineTo(16, 13);
    c.lineTo(9, 13);
    c.lineTo(5.5, 16.5);
    c.lineTo(5.5, 13);
    c.lineTo(4, 13);
    c.closePath();
    c.stroke();
  },
  branch: (c) => {
    arc(c, 6, 5.5, 2);
    arc(c, 6, 14.5, 2);
    arc(c, 14, 7.5, 2);
    line(c, [6, 7.5, 6, 12.5]);
    c.beginPath();
    c.moveTo(14, 9.5);
    c.bezierCurveTo(14, 12.5, 10, 11.5, 8.5, 13);
    c.stroke();
  },
  archive: (c) => {
    rect(c, 3.5, 4.5, 13, 4, 1.5);
    line(c, [5, 8.5, 5, 15.5, 15, 15.5, 15, 8.5]);
    line(c, [8, 11.5, 12, 11.5]);
  },
  tree: (c) => {
    line(c, [5, 3.5, 5, 16.5]);
    line(c, [5, 6, 9, 6]);
    line(c, [5, 11, 9, 11]);
    line(c, [9, 11, 9, 14.5]);
    line(c, [9, 14.5, 11.5, 14.5]);
    line(c, [11.5, 12.5, 11.5, 16.5]);
  },
  diff: (c) => {
    rect(c, 3.5, 3.5, 13, 13, 2.5);
    line(c, [7, 7, 7, 13]);
    line(c, [4.8, 10, 9.2, 10]);
    line(c, [13, 7, 13, 13]);
  },
  terminal: (c) => {
    rect(c, 3, 4, 14, 12, 2.5);
    line(c, [6, 8, 8.5, 10, 6, 12]);
    line(c, [10, 12.5, 14, 12.5]);
  },
  gear: (c) => {
    arc(c, 10, 10, 3);
    arc(c, 10, 10, 6.5);
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      line(c, [10 + Math.cos(a) * 6.5, 10 + Math.sin(a) * 6.5, 10 + Math.cos(a) * 8.5, 10 + Math.sin(a) * 8.5]);
    }
  },
  plus: (c) => {
    line(c, [10, 5, 10, 15]);
    line(c, [5, 10, 15, 10]);
  },
  send: (c) => line(c, [5, 11, 10, 6, 15, 11]),
  file: (c) => {
    line(c, [5, 3, 12, 3, 15.5, 6.5, 15.5, 17, 5, 17, 5, 3]);
    line(c, [12, 3, 12, 6.5, 15.5, 6.5]);
  },
  check: (c) => line(c, [5, 10.5, 8.5, 14, 15, 6.5]),
  "caret-right": (c) => line(c, [8, 6, 12.5, 10, 8, 14]),
  "caret-down": (c) => line(c, [6, 8, 10, 12.5, 14, 8]),
  "chevron-left": (c) => line(c, [12.5, 6, 8, 10, 12.5, 14]),
  "chevron-right": (c) => line(c, [7.5, 6, 12, 10, 7.5, 14]),
  reload: (c) => {
    arc(c, 10, 10, 6, -0.6, 4.2);
    line(c, [15.2, 4.6, 15.9, 7.9, 12.5, 8.4]);
  },
  close: (c) => {
    line(c, [6.5, 6.5, 13.5, 13.5]);
    line(c, [13.5, 6.5, 6.5, 13.5]);
  },
  globe: (c) => {
    arc(c, 10, 10, 6.5);
    line(c, [3.5, 10, 16.5, 10]);
    c.beginPath();
    c.moveTo(10, 3.5);
    c.bezierCurveTo(6.5, 6, 6.5, 14, 10, 16.5);
    c.bezierCurveTo(13.5, 14, 13.5, 6, 10, 3.5);
    c.stroke();
  },
  pulse: (c) => line(c, [3, 10, 7, 10, 9, 5, 11.5, 15, 13.5, 10, 17, 10]),
  stop: (c) => {
    c.beginPath();
    c.rect(6, 6, 8, 8);
    c.fill();
  },
  commit: (c) => {
    line(c, [2.5, 10, 7, 10]);
    line(c, [13, 10, 17.5, 10]);
    arc(c, 10, 10, 3);
  },
  minus: (c) => line(c, [5, 10, 15, 10]),
  // A window with its left column marked: the sidebar toggle.
  sidebar: (c) => {
    rect(c, 3.5, 4, 13, 12, 2);
    line(c, [8, 4, 8, 16]);
  },
  // The overflow's three dots, filled.
  more: (c) => {
    for (const x of [5.5, 10, 14.5]) {
      c.beginPath();
      c.arc(x, 10, 1.15, 0, Math.PI * 2);
      c.fill();
    }
  },
  search: (c) => {
    arc(c, 8.8, 8.8, 4.6);
    line(c, [12.2, 12.2, 16.5, 16.5]);
  },
  // A sort ladder: three rows, longest first.
  sort: (c) => {
    line(c, [4, 6, 16, 6]);
    line(c, [4, 10, 12, 10]);
    line(c, [4, 14, 8, 14]);
  },
  // `</>`: the editor's own mark.
  code: (c) => {
    line(c, [7.5, 6.5, 3.5, 10, 7.5, 13.5]);
    line(c, [12.5, 6.5, 16.5, 10, 12.5, 13.5]);
    line(c, [11.5, 4.5, 8.5, 15.5]);
  },
  alert: (c) => {
    c.beginPath();
    c.moveTo(10, 3.5);
    c.lineTo(17, 16.5);
    c.lineTo(3, 16.5);
    c.closePath();
    c.stroke();
    line(c, [10, 8.5, 10, 12]);
    c.beginPath();
    c.arc(10, 14.4, 0.5, 0, Math.PI * 2);
    c.fill();
  },
  // ↑: the send's shaft and head (the `send` chevron stays the transcript's).
  "arrow-up": (c) => {
    line(c, [10, 15.5, 10, 4.5]);
    line(c, [5.5, 9, 10, 4.5, 14.5, 9]);
  },
  shield,
  "shield-alert": (c) => {
    shield(c);
    line(c, [10, 7.2, 10, 10.4]);
    c.beginPath();
    c.arc(10, 12.9, 0.55, 0, Math.PI * 2);
    c.fill();
  },
  "shield-check": (c) => {
    shield(c);
    line(c, [7.4, 10.2, 9.3, 12.1, 12.8, 8.5]);
  },
  // ■: a filled rounded square for the composer's stop (the transcript's
  // `stop` is the plain rect and stays as it is).
  square: (c) => {
    c.beginPath();
    c.roundRect(5.5, 5.5, 9, 9, 2);
    c.fill();
  },
};

/** A glyph stroked with `tint` (a theme token or any color string). */
export function Glyph(props: { name: GlyphName; size?: number; tint?: string }) {
  const size = props.size ?? 20;
  return (
    <Canvas
      style={{ pointerEvents: "none", width: size, height: size }}
      draw={(c, { width }) => {
        c.scale(width / 20, width / 20);
        c.strokeStyle = props.tint ?? token("muted-foreground");
        c.fillStyle = c.strokeStyle;
        c.lineWidth = 1.5;
        c.lineCap = "round";
        c.lineJoin = "round";
        glyphs[props.name](c);
      }}
    />
  );
}

/**
 * The app mark: `<-→` (Steer's bidirectional arrow) with Zu Chongzhi's
 * milü — 355 above the shaft, 113 below — in the 32-unit box the glyphs
 * use. The stroke and the digits take `ink`.
 */
/** A filled status dot. */
export function Dot(props: { tint: string; size?: number }) {
  const size = props.size ?? 7;
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: props.tint }} />;
}

/** A rounded label chip (model names, branches, counts). */
export function Chip(props: { label: string; tint?: string; filled?: boolean }) {
  return (
    <View
      style={{
        height: 20,
        paddingHorizontal: 8,
        borderRadius: 10,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: props.filled ? token("primary") : "transparent",
        borderWidth: props.filled ? 0 : 1,
        borderColor: token("border"),
      }}
    >
      <Text
        style={{
          fontSize: 11,
          fontWeight: "500",
          color: props.filled ? token("primary-foreground") : (props.tint ?? token("muted-foreground")),
        }}
      >
        {props.label}
      </Text>
    </View>
  );
}

/**
 * A quiet square icon control for a sheet's header: `tint` colors the glyph
 * (muted by default); `disabled` drops the hover and the pressed wash. Every
 * one is a labelled button, since the glyph alone is not its name.
 */
export function SheetIconButton(props: {
  testID: string;
  label: string;
  glyph: GlyphName;
  tint?: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <View
      role="button"
      testID={props.testID}
      accessibilityLabel={props.label}
      tooltip={props.label}
      disabled={props.disabled ?? false}
      class={
        props.disabled
          ? "h-6 w-6 items-center justify-center rounded-md opacity-40"
          : "h-6 w-6 items-center justify-center rounded-md hover:bg-hover active:opacity-60 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
      }
      style={{ ...motionStyle("fast") }}
      onPress={props.onPress}
    >
      <Glyph name={props.glyph} size={12} tint={token((props.tint ?? "muted-foreground") as any)} />
    </View>
  );
}

/** A labelled sheet action; `primary` is the one strong action of a surface. */
export function SheetAction(props: {
  testID: string;
  label: string;
  primary?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const base =
    "h-7 flex-row items-center justify-center rounded-lg px-2.5 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1";
  const look = props.disabled
    ? "border border-line opacity-40"
    : props.primary
      ? "bg-primary hover:bg-primary/90 active:opacity-80"
      : "border border-line hover:bg-hover active:opacity-70";
  return (
    <View
      role="button"
      testID={props.testID}
      accessibilityLabel={props.label}
      disabled={props.disabled ?? false}
      class={`${base} ${look}`}
      style={{ ...motionStyle("fast") }}
      onPress={() => {
        if (!props.disabled) props.onPress();
      }}
    >
      <Text
        class={`text-[11.5px] font-medium ${props.primary ? "text-primary-foreground" : "text-foreground"}`}
      >
        {props.label}
      </Text>
    </View>
  );
}
