import { Clipboard, signal, token, View } from "nsh";
import { K, t } from "../../ui/i18n";
import { Glyph, type GlyphName } from "../../ui/ui";

/**
 * The one copy control: an icon, flashing to a check for 900ms. Its words
 * stay in the tooltip and the accessibility label (§4.3/§4.5), so a row of
 * actions reads as icons rather than Chinese text. The virtualized list
 * recycles rows, so the flash lives in a module map keyed by the owner.
 */
const flashed = signal<Record<string, boolean>>({});

export function CopyButton(props: {
  testID: string;
  flashKey: () => string;
  label: string;
  text: () => string;
  glyph?: GlyphName;
  size?: number;
  /** A left nudge so the glyph's ink lines up with the text's left edge. */
  offset?: number;
}) {
  const copied = () => flashed()[props.flashKey()] ?? false;
  const copy = () => {
    const key = props.flashKey();
    flashed.set({ ...flashed(), [key]: true });
    try {
      void Clipboard.writeText(props.text()).catch(() => {});
    } catch {
      // No clipboard on this host.
    }
    setTimeout(() => {
      const next = { ...flashed() };
      delete next[key];
      flashed.set(next);
    }, 900);
  };
  return (
    <View
      role="button"
      testID={props.testID}
      accessibilityLabel={copied() ? t(K.session.copied) : props.label}
      tooltip={copied() ? t(K.session.copied) : props.label}
      class="h-5 w-5 items-center justify-center rounded self-start hover:bg-hover active:opacity-70 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
      style={{ marginLeft: props.offset ?? 0 }}
      onPress={copy}
    >
      <Glyph
        name={copied() ? "check" : (props.glyph ?? "copy")}
        size={props.size ?? 10}
        tint={copied() ? token("up") : token("muted-foreground")}
      />
    </View>
  );
}
