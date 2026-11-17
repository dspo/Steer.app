import { Clipboard, effect, List, type ListRef, signal, Text, token, View } from "nsh";
import { Input } from "nsh/base";
import { K, t } from "../../ui/i18n";
import { Glyph, motionStyle, type GlyphName } from "../../ui/ui";
import {
  ActionRow,
  CardBody,
  CardLine,
  DaySeparator,
  JumpToLatest,
  MarkdownBlock,
  ThinkingBlock,
  ToolCallCard,
  UserMessage,
  type ChatAction,
  type ToolCardStatus,
} from "../../ui/chat";
import { ensureConnection } from "./ahp";
import {
  answerManoxInput,
  chatOf,
  chatResource,
  confirmManoxToolCall,
  denyManoxToolCall,
  metricsResource,
  parseManoxChatSheet,
  reasoningTimingOf,
  sessionResource,
} from "./stores";
import { ManoxComposer } from "./composer";
import type {
  ChatState,
  InputRequestResponsePart,
  Message,
  ResponsePart,
  ToolCallResponsePart,
} from "../../../contracts/ahp/channels-chat/state";
import { ToolCallStatus } from "../../../contracts/ahp/channels-chat/state";
import type {
  ToolCallCompletedState,
  ToolResultContent,
  MarkdownResponsePart,
  ReasoningResponsePart,
  ErrorResponsePart,
} from "../../../contracts/ahp/channels-chat/state";

/**
 * The manox conversation sheet body (`manox-chat:{threadId}:{chatId}`,
 * DESIGN §3.3/§4.2): the gallery's chat shapes over the pack's own fold —
 * zero translation layer. The turn and its response parts go straight into
 * the presentation kit (`ui/chat.tsx`): Markdown, the thinking collapse, the
 * tool card, elicitations and error lines. The list is virtualized and
 * follows the stream only while the reader is at its bottom.
 */

// --- rows -------------------------------------------------------------------

/** One displayed row: a day line, a user message, a response part, or the
 * reply's action footer. */
type Row =
  | { kind: "day"; id: string; at: string }
  | { kind: "user"; id: string; text: string; attachments: string[] }
  | { kind: "part"; id: string; chatId: string; turnId: string; part: ResponsePart; streaming: boolean; live: boolean; durationMs?: number }
  | { kind: "actions"; id: string; turnId: string; text: string };

/** A completed or active turn, as the projector reads it. */
interface DisplayTurn {
  id: string;
  startedAt?: string;
  message: Message;
  parts: ResponsePart[];
}

const dayKey = (at: number) => {
  const date = new Date(at);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
};

/** The turn's Markdown, the text a reply's Copy copies. */
function turnText(parts: ResponsePart[]): string {
  return parts
    .filter((part) => part.kind === "markdown")
    .map((part) => (part as MarkdownResponsePart).content ?? "")
    .join("\n\n")
    .trim();
}

/** Flattens the chat's turns and their parts into keyed rows, inserting the
 * day line wherever the timeline crosses midnight. */
