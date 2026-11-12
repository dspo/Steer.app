import { effect, List, type ListRef, reduceMotion, signal, Text, token, View } from "nsh";
import { TextView } from "nsh/base";
import { SHEET_FONT } from "./fonts";
import { K, t } from "./i18n";
import { viewFor } from "./sessions";
import { ChatComposer } from "./composer";
import { Glyph } from "./ui";

/**
 * The conversation column, clean-room after the NSH gallery's chat: an
 * assistant reply is selectable Markdown on the 15/22 body scale, a user
 * message is a quiet bubble on the right, a tool step is a compact line and
 * a dispatch note stays faint. The composer's footer carries the only
 * boundary to the transcript: one hairline.
 *
 * An empty session is Steer's hero: the heading and the same inline
 * composer, vertically centered, with no card and no project/access/voice
 * rows.
 */

/** A streaming reply's caret, inline at the end of the last block. */
export function Caret() {
  const still = reduceMotion();
  return (
    <View
      testID="streaming-caret"
      style={{
        width: 7,
        height: 16,
        marginLeft: 2,
        borderRadius: 2,
        backgroundColor: token("brand"),
        ...(still
          ? {}
          : {
              animationName: "pulse",
              animationDuration: 900,
              animationIterationCount: "infinite",
            }),
      }}
    />
  );
}

/** The least a transcript row needs: a session `Msg` or a subagent's plain one. */
export type ChatMessage = {
  role: string;
  text: string;
  tool?: { name: string; state: string };
};

/** One transcript row (also used by the subagent transcript). */
export function MessageRow(props: { message: () => ChatMessage; streaming: () => boolean }) {
  const message = () => props.message();
  const role = () => message().role;
  if (role() === "tool") {
    const tool = () => message().tool;
    const state = () => tool()?.state ?? "done";
    const stateLabel = () =>
      state() === "running" ? t(K.tool.running) : state() === "failed" ? t(K.tool.failed) : t(K.tool.done);
    return (
      <View
        testID="tool-call"
        class="flex-row items-center gap-2 self-start rounded-md border border-line bg-inset px-2 py-1"
      >
        {state() === "running" ? (
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: token("info") }} />
        ) : (
          <Glyph
            name={state() === "failed" ? "alert" : "check"}
            size={10}
            tint={state() === "failed" ? token("destructive") : token("up")}
          />
        )}
        <Text class="text-[11px] font-medium text-foreground">{tool()?.name ?? message().text}</Text>
        <Text class="text-[10px] text-faint">{stateLabel()}</Text>
      </View>
    );
  }
  if (role() === "note") {
    return (
      <View testID="session-note" class="flex-row items-center gap-1.5 self-start px-0.5">
        <Glyph name="branch" size={10} tint={token("faint")} />
        <Text class="text-[11px] text-faint">{message().text}</Text>
      </View>
    );
  }
  if (role() === "user") {
    return (
      <View testID="user-message" class="items-end">
        <View
          style={{
            maxWidth: "82%",
            paddingHorizontal: 14,
            paddingVertical: 10,
            borderRadius: 20,
            borderBottomRightRadius: 6,
            borderCurve: "continuous",
            backgroundColor: token("raised"),
            borderWidth: 1,
            borderColor: token("border"),
          }}
        >
          <Text
            style={{ userSelect: "text", fontFamily: SHEET_FONT, fontSize: 15, lineHeight: 21, color: token("foreground") }}
          >
            {message().text}
          </Text>
        </View>
      </View>
    );
  }
  return (
    <View testID="assistant-markdown" style={{ paddingHorizontal: 2 }}>
      <TextView
        markdown={message().text}
        options={{ streaming: props.streaming() }}
        selectable
        codeBlockScrollbar={false}
        streamingCaret={props.streaming() ? <Caret /> : undefined}
        styles={{
          // A chat's scale: 15 / 22, tighter headings than a document's.
          root: { gap: 12, fontSize: 15, lineHeight: 22, fontFamily: SHEET_FONT, color: token("foreground") },
          heading1: { fontSize: 20, lineHeight: 26 },
          heading2: { fontSize: 17, lineHeight: 22 },
          heading3: { fontSize: 15, lineHeight: 22 },
          code: { color: token("code") },
          codeBlockCode: { color: token("code") },
          link: { color: token("brand") },
        }}
      />
    </View>
  );
}

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
      <Text class="text-[11px] leading-[16px] text-faint" style={{ flex: 1 }}>
        {props.text}
      </Text>
    </View>
  );
}

/** The conversation, with the composer as its footer. */
export function Conversation(props: { id: string }) {
  const view = () => viewFor(props.id);
  const messages = () => view()?.messages ?? [];
  const streaming = () => view()?.streaming ?? false;
  const last = () => messages()[messages().length - 1];
  const waitingForWords = () =>
    streaming() && (!last() || last()?.role !== "assistant" || !last()?.text);
  let list: ListRef | undefined;
  /** Whether the view is at the bottom, so new content follows it. */
  const following = signal(true);
  let dragging = false;

  // A virtualized list: only the rows near the viewport exist, so a long
  // transcript costs its visible height, not its whole history. The list
  // follows the stream while the user stays at the bottom.
  effect(() => {
    const count = messages().length;
    const tail = last()?.text?.length ?? 0;
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
        each={messages()}
        keyExtractor={(_message, index) => String(index)}
        estimatedItemSize={120}
        style={{ flex: 1 }}
        contentStyle={{ paddingHorizontal: 24, paddingVertical: 20, gap: 16 }}
        footer={footer}
        onScrollDragStart={() => (dragging = true)}
        onScroll={(event) => {
          if (!dragging) return;
          following.set(event.offset.y + event.size.height >= event.contentSize.height - 40);
        }}
        onMomentumEnd={() => (dragging = false)}
        onScrollEnd={() => (dragging = false)}
      >
        {(message, index) => (
          <MessageRow
            message={message}
            streaming={() => streaming() && index() === messages().length - 1 && message().role === "assistant"}
          />
        )}
      </List>
      {/* The composer draws its own hairline, exactly its width. */}
      <View class="bg-background" style={{ paddingHorizontal: 24, paddingTop: 8, paddingBottom: 10 }}>
        <ChatComposer sessionId={props.id} autofocus hairline />
      </View>
    </View>
  );
}

/** Steer's empty-session start page: centered heading, inline composer. */
function Hero(props: { id: string }) {
  return (
    <View
      testID="session-hero"
      class="flex-1 items-center justify-center bg-background"
      style={{ paddingHorizontal: 24, paddingBottom: 16 }}
    >
      <View style={{ width: "100%", maxWidth: 720, gap: 20 }}>
        <Text class="text-[16px] font-black text-foreground" style={{ textAlign: "center" }}>
          {t(K.launcher.title)}
        </Text>
        <ChatComposer sessionId={props.id} autofocus />
      </View>
    </View>
  );
}

/** One session's surface: hero while empty, transcript and footer after. */
export function ChatView(props: { id: string }) {
  const view = () => viewFor(props.id);
  const empty = () => (view()?.messages.length ?? 0) === 0;
  return (
    <View class="flex-1 bg-background" style={{ minHeight: 0 }}>
      <If when={empty()}>
        <Hero id={props.id} />
      </If>
      <If when={!empty()}>
        <Conversation id={props.id} />
      </If>
    </View>
  );
}
