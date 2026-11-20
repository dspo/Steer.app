import { Canvas, createAnimatedValue, effect, signal, Text, token, View } from "nsh";
import { Menu, MenuItem } from "nsh/base";
import { K, t } from "../../ui/i18n";
import type { ModelCatalog } from "../../domains/manox";
import { sessionConfigValue, sessionOf, setManoxConfig } from "./stores";
import { Glyph, motionStyle, shadowRaised, type GlyphName } from "../../ui/ui";

/**
 * The manox composer footer's controls (DESIGN §3.6a, Q124): one row, two
 * clusters. Left the disabled `+` and the access-mode switch; right the
 * context ring and the one action (send / stop) — the model and reasoning
 * effort are the kernel-catalogue pickers in `composer.tsx`. The triggers
 * here share one look — h-7, rounded-lg, quiet at rest, `bg-hover` on hover
 * and `bg-accent` while their menu is open — so the footer reads as one
 * control group, like ZCode's toolbar. Everything is AHP session config: the
 * values live on the session fold (`config.values`), a pick dispatches
 * `session/configChanged`.
 */

/** One footer trigger's look; `open` swaps the hover wash for the accent. */
function footerTrigger(open?: boolean): string {
  const look = open ? "bg-accent" : "hover:bg-hover";
  return `h-7 flex-row items-center rounded-lg active:opacity-70 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1 ${look}`;
}

/** `12.3k`, `1M`, `840`: a token count at a glance. */
function formatTokens(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens < 0) return "—";
  if (tokens >= 1_000_000) {
    const value = tokens / 1_000_000;
    return `${value >= 10 ? Math.round(value) : Math.round(value * 10) / 10}M`;
  }
  if (tokens >= 1_000) {
    const value = tokens / 1_000;
    return `${value >= 100 ? Math.round(value) : Math.round(value * 10) / 10}k`;
  }
  return String(Math.round(tokens));
}

/** The context ring's one line: `12.3k / 1M · 1%`. */
function formatContextLine(used: number, max: number): string {
  if (!Number.isFinite(used) || !Number.isFinite(max) || max <= 0) return "";
  const percent = Math.min(Math.max((used / max) * 100, 0), 100);
  return `${formatTokens(used)} / ${formatTokens(max)} · ${Math.round(percent)}%`;
}

