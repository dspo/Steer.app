import { signal, Text, token, View } from "nsh";
import { Input } from "nsh/base";
import { K, t } from "../../ui/i18n";
import { Glyph, motionStyle } from "../../ui/ui";
import {
  ActionType,
  connectionError,
  connectionStatus,
  dispatchAction,
  effectiveState,
  reconnect,
} from "./ahp";
import { cancelManoxTurn, chatResource, latestChatUsage, manoxModelRefOf, sendManoxMessage } from "./stores";
import {
  ManoxAction,
  ManoxContextRing,
  ManoxMode,
  ManoxModel,
  ManoxPlus,
  ManoxThinking,
  contextMaxTokens,
  contextUsedTokens,
} from "./composer-controls";
import { MessageKind, PendingMessageKind } from "../../../contracts/ahp/channels-chat/state";
import type { ChatState, Message } from "../../../contracts/ahp/channels-chat/state";

/**
 * The manox composer (DESIGN §3.6a, Q110): ZCode's rounded input card — the
 * input on top, one footer row under it (left: the disabled `+` and the
 * access mode; right: the context ring, the model, the reasoning effort and
 * the one action), and the manox lanes / transport-error lines above the
 * card, not inside it. No hairline: the card's own border is the boundary,
 * answering hover and focus-within. This file owns the shell, the input and
 * the submit; the footer's controls live in `composer-controls.tsx`.
 */

/**
 * One footer action beside the card (the reconnect). Chips are the status
 * line's scale: h-6, text 11, tight radius — a step under the footer's
 * triggers, which are the card's controls.
 */
function ComposerChip(props: {
  testID: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <View
      role="button"
      testID={props.testID}
      accessibilityLabel={props.label}
      tooltip={props.label}
      class="h-6 flex-row items-center justify-center gap-1 rounded-md border border-line px-2 hover:bg-hover active:opacity-70 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
      style={{ ...motionStyle("fast") }}
      onPress={props.onPress}
    >
      <Text class="text-[11px] font-medium text-foreground">{props.label}</Text>
    </View>
  );
}

/** The queued/steering lanes' one line, from the folded chat state. */
function LanesLine(props: { chat: ChatState }) {
  const parts = () => {
    const pieces: string[] = [];
    if (props.chat.steeringMessage) {
      pieces.push(t(K.manox.lanesSteering, { count: 1 }));
    }
    const queued = props.chat.queuedMessages?.length ?? 0;
    if (queued > 0) pieces.push(t(K.manox.lanesQueued, { count: queued }));
    return pieces.join(" · ");
  };
  return (
    <If when={parts().length > 0}>
      <View testID="manox-lanes" class="flex-row items-center gap-1.5">
        <Glyph name="sort" size={10} tint={token("faint")} />
        <Text class="text-[11px] text-faint">{parts()}</Text>
      </View>
    </If>
  );
}

/** The manox composer: the state lines, then the input card. */
export function ManoxComposer(props: { threadId: string; chatId: string; autofocus?: boolean }) {
  const draft = signal("");
  /** The input's grown height; the clamp lives where the content reports it. */
  const inputHeight = signal(44);
  const chatUri = () => chatResource(props.chatId);
  const chat = () => effectiveState<ChatState>(chatUri());
  const streaming = () => chat()?.activeTurn != null;
  const hasTurns = () => (chat()?.turns.length ?? 0) > 0;
  const canSubmit = () => draft().trim().length > 0;
  const status = () => connectionStatus();
  // The ring reads the last turn's usage over the root model's prompt budget;
  // it stays quiet (no visible dial) until both sides of the ratio exist.
  const ringUsed = () => contextUsedTokens(latestChatUsage(props.chatId));
  const ringMax = () => contextMaxTokens(manoxModelRefOf(props.threadId));
  const take = () => {
    const text = draft();
    draft.set("");
    inputHeight.set(44);
    return text.trim();
  };
  const submit = () => {
    if (!canSubmit()) return;
    const text = take();
    if (streaming()) {
      // Enter is the polite lane while a turn runs: the message queues on
      // the chat's lane; the host starts it as its own turn afterwards.
      const message: Message = { text, origin: { kind: MessageKind.User } };
      dispatchAction(chatUri(), {
        type: ActionType.ChatPendingMessageSet,
        kind: PendingMessageKind.Queued,
        id: `queued-${Date.now()}`,
        message,
      } as never);
      return;
    }
    void sendManoxMessage(props.threadId, props.chatId, text);
  };
  const placeholder = () =>
    streaming()
      ? t(K.manox.placeholderStreaming)
      : hasTurns()
        ? t(K.manox.placeholderFollowUp)
        : t(K.manox.placeholder);
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
      <If when={chat()}>
        <LanesLine chat={chat()!} />
      </If>
      <If when={status() === "error"}>
        <View testID="manox-transport-error" class="flex-row items-center gap-1.5">
          <Glyph name="alert" size={10} tint={token("destructive")} />
          <Text class="text-[11px] leading-[16px] text-destructive" style={{ flex: 1 }}>
            {t(K.manox.transportError, { error: connectionError() ?? "" })}
          </Text>
          <ComposerChip
            testID="manox-reconnect"
            label={t(K.engine.reconnect)}
            onPress={() => void reconnect()}
          />
        </View>
      </If>
      {/* The card: a flat surface, one border, no shadow. The border answers
          hover and focus-within — the input inside stays bare. */}
      <View
        class="rounded-xl border border-border bg-card hover:border-input focus-within:border-ring"
        style={{ padding: 12, gap: 12, ...motionStyle("fast") }}
      >
        <Input
          testID="manox-input"
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
        {/* One footer row, two clusters (DESIGN §3.6a): left the `+` and the
            access mode, right the gauge, model, effort and the action —
            idle's ↑ send and streaming's ■ stop in the same spot. */}
        <View class="flex-row items-center justify-between" style={{ gap: 8 }}>
          <View class="flex-row items-center" style={{ gap: 4, flexShrink: 0 }}>
            <ManoxPlus />
            <ManoxMode threadId={props.threadId} />
          </View>
          <View class="flex-row items-center" style={{ gap: 4, flexShrink: 1, minWidth: 0 }}>
            <ManoxContextRing used={ringUsed} max={ringMax} />
            <ManoxModel threadId={props.threadId} />
            <ManoxThinking threadId={props.threadId} />
            {/* Stop is absolute: never gated by the draft. */}
            <ManoxAction
              streaming={streaming()}
              disabled={!canSubmit()}
              onSubmit={submit}
              onStop={() => void cancelManoxTurn(props.chatId)}
            />
          </View>
        </View>
      </View>
    </View>
  );
}