function rowsOf(chat: ChatState | null, chatId: string): Row[] {
  if (!chat) return [];
  const rows: Row[] = [];
  let lastDay: string | null = null;
  const project = (turn: DisplayTurn, active: boolean) => {
    const at = turn.startedAt ? Date.parse(turn.startedAt) : NaN;
    if (Number.isFinite(at)) {
      const day = dayKey(at);
      if (day !== lastDay) {
        lastDay = day;
        rows.push({ kind: "day", id: `day:${day}`, at: turn.startedAt! });
      }
    }
    const attachments = (turn.message.attachments ?? [])
      .map((attachment) => {
        const record = attachment as { name?: unknown; title?: unknown; uri?: unknown };
        const value = record.name ?? record.title ?? record.uri;
        return typeof value === "string" ? value : "";
      })
      .filter((name) => name.length > 0);
    rows.push({ kind: "user", id: `user:${turn.id}`, text: turn.message.text, attachments });
    const last = turn.parts.length - 1;
    for (let index = 0; index < turn.parts.length; index += 1) {
      const part = turn.parts[index];
      if (!part) continue;
      const partId = "id" in part && typeof part.id === "string" ? part.id : String(index);
      // The settled run's durable clock (the metrics extension face). A part
      // without a row predates the anchor or the kernel lacks the face — the
      // label stays durationless rather than guessed.
      const durationMs = part.kind === "reasoning" ? reasoningTimingOf(chatId, partId)?.durationMs : undefined;
      rows.push({
        kind: "part",
        id: `part:${turn.id}:${partId}`,
        chatId,
        turnId: turn.id,
        part,
        streaming: active && index === last,
        live: active,
        durationMs,
      });
    }
    if (!active) {
      const text = turnText(turn.parts);
      if (text.length > 0) rows.push({ kind: "actions", id: `actions:${turn.id}`, turnId: turn.id, text });
    }
  };
  for (const turn of chat.turns) {
    project({ id: turn.id, startedAt: turn.startedAt, message: turn.message, parts: turn.responseParts }, false);
  }
  if (chat.activeTurn) {
    const active = chat.activeTurn;
    project({ id: active.id, startedAt: active.startedAt, message: active.message, parts: active.responseParts }, true);
  }
  return rows;
}

// --- parts ------------------------------------------------------------------

/** The tool name's line icon (AHP carries no kind, so the name decides). */
function toolGlyph(name: string): GlyphName {
  const value = name.toLowerCase();
  if (/bash|shell|terminal|exec|run/.test(value)) return "terminal";
  if (/read|view|cat|open/.test(value)) return "file";
  if (/edit|write|patch|diff|apply/.test(value)) return "diff";
  if (/search|grep|glob|find/.test(value)) return "search";
  if (/fetch|web|browser|http/.test(value)) return "globe";
  if (/test|check/.test(value)) return "check";
  return "gear";
}

/** AHP's statuses, in the card's vocabulary. */
function toolCardStatus(call: ToolCallResponsePart["toolCall"]): ToolCardStatus {
  switch (call.status) {
    case ToolCallStatus.Completed:
      return (call as ToolCallCompletedState).success === false ? "failed" : "done";
    case ToolCallStatus.Cancelled:
      return "cancelled";
    case ToolCallStatus.PendingConfirmation:
    case ToolCallStatus.PendingResultConfirmation:
      return "pending";
    case ToolCallStatus.Streaming:
      return "streaming";
    default:
      return "running";
  }
}

function toolStatusLabel(call: ToolCallResponsePart["toolCall"]): string {
  switch (call.status) {
    case ToolCallStatus.Streaming:
      return t(K.manox.toolStreaming);
    case ToolCallStatus.PendingConfirmation:
    case ToolCallStatus.PendingResultConfirmation:
      return t(K.manox.toolAwaitingApproval);
    case ToolCallStatus.Completed:
      return (call as ToolCallCompletedState).success === false ? t(K.manox.toolFailed) : t(K.manox.toolDone);
    case ToolCallStatus.Cancelled:
      return t(K.manox.toolCancelled);
    default:
      return t(K.manox.toolRunning);
  }
}

const stringOrMarkdown = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof (value as { markdown?: unknown }).markdown === "string") {
    return String((value as { markdown: string }).markdown);
  }
  return "";
};

const clampLines = (text: string, max = 12): string => {
  const lines = text.split("\n");
  return lines.length > max ? `${lines.slice(0, max).join("\n")}\n…` : text;
};

