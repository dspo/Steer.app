import { effect, List, type ListRef, signal, Text, token, View } from "nsh";
import { SHEET_FONT } from "../../ui/fonts";
import { K, t } from "../../ui/i18n";
import { viewFor } from "./sessions";
import { transcriptRows, type Entry } from "./transcript";
import { EntryRow, Caret } from "./entry-row";
import { MessageRow } from "./subagent-row";
import { ChatComposer } from "./composer";
import { ApprovalCard, ElicitationDialog } from "./approvals";
import { AskCard } from "./ask";
import { PlanBanner } from "./plan-banner";
import { Glyph } from "../../ui/ui";
import { SessionBanner } from "./session-banner";
import { HistoryLoading } from "./history-loading";

/**
 * The conversation column, in the transcript language (issue #20): an agent
 * transcript at TUI density — the session banner as the list's header, the
 * user's words as an integral banner with a vivid left rule, tool calls as
 * shaded text blocks, replies as Markdown — with the composer's footer as
 * the only boundary.
 *
 * An empty session is the same conversation page, not a separate start
 * page (Q121): the still-empty transcript with the composer docked at the
 * bottom. The banner draws itself only when facts exist — a brand-new
 * session has no pi session yet, so no banner either.
 */

/**
 * A quiet line for a state the transcript outlives: an interrupted turn or
 * a failed request. No banner, no surface — a glyph and faint text.
 */
function QuietLine(props: { testID: string; glyph: "stop" | "alert"; text: string }) {
  return (
    <View testID={props.testID} class="flex-row items-start gap-1.5 self-start px-0.5">
      <View style={{ paddingTop: 2 }}>
        <Glyph name={props.glyph} size={10} tint={token("faint")} />
      </View>
      <Text class="text-[11px] leading-[16px] text-faint" style={{ flex: 1, fontFamily: SHEET_FONT }}>
        {props.text}
      </Text>
    </View>
  );
}

/** The conversation, with the composer as its footer. */
export function Conversation(props: { id: string }) {
  const view = () => viewFor(props.id);
  const entries = () => transcriptRows(view()?.transcript);
  const streaming = () => view()?.streaming ?? false;
  const last = () => entries()[entries().length - 1];
  const waitingForWords = () => {
    const tail = last();
    // A settled transcript writes nothing: no caret once the turn is over.
    if (!streaming()) return false;
    if (!tail) return true;
    // A tool card is not a reply yet; the next words still wait.
    if (tail.kind !== "assistant") return true;
    return !tail.text && !tail.thoughts;
  };
  let list: ListRef | undefined;
  /** Whether the view is at the bottom, so new content follows it. Scrolling
   * up — wheel or drag — flips this immediately; scrolling back to the end
   * resumes the follow. */
  const following = signal(true);

  // A virtualized list: only the rows near the viewport exist, so a long
  // transcript costs its visible height, not its whole history. The list
  // follows the stream while the user stays at the bottom.
  effect(() => {
    const count = entries().length;
    const tail = (() => {
      const entry = last();
      return entry?.kind === "assistant" ? entry.text.length : 0;
    })();
    if (following() && (count > 0 || tail > 0)) {
      queueMicrotask(() => list?.scrollToEnd({ animated: true }));
    }
  });

  const footer = (
    <View style={{ gap: 10 }}>
      <If when={waitingForWords()}>
        <View class="flex-row items-center" style={{ height: 22 }}>
          <Caret />
        </View>
      </If>
      <If when={view()?.interrupted ?? false}>
        <QuietLine testID="session-interrupted" glyph="stop" text={t(K.session.interrupted)} />
      </If>
      <If when={!!view()?.error}>
        <QuietLine
          testID="session-error"
          glyph="alert"
          text={t(K.session.error, { error: view()?.error ?? "" })}
        />
      </If>
    </View>
  );

  return (
    <View class="flex-1 bg-background" style={{ minHeight: 0 }}>
      <List
        testID="session-transcript"
        ref={(node) => (list = node)}
        each={entries()}
        keyExtractor={(entry: Entry) => entry.id}
        estimatedItemSize={72}
        style={{ flex: 1 }}
        contentStyle={{ paddingHorizontal: 24, paddingVertical: 20, gap: 10 }}
        header={<SessionBanner sessionId={props.id} banner={() => view()?.banner} />}
        footer={footer}
        onScroll={(event) => {
          // Any scroll — wheel, trackpad or drag — updates the follow flag.
          // The old `dragging` gate ignored the wheel, so a streaming turn
          // kept pulling the view to the end while the user tried to read up.
          following.set(event.offset.y + event.size.height >= event.contentSize.height - 40);
        }}
      >
        {(entry, index) => (
          <EntryRow
            entry={entry}
            streaming={() => streaming() && index() === entries().length - 1 && entry().kind === "assistant"}
          />
        )}
      </List>
      {/* The composer draws its own hairline, exactly its width. */}
      <View class="bg-background" style={{ paddingHorizontal: 24, paddingTop: 8, paddingBottom: 10, gap: 8 }}>
        {/* The plan banner is context (and the panel's entry), the ask blocks
         * the model, the approval gates it: fixed dock order. */}
        <PlanBanner sessionId={props.id} />
        <AskCard sessionId={props.id} />
        <ApprovalCard sessionId={props.id} />
        <ChatComposer sessionId={props.id} autofocus />
      </View>
    </View>
  );
}

/** One session's surface: loading until hydrated, then the conversation —
 * empty or not, always the same page. */
export function ChatView(props: { id: string }) {
  const view = () => viewFor(props.id);
  // A sheet whose session view does not exist yet is a restored session on
  // its way through hydration, not a brand-new empty one (a new session
  // patches its loaded view before its sheet opens). The "pending" sheet is
  // the one exception: it has no session id to load.
  const loading = () => {
    const current = view();
    return current ? current.loading : props.id !== "pending";
  };
  return (
    <View class="flex-1 bg-background" style={{ minHeight: 0 }}>
      <If when={loading()}>
        <HistoryLoading id={props.id} />
      </If>
      <If when={!loading()}>
        <Conversation id={props.id} />
      </If>
      <ElicitationDialog sessionId={props.id} />
    </View>
  );
}
