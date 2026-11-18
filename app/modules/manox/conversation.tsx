import { Clipboard, effect, Scroll, type ViewRef, signal, Text, token, View } from "nsh";
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
  AssistantHeader,
  ThinkingBlock,
  ToolCallCard,
  ToolFooter,
  UserMessage,
  type ChatAction,
  type ToolCardStatus,
} from "../../ui/chat";
import { effectiveState, ensureConnection } from "./ahp";
import { loadPiModels, modelLabel, usableModels } from "../../domains/pimodels";
import type { SessionState } from "../../../contracts/ahp/channels-session/state";
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

/** Whether the pi model catalogue was asked for (one read per app run). */
let catalogRequested = false;

/** One displayed row: a day line, a user message, a response part, or the
 * reply's action footer. */
type Row =
  | { kind: "day"; id: string; at: string }
  | { kind: "user"; id: string; text: string; attachments: string[] }
  | { kind: "header"; id: string; turnId: string; model: string }
  | { kind: "part"; id: string; chatId: string; turnId: string; part: ResponsePart; streaming: boolean; live: boolean; durationMs?: number }
  | { kind: "actions"; id: string; turnId: string; text: string };

/** A completed or active turn, as the projector reads it. */
interface DisplayTurn {
  id: string;
  startedAt?: string;
  message: Message;
  parts: ResponsePart[];
}

/** The reply's model name: the turn's own selection first, else the thread's
 * configured model ref, resolved against the pi catalogue (the gallery shows
 * the model beside the assistant's avatar). */
const modelLabels = new Map<string, string>();

function labelForRef(ref: string): string {
  const cached = modelLabels.get(ref);
  if (cached !== undefined) return cached;
  const id = ref.includes("/") ? ref.slice(ref.lastIndexOf("/") + 1) : ref;
  const row = usableModels().find((candidate) => candidate.model.id === id);
  const label = row ? modelLabel(row) : id;
  modelLabels.set(ref, label);
  return label;
}