/** One tool result block, rendered by its AHP type. */
function ResultBlock(props: { block: ToolResultContent }) {
  const value = props.block;
  switch (value.type) {
    case "text":
      return <CardLine text={clampLines(value.text)} />;
    case "terminal": {
      const terminal = value;
      return (
        <View style={{ gap: 2 }}>
          <CardLine
            text={clampLines(terminal.result?.preview ?? terminal.title)}
            tone={terminal.result?.exitCode ? "destructive" : "muted"}
          />
          <If when={terminal.result?.exitCode !== undefined}>
            <CardLine
              text={`${t(K.manox.toolOutput)} · exit ${terminal.result!.exitCode}`}
              tone={terminal.result!.exitCode === 0 ? "up" : "destructive"}
            />
          </If>
        </View>
      );
    }
    case "fileEdit": {
      const edit = value;
      const path = edit.after?.uri ?? edit.before?.uri ?? "";
      const added = edit.diff?.added;
      const removed = edit.diff?.removed;
      return (
        <View style={{ gap: 1 }}>
          <CardLine text={path} tone="muted" />
          <View class="flex-row items-center gap-2">
            <If when={removed !== undefined}>
              <CardLine text={`-${removed}`} tone="destructive" />
            </If>
            <If when={added !== undefined}>
              <CardLine text={`+${added}`} tone="up" />
            </If>
          </View>
        </View>
      );
    }
    case "subagent": {
      const subagent = value;
      return (
        <CardLine
          text={`↳ ${subagent.title}${subagent.description ? ` — ${subagent.description}` : ""}`}
          tone="faint"
        />
      );
    }
    case "resource":
      return <CardLine text={value.uri} tone="faint" />;
    case "embeddedResource":
      return <CardLine text={value.contentType} tone="faint" />;
    default:
      return null;
  }
}

/** A tool call: the gallery's card, with the approval actions it may need. */
function ToolCallPart(props: { chatId: string; turnId: string; part: ToolCallResponsePart }) {
  const call = () => props.part.toolCall;
  const completed = () => (call().status === ToolCallStatus.Completed ? (call() as ToolCallCompletedState) : null);
  const contents = () => completed()?.content ?? [];
  const detail = () =>
    call().intention ??
    stringOrMarkdown((call() as { invocationMessage?: unknown }).invocationMessage ?? "");
  const waiting = () => call().status === ToolCallStatus.PendingConfirmation;
  return (
    <ToolCallCard
      title={call().displayName || call().toolName}
      detail={detail()}
      glyph={toolGlyph(call().toolName || call().displayName)}
      status={toolCardStatus(call())}
      statusLabel={toolStatusLabel(call())}
      actions={
        <If when={waiting()}>
          <View class="flex-row items-center justify-end gap-2" style={{ paddingHorizontal: 10, paddingBottom: 10 }}>
            <CardChip
              testID="manox-deny"
              label={t(K.manox.deny)}
              onPress={() => denyManoxToolCall(props.chatId, props.turnId, call().toolCallId)}
            />
            <CardChip
              testID="manox-approve"
              label={t(K.manox.approve)}
              primary
              onPress={() => confirmManoxToolCall(props.chatId, props.turnId, call().toolCallId)}
            />
          </View>
        </If>
      }
    >
      <If when={contents().length > 0}>
        <CardBody>
          <Each of={contents()}>
            {(block) => <ResultBlock block={block()} />}
          </Each>
        </CardBody>
      </If>
    </ToolCallCard>
  );
}

