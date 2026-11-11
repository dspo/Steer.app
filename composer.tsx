import { Scroll, signal, Text, token, View } from "nsh";
import { Input, Menu, MenuItem, Submenu } from "nsh/base";
import { K, t } from "./i18n";
import {
  chooseSessionModel,
  followUp,
  interrupt,
  loadSessionModels,
  send,
  sessionModels,
  steer,
  stop,
  viewFor,
} from "./sessions";
import { Glyph, motionStyle, shadowRaised, type GlyphName } from "./ui";

/**
 * The composer: a bare, borderless input over one footer row. The message
 * area and the composer share the page background; the only boundary is the
 * hairline the footer owner draws above this component. There is no card,
 * bubble or shadow around it, as in Steer.
 *
 * The footer's left cluster names the session's model and context from
 * `session.info`; its right cluster is the action lane. Idle has one accent
 * send. While a turn runs it has the absolute-priority stop, then the queue
 * (Enter's lane), steer and interrupt — every one a compact chip, none gated
 * by a draft except stop.
 */

/** `12.3k`, `1M`, `840`: a token count at a glance. */
export function formatTokens(tokens: number): string {
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
export function contextLine(usage: {
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
export function ComposerChip(props: {
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
 * The model picker: the composer's `provider · id · thinking` trigger opens a
 * two-level menu (providers, then their models). The current model carries
 * the checkmark; choosing one switches the session and folds the reply's
 * `session.info` back in. The menu stays open on an error so the reason is
 * readable, and closes itself on success.
 */
export function ModelPicker(props: { sessionId: string }) {
  const open = signal(false);
  const view = () => viewFor(props.sessionId);
  const state = () => sessionModels()[props.sessionId];
  const providers = () => state()?.data?.providers ?? [];
  const current = () => view()?.model ?? state()?.data?.current;
  const thinking = () => view()?.thinkingLevel ?? state()?.data?.thinkingLevel;
  const currentKey = () => (current() ? `${current()!.provider}/${current()!.id}` : "");
  const label = () => {
    const model = current();
    if (!model) return t(K.session.model);
    const level = thinking();
    return [model.provider, model.id || model.name, level && level !== "off" ? level : null]
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
      align="start"
      offset={6}
      popupClass="rounded-xl border border-border bg-popover p-1"
      popupStyle={{ width: 310, maxHeight: 420, boxShadow: shadowRaised() }}
      trigger={
        <View
          role="button"
          testID="model-picker"
          accessibilityLabel={label()}
          accessibilityState={{ expanded: open(), hasPopup: true }}
          class="h-6 min-w-0 flex-row items-center gap-1 rounded-md px-1.5 hover:bg-hover active:opacity-70 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
          style={{ ...motionStyle("fast") }}
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
            <If when={!!thinking() && thinking() !== "off"}>
              <Text class="text-[11px] text-faint">·</Text>
              <Text class="text-[11px] text-muted-foreground">{thinking()}</Text>
            </If>
          </If>
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
          <Text class="px-2 py-2 text-[11.5px] text-faint">{t(K.session.modelsEmpty)}</Text>
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
                    indicator={<Glyph name="check" size={11} tint={token("brand")} />}
                    indicatorClass="opacity-0 checked:opacity-100"
                    class="rounded-lg px-2.5 py-1.5 hover:bg-hover focus:bg-hover active:bg-accent"
                    onSelect={() => void choose(model().provider, model().id)}
                  >
                    <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
                      <Text class="text-[12px] font-medium text-foreground" style={{ numberOfLines: 1 }}>
                        {model().name}
                      </Text>
                      <Text class="text-[10px] text-faint" style={{ numberOfLines: 1 }}>
                        {model().id}
                        {model().contextWindow ? ` · ${formatTokens(model().contextWindow!)}` : ""}
                      </Text>
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

/** The session composer: input and footer, without the surrounding lane. */
export function ChatComposer(props: { sessionId: string; autofocus?: boolean }) {
  const draft = signal("");
  const view = () => viewFor(props.sessionId);
  const streaming = () => view()?.streaming ?? false;
  const canSubmit = () => draft().trim().length > 0 && !!view();
  const take = () => {
    const text = draft();
    draft.set("");
    return text;
  };
  const submit = () => {
    if (!canSubmit()) return;
    const text = take();
    // Enter is the polite lane while a turn runs: the message waits its turn.
    if (streaming()) void followUp(text, props.sessionId);
    else void send(text, props.sessionId);
  };
  const doSteer = () => {
    if (!canSubmit()) return;
    void steer(take(), props.sessionId);
  };
  const doInterrupt = () => {
    if (!canSubmit()) return;
    void interrupt(take(), props.sessionId);
  };
  const context = () => contextLine(view()?.contextUsage);
  return (
    <View style={{ width: "100%", maxWidth: 820, alignSelf: "center", gap: 6 }}>
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
      <View class="flex-row items-center gap-2">
        <View class="min-w-0 flex-row items-center gap-1" style={{ flex: 1 }}>
          <ModelPicker sessionId={props.sessionId} />
          <If when={!!context()}>
            <>
              <If when={!!view()?.model}>
                <Text class="text-[11px] text-faint">·</Text>
              </If>
              <Text class="text-[11px] text-faint" accessibilityLabel={t(K.session.contextUsage)}>
                {context()}
              </Text>
            </>
          </If>
        </View>
        <View class="flex-row items-center gap-1">
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
            <ComposerChip
              testID="session-queue"
              label={t(K.session.queue)}
              glyph="send"
              disabled={!canSubmit()}
              onPress={submit}
            />
            <ComposerChip
              testID="session-steer"
              label={t(K.session.steer)}
              glyph="branch"
              disabled={!canSubmit()}
              onPress={doSteer}
            />
            <ComposerChip
              testID="session-interrupt"
              label={t(K.session.interrupt)}
              glyph="alert"
              danger
              disabled={!canSubmit()}
              onPress={doInterrupt}
            />
          </If>
        </View>
      </View>
    </View>
  );
}
