import { Overlay, Scroll, Text, token, View, type Bounds } from "nsh";
import { TextView } from "nsh/base";
import { K, t } from "./i18n";
import { shadowRaised } from "./ui";

/**
 * A stateless hover card: Markdown in a `TextView`, anchored to a word's
 * page bounds. The editor and the Problems sheet both show LSP hovers; the
 * card carries no state and no module knows the other.
 */
export function HoverCard(props: { markdown: string; anchor: Bounds; onClose: () => void }) {
  return (
    <Overlay
      anchor={props.anchor}
      placement="bottom"
      align="start"
      offset={6}
      margin={8}
      onPressOutside={props.onClose}
      onCancel={props.onClose}
    >
      <View
        testID="editor-hover"
        accessibilityLabel={t(K.editor.hover)}
        class="rounded-xl border border-line bg-popover"
        style={{ width: 430, maxHeight: 300, overflow: "hidden", boxShadow: shadowRaised() }}
      >
        <Scroll style={{ maxHeight: 300 }} contentStyle={{ paddingHorizontal: 12, paddingVertical: 10 }}>
          <TextView
            markdown={props.markdown}
            selectable
            codeBlockScrollbar={false}
            styles={{
              root: { gap: 6, fontSize: 12, lineHeight: 18, color: token("foreground") },
              code: { color: token("code") },
              codeBlockCode: { color: token("code") },
              link: { color: token("brand") },
            }}
            classes={{ codeBlock: "bg-inset rounded-lg" }}
          />
        </Scroll>
      </View>
    </Overlay>
  );
}
