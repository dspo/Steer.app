import { Canvas, createAnimatedValue, effect, Scroll, signal, Text, token, View } from "nsh";
import { Menu, MenuItem, Submenu } from "nsh/base";
import { K, t } from "../../ui/i18n";
import {
  loadPiModels,
  manoxModelRef,
  modelLabel,
  piModelsError,
  piProviders,
  usableModels,
} from "../../domains/pimodels";
import type { PiModelInfo, PiProvider } from "../../domains/pimodels";
import {
  manoxModelRefOf,
  rootModelOf,
  sessionConfigValue,
  sessionOf,
  setManoxConfig,
} from "./stores";
import { Glyph, motionStyle, shadowRaised, type GlyphName } from "../../ui/ui";

/**
 * The manox composer footer's controls (DESIGN §3.6a, Q110): one row, two
 * clusters. Left the disabled `+` and the access-mode switch; right the
 * context ring, the model, the reasoning effort and the one action
 * (send / stop). The triggers share one look — h-7, rounded-lg, quiet at
 * rest, `bg-hover` on hover and `bg-accent` while their menu is open — so
 * the footer reads as one control group, like ZCode's toolbar. Everything is
 * AHP session config: the values live on the session fold
 * (`config.values`), a pick dispatches `session/configChanged`.
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

/** manox's reasoning-effort ladder, localized; unknown raw values stay as they are. */
const THINKING_KEYS: Record<string, string> = {
  off: K.manox.thinkingOff,
  minimal: K.manox.thinkingMinimal,
  low: K.manox.thinkingLow,
  medium: K.manox.thinkingMedium,
  high: K.manox.thinkingHigh,
  xhigh: K.manox.thinkingXhigh,
  max: K.manox.thinkingMax,
};

/** A reasoning-effort value's label, localized when the shell knows it. */
function thinkingLabel(value: string): string {
  const key = THINKING_KEYS[value];
  return key ? t(key) : value;
}

/**
 * The reasoning-effort trigger over the schema's writable enum (the host
 * exposes `high`/`max`; a current value outside it stays named in the
 * trigger, with a disabled "current" row above the writable choices).
 * Selecting dispatches `session/configChanged` with `reasoningEffort`.
 */
