import { signal, Text, token, View } from "nsh";
import { Collapsible } from "nsh/base";
import { SHEET_FONT, SHEET_MONO } from "../../ui/fonts";
import { K, t } from "../../ui/i18n";
import type { AssistantEntry } from "./transcript";

/**
 * The thinking lane, in Pi TUI's shape: no header, no caret, no separate
 * control. The first line is the trigger; opening reveals the rest with the
 * base `Collapsible`'s native reveal. Streaming opens it and shows every line
 * (the old tail-only view hid most of the thinking); settled starts folded.
 */

/** One open/closed toggle per entry id; the virtualized list recycles rows,
 * so the state lives here, not in a row (issue #20 §10.1). */
const expanded = signal<Record<string, boolean>>({});

function isOpen(id: string): boolean {
  return expanded()[id] ?? false;
}

function toggle(id: string): void {
  expanded.set({ ...expanded(), [id]: !isOpen(id) });
}

export function ThinkingBlock(props: { entry: () => AssistantEntry; streaming: () => boolean }) {
  const entry = () => props.entry();
  const thoughts = () => entry().thoughts ?? "";
  const running = () => props.streaming() && !entry().pi?.settled;
  const open = () => running() || isOpen(entry().id);
  const lines = () => thoughts().split("\n");
  const firstIndex = () => {
    const index = lines().findIndex((line) => line.trim().length > 0);
    return index < 0 ? 0 : index;
  };
  const firstLine = () => lines()[firstIndex()]?.trim() ?? "";
  const rest = () => lines().slice(firstIndex() + 1).join("\n").replace(/\s+$/, "");
  return (
    <If when={!!thoughts()}>
      <View testID="thinking" style={{ userSelect: "text" }}>
        <Collapsible
          open={open()}
          reveal
          content={
            <View
              testID="thinking-body"
              role="button"
              accessibilityLabel={t(K.session.thinking)}
              style={{ paddingVertical: 2, userSelect: "text" }}
              onPress={() => toggle(entry().id)}
            >
              <Text
                class="self-stretch text-[13px] leading-[18px] italic text-muted-foreground"
                style={{ fontFamily: SHEET_FONT, fontWeight: 300, flexWrap: "wrap", userSelect: "text" }}
              >
                {spans(rest()).map((span) => (
                  <Text
                    style={
                      span.code
                        ? { fontFamily: SHEET_MONO, color: token("code") }
                        : { fontFamily: SHEET_FONT }
                    }
                  >
                    {span.text}
                  </Text>
                ))}
              </Text>
            </View>
          }
        >
          <View
            role="button"
            testID={`thinking-toggle-${entry().id}`}
            accessibilityLabel={t(K.session.thinking)}
            accessibilityState={{ expanded: open() }}
            tooltip={t(K.session.thinking)}
            class="focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
            style={{ flexDirection: "row", paddingVertical: 2, width: "100%" }}
            onPress={() => toggle(entry().id)}
          >
            {/* Two Texts, one per fold state, in `If` branches: a Text whose
             * `numberOfLines` flips in place (a stream settling, an expand
             * folding) dropped its string on the macOS backend and kept only
             * the blank line box. The folded branch is also constrained to
             * the row like every other one-line preview (composer, session
             * banner), so the ellipsis engages — pi's thinking is often a
             * single long paragraph line, and an unconstrained Text ran past
             * the row's edge to a mid-word clip with no ellipsis at all. */}
            <If when={open()}>
              <Text
                class="text-[13px] leading-[18px] italic text-muted-foreground"
                style={{ fontFamily: SHEET_FONT, fontWeight: 300, flex: 1, minWidth: 0, userSelect: "text" }}
              >
                {firstLine() || t(K.session.thinkingCollapsed)}
              </Text>
            </If>
            <If when={!open()}>
              <Text
                class="text-[13px] leading-[18px] italic text-muted-foreground"
                style={{
                  fontFamily: SHEET_FONT,
                  fontWeight: 300,
                  numberOfLines: 1,
                  textOverflow: "ellipsis",
                  flex: 1,
                  minWidth: 0,
                  userSelect: "text",
                }}
              >
                {firstLine() || t(K.session.thinkingCollapsed)}
              </Text>
            </If>
          </View>
        </Collapsible>
      </View>
    </If>
  );
}

/** The thinking text with its inline `` `code` `` runs as mono spans; one
 * parent Text keeps a drag selecting across lines while the child spans keep
 * the highlighting. */
function spans(text: string): Array<{ text: string; code: boolean }> {
  const parts = text.split("`");
  return parts.map((part, index) => ({ text: part, code: index % 2 === 1 })).filter((part) => part.text.length > 0);
}
