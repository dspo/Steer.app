import { effect, Scroll, signal, Text, token, View } from "nsh";
import type { ViewRef } from "nsh";
import { Input, Menu, MenuItem } from "nsh/base";
import { modelMenuShown, openModelMenu } from "./model-menu";
import { K, t } from "../../ui/i18n";
import type { SessionModelsReason, SessionThinkingLevel } from "./protocol";
import { openModelMenuRequest, runSlash, slashCandidates } from "./slash";
import {
  chooseSessionModel,
  ensureSessionModels,
  followUp,
  loadSessionModels,
  send,
  sessionModels,
  setSessionMode,
  setThinkingLevel,
  stop,
  viewFor,
} from "./sessions";
import { Glyph, motionStyle, shadowRaised, type GlyphName } from "../../ui/ui";

/**
 * The composer: a bare input over one footer row, all right-aligned (DESIGN
 * §3.6). The hairline above it belongs to the composer and is exactly its
 * width; the message area and the composer share the page background — no
 * card, bubble or shadow around it, as in Steer.
 *
 * The footer names the session's model, thinking level and context, then the
 * action: idle is one accent send; while a turn runs the same spot is the
 * stop (absolute — never gated by the draft). The model menu ends with the
 * approval policy; the `⋯` menu carries a running turn's lanes.
 */

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

/** The context gauge's one line: `12.3k / 1M · 1%`. */
function contextLine(usage: {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
} | null | undefined): string {
  if (!usage || usage.tokens === null || usage.tokens === undefined) return "";
  const percent =
    typeof usage.percent === "number"
      ? usage.percent
      : usage.contextWindow > 0
        ? (usage.tokens / usage.contextWindow) * 100
        : 0;
  return `${formatTokens(usage.tokens)} / ${formatTokens(usage.contextWindow)} · ${Math.round(percent)}%`;
}

/**
 * One footer action. `primary` is the idle send; `danger` is stop and
 * interrupt. Chips are the footer's scale: h-6, text 11, tight radius.
 */
