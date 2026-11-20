import { effect, Scroll, signal, Text, token, View } from "nsh";
import { Input, TextView } from "nsh/base";
import { K, t } from "../../ui/i18n";
import { Glyph, motionStyle, type GlyphName } from "../../ui/ui";
import { connectionStatus, ensureConnection } from "./ahp";
import { openTitleBridge } from "./titles";
import {
  answerManoxInput,
  chatOf,
  chatResource,
  confirmManoxToolCall,
  denyManoxToolCall,
  parseManoxChatSheet,
  sessionResource,
} from "./stores";
import { ManoxComposer } from "./composer";
import type {
  ChatState,
  InputRequestResponsePart,
  ResponsePart,
  ToolCallResponsePart,
  Turn,
} from "../../../contracts/ahp/channels-chat/state";
import { ToolCallStatus, TurnState } from "../../../contracts/ahp/channels-chat/state";
import type { ToolCallCompletedState, MarkdownResponsePart, ReasoningResponsePart, ErrorResponsePart } from "../../../contracts/ahp/channels-chat/state";

/**
 * The manox conversation sheet body (`manox-chat:{threadId}:{chatId}`,
 * DESIGN §3.3/§4.2): the pack's own message area, bound directly to the
 * vendored reducers' fold — zero translation layer. The structure is manox's
 * own implementation; what it reuses from the shell is only the stateless
 * presentation primitives (`TextView` for Markdown, glyphs, motion tokens).
 *
 * Rows: one user row per turn (the turn boundary), then the turn's response
 * parts — streamed Markdown, reasoning blocks, tool-call cards
 * (`chat/toolCallReady`'s minimal approve/deny → `chat/toolCallConfirmed`),
 * elicitation cards (the three actions → `chat/inputCompleted`), and error
 * lines. The active turn renders streaming below the completed ones.
 */

/** One user message row: the turn boundary. */
function UserRow(props: { text: string }) {
  return (
    <View testID="manox-user-message" style={{ alignItems: "flex-end", paddingHorizontal: 4 }}>
      <View class="rounded-xl bg-card px-3 py-2" style={{ maxWidth: 560 }}>
        <Text class="text-[13.5px] leading-[19px] text-foreground" style={{ numberOfLines: 20 }}>
          {props.text}
        </Text>
      </View>
    </View>
  );
}

/** The streaming caret: one quiet mark at the growing edge. */
function StreamingCaret() {
  return <View testID="manox-streaming-caret" class="h-3.5 w-1.5 rounded-sm bg-brand" style={{ opacity: 0.7 }} />;
}

/** A reasoning block: dimmer, quieter, still part of the stream. */
function ReasoningRow(props: { content: string; streaming: boolean }) {
  return (
    <View testID="manox-reasoning" style={{ paddingHorizontal: 4, gap: 2 }}>
      <View class="flex-row items-center gap-1.5">
        <Glyph name="tree" size={10} tint={token("faint")} />
        <Text class="text-[10.5px] font-medium text-faint">{t(K.manox.reasoning)}</Text>
      </View>
      <Text class="text-[11.5px] leading-[16px] text-faint" style={{ numberOfLines: 6 }}>
        {props.content}
      </Text>
      <If when={props.streaming}>
        <StreamingCaret />
      </If>
    </View>
  );
}

/** A tool-call card: what it is, what it wants, and the minimal approval. */
function ToolCallCard(props: { chatId: string; turnId: string; part: ToolCallResponsePart }) {
  const toolCall = () => props.part.toolCall;
  const waiting = () => toolCall().status === ToolCallStatus.PendingConfirmation;
  const statusInk = () => {
    switch (toolCall().status) {
      case ToolCallStatus.Completed:
        return (toolCall() as ToolCallCompletedState).success === false
          ? token("destructive")
          : token("up");
      case ToolCallStatus.Cancelled:
        return token("faint");
      default:
        return token("info");
    }
  };
  const statusLabel = () => {
    switch (toolCall().status) {
      case ToolCallStatus.Streaming:
        return t(K.manox.toolStreaming);
      case ToolCallStatus.PendingConfirmation:
        return t(K.manox.toolAwaitingApproval);
      case ToolCallStatus.Completed:
        return t(K.manox.toolDone);
      case ToolCallStatus.Cancelled:
        return t(K.manox.toolCancelled);
      default:
        return t(K.manox.toolRunning);
    }
  };
  const invocation = () => {
    const message = toolCall().invocationMessage;
    return typeof message === "string" ? message : message?.markdown ?? "";
  };
  return (
    <View
      testID="manox-tool-call"
      class="rounded-xl border border-line bg-card"
      style={{ padding: 10, gap: 6, maxWidth: 640 }}
    >
      <View class="flex-row items-center gap-2">
        <Glyph name="gear" size={12} tint={token("muted-foreground")} />
        <Text
          class="text-[12px] font-semibold text-foreground"
          style={{ flex: 1, numberOfLines: 1 }}
        >
          {toolCall().displayName || toolCall().toolName}
        </Text>
        <Text
          testID="manox-tool-status"
          class="text-[10.5px] font-medium"
          style={{ color: statusInk() }}
        >
          {statusLabel()}
        </Text>
      </View>
      <If when={invocation().length > 0}>
        <Text class="text-[11.5px] leading-[16px] text-muted-foreground">{invocation()}</Text>
      </If>
      <If when={waiting()}>
        <View class="flex-row items-center justify-end gap-2" style={{ paddingTop: 2 }}>
          <View
            role="button"
            testID="manox-deny"
            accessibilityLabel={t(K.manox.deny)}
            class="h-7 flex-row items-center rounded-lg border border-line px-3 hover:bg-hover active:opacity-70 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
            style={{ ...motionStyle("fast") }}
            onPress={() => denyManoxToolCall(props.chatId, props.turnId, toolCall().toolCallId)}
          >
            <Text class="text-[12px] font-medium text-foreground">{t(K.manox.deny)}</Text>
          </View>
          <View
            role="button"
            testID="manox-approve"
            accessibilityLabel={t(K.manox.approve)}
            class="h-7 flex-row items-center rounded-lg bg-primary px-3 hover:bg-primary/90 active:opacity-80 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
            style={{ ...motionStyle("fast") }}
            onPress={() => confirmManoxToolCall(props.chatId, props.turnId, toolCall().toolCallId)}
          >
            <Text class="text-[12px] font-medium text-primary-foreground">{t(K.manox.approve)}</Text>
          </View>
        </View>
      </If>
    </View>
  );
}