export function ManoxThinking(props: { threadId: string }) {
  const open = signal(false);
  const options = () => configEnumOf(props.threadId, "reasoningEffort", ["high", "max"]);
  const current = () => {
    const value = sessionConfigValue(props.threadId, "reasoningEffort");
    return typeof value === "string" ? value : options()[0];
  };
  const outOfEnum = () => !options().includes(current());
  return (
    <Menu
      open={open()}
      onOpenChange={({ open: next }) => open.set(next)}
      placement="top"
      align="end"
      offset={6}
      popupClass="rounded-xl border border-border bg-popover p-1"
      popupStyle={{ width: 168, boxShadow: shadowRaised() }}
      trigger={
        <View
          role="button"
          testID="manox-thinking"
          accessibilityLabel={`${t(K.manox.thinking)}：${thinkingLabel(current())}`}
          accessibilityState={{ expanded: open(), hasPopup: true }}
          tooltip={`${t(K.manox.thinking)} · ${thinkingLabel(current())}`}
          class={`${footerTrigger(open())} gap-1 px-1.5`}
          style={{ ...motionStyle("fast") }}
        >
          <Text class="text-[12px] text-muted-foreground" style={{ numberOfLines: 1 }}>
            {thinkingLabel(current())}
          </Text>
          <Glyph name="caret-down" size={8} tint={token("faint")} />
        </View>
      }
    >
      <If when={outOfEnum()}>
        <MenuItem
          disabled
          class="rounded-lg px-2.5 py-1.5 opacity-40"
        >
          <Text class="text-[12px] text-muted-foreground" style={{ numberOfLines: 1 }}>
            {`${t(K.manox.thinkingCurrent)} · ${thinkingLabel(current())}`}
          </Text>
        </MenuItem>
      </If>
      <Each of={options()} key={(value) => value}>
        {(value) => (
          <MenuItem
            testID={`manox-thinking-${value()}`}
            checked={current() === value()}
            role="menuitemradio"
            class="rounded-lg px-2.5 py-1.5 hover:bg-hover focus:bg-hover active:bg-accent"
            onSelect={() => setManoxConfig(props.threadId, { reasoningEffort: value() })}
          >
            <View class="flex-row items-center" style={{ flex: 1, minWidth: 0, gap: 8 }}>
              <Text class="flex-1 text-[12px] text-foreground" style={{ numberOfLines: 1 }}>
                {thinkingLabel(value())}
              </Text>
              <If when={current() === value()}>
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
 * `inputTokens + cacheReadTokens` over the root model's `maxPromptTokens`.
 * The tooltip carries the full fact so the dial alone never has to be read.
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

/** The ring's denominator: the root model's prompt budget (window as fallback). */
export function contextMaxTokens(ref: string): number {
  const model = rootModelOf(ref);
  if (!model) return 0;
  return model.maxPromptTokens ?? model.maxContextWindow ?? 0;
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

/**
 * The model picker: the trigger shows the session model's display name (no
 * provider prefix — the name is the fact the user picks by), resolved by
 * reverse-matching the pi catalogue's registration-qualified ref against the
 * config model; the tooltip keeps the full ref. The menu is the two-level
 * provider→model list over `usableModels()` — the machine's single model
 * source for both harnesses. Selecting dispatches `session/configChanged`
 * with the ref the manox kernel resolves.
 */
export function ManoxModel(props: { threadId: string }) {
  const open = signal(false);
  // One load per composer, so the menu has rows without a first open.
  let asked = false;
  effect(() => {
    if (asked) return;
    asked = true;
    void loadPiModels();
  });
  const current = () => manoxModelRefOf(props.threadId);
  const rows = () => usableModels();
  const currentRow = () => rows().find((row) => manoxModelRef(row) === current());
  const display = () => {
    const row = currentRow();
    return row ? modelLabel(row) : current() || t(K.session.model);
  };
  // A failed first load leaves the providers null but the error set; the
  // menu must show the reason rather than a spinner that never ends.
  const loaded = () => piProviders() !== null || piModelsError() !== null;
  const groups = (): Array<{ provider: PiProvider; models: PiModelInfo[] }> => {
    const out: Array<{ provider: PiProvider; models: PiModelInfo[] }> = [];
    const byId = new Map<string, PiModelInfo[]>();
    for (const row of rows()) {
      let bucket = byId.get(row.provider.id);
      if (!bucket) {
        bucket = [];
        byId.set(row.provider.id, bucket);
        out.push({ provider: row.provider, models: bucket });
      }
      bucket.push(row.model);
    }
    return out;
  };
  const choose = (row: { provider: PiProvider; model: PiModelInfo }) => {
    setManoxConfig(props.threadId, { model: manoxModelRef(row) });
  };
  return (
    <Menu
      open={open()}
      onOpenChange={({ open: next }) => {
        open.set(next);
        if (next) void loadPiModels();
      }}
      placement="top"
      align="start"
      offset={6}
      popupClass="rounded-xl border border-border bg-popover p-1"
      popupStyle={{ width: 310, maxHeight: 420, boxShadow: shadowRaised() }}
      trigger={
        <View
          role="button"
          testID="manox-model"
          accessibilityLabel={display()}
          accessibilityState={{ expanded: open(), hasPopup: true }}
          tooltip={current() || display()}
          class={`${footerTrigger(open())} min-w-0 gap-1 px-1.5`}
          style={{ ...motionStyle("fast") }}
        >
          <Text
            class={
              currentRow()
                ? "min-w-0 text-[12.5px] font-medium text-foreground"
                : "min-w-0 text-[12.5px] text-muted-foreground"
            }
            style={{ numberOfLines: 1, flexShrink: 1 }}
          >
            {display()}
          </Text>
          <Glyph name="caret-down" size={8} tint={token("faint")} />
        </View>
      }
    >
      <Scroll style={{ maxHeight: 380 }} contentStyle={{ gap: 1 }}>
        <If when={!loaded()}>
          <Text class="px-2 py-2 text-[11.5px] text-faint">{t(K.session.modelsLoading)}</Text>
        </If>
        <If when={loaded() && !!piModelsError()}>
          <Text class="px-2 py-1.5 text-[11px] text-destructive" style={{ numberOfLines: 2 }}>
            {t(K.session.modelsError, { error: piModelsError() ?? "" })}
          </Text>
        </If>
        <If when={loaded() && !piModelsError() && groups().length === 0}>
          <Text testID="manox-model-reason" class="px-2 py-2 text-[11.5px] leading-[16px] text-faint">
            {t(K.session.modelsEmpty)}
          </Text>
        </If>
        <Each of={groups()} key={(group) => group.provider.id}>
          {(group) => (
            <Submenu
              trigger={
                <View
                  role="button"
                  testID={`manox-model-provider-${group().provider.id}`}
                  accessibilityLabel={group().provider.name || group().provider.id}
                  class="flex-row items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-hover focus:bg-hover active:bg-accent"
                  style={{ ...motionStyle("fast") }}
                >
                  <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
                    <Text class="text-[12px] font-medium text-foreground" style={{ numberOfLines: 1 }}>
                      {group().provider.name || group().provider.id}
                    </Text>
                    <Text class="text-[10px] text-faint" style={{ numberOfLines: 1 }}>
                      {group().provider.id}
                    </Text>
                  </View>
                  <Glyph name="chevron-right" size={10} tint={token("faint")} />
                </View>
              }
            >
              <Each of={group().models} key={(model) => model.id}>
                {(model) => (
                  <MenuItem
                    testID={`manox-model-${group().provider.id}-${model().id}`}
                    checked={manoxModelRef({ provider: group().provider, model: model() }) === current()}
                    role="menuitemradio"
                    class="rounded-lg px-2.5 py-1.5 hover:bg-hover focus:bg-hover active:bg-accent"
                    onSelect={() => choose({ provider: group().provider, model: model() })}
                  >
                    <View class="flex-row items-center" style={{ flex: 1, minWidth: 0, gap: 8 }}>
                      <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
                        <Text class="text-[12px] font-medium text-foreground" style={{ numberOfLines: 1 }}>
                          {modelLabel({ provider: group().provider, model: model() })}
                        </Text>
                        <Text class="text-[10px] text-faint" style={{ numberOfLines: 1 }}>
                          {model().id}
                          {model().contextWindow ? ` · ${formatTokens(model().contextWindow ?? 0)}` : ""}
                        </Text>
                      </View>
                      <If when={manoxModelRef({ provider: group().provider, model: model() }) === current()}>
                        <Glyph name="check" size={11} tint={token("brand")} />
                      </If>
                    </View>
                  </MenuItem>
                )}
              </Each>
            </Submenu>
          )}
        </Each>
      </Scroll>
    </Menu>
  );
}
