import { Canvas, effect, reduceMotion, signal, Text, token, View } from "nsh";
import { SHEET_FONT, SHEET_MONO } from "../../ui/fonts";
import { K, t } from "../../ui/i18n";
import { sessionTitle } from "./sessions";

/**
 * The history-loading page (issue #20 follow-up): a restored session's sheet
 * draws this while its replay is in flight, never the conversation page.
 * The sprite is the manox app's pixel meerkat
 * (`manox-app/crates/ai-elements/src/meerkat.rs`), ported to a Canvas: the
 * same 12×14 grids, the same 6-slot loop (idle, bob, blink, bob, idle, tail
 * flick) at 3 slots/s. Its palette is mapped to semantic tokens, not raw
 * hex, so it follows the theme in light and dark.
 */

const GRID_W = 12;
const GRID_H = 14;
/** Cell edge in points; 9 keeps the sprite readable in the empty column. */
const CELL = 9;
const SLOT_MS = 1000 / 3;
const CYCLE = [0, 1, 2, 1, 0, 3];

/** Frame 0: eyes open, tail down. Rows are exactly 12 chars wide. */
const F0 = [
  "..oo....oo..",
  ".oddo..oddo.",
  ".obboooobbo.",
  ".obbbbbbbbo.",
  "obbEEbbEEbo.",
  "obbEEbbEEbbo",
  ".obbbddbbbo.",
  "..obbbbbbo.t",
  "..obllllbo.t",
  "..obllllbo.t",
  "..obllllbo.t",
  "..obllllbo.t",
  "..obb..bbo.t",
  "..oo....oo..",
];

/** Bob: every row shifts one cell down; the feet row falls off the grid. */
const F1 = [
  "............",
  "..oo....oo..",
  ".oddo..oddo.",
  ".obboooobbo.",
  ".obbbbbbbbo.",
  "obbEEbbEEbo.",
  "obbEEbbEEbbo",
  ".obbbddbbbo.",
  "..obbbbbbo.t",
  "..obllllbo.t",
  "..obllllbo.t",
  "..obllllbo.t",
  "..obllllbo.t",
  "..obb..bbo.t",
];

/** Blink: the eye patches collapse to a thin outline line. */
const F2 = [
  "..oo....oo..",
  ".oddo..oddo.",
  ".obboooobbo.",
  ".obbbbbbbbo.",
  "obbbbbbbbbbo",
  "obboobboobbo",
  ".obbbddbbbo.",
  "..obbbbbbo.t",
  "..obllllbo.t",
  "..obllllbo.t",
  "..obllllbo.t",
  "..obllllbo.t",
  "..obb..bbo.t",
  "..oo....oo..",
];

/** Tail flick: the tail cells lift to head height on the right edge. */
const F3 = [
  "..oo....oo..",
  ".oddo..oddo.",
  ".obboooobbot",
  ".obbbbbbbbot",
  "obbEEbbEEbot",
  "obbEEbbEEbbt",
  ".obbbddbbbo.",
  "..obbbbbbo..",
  "..obllllbo..",
  "..obllllbo..",
  "..obllllbo..",
  "..obllllbo..",
  "..obb..bbo..",
  "..oo....oo..",
];

const FRAMES = [F0, F1, F2, F3];

type Role = "meerkat-outline" | "meerkat-body" | "meerkat-belly" | "meerkat-eye" | "meerkat-tail";

/** The meerkat's inks, the app's theme data colors (the sprite is content,
 * so its browns live in `theme.json`, not as raw hex in TSX). */
const INK: Record<string, Role> = {
  o: "meerkat-outline",
  b: "meerkat-body",
  l: "meerkat-belly",
  E: "meerkat-eye",
  d: "meerkat-eye",
  t: "meerkat-tail",
};

export function HistoryLoading(props: { id: string }) {
  const slot = signal(0);
  // A long load is the only reason this page exists; the sprite is the
  // progress signal, so it plays until the replay lands. Reduced motion
  // pins the idle frame.
  effect(() => {
    if (reduceMotion()) return;
    const timer = setInterval(() => slot.set((slot() + 1) % CYCLE.length), SLOT_MS);
    return () => clearInterval(timer);
  });
  return (
    <View
      testID="session-loading"
      class="flex-1 items-center justify-center bg-background"
      style={{ gap: 14 }}
    >
      <Canvas
        testID="session-loading-sprite"
        style={{ width: GRID_W * CELL, height: GRID_H * CELL }}
        draw={(c, { width }) => {
          const cell = width / GRID_W;
          const frame = FRAMES[CYCLE[slot()] ?? 0] ?? F0;
          for (let y = 0; y < frame.length; y += 1) {
            const row = frame[y] ?? "";
            for (let x = 0; x < row.length; x += 1) {
              const ink = INK[row.charAt(x)];
              if (!ink) continue;
              c.fillStyle = token(ink);
              c.fillRect(x * cell, y * cell, cell, cell);
            }
          }
        }}
      />
      <View class="items-center" style={{ gap: 4 }}>
        <Text class="text-[14px] font-semibold text-foreground" style={{ fontFamily: SHEET_FONT }}>
          {t(K.session.loading)}
        </Text>
        <Text
          class="text-[11px] text-faint"
          style={{ fontFamily: SHEET_MONO, numberOfLines: 1, maxWidth: 360 }}
        >
          {sessionTitle(props.id)}
        </Text>
      </View>
    </View>
  );
}
