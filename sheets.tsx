import { Input } from "nsh/base";
import { Scroll, signal, Text, token, View } from "nsh";
import { messages, send, stop, streaming } from "./sessions";
import { Dot, Glyph, type GlyphName } from "./ui";

/** The color tokens the registry tints glyphs with. */
type TintToken = "brand" | "warn" | "up" | "info" | "muted-foreground" | "primary-foreground" | "faint";

/**
 * The sheet registry: what a sheet kind is (its tab title, glyph, the
 * mock body's big line) and what the body renders. The dock canvas holds
 * sheet ids (`kind:instance`); the registry resolves them. Mock only:
 * every body is one line of text plus a counter that survives drags
 * (`renderPanel` renders once per key, so the component keeps its state
 * wherever the sheet moves).
 */

export type SheetKind =
  | "session"
  | "terminal"
  | "claude"
  | "codex"
  | "copilot"
  | "webview"
  | "editor"
  | "diff"
  | "files"
  | "subagents"
  | "tasks"
  | "traces"
  | "stats";

interface SheetSpec {
  /** The tab's title. */
  title: string;
  glyph: GlyphName;
  /** The glyph's tint token. */
  tint: TintToken;
  /** The body's big line (the placeholder text). */
  label: string;
  /** The dim line under it. */
  note: string;
}

const SPECS: Record<SheetKind, SheetSpec> = {
  session: { title: "Pi Session", glyph: "chat", tint: "brand", label: "Pi Session", note: "对话渲染（mock）" },
  terminal: { title: "终端", glyph: "terminal", tint: "muted-foreground", label: "终端", note: "PTY 模拟终端（mock）" },
  claude: { title: "Claude Code TUI", glyph: "terminal", tint: "warn", label: "Claude Code TUI", note: "外部 agent TUI（mock）" },
  codex: { title: "Codex TUI", glyph: "terminal", tint: "up", label: "Codex TUI", note: "外部 agent TUI（mock）" },
  copilot: { title: "Copilot TUI", glyph: "terminal", tint: "info", label: "GitHub Copilot TUI", note: "外部 agent TUI（mock）" },
  webview: { title: "Webview", glyph: "globe", tint: "info", label: "Webview", note: "内置浏览器（mock）" },
  editor: { title: "编辑器", glyph: "file", tint: "muted-foreground", label: "编辑器", note: "代码编辑器（mock）" },
  diff: { title: "Diff", glyph: "diff", tint: "muted-foreground", label: "Diff", note: "变更对比（mock）" },
  files: { title: "文件", glyph: "folder", tint: "muted-foreground", label: "文件浏览器", note: "工作区文件树（mock）" },
  subagents: { title: "Subagents", glyph: "branch", tint: "muted-foreground", label: "Subagents", note: "子代理会话（mock）" },
  tasks: { title: "后台任务", glyph: "archive", tint: "muted-foreground", label: "后台任务", note: "会话后台命令（mock）" },
  traces: { title: "轨迹", glyph: "tree", tint: "muted-foreground", label: "轨迹", note: "agent 运行轨迹（mock）" },
  stats: { title: "统计", glyph: "pulse", tint: "muted-foreground", label: "统计", note: "token 与费用读数（mock）" },
};

/** Splits a sheet id (`kind:instance`) into its kind and instance. */
export function sheetParts(id: string): { kind: SheetKind; instance: string } {
  const at = id.indexOf(":");
  const kind = (at < 0 ? id : id.slice(0, at)) as SheetKind;
  return { kind, instance: at < 0 ? "" : id.slice(at + 1) };
}

/** A sheet's tab title, by id. */
export function sheetTitle(id: string): string {
  const { kind, instance } = sheetParts(id);
  const spec = SPECS[kind];
  return spec ? (instance && kind !== "session" ? `${spec.title} · ${instance}` : spec.title) : id;
}

/** A sheet's tab glyph, by id. */
export function sheetGlyph(id: string): GlyphName {
  const { kind } = sheetParts(id);
  return SPECS[kind]?.glyph ?? "file";
}

/** The kinds the canvas toolbar offers. */
export const TOOLBAR_KINDS: SheetKind[] = [
  "session",
  "terminal",
  "claude",
  "codex",
  "copilot",
  "webview",
  "editor",
  "diff",
];

