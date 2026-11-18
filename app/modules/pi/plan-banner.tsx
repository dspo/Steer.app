import { Canvas, cleanup, effect, reduceMotion, signal, Text, token, View } from "nsh";
import { K, t } from "../../ui/i18n";
import { Glyph, motionStyle } from "../../ui/ui";
import { planCurrentItem } from "./protocol";
import { containerOfSession, loadPlanFor, openPlan, planEnabled, planFor, PLAN_POLL_MS } from "./todos";

/**
 * The composer banner (A2 v2): while the session's plan has work left, a
 * quiet bar above the composer shows the item the plan is on right now —
 * the in_progress step under a braille spinner, else the next pending step
 * under the spinner at rest. Pressing it splits the session's sheet to the
 * right with the plan sheet (the panel itself is unchanged); when every
 * item is done the banner disappears, and with it the entry to the finished
 * history (accepted for this version).
 *
 * The banner is the plan's only entry, so it renders only where the plan
 * sheet's data matches: on the container's captain session, the one the
 * panel reads.
 */

/** The spinner's orbit: the lit dot runs clockwise around the braille
 * cell's six positions (2 columns × 3 rows, the geometry the classic
 * ⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏ frames use). */
const ORBIT: Array<[number, number]> = [
  [0, 0],
  [0, 1],
  [1, 1],
  [2, 1],
  [2, 0],
  [1, 0],
];
const SPIN_ROWS = 3;
const SPIN_FRAME_MS = 120;
/** The spinner canvas: one braille cell, 2 columns × 3 rows of dots. */
const SPINNER = { width: 11, height: 15, dot: 1.4 };

/**
 * The braille dot-matrix spinner, drawn on Canvas so no font has to carry
 * braille glyphs. Spins while the item is in progress; at rest it shows a
 * dimmed frame (a plan waiting, not a glitch).
 */
function BrailleSpinner(props: { active: boolean }) {
  const frame = signal(0);
  effect(() => {
    if (!props.active || reduceMotion()) return;
    const timer = setInterval(() => frame.update((value) => (value + 1) % ORBIT.length), SPIN_FRAME_MS);
    cleanup(() => clearInterval(timer));
  });
  return (
    <Canvas
      style={{ width: SPINNER.width, height: SPINNER.height, pointerEvents: "none" }}
      draw={(c, size) => {
        const head = frame();
        const x = (col: number) => (col === 0 ? size.width * 0.3 : size.width * 0.7);
        const y = (row: number) => ((row + 0.5) / SPIN_ROWS) * size.height;
        for (let i = 0; i < ORBIT.length; i++) {
          const [row, col] = ORBIT[i];
          const distance = (head - i + ORBIT.length) % ORBIT.length;
          const alpha = props.active ? (distance === 0 ? 1 : distance === 1 ? 0.45 : distance === 2 ? 0.2 : 0) : 0.3;
          if (alpha <= 0) continue;
          c.globalAlpha = alpha;
          c.fillStyle = token("brand");
          c.beginPath();
          c.arc(x(col), y(row), SPINNER.dot, 0, Math.PI * 2);
          c.fill();
        }
        c.globalAlpha = 1;
      }}
    />
  );
}

/** The session's current plan item, or null while there is nothing to show. */
function bannerItem(sessionId: string): { title: string; active: boolean } | null {
  const file = planFor(sessionId);
  return file ? planCurrentItem(file) : null;
}

export function PlanBanner(props: { sessionId: string }) {
  const onCaptain = () => containerOfSession(props.sessionId) !== null;
  const item = () => bannerItem(props.sessionId);
  // The poll lives while the sheet is drawn (ChatView only mounts visible);
  // a non-captain session's plan is not the panel's, so it is not read.
  effect(() => {
    const refresh = () => {
      if (containerOfSession(props.sessionId)) void loadPlanFor(props.sessionId);
    };
    refresh();
    const timer = setInterval(refresh, PLAN_POLL_MS);
    cleanup(() => clearInterval(timer));
  });
  return (
    <If when={onCaptain() && planEnabled(props.sessionId) && !!item()}>
      <View
        role="button"
        testID="plan-banner"
        accessibilityLabel={t(K.plan.banner)}
        class="flex-row items-center gap-2 rounded-xl border border-line bg-card px-3 py-2 hover:bg-hover active:opacity-80"
        style={{ ...motionStyle("fast") }}
        onPress={() => openPlan(props.sessionId)}
      >
        <BrailleSpinner active={item()!.active} />
        <Text class="flex-1 text-[12px] text-foreground" style={{ numberOfLines: 1 }}>
          {item()!.title}
        </Text>
        <Glyph name="caret-right" size={11} tint={token("faint")} />
      </View>
    </If>
  );
}