/** An elicitation card: the request, a minimal text line, the three actions. */
function InputRequestCard(props: { chatId: string; part: InputRequestResponsePart }) {
  const text = signal("");
  const answered = () => props.part.response != null;
  const question = () => (props.part.request.questions ?? []).find((candidate) => candidate.kind === "text");
  const respond = (response: "accept" | "decline" | "cancel") => {
    answerManoxInput(props.chatId, props.part.request.id, response, text());
    text.set("");
  };
  return (
    <View
      testID="manox-input-request"
      class="rounded-xl border border-line bg-card"
      style={{ padding: 10, gap: 8 }}
    >
      <View class="flex-row items-center gap-2">
        <Glyph name="alert" size={12} tint={token("info")} />
        <Text class="text-[12px] font-semibold text-foreground" style={{ flex: 1, numberOfLines: 2 }}>
          {props.part.request.message ?? t(K.manox.askTitle)}
        </Text>
      </View>
      <If
        when={!answered() && question()}
        else={
          <If when={answered()}>
            <Text testID="manox-ask-answer" class="text-[11px] text-faint">
              {t(K.manox.askAnswered, { answer: t(`app.manox.ask.${props.part.response}`) })}
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

/** The settled thinking label of a part row: the run's whole seconds ride
 * the block (the number is its layout), a sub-second run — the wire's
 * `durationMs: 0` edge included — says "<1s" in the locale's own phrasing,
 * and a part without a timing row keeps the durationless label. */
function settledThinkingLabel(row: { durationMs?: number }): { label: string; seconds?: number } {
  if (row.durationMs == null) return { label: t(K.manox.reasoningDone) };
  const seconds = Math.round(row.durationMs / 1000);
  return seconds < 1
    ? { label: t(K.manox.reasoningDoneTimed, { seconds: "<1" }) }
    : { label: t(K.manox.reasoningDone), seconds };
}

/** One response part, dispatched by kind. */
function PartRow(props: { row: Extract<Row, { kind: "part" }> }) {
  // The list may hand this row a different item while the fold changes under
  // it: every read is of the current part, and a missing one renders nothing.
  const part = () => (props.row as { part?: ResponsePart } | undefined)?.part ?? null;
  const kind = () => part()?.kind;
  const markdownText = () => {
    const value = part() as MarkdownResponsePart | null;
    return typeof value?.content === "string" ? value.content : "";
  };
  switch (kind()) {
    case "markdown":
      return <MarkdownBlock text={markdownText()} streaming={props.row.streaming} />;
    case "reasoning": {
      const reasoning = part() as ReasoningResponsePart | null;
      if (!reasoning) return null;
      // Live reads: the fold may re-hand the row under this block, so the
      // settled label is computed per evaluation, not captured.
      const settled = () => settledThinkingLabel(props.row as { durationMs?: number });
      return (
        <ThinkingBlock
          id={reasoning.id}
          text={reasoning.content ?? ""}
          label={props.row.streaming ? t(K.manox.reasoningStreaming) : settled().label}
          seconds={settled().seconds}
          live={props.row.live}
          streaming={props.row.streaming}
        />
      );
    }
    case "toolCall": {
      const call = part() as ToolCallResponsePart | null;
      if (!call) return null;
      return <ToolCallPart chatId={props.row.chatId} turnId={props.row.turnId} part={call} />;
    }
    case "inputRequest": {
      const request = part() as InputRequestResponsePart | null;
      if (!request) return null;
      return <InputRequestCard chatId={props.row.chatId} part={request} />;
    }
    case "systemNotification":
      return (
        <Text testID="manox-notification" class="px-1 text-[11px] text-faint">
          {stringOrMarkdown((part() as { content?: unknown }).content ?? "")}
        </Text>
      );
    case "error": {
      const failed = part() as ErrorResponsePart | null;
      if (!failed?.error) return null;
      return (
        <View testID="manox-error-line" class="flex-row items-start gap-1.5" style={{ paddingHorizontal: 4 }}>
          <View style={{ paddingTop: 2 }}>
            <Glyph name="alert" size={10} tint={token("destructive")} />
          </View>
          <Text class="text-[11.5px] leading-[16px] text-destructive" style={{ flex: 1 }}>
            {failed.error.message}
          </Text>
        </View>
      );
    }
    case "contentRef":
      return null;
    default:
      return null;
  }
}

// --- the sheet --------------------------------------------------------------

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
  // The sheet mounts: the connection subscribes (snapshot → immediate render;
  // the journal legs reconcile behind it, §3.5). The metrics extension face
  // rides along: it carries the settled runs' timing rows the thinking
  // blocks quote.
  effect(() => {
    // A missing chat (a stale sheet id against a fresh host) surfaces as
    // the sheet's error status, never an unhandled rejection.
    void ensureConnection([sessionResource(parsed.threadId), chatUri(), metricsResource(parsed.chatId)]).catch(() => {});
  });
  const chat = () => chatOf(parsed.chatId);
  const rows = () => rowsOf(chat(), parsed.chatId);
  const streaming = () => chat()?.activeTurn != null;
  const empty = () => rows().length === 0;
  const copied = signal<string | null>(null);

  let list: ListRef | undefined;
  /** Whether the reader is at the bottom: the jump button hides there. The
   * list itself holds the position while new parts stream in. */
  const following = signal(true);
  const toEnd = (animated = true) => {
    following.set(true);
    // `scrollToIndex` resolves against the list's current sizes, where
    // `scrollToEnd` can stop short of a row whose height was an estimate.
    const jump = () => {
      const last = rows().length - 1;
      if (last >= 0) list?.scrollToIndex({ index: last, viewPosition: 1, animated });
    };
    queueMicrotask(jump);
    // The heights settle after the data change; a couple of later tries
    // land on the true end.
    setTimeout(() => following() && jump(), 150);
    setTimeout(() => following() && jump(), 600);
  };
  // A freshly opened chat reads from its end; after that the list follows
  // the stream only while it is already at the bottom. `onScroll` keeps
  // `following` honest for every scroll (a wheel included), and no scroll is
  // issued while the reader is above the end.
  let opened = false;
  let queued = false;
  effect(() => {
    const count = rows().length;
    if (opened && !following()) return;
    if (!opened) {
      opened = true;
      toEnd(false);
      return;
    }
    if (count === 0 || queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (!following()) return;
      const last = rows().length - 1;
      if (last >= 0) list?.scrollToIndex({ index: last, viewPosition: 1, animated: true });
    });
  });

  const copy = (turnId: string, text: string) => {
    Clipboard.writeText(text);
    copied.set(turnId);
    setTimeout(() => copied() === turnId && copied.set(null), 1600);
  };

  const actions = (row: Extract<Row, { kind: "actions" }>): ChatAction[] => [
    {
      id: "copy",
      label: copied() === row.turnId ? t(K.manox.copied) : t(K.manox.copy),
      glyph: copied() === row.turnId ? "check" : "file",
      active: copied() === row.turnId,
      onPress: () => copy(row.turnId, row.text),
    },
  ];

  return (
    <View class="flex-1 bg-background" style={{ minHeight: 0 }}>
      <If
        when={!empty()}
        else={
          <View class="flex-1 items-center justify-center gap-2 bg-background" testID="manox-empty">
            <Glyph name="chat" size={20} tint={token("faint")} />
            <Text class="text-[12px] text-muted-foreground">{t(K.manox.empty)}</Text>
          </View>
        }
      >
        <View class="flex-1" style={{ minHeight: 0, width: "100%", maxWidth: 820, alignSelf: "center" }}>
          <List
            testID="manox-transcript"
            ref={(node) => (list = node)}
            each={rows()}
            keyExtractor={(row) => row.id}
            estimatedItemSize={90}
            style={{ flex: 1 }}
            contentStyle={{
              paddingTop: 14,
              paddingBottom: 14,
              gap: 10,
            }}
            onScroll={(event) => {
              following.set(event.offset.y + event.size.height >= event.contentSize.height - 40);
            }}
          >
            {(row) => {
              const current = () => row();
              switch (current().kind) {
                case "day":
                  return <DaySeparator label={(current() as Extract<Row, { kind: "day" }>).at} />;
                case "user": {
                  const user = current() as Extract<Row, { kind: "user" }>;
                  return <UserMessage text={user.text} attachments={user.attachments} />;
                }
                case "part":
                  return <PartRow row={current() as Extract<Row, { kind: "part" }>} />;
                case "actions":
                  return (
                    <ActionRow
                      testID={`chat-actions:${(current() as Extract<Row, { kind: "actions" }>).turnId}`}
                      actions={actions(current() as Extract<Row, { kind: "actions" }>)}
                    />
                  );
                default:
                  return null;
              }
            }}
          </List>
          <If when={!following()}>
            <JumpToLatest label={t(K.manox.jumpLatest)} streaming={streaming()} onPress={() => toEnd()} />
          </If>
        </View>
      </If>
      <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}>
        <ManoxComposer threadId={parsed.threadId} chatId={parsed.chatId} onSend={() => toEnd()} />
      </View>
    </View>
  );
}
