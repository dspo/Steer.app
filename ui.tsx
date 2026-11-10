import { Canvas, type CanvasRenderingContext2D, reduceMotion, Text, token, View } from "nsh";
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
  | "globe"
  | "pulse"
  | "stop"
  | "alert";

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

/** The shell's motion tokens: short, eased color/opacity changes, never motion for its own sake. */
export const motion = {
  fast: {
    transitionProperty: "background-color, opacity, color, border-color",
    transitionDuration: 120,
    transitionTimingFunction: "ease-out" as const,
  },
  medium: {
    transitionProperty: "background-color, opacity, box-shadow",
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

/** A surface that sits above the page: menus, launcher cards, toasts. */
export function shadowRaised(): string {
  return `0 1px 2px ${token("shadow")}, 0 8px 24px ${token("shadow")}`;
}

/** The topmost decision layer: dialogs. */
export function shadowDialog(): string {
  return `0 2px 6px ${token("shadow")}, 0 18px 44px ${token("shadow-strong")}`;
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
  plus: (c) => line(c, [10, 5, 10, 15]),
  send: (c) => line(c, [5, 11, 10, 6, 15, 11]),
  file: (c) => {
    line(c, [5, 3, 12, 3, 15.5, 6.5, 15.5, 17, 5, 17, 5, 3]);
    line(c, [12, 3, 12, 6.5, 15.5, 6.5]);
  },
  check: (c) => line(c, [5, 10.5, 8.5, 14, 15, 6.5]),
  "caret-right": (c) => line(c, [8, 6, 12.5, 10, 8, 14]),
  "caret-down": (c) => line(c, [6, 8, 10, 12.5, 14, 8]),
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
export function Logo(props: { size?: number; ink?: string }) {
  const size = props.size ?? 34;
  return (
    <Canvas
      style={{ pointerEvents: "none", width: size, height: size }}
      draw={(c, { width }) => {
        c.scale(width / 32, width / 32);
        const ink = props.ink ?? token("primary-foreground");
        c.strokeStyle = ink;
        c.fillStyle = ink;
        c.lineWidth = 1.8;
        c.lineCap = "round";
        c.lineJoin = "round";
        c.beginPath();
        // The shaft, then the two arrowheads.
        c.moveTo(4, 16);
        c.lineTo(28, 16);
        c.moveTo(8.5, 12.5);
        c.lineTo(4, 16);
        c.lineTo(8.5, 19.5);
        c.moveTo(23.5, 12.5);
        c.lineTo(28, 16);
        c.lineTo(23.5, 19.5);
        c.stroke();
        // 355/113 ≈ π, above and below the shaft.
        c.font = "600 6.5px system-ui";
        c.textAlign = "center";
        c.fillText("355", 16, 9);
        c.fillText("113", 16, 29.5);
      }}
    />
  );
}

/** A filled status dot. */
export function Dot(props: { tint: string; size?: number }) {
  const size = props.size ?? 7;
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: props.tint }} />;
}

/** A small all-caps section title used across the sidebar and the panel. */
export function SectionTitle(props: { label: string; trailing?: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingTop: 16, paddingBottom: 6 }}>
      <Text style={{ flex: 1, fontSize: 11, fontWeight: "600", letterSpacing: 0.6, color: token("faint") }}>{props.label}</Text>
      {props.trailing ? (
        <Text style={{ fontSize: 11, color: token("faint") }}>{props.trailing}</Text>
      ) : null}
    </View>
  );
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
