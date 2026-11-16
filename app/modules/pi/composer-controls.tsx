import { Canvas, createAnimatedValue, effect, Scroll, signal, Text, token, View } from "nsh";
import { Menu, MenuItem, Submenu } from "nsh/base";
import { K, t } from "../../ui/i18n";
import type { SessionContextUsage, SessionModelsReason, SessionThinkingLevel } from "./protocol";
import { openModelMenuRequest } from "./slash";
import {
  chooseSessionModel,
  loadSessionModels,
  sessionModels,
  setSessionMode,
  setThinkingLevel,
  viewFor,
} from "./sessions";
import { Glyph, motionStyle, shadowRaised, type GlyphName } from "../../ui/ui";

/**
 * The composer footer's controls (DESIGN §3.6, Q110): one row, two clusters.
 * Left the disabled `+` and the permission-mode switch; right the context
 * ring, the model, the reasoning effort and the one action (send / stop).
 * The triggers share one look — h-7, rounded-lg, quiet at rest, `bg-hover`
 * on hover and `bg-accent` while their menu is open — so the footer reads
 * as one control group, like ZCode's toolbar.
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
function contextLine(usage: SessionContextUsage | null | undefined): string {
  if (!usage || usage.tokens === null || usage.tokens === undefined) return "";
  const percent =
    typeof usage.percent === "number"
      ? usage.percent
      : usage.contextWindow > 0
        ? (usage.tokens / usage.contextWindow) * 100
        : 0;
  return `${formatTokens(usage.tokens)} / ${formatTokens(usage.contextWindow)} · ${Math.round(percent)}%`;
}

/** The context ring's share, clamped into 0..1 (the arc's sweep). */
function contextPercent(usage: SessionContextUsage): number {
  if (typeof usage.percent === "number") return Math.min(Math.max(usage.percent / 100, 0), 1);
  if (!usage.contextWindow || usage.tokens === null || usage.tokens === undefined) return 0;
  return Math.min(Math.max(usage.tokens / usage.contextWindow, 0), 1);
}

/**
 * The `+` is a disabled placeholder: attachments are not in the pi harness
 * yet (dspo-group/Steer.app#5). It keeps the layout's left anchor so the
 * footer doesn't reflow when the capability lands.
 */
export function ComposerPlus() {
  const label = () => `${t(K.session.attach)} · ${t(K.session.attachUnavailable)}`;
  return (
    <View
      role="button"
      testID="session-attach"
      accessibilityLabel={label()}
      tooltip={label()}
      disabled
      class="h-7 w-7 items-center justify-center rounded-lg opacity-40 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
    >
      <Glyph name="plus" size={14} tint={token("muted-foreground")} />
    </View>
  );
}

/** Mode id → its glyph and tint: `auto` is the loud one, the quiet modes are not. */
const MODE_LOOK: Record<string, { glyph: GlyphName; tint: "muted-foreground" | "warn" | "info" | "foreground" }> = {
  ask: { glyph: "shield", tint: "foreground" },
  auto: { glyph: "shield-alert", tint: "warn" },
  "read-only": { glyph: "shield-check", tint: "info" },
};

/** The modes pi's distro names by id, in the shell's words (unknown ids fall back to the ACP name). */
const MODE_KEYS: Record<string, { label: string; hint: string }> = {
  ask: { label: K.session.modeAsk, hint: K.session.modeAskHint },
  auto: { label: K.session.modeAuto, hint: K.session.modeAutoHint },
  "read-only": { label: K.session.modeReadOnly, hint: K.session.modeReadOnlyHint },
};

/**
 * The permission-mode switch (moved out of the model menu): one trigger that
 * names the current mode in the user's words, over a radio menu of the
 * distro's modes. The switch calls `session/set_mode`; the label follows the
 * view's `mode` when the engine confirms.
 */