/** The context ring's share, clamped into 0..1 (the arc's sweep). */
function contextShare(used: number, max: number): number {
  if (!Number.isFinite(used) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.min(Math.max(used / max, 0), 1);
}

/** A config property's string enum, falling back when the host lists none. */
function configEnumOf(threadId: string, key: string, fallback: string[]): string[] {
  const raw = sessionOf(threadId)?.config?.schema.properties[key]?.enum ?? [];
  const values = raw.filter((value): value is string => typeof value === "string");
  return values.length > 0 ? values : fallback;
}

/**
 * The `+` is a disabled placeholder: attachments are not in the app yet
 * (dspo-group/Steer.app#5 — the manox harness models them, the shell has no
 * picker/upload path). It keeps the layout's left anchor so the footer
 * doesn't reflow when the capability lands.
 */
export function ManoxPlus() {
  const label = () => `${t(K.manox.attach)} · ${t(K.manox.attachUnavailable)}`;
  return (
    <View
      role="button"
      testID="manox-attach"
      accessibilityLabel={label()}
      tooltip={label()}
      disabled
      class="h-7 w-7 items-center justify-center rounded-lg opacity-40 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
    >
      <Glyph name="plus" size={14} tint={token("muted-foreground")} />
    </View>
  );
}

/** Access mode → its glyph and tint: the loud `full-access` is warn, the quiet `sandbox` is info. */
const MODE_LOOK: Record<string, { glyph: GlyphName; tint: "muted-foreground" | "warn" | "info" }> = {
  sandbox: { glyph: "shield-check", tint: "info" },
  "full-access": { glyph: "shield-alert", tint: "warn" },
};

/** The access modes the shell names, in the user's words (unknown ids fall back to the raw value). */
const MODE_KEYS: Record<string, { label: string; hint: string }> = {
  sandbox: { label: K.manox.modeSandbox, hint: K.manox.modeSandboxHint },
  "full-access": { label: K.manox.modeFullAccess, hint: K.manox.modeFullAccessHint },
};

/**
 * The access-mode switch: one trigger that names the current mode over a
 * radio menu of the schema's modes. The switch dispatches
 * `session/configChanged` with `accessMode`; the label follows the fold.
 */
export function ManoxMode(props: { threadId: string }) {
  const open = signal(false);
  const modes = () => configEnumOf(props.threadId, "accessMode", ["sandbox", "full-access"]);
  const current = () => {
    const value = sessionConfigValue(props.threadId, "accessMode");
    return typeof value === "string" ? value : modes()[0];
  };
  const modeName = (id: string) => {
    const keys = MODE_KEYS[id];
    return keys ? t(keys.label) : id;
  };
  const modeHint = (id: string) => {
    const keys = MODE_KEYS[id];
    return keys ? t(keys.hint) : "";
  };
  const look = () => MODE_LOOK[current()] ?? { glyph: "shield" as GlyphName, tint: "muted-foreground" as const };
  return (
    <Menu
      open={open()}
      onOpenChange={({ open: next }) => open.set(next)}
      placement="top"
      align="start"
      offset={6}
      popupClass="rounded-xl border border-border bg-popover p-1"
      popupStyle={{ width: 268, boxShadow: shadowRaised() }}
      trigger={
        <View
          role="button"
          testID="manox-mode"
          accessibilityLabel={`${t(K.manox.accessMode)}：${modeName(current())}`}
          accessibilityState={{ expanded: open(), hasPopup: true }}
          tooltip={`${t(K.manox.accessMode)} · ${modeName(current())}`}
          class={`${footerTrigger(open())} gap-1 px-2`}
          style={{ ...motionStyle("fast") }}
        >
          <Glyph name={look().glyph} size={15} tint={token(look().tint)} />
          <Text class="text-[12px] font-medium" style={{ color: token(look().tint), numberOfLines: 1 }}>
            {modeName(current())}
          </Text>
          <Glyph name="caret-down" size={8} tint={token("faint")} />
        </View>
      }
    >
      <Each of={modes()} key={(mode) => mode}>
        {(mode) => (
          <MenuItem
            testID={`manox-mode-${mode()}`}
            checked={current() === mode()}
            role="menuitemradio"
            class="rounded-lg px-2.5 py-1.5 hover:bg-hover focus:bg-hover active:bg-accent"
            onSelect={() => setManoxConfig(props.threadId, { accessMode: mode() })}
          >
            <View class="flex-row items-center" style={{ flex: 1, minWidth: 0, gap: 8 }}>
              <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
                <Text class="text-[12px] text-foreground" style={{ numberOfLines: 1 }}>
                  {modeName(mode())}
                </Text>
                <If when={!!modeHint(mode())}>
                  <Text class="text-[10.5px] leading-[14px] text-faint" style={{ numberOfLines: 2 }}>
                    {modeHint(mode())}
                  </Text>
                </If>
              </View>
              <If when={current() === mode()}>
                <Glyph name="check" size={11} tint={token("brand")} />
              </If>
            </View>
          </MenuItem>
        )}
      </Each>
    </Menu>
  );
}

/**
 * The context ring: the LAST TURN's usage compressed into one 14pt dial — a
 * quiet track at 25% alpha and the used arc at 70%, round heads, from twelve
 * o'clock. It is not a live gauge: the inputs are the latest settled turn's
 * `inputTokens + cacheReadTokens` over the current model's context window in
 * the kernel catalogue. The tooltip carries the full fact so the dial alone
 * never has to be read.
 */
export function ManoxContextRing(props: { used: () => number; max: () => number }) {
  const line = () => formatContextLine(props.used(), props.max());
  const label = () => `${t(K.manox.contextUsage)} · ${line()}`;
  // The arc is a native canvas; it redraws only for an animated value it
  // reads, so the sweep rides one instead of the usage snapshot.
  const sweepEnd = createAnimatedValue(-Math.PI / 2);
  effect(() => {
    sweepEnd.set(-Math.PI / 2 + Math.PI * 2 * contextShare(props.used(), props.max()));
  });
  return (
    <If when={props.used() > 0 && props.max() > 0}>
      <View
        testID="manox-context"
        role="progressbar"
        accessibilityLabel={label()}
        accessibilityValue={{ text: line() }}
        tooltip={label()}
        class="h-7 w-7 items-center justify-center rounded-lg"
      >
        <Canvas
          style={{ width: 14, height: 14 }}
          draw={(c, { width }) => {
            c.scale(width / 14, width / 14);
            c.strokeStyle = token("muted-foreground");
            c.lineWidth = 1.5;
            c.lineCap = "round";
            // The track first, then the arc from the top, clockwise.
            c.beginPath();
            c.globalAlpha = 0.25;
            c.arc(7, 7, 6.25, 0, Math.PI * 2);
            c.stroke();
            c.beginPath();
            c.globalAlpha = 0.7;
            c.arc(7, 7, 6.25, -Math.PI / 2, sweepEnd);
            c.stroke();
          }}
        />
      </View>
    </If>
  );
}

/** The usage tokens the ring counts: input plus the cache reads. */
export function contextUsedTokens(usage: { inputTokens?: number; cacheReadTokens?: number } | null): number {
  if (!usage) return 0;
  return (usage.inputTokens ?? 0) + (usage.cacheReadTokens ?? 0);
}

/** The ring's denominator: the current model's context window in the kernel
 * catalogue (the directory carries no separate prompt budget). */
export function contextMaxTokens(ref: string, catalog: ModelCatalog | null): number {
  if (!ref || !catalog) return 0;
  const model = catalog.providers.flatMap((provider) => provider.models).find((m) => m.reference === ref);
  return model?.contextWindow ?? 0;
}

/**
 * The composer's one action spot: idle is the ↑ send, streaming is the ■
 * stop in the same 28pt square. Stop is neutral (a turn ending is not a
 * failure) and never gated by the draft; send is only as live as the draft.
 * The swap rides an `If`, not a body branch: a component runs once, and only
 * a control structure's binding re-reads `props.streaming` when the turn
 * starts or settles.
 */
export function ManoxAction(props: {
  streaming: boolean;
  disabled: boolean;
  onSubmit: () => void;
  onStop: () => void;
}) {
  return (
    <If
      when={props.streaming}
      else={
        <View
          role="button"
          testID="manox-send"
          accessibilityLabel={t(K.session.send)}
          tooltip={t(K.session.send)}
          disabled={props.disabled}
          class={
            props.disabled
              ? "h-7 w-7 items-center justify-center rounded-lg bg-muted opacity-40 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
              : "h-7 w-7 items-center justify-center rounded-lg bg-primary hover:bg-primary/90 active:opacity-80 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
          }
          style={{ ...motionStyle("fast") }}
          onPress={() => {
            if (!props.disabled) props.onSubmit();
          }}
        >
          <Glyph name="arrow-up" size={14} tint={token(props.disabled ? "faint" : "primary-foreground")} />
        </View>
      }
    >
      {/* Stop is absolute: never gated by the draft. */}
      <View
        role="button"
        testID="manox-stop"
        accessibilityLabel={t(K.session.stop)}
        tooltip={t(K.session.stop)}
        class="h-7 w-7 items-center justify-center rounded-lg bg-secondary hover:bg-muted active:opacity-70 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
        style={{ ...motionStyle("fast") }}
        onPress={() => props.onStop()}
      >
        <Glyph name="square" size={12} tint={token("foreground")} />
      </View>
    </If>
  );
}
