import { reduceMotion, Text, token, View } from "nsh";
import { TextView } from "nsh/base";
import { SHEET_FONT, SHEET_MONO } from "../../ui/fonts";
import { K, t } from "../../ui/i18n";
import { Glyph } from "../../ui/ui";
import { CopyButton } from "./copy-button";
import { entryText, type Entry } from "./transcript";
import { ThinkingBlock } from "./thinking-block";
import { ToolBlock } from "./tool-block";

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

/**
 * One transcript row (issue #20 §4): the user's message is an integral
 * banner with a vivid left rule, an assistant reply is Markdown with its
 * thinking folded above it, a tool call is a shaded text block, and a note
 * stays a faint line. The list keys rows by the entry's id; the streaming
 * draft is the last row and carries the caret.
 */

/** One transcript row; `streaming` marks the tail the turn is still writing.
 * A List cell is recycled across entries, so the row's kind is a reactive
 * `If`, never a snapshot taken once in the component body. */
export function EntryRow(props: { entry: () => Entry; streaming: () => boolean }) {
  const entry = () => props.entry();
  return (
    <>
      <If when={entry().kind === "user"}>
        <UserBanner entry={entry as () => Entry & { kind: "user" }} />
      </If>
      <If when={entry().kind === "tool"}>
        <ToolBlock entry={entry as () => Entry & { kind: "tool" }} />
      </If>
      <If when={entry().kind === "note"}>
        <NoteRow entry={entry as () => Entry & { kind: "note" }} />
      </If>
      <If when={entry().kind === "assistant"}>
        <AssistantRow entry={entry as () => Entry & { kind: "assistant" }} streaming={props.streaming} />
      </If>
    </>
  );
}

// --- user -------------------------------------------------------------------

/** The user's own words, a full-width banner with a vivid left rule — the
 * intentional GUI deviation from the TUI's `❯` prompt (§4.3). */
function UserBanner(props: { entry: () => Entry & { kind: "user" } }) {
  const entry = () => props.entry();
  return (
    <View
      testID="user-message"
      class="rounded-md bg-muted"
      accessibilityLabel={entryText(entry())}
      style={{
        borderRadius: 6,
        borderLeftWidth: 3,
        borderLeftColor: token("primary"),
        paddingVertical: 8,
        paddingHorizontal: 12,
        gap: 2,
      }}
    >
      <Text
        class="text-[13px] leading-[18px] text-foreground"
        style={{ fontFamily: SHEET_FONT, fontWeight: 300, userSelect: "text" }}
      >
        {entry().text}
      </Text>
      <CopyButton
        testID="user-copy"
        flashKey={() => `user:${entry().id}`}
        label={t(K.session.copy)}
        text={() => entryText(entry())}
        offset={-2}
      />
    </View>
  );
}

// --- assistant --------------------------------------------------------------

/** The reply: its folded thinking, then the Markdown answer. */
function AssistantRow(props: {
  entry: () => Entry & { kind: "assistant" };
  streaming: () => boolean;
}) {
  const entry = () => props.entry();
  const settled = () => !!entry().pi?.settled;
  return (
    <View testID="assistant-markdown" style={{ gap: 8, userSelect: "text" }}>
      <ThinkingBlock entry={entry} streaming={props.streaming} />
      <If when={!!entryText(entry())}>
        <TextView
          markdown={entryText(entry())}
          options={{ streaming: props.streaming() && !settled() }}
          selectable
          codeBlockScrollbar={false}
          streamingCaret={props.streaming() && !settled() ? <Caret /> : undefined}
          styles={{
            // Pi TUI's terminal scale: 13 / 18, tighter headings than a document's.
            root: { gap: 10, fontSize: 13, lineHeight: 18, fontFamily: SHEET_FONT, fontWeight: 300, color: token("foreground") },
            heading1: { fontSize: 17, lineHeight: 22 },
            heading2: { fontSize: 15, lineHeight: 20 },
            heading3: { fontSize: 13, lineHeight: 18 },
            code: { color: token("code"), fontFamily: SHEET_MONO },
            codeBlockCode: { color: token("code"), fontFamily: SHEET_MONO },
            link: { color: token("brand") },
          }}
        />
      </If>
      <If when={!!entry().pi?.error}>
        <View testID="entry-error" class="flex-row items-start gap-1.5 self-start">
          <View style={{ paddingTop: 2 }}>
            <Glyph name="alert" size={10} tint={token("destructive")} />
          </View>
          <Text class="text-[11px] leading-[16px] text-destructive" style={{ fontFamily: SHEET_FONT, flex: 1 }}>
            {entry().pi!.error}
          </Text>
        </View>
      </If>
      <If when={settled() && !!entryText(entry())}>
        <CopyButton
          testID="entry-copy"
          flashKey={() => entry().id}
          label={t(K.session.copy)}
          text={() => entryText(entry())}
          offset={-4}
        />
      </If>
    </View>
  );
}

// --- note -------------------------------------------------------------------

/** A quiet line for a state the transcript outlives (§4.6). */
function NoteRow(props: { entry: () => Entry & { kind: "note" } }) {
  return (
    <View testID="session-note" class="flex-row items-center gap-1.5 self-start px-0.5" style={{ userSelect: "text" }}>
      <Glyph name="branch" size={10} tint={token("faint")} />
      <Text class="text-[11px] text-faint" style={{ fontFamily: SHEET_FONT }}>
        {props.entry().text}
      </Text>
    </View>
  );
}