export function ModeSwitch(props: { sessionId: string }) {
  const open = signal(false);
  const view = () => viewFor(props.sessionId);
  const modes = () => view()?.modes ?? [];
  const current = () => view()?.mode ?? "ask";
  const modeName = (id: string) => {
    const keys = MODE_KEYS[id];
    return keys ? t(keys.label) : (modes().find((mode) => mode.id === id)?.name ?? id);
  };
  const modeHint = (id: string) => {
    const keys = MODE_KEYS[id];
    return keys ? t(keys.hint) : (modes().find((mode) => mode.id === id)?.description ?? "");
  };
  const look = () => MODE_LOOK[current()] ?? { glyph: "shield" as GlyphName, tint: "foreground" as const };
  return (
    <If when={modes().length > 0}>
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
            testID="session-mode"
            accessibilityLabel={`${t(K.session.accessMode)}：${modeName(current())}`}
            accessibilityState={{ expanded: open(), hasPopup: true }}
            tooltip={`${t(K.session.accessMode)} · ${modeName(current())}`}
            class={`${footerTrigger(open())} gap-1 px-2`}
            style={{ ...motionStyle("fast") }}
          >
            <Glyph name={look().glyph} size={15} tint={token(look().tint)} />
            <Text
              class="text-[12px] font-medium"
              style={{ color: token(look().tint), numberOfLines: 1 }}
            >
              {modeName(current())}
            </Text>
            <Glyph name="caret-down" size={8} tint={token("faint")} />
          </View>
        }
      >
        <Each of={modes()} key={(mode) => mode.id}>
          {(mode) => (
            <MenuItem
              testID={`session-mode-${mode().id}`}
              checked={current() === mode().id}
              role="menuitemradio"
              class="rounded-lg px-2.5 py-1.5 hover:bg-hover focus:bg-hover active:bg-accent"
              onSelect={() => void setSessionMode(props.sessionId, mode().id)}
            >
              <View class="flex-row items-center" style={{ flex: 1, minWidth: 0, gap: 8 }}>
                <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
                  <Text class="text-[12px] text-foreground" style={{ numberOfLines: 1 }}>
                    {modeName(mode().id)}
                  </Text>
                  <If when={!!modeHint(mode().id)}>
                    <Text class="text-[10.5px] leading-[14px] text-faint" style={{ numberOfLines: 2 }}>
                      {modeHint(mode().id)}
                    </Text>
                  </If>
                </View>
                <If when={current() === mode().id}>
                  <Glyph name="check" size={11} tint={token("brand")} />
                </If>
              </View>
            </MenuItem>
          )}
        </Each>
      </Menu>
    </If>
  );
}

/** pi's thinking levels in the shell's words; unknown raw values stay as they are. */
const THINKING_KEYS: Record<string, string> = {
  off: K.session.thinkingOff,
  minimal: K.session.thinkingMinimal,
  low: K.session.thinkingLow,
  medium: K.session.thinkingMedium,
  high: K.session.thinkingHigh,
  xhigh: K.session.thinkingXhigh,
  max: K.session.thinkingMax,
};

/** A thinking level's label, localized when the shell knows it. */
function thinkingLabel(level: string): string {
  const key = THINKING_KEYS[level];
  return key ? t(key) : level;
}

/**
 * The reasoning-effort trigger: the session's `thought_level` config selector
 * as a quiet label, over the selector's own values. Only exists while the
 * distro offers the selector (no `thought_level`, no trigger).
 */
export function ThinkingPicker(props: { sessionId: string }) {
  const open = signal(false);
  const view = () => viewFor(props.sessionId);
  const option = () => view()?.configOptions.find((row) => row.id === "thought_level");
  // The view's folded level is the live value; the selector's currentValue is
  // only the seed (the store folds `session.info`'s `thinkingLevel` into the
  // view, not back into the config option).
  const value = () => view()?.thinkingLevel ?? option()?.currentValue ?? "";
  return (
    <If when={!!option()}>
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
            testID="session-thinking"
            accessibilityLabel={`${t(K.session.thinking)}：${thinkingLabel(value())}`}
            accessibilityState={{ expanded: open(), hasPopup: true }}
            tooltip={`${t(K.session.thinking)} · ${thinkingLabel(value())}`}
            class={`${footerTrigger(open())} gap-1 px-1.5`}
            style={{ ...motionStyle("fast") }}
          >
            <Text class="text-[12px] text-muted-foreground" style={{ numberOfLines: 1 }}>
              {thinkingLabel(value())}
            </Text>
            <Glyph name="caret-down" size={8} tint={token("faint")} />
          </View>
        }
      >
        <Each of={option()?.options ?? []} key={(row) => row.value}>
          {(row) => (
            <MenuItem
              testID={`session-thinking-${row().value}`}
              checked={value() === row().value}
              role="menuitemradio"
              class="rounded-lg px-2.5 py-1.5 hover:bg-hover focus:bg-hover active:bg-accent"
              onSelect={() => void setThinkingLevel(props.sessionId, row().value as SessionThinkingLevel)}
            >
              <View class="flex-row items-center" style={{ flex: 1, minWidth: 0, gap: 8 }}>
                <Text class="flex-1 text-[12px] text-foreground" style={{ numberOfLines: 1 }}>
                  {thinkingLabel(row().value)}
                </Text>
                <If when={value() === row().value}>
                  <Glyph name="check" size={11} tint={token("brand")} />
                </If>
              </View>
            </MenuItem>
          )}
        </Each>
      </Menu>
    </If>
  );
}

