import { Text, token, View } from "nsh";
import { TextView } from "nsh/base";
import { SHEET_FONT } from "../../ui/fonts";
import { K, t } from "../../ui/i18n";
import { Glyph } from "../../ui/ui";

/**
 * The subagent transcript's row: the plain {role, text} lane the roster
 * renders. The captain's transcript moved to the entry rows (issue #20);
 * a subagent run keeps its compact shapes — a chip for a tool step, a
 * bubble for the task, Markdown for the output — with the sheet's face.
 */

/** The least a transcript row needs: a subagent run's plain message. */
export type ChatMessage = {
  role: string;
  text: string;
  tool?: { name: string; state: string };
};

/** One subagent transcript row. */
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
        <Text class="text-[11px] font-medium text-foreground" style={{ fontFamily: SHEET_FONT }}>
          {tool()?.name ?? message().text}
        </Text>
        <Text class="text-[10px] text-faint" style={{ fontFamily: SHEET_FONT }}>
          {stateLabel()}
        </Text>
      </View>
    );
  }
  if (role() === "note") {
    return (
      <View testID="session-note" class="flex-row items-center gap-1.5 self-start px-0.5">
        <Glyph name="branch" size={10} tint={token("faint")} />
        <Text class="text-[11px] text-faint" style={{ fontFamily: SHEET_FONT }}>
          {message().text}
        </Text>
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
            style={{ userSelect: "text", fontFamily: SHEET_FONT, fontWeight: 300, fontSize: 13, lineHeight: 18, color: token("foreground") }}
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
        styles={{
          // A chat's scale: 15 / 22, tighter headings than a document's.
          root: { gap: 10, fontSize: 13, lineHeight: 18, fontFamily: SHEET_FONT, fontWeight: 300, color: token("foreground") },
          heading1: { fontSize: 20, lineHeight: 26 },
          heading2: { fontSize: 15, lineHeight: 20 },
          heading3: { fontSize: 13, lineHeight: 18 },
          code: { color: token("code") },
          codeBlockCode: { color: token("code") },
          link: { color: token("brand") },
        }}
      />
    </View>
  );
}
