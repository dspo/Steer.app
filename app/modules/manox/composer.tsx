import { signal, Text, token, View } from "nsh";
import { Input } from "nsh/base";
import { K, t } from "../../ui/i18n";
import { Glyph, motionStyle, type GlyphName } from "../../ui/ui";
import {
  ActionType,
  connectionError,
  connectionStatus,
  dispatchAction,
  effectiveState,
  reconnect,
} from "./ahp";
import { cancelManoxTurn, chatResource, sendManoxMessage } from "./stores";
import { MessageKind, PendingMessageKind } from "../../../contracts/ahp/channels-chat/state";
import type { ChatState, Message } from "../../../contracts/ahp/channels-chat/state";

/**
 * The manox composer (the pack's `composer-hairline`, DESIGN §3.2/§4.2).
 *
 * **Copied** from `app/sheets/composer.tsx`'s `ChatComposer` — the hairline
 * design already matched Steer, so migration rather than a rewrite — and
 * adapted to the manox pack; the pi original stays put (the pi composer
 * redesign is another batch):
 * - the footer's model picker, context gauge and slash palette are pi
 *   session semantics and are gone; the hairline over the bare input, the
 *   single right-aligned footer row, and the idle-send / streaming-stop
 *   spots are kept verbatim;
 * - the lanes line (§4.2: steering/queued) reads the chat's pending
 *   messages straight off the vendored reducer's fold;
 * - send dispatches `chat/turnStarted`; while a turn runs, Enter queues
 *   (`chat/pendingMessageSet{queued}`) — the host starts it as its own turn;
 * - a transport error (§3.4: a caught host-half panic) shows inline with the
 *   reconnect path beside it.
 */

/** One footer action. Chips are the footer's scale: h-6, text 11. */
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

/** The manox composer: the hairline input and one right-aligned footer row. */
export function ManoxComposer(props: { threadId: string; chatId: string; autofocus?: boolean }) {
  const draft = signal("");
  const chatUri = () => chatResource(props.chatId);
  const chat = () => effectiveState<ChatState>(chatUri());
  const streaming = () => chat()?.activeTurn != null;
  const canSubmit = () => draft().trim().length > 0;
  const status = () => connectionStatus();
  const take = () => {
    const text = draft();
    draft.set("");
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
      <Input
        testID="manox-input"
        value={draft()}
        onChange={({ value }) => draft.set(value)}
        multiline
        submitBehavior="submit"
        autoFocus={props.autofocus ?? false}
        placeholder={streaming() ? t(K.manox.placeholderStreaming) : t(K.manox.placeholder)}
        onSubmit={submit}
        style={{
          minHeight: 44,
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
      <View class="flex-row items-center justify-end gap-2">
        <If when={status() === "connecting"}>
          <Text class="text-[11px] text-faint">{t(K.manox.connecting)}</Text>
        </If>
        <If
          when={streaming()}
          else={
            <ComposerChip
              testID="manox-send"
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
            testID="manox-stop"
            label={t(K.session.stop)}
            glyph="stop"
            danger
            disabled={false}
            onPress={() => void cancelManoxTurn(props.chatId)}
          />
        </If>
      </View>
    </View>
  );
}