/**
 * The context ring: the whole gauge compressed into one 14pt dial (ZCode's
 * context icon) — a quiet track at 25% alpha and the used arc at 70%, round
 * heads, from twelve o'clock. The tooltip carries the full fact so the dial
 * alone never has to be read precisely.
 */
export function ContextRing(props: { usage: () => SessionContextUsage | undefined }) {
  const line = () => contextLine(props.usage());
  const label = () => `${t(K.session.contextUsage)} · ${line()}`;
  // The arc is a native canvas; it redraws only for an animated value it
  // reads, so the sweep rides one instead of the usage snapshot.
  const sweepEnd = createAnimatedValue(-Math.PI / 2);
  effect(() => {
    const usage = props.usage();
    sweepEnd.set(-Math.PI / 2 + Math.PI * 2 * (usage ? contextPercent(usage) : 0));
  });
  return (
    <If when={!!line()}>
      <View
        testID="session-context"
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

/**
 * The composer's one action spot: idle is the ↑ send, streaming is the ■
 * stop in the same 28pt square. Stop is neutral (a turn ending is not a
 * failure) and never gated by the draft; send is only as live as the draft.
 */
export function ComposerAction(props: {
  streaming: boolean;
  disabled: boolean;
  onSubmit: () => void;
  onStop: () => void;
}) {
  const label = () => (props.streaming ? t(K.session.stop) : t(K.session.send));
  if (props.streaming) {
    return (
      <View
        role="button"
        testID="session-stop"
        accessibilityLabel={label()}
        tooltip={label()}
        class="h-7 w-7 items-center justify-center rounded-lg bg-secondary hover:bg-muted active:opacity-70 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
        style={{ ...motionStyle("fast") }}
        onPress={props.onStop}
      >
        <Glyph name="square" size={12} tint={token("foreground")} />
      </View>
    );
  }
  return (
    <View
      role="button"
      testID="session-send"
      accessibilityLabel={label()}
      tooltip={label()}
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
  );
}

/** Why an empty list is empty: the engine's code, in the user's words. */
export function modelsReasonText(reason: SessionModelsReason | undefined, error?: string): string {
  if (error) return t(K.session.modelsError, { error });
  switch (reason?.code) {
    case "no_credentials":
      return t(K.session.modelsNoCredentials);
    case "no_catalog":
      return t(K.session.modelsNoCatalog);
    case "no_models":
      return t(K.session.modelsNoChat);
    case "unavailable":
      return t(K.session.modelsError, { error: reason.message ?? "" });
    default:
      return t(K.session.modelsEmpty);
  }
}

/**
 * The model picker: the trigger shows the session model's display name (no
 * provider prefix — the name is the fact the user picks by), and its tooltip
 * keeps the full `provider · id · effort` line. The menu is the same
 * two-level provider→model list as before; the permission modes moved to the
 * footer's left cluster. The menu stays open on an error so the reason is
 * readable, and closes itself on success.
 */
export function ModelPicker(props: { sessionId: string }) {
  const open = signal(false);
  // The `/model` command lands here: open once, then clear the request.
  effect(() => {
    if (openModelMenuRequest() !== props.sessionId) return;
    openModelMenuRequest.set(null);
    open.set(true);
  });

  const view = () => viewFor(props.sessionId);
  const state = () => sessionModels()[props.sessionId];
  const providers = () => state()?.data?.providers ?? [];
  const current = () => view()?.model ?? state()?.data?.current;
  const thinking = () => view()?.thinkingLevel ?? state()?.data?.thinkingLevel;
  const currentKey = () => (current() ? `${current()!.provider}/${current()!.id}` : "");
  const display = () => (current() ? current()!.name || current()!.id : t(K.session.model));
  const tooltip = () => {
    const model = current();
    if (!model) return t(K.session.model);
    const level = thinking();
    return [
      model.provider,
      model.id || model.name,
      level && level !== "off" ? thinkingLabel(level) : null,
    ]
      .filter(Boolean)
      .join(" · ");
  };
  const choose = async (provider: string, id: string) => {
    if (await chooseSessionModel(props.sessionId, provider, id)) open.set(false);
  };
  return (
    <Menu
      open={open()}
      onOpenChange={({ open: next }) => {
        open.set(next);
        if (next) void loadSessionModels(props.sessionId);
      }}
      placement="top"
      align="start"
      offset={6}
      popupClass="rounded-xl border border-border bg-popover p-1"
      popupStyle={{ width: 310, maxHeight: 420, boxShadow: shadowRaised() }}
      trigger={
        <View
          role="button"
          testID="model-picker"
          accessibilityLabel={tooltip()}
          accessibilityState={{ expanded: open(), hasPopup: true }}
          tooltip={tooltip()}
          class={`${footerTrigger(open())} min-w-0 gap-1 px-1.5`}
          style={{ ...motionStyle("fast") }}
        >
          <Text
            class={
              current()
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
        <If when={state()?.status === "loading"}>
          <Text class="px-2 py-2 text-[11.5px] text-faint">{t(K.session.modelsLoading)}</Text>
        </If>
        <If when={state()?.status === "error"}>
          <Text class="px-2 py-1.5 text-[11px] text-destructive" style={{ numberOfLines: 2 }}>
            {t(K.session.modelsError, { error: state()?.error ?? "" })}
          </Text>
          <MenuItem
            testID="model-retry"
            class="rounded-lg px-2.5 py-1.5 hover:bg-hover focus:bg-hover active:bg-accent"
            onSelect={() => void loadSessionModels(props.sessionId, true)}
          >
            <Text class="text-[12px] text-foreground">{t(K.engine.retry)}</Text>
          </MenuItem>
        </If>
        <If when={state()?.status === "ready" && providers().length === 0}>
          <Text testID="model-reason" class="px-2 py-2 text-[11.5px] leading-[16px] text-faint">
            {modelsReasonText(state()?.data?.reason)}
          </Text>
          <MenuItem
            testID="model-retry"
            class="rounded-lg px-2.5 py-1.5 hover:bg-hover focus:bg-hover active:bg-accent"
            onSelect={() => void loadSessionModels(props.sessionId, true)}
          >
            <Text class="text-[12px] text-foreground">{t(K.engine.retry)}</Text>
          </MenuItem>
        </If>
        <Each of={providers()} key={(provider) => provider.id}>
          {(provider) => (
            <Submenu
              trigger={
                <View
                  role="button"
                  testID={`model-provider-${provider().id}`}
                  accessibilityLabel={provider().name}
                  class="flex-row items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-hover focus:bg-hover active:bg-accent"
                  style={{ ...motionStyle("fast") }}
                >
                  <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
                    <Text class="text-[12px] font-medium text-foreground" style={{ numberOfLines: 1 }}>
                      {provider().name}
                    </Text>
                    <Text class="text-[10px] text-faint" style={{ numberOfLines: 1 }}>
                      {provider().id}
                    </Text>
                  </View>
                  <Glyph name="chevron-right" size={10} tint={token("faint")} />
                </View>
              }
            >
              <Each of={provider().models} key={(model) => `${model.provider}/${model.id}`}>
                {(model) => (
                  <MenuItem
                    testID={`model-${model().provider}-${model().id}`}
                    checked={currentKey() === `${model().provider}/${model().id}`}
                    role="menuitemradio"
                    closeOnSelect={false}
                    class="rounded-lg px-2.5 py-1.5 hover:bg-hover focus:bg-hover active:bg-accent"
                    onSelect={() => void choose(model().provider, model().id)}
                  >
                    <View class="flex-row items-center" style={{ flex: 1, minWidth: 0, gap: 8 }}>
                      <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
                        <Text class="text-[12px] font-medium text-foreground" style={{ numberOfLines: 1 }}>
                          {model().name}
                        </Text>
                        <Text class="text-[10px] text-faint" style={{ numberOfLines: 1 }}>
                          {model().id}
                          {model().contextWindow ? ` · ${formatTokens(model().contextWindow!)}` : ""}
                        </Text>
                      </View>
                      <If when={currentKey() === `${model().provider}/${model().id}`}>
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