function ComposerChip(props: {
  testID: string;
  label: string;
  glyph?: GlyphName;
  primary?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const disabled = () => props.disabled ?? false;
  const look = () =>
    disabled()
      ? "bg-muted opacity-40"
      : props.primary
        ? "bg-primary hover:bg-primary/90 active:opacity-80"
        : props.danger
          ? "border border-line hover:bg-destructive/10 active:opacity-70"
          : "border border-line hover:bg-hover active:opacity-70";
  const ink = () =>
    disabled()
      ? token("faint")
      : props.primary
        ? token("primary-foreground")
        : props.danger
          ? token("destructive")
          : token("foreground");
  return (
    <View
      role="button"
      testID={props.testID}
      accessibilityLabel={props.label}
      tooltip={props.label}
      disabled={disabled()}
      class={`h-6 flex-row items-center justify-center gap-1 rounded-md px-2 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1 ${look()}`}
      style={{ ...motionStyle("fast") }}
      onPress={() => {
        if (!disabled()) props.onPress();
      }}
    >
      {props.glyph ? <Glyph name={props.glyph} size={11} tint={ink()} /> : null}
      <Text class="text-[11px] font-medium" style={{ color: ink() }}>
        {props.label}
      </Text>
    </View>
  );
}

/**
 * The model picker: the composer's `provider · id` trigger opens a two-level
 * menu (providers, then their models). The current model carries the
 * checkmark; choosing one switches the session and folds the reply's
 * `session.info` back in. The menu stays open on an error so the reason is
 * readable, and closes itself on success. The provider rows name the
 * credential source and the model rows the context window (issue #54), so
 * "why is this provider listed" is answered in place.
 */

/** Why an empty list is empty: the engine's code, in the user's words. */
function modelsReasonText(reason: SessionModelsReason | undefined, error?: string): string {
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

/** A provider's credential source, in the user's words (issue #54). An
 * unknown source shows itself raw rather than "未配置" — the credential may
 * well exist; only `none` means it does not (issue #54 review, P3). */
function authSourceText(source: string | undefined, label: string | undefined): string {
  switch (source) {
    case "stored":
      return t(K.session.authStored);
    case "environment":
      return t(K.session.authEnvironment, { label: label ?? "" });
    case "models_json_command":
      return t(K.session.authCommand);
    case "models_json_key":
    case "runtime":
    case "fallback":
      return t(K.session.authKey);
    case "none":
      return t(K.session.authNone);
    default:
      return source ?? "";
  }
}

export function ModelPicker(props: { sessionId: string }) {
  let chip: ViewRef | undefined;
  const view = () => viewFor(props.sessionId);
  const state = () => sessionModels()[props.sessionId];
  const current = () => view()?.model ?? state()?.data?.current;
  const shown = () => modelMenuShown();
  const label = () => {
    const model = current();
    if (!model) return t(K.session.model);
    // The effort lives in its own chip now (issue #54); the trigger names
    // the model only.
    return [model.provider, model.id || model.name].filter(Boolean).join(" · ");
  };
  // The menu is hosted at the window root (see `model-menu.tsx`): the chip
  // measures itself and opens it at its own rectangle, so the popup lands
  // where an anchored menu would while its rows stay clickable.
  const open = () => {
    const session = props.sessionId;
    void chip
      ?.measure()
      .then((at) => {
        if (at) {
          openModelMenu(session, {
            x: at.pagePosition.x,
            y: at.pagePosition.y,
            width: at.bounds.size.width,
            height: at.bounds.size.height,
          });
        }
      });
  };
  // The `/model` command lands here.
  effect(() => {
    if (openModelMenuRequest() !== props.sessionId) return;
    openModelMenuRequest.set(null);
    open();
  });
  return (
    <View
      ref={(node) => (chip = node)}
      role="button"
      testID="model-picker"
      accessibilityLabel={label()}
      accessibilityState={{ expanded: shown(), hasPopup: true }}
      class="h-6 min-w-0 flex-row items-center gap-1 rounded-md px-1.5 hover:bg-hover active:opacity-70 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
      style={{ ...motionStyle("fast"), opacity: shown() ? 0.6 : 1 }}
      onPress={open}
    >
      <If
        when={!!current()}
        else={
          <Text class="min-w-0 text-[11px] text-muted-foreground" style={{ numberOfLines: 1 }}>
            {t(K.session.model)}
          </Text>
        }
      >
        <Text class="text-[11px] text-muted-foreground" style={{ numberOfLines: 1 }}>
          {current()!.provider}
        </Text>
        <Text class="text-[11px] text-faint">·</Text>
        <Text class="min-w-0 text-[11px] font-medium text-foreground" style={{ numberOfLines: 1 }}>
          {current()!.id || current()!.name}
        </Text>
      </If>
      <Glyph name="caret-down" size={8} tint={token("faint")} />
    </View>
  );
}


/**
 * The reasoning-effort control (issue #54): the footer's own chip and menu,
 * next to the model picker. The options are the session's live
 * `thought_level` selector — pi clamps a chosen level to the model's own
 * ladder — so a model with three levels shows three, not pi's seven. A view
 * with a level but no selector (the legacy transport's seeds) draws the chip
 * as a plain label: there is nothing to choose.
 */
function EffortControl(props: { sessionId: string }) {
  const open = signal(false);
  const view = () => viewFor(props.sessionId);
  const thought = () => view()?.configOptions.find((option) => option.id === "thought_level");
  const options = () => thought()?.options ?? [];
  const current = () => view()?.thinkingLevel ?? thought()?.currentValue;
  const choose = async (value: string) => {
    if (await setThinkingLevel(props.sessionId, value as SessionThinkingLevel)) open.set(false);
  };
  const trigger = (
    <>
      <Text class="text-[11px] font-medium text-foreground" style={{ numberOfLines: 1 }}>
        {current() ?? "off"}
      </Text>
      <Glyph name="caret-down" size={8} tint={token("faint")} />
    </>
  );
  if (options().length === 0) {
    return (
      <View
        testID="effort-picker"
        accessibilityLabel={t(K.session.effort)}
        class="h-6 flex-row items-center gap-1 rounded-md px-1.5"
      >
        {trigger}
      </View>
    );
  }
  return (
    <Menu
      open={open()}
      onOpenChange={({ open: next }) => open.set(next)}
      align="start"
      offset={6}
      popupClass="rounded-xl border border-border bg-popover p-1"
      popupStyle={{ width: 160, maxHeight: 320, boxShadow: shadowRaised() }}
      trigger={
        <View
          role="button"
          testID="effort-picker"
          accessibilityLabel={t(K.session.effort)}
          accessibilityState={{ expanded: open(), hasPopup: true }}
          class="h-6 flex-row items-center gap-1 rounded-md px-1.5 hover:bg-hover active:opacity-70 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
          style={{ ...motionStyle("fast") }}
        >
          {trigger}
        </View>
      }
    >
      <Each of={options()} key={(option) => option.value}>
        {(option) => (
          <MenuItem
            testID={`effort-${option().value}`}
            checked={current() === option().value}
            role="menuitemradio"
            closeOnSelect={false}
            indicator={<Glyph name="check" size={11} tint={token("brand")} />}
            indicatorClass="opacity-0 checked:opacity-100"
            class="rounded-lg px-2.5 py-1.5 hover:bg-hover focus:bg-hover active:bg-accent"
            onSelect={() => void choose(option().value)}
          >
            <Text class="text-[12px] text-foreground">{option().name}</Text>
          </MenuItem>
        )}
      </Each>
    </Menu>
  );
}

/** The `⋯` menu: the lanes of a running turn. */
function ComposerMore() {
  const open = signal(false);
  const item = "rounded-lg px-2.5 py-1.5 hover:bg-hover focus:bg-hover active:bg-accent";
  return (
    <Menu
      open={open()}
      onOpenChange={({ open: next }) => open.set(next)}
      align="end"
      offset={6}
      popupClass="rounded-xl border border-border bg-popover p-1"
      popupStyle={{ minWidth: 172, boxShadow: shadowRaised() }}
      trigger={
        <View
          role="button"
          testID="session-more"
          accessibilityLabel={t(K.session.more)}
          class="h-6 w-6 items-center justify-center rounded-md hover:bg-hover active:opacity-70 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
          style={{ ...motionStyle("fast") }}
        >
          <Glyph name="more" size={12} tint={token("muted-foreground")} />
        </View>
      }
    >
      <MenuItem testID="session-queue" class={item} onSelect={() => open.set(false)}>
        <Text class="text-[12px] text-foreground">{t(K.session.queue)}</Text>
      </MenuItem>
      <MenuItem testID="session-steer" class={item} onSelect={() => open.set(false)}>
        <Text class="text-[12px] text-foreground">{t(K.session.steer)}</Text>
      </MenuItem>
      <MenuItem testID="session-interrupt" class={item} onSelect={() => open.set(false)}>
        <Text class="text-[12px] text-foreground">{t(K.session.interrupt)}</Text>
      </MenuItem>
    </Menu>
  );
}

/** The session composer: input and one right-aligned footer row. */
export function ChatComposer(props: { sessionId: string; autofocus?: boolean }) {
  const draft = signal("");
  const view = () => viewFor(props.sessionId);
  const streaming = () => view()?.streaming ?? false;
  const models = () => sessionModels()[props.sessionId];
  /** The engine's answer that this machine has no models to name. */
  const modelsUnavailable = () => !!models()?.data?.reason;
  const waiting = () => view()?.sessionState === "waiting_user";
  const queued = () => view()?.queued ?? 0;
  const canSubmit = () => draft().trim().length > 0 && !!view() && !modelsUnavailable() && !waiting();
  // One ask per composer, so the empty state knows its cause without the
  // user opening the menu. A retry (here or in the menu) is the way back.
  let asked = false;
  effect(() => {
    if (asked) return;
    asked = true;
    void loadSessionModels(props.sessionId);
  });
  const take = () => {
    const text = draft();
    draft.set("");
    return text;
  };
  // The footer's effort chip: any thinking level or live thought_level
  // selector puts one next to the model picker (issue #54).
  const currentEffort = () =>
    !!(view()?.thinkingLevel ?? view()?.configOptions.find((option) => option.id === "thought_level"));
  const context = () => contextLine(view()?.contextUsage);
  // The slash popup: open while the draft is a slash draft, filtered by it.
  const slashDraft = () => {
    const text = draft().trimStart();
    return text.startsWith("/") ? text : "";
  };
  const candidates = () => (slashDraft() ? slashCandidates(slashDraft(), props.sessionId) : []);
  const runDraft = () => {
    const text = slashDraft();
    if (!text) return false;
    void runSlash(props.sessionId, text);
    draft.set("");
    return true;
  };
  const submit = () => {
    if (runDraft()) return;
    if (!canSubmit()) return;
    const text = take();
    // Enter is the polite lane while a turn runs: the message waits its turn.
    if (streaming()) void followUp(text, props.sessionId);
    else void send(text, props.sessionId);
  };
  return (
    <View
      style={{
        width: "100%",
        maxWidth: 820,
        alignSelf: "center",
        gap: 6,
        position: "relative",
        // The divider is the composer's own, exactly as wide as it is.
        borderTopWidth: 1,
        borderTopColor: token("line"),
        paddingTop: 8,
      }}
    >
      {/* No models is not a dead composer: the input stays, the send waits,
          and the line names the cause with a retry of its own. */}
      <If when={modelsUnavailable()}>
        <View testID="session-no-model" class="flex-row items-start gap-1.5">
          <View style={{ paddingTop: 2 }}>
            <Glyph name="alert" size={10} tint={token("faint")} />
          </View>
          <Text class="text-[11px] leading-[16px] text-faint" style={{ flex: 1 }}>
            {modelsReasonText(models()?.data?.reason)}
          </Text>
          <ComposerChip
            testID="session-no-model-retry"
            label={t(K.engine.retry)}
            onPress={() => void ensureSessionModels(props.sessionId, true)}
          />
        </View>
      </If>
      <If when={waiting()}>
        <View testID="session-waiting" class="flex-row items-center gap-1.5">
          <Glyph name="alert" size={10} tint={token("warn")} />
          <Text class="text-[11px] text-warn">{t(K.session.waitingApproval)}</Text>
        </View>
      </If>
      <If when={queued() > 0}>
        <Text testID="session-queued" class="text-[11px] text-faint">
          {t(K.session.queued, { count: queued() })}
        </Text>
      </If>
      {/* The slash candidates: the mapping's own rows, filtered by the draft. */}
      <If when={candidates().length > 0}>
        <View
          testID="session-slash"
          class="absolute left-0 right-0 z-10 rounded-xl border border-border bg-popover p-1"
          style={{ bottom: "100%", marginBottom: 4, boxShadow: shadowRaised() }}
        >
          {candidates().map((command) => (
            <View
              role="button"
              testID={`slash-${command.name}`}
              class="flex-row items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-hover active:bg-accent"
              onPress={() => {
                void runSlash(props.sessionId, `/${command.name}`);
                draft.set("");
              }}
            >
              <Text class="text-[12px] font-medium text-foreground">{`/${command.name}`}</Text>
              <Text class="min-w-0 flex-1 text-[11px] text-faint" style={{ numberOfLines: 1 }}>
                {command.description}
              </Text>
            </View>
          ))}
        </View>
      </If>
      <Input
        testID="session-input"
        value={draft()}
        onChange={({ value }) => draft.set(value)}
        multiline
        submitBehavior="submit"
        autoFocus={props.autofocus ?? false}
        placeholder={streaming() ? t(K.session.placeholderStreaming) : t(K.session.placeholder)}
        onSubmit={submit}
        style={{
          minHeight: 48,
          paddingHorizontal: 2,
          paddingVertical: 4,
          fontSize: 14,
          lineHeight: 21,
          color: token("foreground"),
          placeholderColor: token("faint"),
          caretColor: token("primary"),
          selectionColor: token("brand"),
          backgroundColor: "transparent",
          borderWidth: 0,
        }}
      />
      {/* One row, everything to the right (DESIGN §3.6): the model and the
          effort chips, the context gauge, then the `⋯` lanes while a turn
          runs, then the action — idle's ↑ send and streaming's ■ stop in the
          same spot. */}
      <View class="flex-row items-center justify-end gap-2">
        <ModelPicker sessionId={props.sessionId} />
        <If when={!!currentEffort()}>
          <EffortControl sessionId={props.sessionId} />
        </If>
        <If when={!!context()}>
          <>
            <If when={!!view()?.model || !!currentEffort()}>
              <Text class="text-[11px] text-faint">·</Text>
            </If>
            <Text class="text-[11px] text-faint" accessibilityLabel={t(K.session.contextUsage)}>
              {context()}
            </Text>
          </>
        </If>
        <If when={streaming()}>
          <ComposerMore />
        </If>
        <If
          when={streaming()}
          else={
            <ComposerChip
              testID="session-send"
              label={t(K.session.send)}
              glyph="send"
              primary
              disabled={!canSubmit()}
              onPress={submit}
            />
          }
        >
          {/* Stop is absolute: never gated by the draft. */}
          <ComposerChip
            testID="session-stop"
            label={t(K.session.stop)}
            glyph="stop"
            danger
            disabled={false}
            onPress={() => void stop(props.sessionId)}
          />
        </If>
      </View>
    </View>
  );
}