/** An elicitation card: the request, a minimal text line, the three actions. */
function InputRequestCard(props: { chatId: string; part: InputRequestResponsePart }) {
  const text = signal("");
  const answered = () => props.part.response != null;
  const question = () =>
    (props.part.request.questions ?? []).find((candidate) => candidate.kind === "text");
  const respond = (response: "accept" | "decline" | "cancel") => {
    answerManoxInput(props.chatId, props.part.request.id, response, text());
    text.set("");
  };
  return (
    <View
      testID="manox-input-request"
      class="rounded-xl border border-line bg-card"
      style={{ padding: 10, gap: 8, maxWidth: 640 }}
    >
      <View class="flex-row items-center gap-2">
        <Glyph name="alert" size={12} tint={token("info")} />
        <Text
          class="text-[12px] font-semibold text-foreground"
          style={{ flex: 1, numberOfLines: 2 }}
        >
          {props.part.request.message ?? t(K.manox.askTitle)}
        </Text>
      </View>
      <If
        when={!answered() && question()}
        else={
          <If when={answered()}>
            <Text testID="manox-ask-answer" class="text-[11px] text-faint">
              {t(K.manox.askAnswered, {
                answer: t(`app.manox.ask.${props.part.response}`),
              })}
            </Text>
          </If>
        }
      >
        <View style={{ gap: 4 }}>
          <Text class="text-[11.5px] text-muted-foreground">{question()!.message}</Text>
          <Input
            testID="manox-ask-input"
            value={text()}
            onChange={({ value }) => text.set(value)}
            placeholder={t(K.dialog.inputPlaceholder)}
            style={{
              height: 30,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: token("border"),
              paddingHorizontal: 8,
              fontSize: 12.5,
              color: token("foreground"),
              placeholderColor: token("faint"),
              backgroundColor: token("background"),
            }}
          />
        </View>
      </If>
      <If when={!answered()}>
        <View class="flex-row items-center justify-end gap-2">
          <CardChip testID="manox-ask-cancel" label={t(K.manox.askCancel)} onPress={() => respond("cancel")} />
          <CardChip testID="manox-ask-decline" label={t(K.manox.askDecline)} onPress={() => respond("decline")} />
          <CardChip testID="manox-ask-accept" label={t(K.manox.askAccept)} primary onPress={() => respond("accept")} />
        </View>
      </If>
    </View>
  );
}

/** One small card action. */
function CardChip(props: { testID: string; label: string; primary?: boolean; onPress: () => void }) {
  return (
    <View
      role="button"
      testID={props.testID}
      accessibilityLabel={props.label}
      class={
        props.primary
          ? "h-7 flex-row items-center rounded-lg bg-primary px-3 hover:bg-primary/90 active:opacity-80 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
          : "h-7 flex-row items-center rounded-lg border border-line px-3 hover:bg-hover active:opacity-70 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
      }
      style={{ ...motionStyle("fast") }}
      onPress={props.onPress}
    >
      <Text
        class="text-[12px] font-medium"
        style={{ color: props.primary ? token("primary-foreground") : token("foreground") }}
      >
        {props.label}
      </Text>
    </View>
  );
}

