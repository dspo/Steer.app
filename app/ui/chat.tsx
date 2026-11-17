import { type JSX, reduceMotion, signal, Text, token, View } from "nsh";
import { TextView } from "nsh/base";
import { SHEET_FONT } from "./fonts";
import { Chip, Glyph, motionStyle, shadowCard, type GlyphName } from "./ui";

/**
 * The gallery's chat presentation kit, on the manox conversation's scale
 * (13.5/19 body). Components take primitives only — no protocol types — so a
 * caller passes its own fields and nothing sits between the pack's state and
 * the row. The gallery's thinking block and tool card are the shapes:
 * `Chat.tsx`'s reasoning collapse and `chat/parts.tsx`'s `ToolCard`.
 */

/** Open state of each thinking block, keyed by the caller's part id. UI
 * state only: it never enters a store. */
const thoughtsOpen = signal<Record<string, boolean>>({});

/** A ring that spins natively (the built-in `spin` keyframes). */
export function Spinner(props: { size?: number; tint?: string }) {
  const size = props.size ?? 12;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 2,
        borderColor: token("border"),
        borderTopColor: props.tint ?? token("brand"),
        animationName: "spin",
        animationDuration: 800,
        animationTimingFunction: "linear",
        animationIterationCount: "infinite",
      }}
    />
  );
}

