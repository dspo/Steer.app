import { effect, signal, Text, token, View } from "nsh";
import { Input } from "nsh/base";
import { K, t } from "../../ui/i18n";
import { runSlash, slashCandidates } from "./slash";
import { followUp, loadSessionModels, send, sessionModels, stop, viewFor } from "./sessions";
import { Glyph, motionStyle, shadowRaised } from "../../ui/ui";
import {
  ComposerAction,
  ComposerPlus,
  ContextRing,
  ModeSwitch,
  ModelPicker,
  ThinkingPicker,
  modelsReasonText,
} from "./composer-controls";

/**
 * The composer (DESIGN §3.6, Q110): ZCode's rounded input card — the input on
 * top, one footer row under it (left: the disabled `+` and the permission
 * mode; right: the context ring, the model, the effort, the action), and the
 * state lines (no models, waiting, queued) above the card, not inside it.
 * No hairline: the card's own border is the boundary. This file owns the
 * shell, the input and the submit; the footer's controls live in
 * `composer-controls.tsx`.
 */

/**
 * One labeled action above the card (the no-model retry). Chips are the
 * status line's scale: h-6, text 11, tight radius — a step under the footer's
 * triggers, which are the card's controls.
 */
function ComposerChip(props: {
  testID: string;
  label: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  const disabled = () => props.disabled ?? false;
  return (
    <View
      role="button"
      testID={props.testID}
      accessibilityLabel={props.label}
      tooltip={props.label}
      disabled={disabled()}
      class="h-6 flex-row items-center justify-center gap-1 rounded-md border border-line px-2 hover:bg-hover active:opacity-70 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
      style={{ ...motionStyle("fast") }}
      onPress={() => {
        if (!disabled()) props.onPress();
      }}
    >
      <Text class="text-[11px] font-medium text-foreground">{props.label}</Text>
    </View>
  );
}

/** The session composer: the state lines, then the input card. */
export function ChatComposer(props: { sessionId: string; autofocus?: boolean }) {
  const draft = signal("");
  /** The input's grown height; the clamp lives where the content reports it. */
  const inputHeight = signal(44);
  const view = () => viewFor(props.sessionId);
  const streaming = () => view()?.streaming ?? false;
  const models = () => sessionModels()[props.sessionId];
  /** The engine's answer that this machine has no models to name. */
  const modelsUnavailable = () => !!models()?.data?.reason;
  const waiting = () => view()?.sessionState === "waiting_user";
  const queued = () => view()?.queued ?? 0;
  const hasMessages = () => (view()?.messages.length ?? 0) > 0;
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
    inputHeight.set(44);
    return text;
  };
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
    inputHeight.set(44);
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
  const placeholder = () =>
    streaming()
      ? t(K.session.placeholderStreaming)
      : hasMessages()
        ? t(K.session.placeholderFollowUp)
        : t(K.session.placeholder);
  return (
    <View
      style={{
        width: "100%",
        maxWidth: 820,
        alignSelf: "center",
        gap: 8,
        position: "relative",
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
            onPress={() => void loadSessionModels(props.sessionId, true)}
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
      {/* The card: a flat surface, one border, no shadow. The border answers
          hover and focus-within — the input inside stays bare. */}
      <View
        class="rounded-xl border border-border bg-card hover:border-input focus-within:border-ring"
        style={{ padding: 12, gap: 12, ...motionStyle("fast") }}
      >
        <Input
          testID="session-input"
          value={draft()}
          onChange={({ value }) => draft.set(value)}
          multiline
          submitBehavior="submit"
          autoFocus={props.autofocus ?? false}
          placeholder={placeholder()}
          onSubmit={submit}
          onContentSizeChange={({ size }) => {
            inputHeight.set(Math.min(176, Math.max(44, size.height)));
          }}
          style={{
            height: inputHeight(),
            minHeight: 44,
            padding: 0,
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
        {/* One footer row, two clusters (DESIGN §3.6): left the `+` and the
            permission mode, right the gauge, model, effort and the action —
            idle's ↑ send and streaming's ■ stop in the same spot. */}
        <View class="flex-row items-center justify-between" style={{ gap: 8 }}>
          <View class="flex-row items-center" style={{ gap: 4, flexShrink: 0 }}>
            <ComposerPlus />
            <ModeSwitch sessionId={props.sessionId} />
          </View>
          <View class="flex-row items-center" style={{ gap: 4, flexShrink: 1, minWidth: 0 }}>
            <ContextRing usage={() => view()?.contextUsage} />
            <ModelPicker sessionId={props.sessionId} />
            <ThinkingPicker sessionId={props.sessionId} />
            {/* Stop is absolute: never gated by the draft. */}
            <ComposerAction
              streaming={streaming()}
              disabled={!canSubmit()}
              onSubmit={submit}
              onStop={() => void stop(props.sessionId)}
            />
          </View>
        </View>
      </View>
    </View>
  );
}