function modelLabelOf(turn: DisplayTurn, threadId: string): string {
  const explicit = turn.message.model?.id;
  let ref = typeof explicit === "string" ? explicit : "";
  if (!ref) {
    const state = effectiveState<SessionState>(sessionResource(threadId));
    const value = state?.config?.values?.["model"] ?? state?.config?.schema?.properties?.["model"]?.default;
    if (typeof value === "string") ref = value;
  }
  return ref ? labelForRef(ref) : "";
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

/** One turn's rows, carrying the day cursor across turns. */
function projectTurn(
  turn: DisplayTurn,
  chatId: string,
  threadId: string,
  active: boolean,
  lastDay: string | null,
): { rows: Row[]; lastDay: string | null } {
  const rows: Row[] = [];
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
  if (turn.parts.length > 0) {
    rows.push({ kind: "header", id: `header:${turn.id}`, turnId: turn.id, model: modelLabelOf(turn, threadId) });
  }
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
  return { rows, lastDay };
}

/** The completed turns' rows, cached by the turns array's identity: streaming
 * replaces the active turn per delta, the completed array only when a turn
 * settles. Rebuilding every turn per token was the jank behind scrolling. */
let cachedTurns: ChatState["turns"] | null = null;
let cachedMetrics: unknown = null;
let cachedRows: Row[] = [];
let cachedLastDay: string | null = null;

function projectCompleted(chat: ChatState, chatId: string, threadId: string): void {
  const metrics = effectiveState<{ reasoningTimings?: unknown }>(metricsResource(chatId));
  if (chat.turns === cachedTurns && metrics === cachedMetrics) return;
  cachedTurns = chat.turns;
  cachedMetrics = metrics;
  const rows: Row[] = [];
  let lastDay: string | null = null;
  for (const turn of chat.turns) {
    const projected = projectTurn(
      { id: turn.id, startedAt: turn.startedAt, message: turn.message, parts: turn.responseParts },
      chatId,
      threadId,
      false,
      lastDay,
    );
    rows.push(...projected.rows);
    lastDay = projected.lastDay;
  }
  cachedRows = rows;
  cachedLastDay = lastDay;
}

/** Flattens the chat into keyed rows: the cached completed turns, then the
 * active turn's rows (only that tail is rebuilt while a turn streams). */
function rowsOf(chat: ChatState | null, chatId: string, threadId: string): Row[] {
  if (!chat) return [];
  projectCompleted(chat, chatId, threadId);
  const active = chat.activeTurn;
  if (!active) return cachedRows;
  return [
    ...cachedRows,
    ...projectTurn(
      { id: active.id, startedAt: active.startedAt, message: active.message, parts: active.responseParts },
      chatId,
      threadId,
      true,
      cachedLastDay,
    ).rows,
  ];
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
  // A terminal result is the card's footer (the gallery's `Output … exit …`);
  // every other block is the body.
  const bodyBlocks = () => contents().filter((block) => block.type !== "terminal");
  const terminal = () => contents().find((block) => block.type === "terminal");
  const exitCode = () => (terminal()?.type === "terminal" ? terminal()!.result?.exitCode : undefined);
  const outputText = () =>
    terminal()?.type === "terminal"
      ? clampLines(terminal()!.result?.preview ?? terminal()!.title, 2)
      : "";
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
      footer={
        <If when={!!terminal()}>
          <ToolFooter
            label={t(K.manox.toolOutput)}
            value={outputText() || t(K.manox.noOutput)}
            tone={exitCode() ? "destructive" : "up"}
            meta={exitCode() !== undefined ? `exit ${exitCode()}` : undefined}
          />
        </If>
      }
    >
      <If when={bodyBlocks().length > 0}>
        <CardBody>
          <Each of={bodyBlocks()}>
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
  // The model catalogue is a one-shot read, never part of the reactive
  // effect below: that effect re-runs on every channel envelope, and a
  // catalogue reload per delta re-renders the whole list.
  if (!catalogRequested) {
    catalogRequested = true;
    void loadPiModels();
  }
  const chat = () => chatOf(parsed.chatId);
  const rows = () => rowsOf(chat(), parsed.chatId, parsed.threadId);
  const streaming = () => chat()?.activeTurn != null;
  const empty = () => rows().length === 0;
  const copied = signal<string | null>(null);

  let bottom: ViewRef | undefined;
  /** Whether the reader is at the bottom: the jump button hides there. The
   * scroll view holds its position while new parts stream in. */
  const following = signal(true);
  const revealEnd = (animated = true) => {
    queueMicrotask(() => bottom?.reveal({ vertical: "end", animated }));
  };
  const toEnd = (animated = true) => {
    following.set(true);
    revealEnd(animated);
    // The layout settles after the data change; a later try lands on the
    // true end (the same reason the list needed retries).
    setTimeout(() => following() && revealEnd(animated), 150);
  };
  // A freshly opened chat reads from its end; after that the view follows
  // the stream only while it is already at the bottom.
  let opened = false;
  let queued = false;
  effect(() => {
    const count = rows().length;
    if (!opened) {
      opened = true;
      queueMicrotask(() => revealEnd(false));
      return;
    }
    if (count === 0 || !following() || queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (following()) revealEnd(true);
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
      glyph: copied() === row.turnId ? "check" : "copy",
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
          <Scroll
            testID="manox-transcript"
            scrollbar={false}
            style={{ flex: 1 }}
            contentStyle={{ paddingTop: 16, paddingBottom: 16 }}
            onScroll={(event) => {
              const atBottom = event.offset.y + event.size.height >= event.contentSize.height - 40;
              if (following() !== atBottom) following.set(atBottom);
            }}
          >
            <View style={{ gap: 12 }}>
              <Each of={rows()} key={(row) => row.id}>
                {(row) => {
                  const current = () => row();
                  switch (current().kind) {
                    case "day":
                      return <DaySeparator label={(current() as Extract<Row, { kind: "day" }>).at} />;
                    case "user": {
                      const user = current() as Extract<Row, { kind: "user" }>;
                      return <UserMessage text={user.text} attachments={user.attachments} />;
                    }
                    case "header": {
                      const header = current() as Extract<Row, { kind: "header" }>;
                      return <AssistantHeader model={header.model} />;
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
              </Each>
              <View ref={(node) => (bottom = node)} style={{ height: 1 }} />
            </View>
          </Scroll>
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