/** One response part, dispatched by kind. */
function PartRow(props: {
  chatId: string;
  turnId: string;
  part: ResponsePart;
  streaming: boolean;
}) {
  const part = () => props.part;
  switch (part().kind) {
    case "markdown": {
      const markdown = part() as MarkdownResponsePart;
      return (
        <View testID="manox-markdown" style={{ paddingHorizontal: 4 }}>
          <TextView
            markdown={markdown.content}
            selectable
            codeBlockScrollbar={false}
            styles={{
              root: { gap: 8, fontSize: 13.5, lineHeight: 19, color: token("foreground") },
              heading2: { fontSize: 16, lineHeight: 21 },
            }}
          />
          <If when={props.streaming}>
            <StreamingCaret />
          </If>
        </View>
      );
    }
    case "reasoning": {
      const reasoning = part() as ReasoningResponsePart;
      return <ReasoningRow content={reasoning.content} streaming={props.streaming} />;
    }
    case "toolCall":
      return <ToolCallCard chatId={props.chatId} turnId={props.turnId} part={part() as ToolCallResponsePart} />;
    case "inputRequest":
      return <InputRequestCard chatId={props.chatId} part={part() as InputRequestResponsePart} />;
    case "error": {
      const failed = part() as ErrorResponsePart;
      return (
        <View
          testID="manox-error-line"
          class="flex-row items-start gap-1.5"
          style={{ paddingHorizontal: 4 }}
        >
          <View style={{ paddingTop: 2 }}>
            <Glyph name="alert" size={10} tint={token("destructive")} />
          </View>
          <Text class="text-[11.5px] leading-[16px] text-destructive" style={{ flex: 1 }}>
            {failed.error.message}
          </Text>
        </View>
      );
    }
    default:
      return null;
  }
}

/** One turn: the user row (the boundary) then the response parts. */
function TurnRows(props: { chatId: string; turn: Turn; streaming: boolean }) {
  return (
    <View style={{ gap: 10 }}>
      <UserRow text={props.turn.message.text} />
      <Each of={props.turn.responseParts} key="index">
        {(part, index) => (
          <PartRow
            chatId={props.chatId}
            turnId={props.turn.id}
            part={part()}
            streaming={props.streaming && index() === props.turn.responseParts.length - 1}
          />
        )}
      </Each>
    </View>
  );
}

/** The active turn reads as a Turn so one row renderer serves both. */
function activeTurnAsTurn(active: NonNullable<ChatState["activeTurn"]>): Turn {
  return {
    id: active.id,
    startedAt: active.startedAt,
    message: active.message,
    responseParts: active.responseParts,
    usage: active.usage,
    state: TurnState.Complete,
  };
}

/** The manox conversation sheet body. */
export function ManoxChatBody(props: { id: string }) {
  const parsed = parseManoxChatSheet(props.id);
  if (!parsed) {
    return (
      <View class="flex-1 items-center justify-center bg-background">
        <Text class="text-[12px] text-muted-foreground">{props.id}</Text>
      </View>
    );
  }
  const chatUri = () => chatResource(parsed.chatId);
  // The sheet mounts: the thread's title bridge reattaches (issue #73 —
  // a thread restored on this run gets its channel here; idempotent).
  effect(() => {
    openTitleBridge(parsed.threadId);
  });
  // The sheet mounts: the connection subscribes (snapshot → immediate render;
  // the journal legs reconcile behind it, §3.5).
  effect(() => {
    // A missing chat (a stale sheet id against a fresh host) surfaces as
    // the sheet's error status, never an unhandled rejection.
    void ensureConnection([sessionResource(parsed.threadId), chatUri()]).catch(() => {});
  });
  const chat = () => chatOf(parsed.chatId);
  const status = () => connectionStatus();
  const empty = () => (chat()?.turns.length ?? 0) === 0 && chat()?.activeTurn == null;
  return (
    <View class="flex-1 bg-background">
      <If
        when={!empty()}
        else={
          <View class="flex-1 items-center justify-center gap-2 bg-background" testID="manox-empty">
            <Glyph name="chat" size={20} tint={token("faint")} />
            <Text class="text-[12px] text-muted-foreground">{t(K.manox.empty)}</Text>
          </View>
        }
      >
        <Scroll
          style={{ flex: 1 }}
          contentStyle={{
            maxWidth: 820,
            alignSelf: "center",
            width: "100%",
            paddingTop: 14,
            paddingBottom: 14,
            gap: 14,
          }}
        >
          <Each of={chat()?.turns ?? []} key={(turn) => turn.id}>
            {(turn) => <TurnRows chatId={parsed.chatId} turn={turn()} streaming={false} />}
          </Each>
          <If when={chat()?.activeTurn}>
            <TurnRows chatId={parsed.chatId} turn={activeTurnAsTurn(chat()!.activeTurn!)} streaming />
          </If>
          <If when={status() === "connecting"}>
            <Text testID="manox-connecting" class="px-1 text-[11px] text-faint">
              {t(K.manox.connecting)}
            </Text>
          </If>
        </Scroll>
      </If>
      <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}>
        <ManoxComposer threadId={parsed.threadId} chatId={parsed.chatId} />
      </View>
    </View>
  );
}