/** The streaming caret: one quiet mark at the growing edge. */
export function StreamCaret(props: { testID?: string }) {
  const still = reduceMotion();
  return (
    <View
      testID={props.testID ?? "chat-stream-caret"}
      style={{
        width: 6,
        height: 14,
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
 * The gallery's thinking block: a ring while it thinks, a label, a rotating
 * caret, and the text behind a hairline. `seconds` is optional: when given,
 * the block renders it after the caller's label; a protocol that carries no
 * timing shows the label alone rather than a guess.
 */
export function ThinkingBlock(props: {
  id: string;
  text: string;
  label: string;
  /** The settled run's whole seconds. Sub-second runs render "<1s" — "0s"
   * would misread the wire's `durationMs: 0` (a settle within the same
   * millisecond as the first delta). */
  seconds?: number;
  /** The turn is running: the block stays open until it settles. */
  live: boolean;
  /** The reasoning text is still growing (the turn's tail). */
  streaming: boolean;
}) {
  // The gallery's reasoning interaction: open and live while the turn runs,
  // then folded to its label once it settles; the reader toggles it after.
  const open = () => props.live || (thoughtsOpen()[props.id] ?? false);
  const toggle = () => {
    if (props.live) return;
    thoughtsOpen.set({ ...thoughtsOpen(), [props.id]: !open() });
  };
  const label = () =>
    props.seconds == null
      ? props.label
      : `${props.label} ${props.seconds < 1 ? "<1s" : `${props.seconds}s`}`;
  return (
    <View style={{ gap: 6 }}>
      <View
        role="button"
        testID="chat-thinking"
        accessibilityLabel={label()}
        accessibilityState={{ selected: open() }}
        class="flex-row items-center gap-1.5 self-start rounded-md px-1 hover:bg-hover active:bg-accent focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
        style={{ height: 26, ...motionStyle("fast") }}
        onPress={toggle}
      >
        <If when={props.streaming} else={<Glyph name="pulse" size={12} tint={token("muted-foreground")} />}>
          <Spinner size={12} tint={token("muted-foreground")} />
        </If>
        <Text class="text-[12.5px] text-muted-foreground" style={{ fontVariant: ["tabular-nums"] }}>
          {label()}
        </Text>
        <View
          style={{
            transform: open() ? "rotate(0deg)" : "rotate(-90deg)",
            transitionProperty: "transform",
            transitionDuration: 220,
            transitionTimingFunction: "ease-out",
          }}
        >
          <Glyph name="caret-down" size={12} tint={token("faint")} />
        </View>
      </View>
      <If when={open()}>
        <View style={{ flexDirection: "row", gap: 10, paddingLeft: 6 }}>
          <View style={{ width: 2, borderRadius: 1, backgroundColor: token("line") }} />
          <Text
            testID="chat-thinking-text"
            style={{
              flex: 1,
              fontSize: 12.5,
              lineHeight: 17,
              color: token("muted-foreground"),
              fontFamily: SHEET_FONT,
              userSelect: "text",
            }}
          >
            {props.text}
          </Text>
        </View>
      </If>
    </View>
  );
}

/** The card's four visual states, as the gallery's badge tones. */
export type ToolCardStatus = "streaming" | "pending" | "running" | "done" | "failed" | "cancelled";

/**
 * The gallery's tool card: a kind icon tile, the title and its detail, a
 * status chip, the body, and an optional action row (approval, retry). The
 * body is the caller's own blocks — text stays mono, a diff stays a diff.
 */
export function ToolCallCard(props: {
  title: string;
  detail?: string;
  glyph: GlyphName;
  status: ToolCardStatus;
  statusLabel: string;
  children?: JSX.Element;
  actions?: JSX.Element;
}) {
  const busy = () => props.status === "streaming" || props.status === "running";
  const tint = () => {
    switch (props.status) {
      case "done":
        return "up" as const;
      case "failed":
        return "destructive" as const;
      case "cancelled":
        return "faint" as const;
      default:
        return "info" as const;
    }
  };
  return (
    <View
      testID="chat-tool-call"
      style={{
        alignSelf: "stretch",
        borderRadius: 12,
        borderWidth: 1,
        borderColor: busy() ? token("info") : token("border"),
        backgroundColor: token("card"),
        overflow: "hidden",
        ...motionStyle("medium"),
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 10 }}>
        <View
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: token("raised"),
            borderWidth: 1,
            borderColor: token("border"),
          }}
        >
          <Glyph name={props.glyph} size={14} tint={token("foreground")} />
        </View>
        <View style={{ flex: 1, gap: 1, minWidth: 0 }}>
          <Text class="text-[12.5px] font-semibold text-foreground" style={{ numberOfLines: 1 }}>
            {props.title}
          </Text>
          <If when={!!props.detail}>
            <Text class="text-[11.5px] text-muted-foreground" style={{ numberOfLines: 1 }}>
              {props.detail}
            </Text>
          </If>
        </View>
        <If
          when={busy()}
          else={<Chip label={props.statusLabel} tint={token(tint())} />}
        >
          <View class="flex-row items-center gap-1.5">
            <Spinner size={10} tint={token("info")} />
            <Text class="text-[11.5px] text-muted-foreground">{props.statusLabel}</Text>
          </View>
        </If>
      </View>
      {props.children}
      {props.actions}
    </View>
  );
}

/** A card body block: inset, mono, at the card's scale. */
export function CardBody(props: { children: JSX.Element }) {
  return (
    <View
      style={{
        borderTopWidth: 1,
        borderTopColor: token("line"),
        backgroundColor: token("inset"),
        paddingHorizontal: 10,
        paddingVertical: 8,
        gap: 4,
      }}
    >
      {props.children}
    </View>
  );
}

/** One mono line of a card body (a command, an output, a path). */
export function CardLine(props: { text: string; tone?: "muted" | "up" | "destructive" | "faint"; testID?: string }) {
  return (
    <Text
      testID={props.testID}
      class="text-[11.5px] leading-[16px]"
      style={{
        fontFamily: SHEET_FONT,
        userSelect: "text",
        color:
          props.tone === "up"
            ? token("up")
            : props.tone === "destructive"
              ? token("destructive")
              : props.tone === "faint"
                ? token("faint")
                : token("muted-foreground"),
      }}
    >
      {props.text}
    </Text>
  );
}

/** A reply's Markdown at the conversation's reading scale. */
export function MarkdownBlock(props: { text: string; streaming: boolean }) {
  return (
    <View testID="chat-markdown" style={{ paddingHorizontal: 4 }}>
      <TextView
        markdown={props.text}
        options={{ streaming: props.streaming }}
        selectable
        codeBlockScrollbar={false}
        styles={{
          root: { gap: 8, fontSize: 13.5, lineHeight: 19, fontFamily: SHEET_FONT, color: token("foreground") },
          heading2: { fontSize: 16, lineHeight: 21 },
        }}
      />
      <If when={props.streaming}>
        <StreamCaret />
      </If>
    </View>
  );
}

/** A user message: the turn boundary, as the gallery's quiet bubble. */
export function UserMessage(props: { text: string; attachments?: string[] }) {
  return (
    <View testID="chat-user-message" style={{ alignItems: "flex-end", gap: 4 }}>
      <If when={props.text.length > 0}>
        <View class="rounded-xl bg-card px-3 py-2" style={{ maxWidth: 560 }}>
          <Text class="text-[13.5px] leading-[19px] text-foreground" style={{ numberOfLines: 20 }}>
            {props.text}
          </Text>
        </View>
      </If>
      <If when={(props.attachments?.length ?? 0) > 0}>
        <View class="flex-row flex-wrap justify-end gap-1">
          <Each of={props.attachments ?? []}>
            {(name) => <Chip label={name()} />}
          </Each>
        </View>
      </If>
    </View>
  );
}

/** The line between days. */
export function DaySeparator(props: { label: string }) {
  const date = new Date(props.label);
  const text = Number.isFinite(date.getTime()) ? `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}` : props.label;
  return (
    <View testID="chat-day" class="flex-row items-center gap-2 py-1">
      <View class="h-px flex-1 bg-line" />
      <Text class="text-[10.5px] text-faint">{text}</Text>
      <View class="h-px flex-1 bg-line" />
    </View>
  );
}

/** One row of message actions, as the gallery's reply footer. */
export interface ChatAction {
  id: string;
  label: string;
  glyph: GlyphName;
  onPress: () => void;
  active?: boolean;
}

export function ActionRow(props: { testID: string; actions: ChatAction[] }) {
  return (
    <View testID={props.testID} class="flex-row items-center gap-1" style={{ marginLeft: -4 }}>
      <Each of={props.actions}>
        {(action) => (
          <View
            role="button"
            testID={`${props.testID}-${action().id}`}
            accessibilityLabel={action().label}
            tooltip={action().label}
            class="h-6 flex-row items-center gap-1 rounded-md px-1.5 hover:bg-hover active:opacity-70 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
            style={{ ...motionStyle("fast") }}
            onPress={action().onPress}
          >
            <Glyph name={action().glyph} size={11} tint={action().active ? token("up") : token("muted-foreground")} />
            <Text class="text-[11px] text-muted-foreground">{action().label}</Text>
          </View>
        )}
      </Each>
    </View>
  );
}

/** The jump-to-latest control, shown while the reader is scrolled up. */
export function JumpToLatest(props: { label: string; streaming: boolean; onPress: () => void }) {
  return (
    <View
      role="button"
      testID="chat-jump-latest"
      accessibilityLabel={props.label}
      tooltip={props.label}
      class="absolute bottom-3 right-4 h-7 flex-row items-center gap-1 rounded-md border border-border bg-card px-2.5 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
      style={{ ...motionStyle("fast"), boxShadow: shadowCard() }}
      onPress={props.onPress}
    >
      <Glyph name="caret-down" size={10} tint={token("muted-foreground")} />
      <Text class="text-[11px] text-muted-foreground">{props.label}</Text>
      <If when={props.streaming}>
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: token("brand") }} />
      </If>
    </View>
  );
}