/**
 * A sheet's mock body: the registry's big line, the id dimmed, and a
 * counter whose presses survive the sheet moving between panels —
 * `renderPanel` is keyed by id, so the component never remounts on a
 * move. A real sheet renders its domain store here instead.
 */
export function SheetBody(props: { id: string }) {
  const taps = signal(0);
  const { kind } = sheetParts(props.id);
  const spec = SPECS[kind];
  if (kind === "session") return <SessionBody />;
  return (
    <View
      class="flex-1 items-center justify-center gap-3 bg-card"
      role="button"
      accessibilityLabel={`Sheet ${props.id}`}
      onPress={() => taps.set(taps() + 1)}
    >
      <View
        class="items-center justify-center rounded-2xl"
        style={{ width: 52, height: 52, backgroundColor: token("muted") }}
      >
        <Glyph name={spec.glyph} size={24} tint={token(spec.tint)} />
      </View>
      <Text class="text-base font-semibold text-foreground">{spec.label}</Text>
      <Text class="text-xs text-muted-foreground">{spec.note}</Text>
      <Text class="text-[11px] font-mono text-faint">{props.id}</Text>
      <Text class="text-[11px] tabular-nums text-faint">{`taps ${taps()} · 拖我到另一个 panel，计数不丢`}</Text>
    </View>
  );
}


/** One transcript row: the user's messages right-aligned, the assistant's
 * plain prose, a tool step as a dim line. M1 renders text, not Markdown. */
function MessageRow(props: { role: string; text: string }) {
  if (props.role === "tool") {
    return (
      <View class="flex-row items-center gap-2 py-0.5">
        <Glyph name="terminal" size={11} tint={token("faint")} />
        <Text class="text-[11px] font-mono text-faint" style={{ numberOfLines: 1 }}>
          {props.text}
        </Text>
      </View>
    );
  }
  if (props.role === "user") {
    return (
      <View class="items-end">
        <View class="max-w-[82%] rounded-2xl bg-raised px-3 py-2" style={{ borderWidth: 1, borderColor: token("border") }}>
          <Text class="text-[13px] leading-5 text-foreground">{props.text}</Text>
        </View>
      </View>
    );
  }
  return (
    <View class="px-0.5">
      <Text class="text-[13px] leading-[21px] text-foreground">{props.text}</Text>
    </View>
  );
}

/**
 * The conversation: the open session's transcript, the streaming indicator
 * and the composer. Return sends; Shift+Return breaks the line.
 */
export function SessionBody() {
  const draft = signal("");
  const canSend = () => !!draft().trim();
  const submit = () => {
    if (!canSend()) return;
    const text = draft();
    draft.set("");
    void send(text);
  };
  return (
    <View class="flex-1 bg-card">
      <Scroll style={{ flex: 1 }} contentStyle={{ paddingHorizontal: 16, paddingVertical: 12, gap: 10 }}>
        <Each of={messages()} key="index">
          {(message) => <MessageRow role={message().role} text={message().text} />}
        </Each>
        <If when={streaming()}>
          <View class="flex-row items-center gap-2">
            <Dot tint={token("info")} size={6} />
            <Text class="text-[12px] text-muted-foreground">running…</Text>
          </View>
        </If>
      </Scroll>
      <View class="border-t border-line px-3 py-2">
        <View class="flex-row items-end gap-2 rounded-xl border border-border bg-background px-2 py-1.5">
          <View style={{ flex: 1 }}>
            <Input
              value={draft()}
              onChange={({ value }) => draft.set(value)}
              multiline
              placeholder="Message pi — Return sends, Shift+Return breaks"
              onSubmit={submit}
              style={{ fontSize: 13, lineHeight: 19, color: token("foreground"), placeholderColor: token("faint"), height: 38, paddingHorizontal: 6, paddingVertical: 6 }}
            />
          </View>
          <View
            role="button"
            accessibilityLabel={streaming() ? "Stop" : "Send"}
            class={streaming() ? "items-center justify-center rounded-full bg-destructive" : canSend() ? "items-center justify-center rounded-full bg-primary" : "items-center justify-center rounded-full bg-muted"}
            style={{ width: 28, height: 28 }}
            onPress={() => (streaming() ? void stop() : submit())}
          >
            <Glyph name={streaming() ? "stop" : "send"} size={13} tint={streaming() ? token("destructive-foreground") : canSend() ? token("primary-foreground") : token("faint")} />
          </View>
        </View>
      </View>
    </View>
  );
}
