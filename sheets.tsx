import { Input, TextView } from "nsh/base";
import { Scroll, signal, Text, token, View } from "nsh";
import { send, sessionTitle, stop, viewFor } from "./sessions";
import { abortRun, loadSubagents, runs, selectedRunId, selectRun, transcript, subagentError } from "./subagents";
import { phase } from "./engine";
import { visiblePanels } from "./dock";
import { K, t } from "./i18n";
import { Chip, Dot, Glyph, motionStyle, shadowCard, type GlyphName } from "./ui";

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
  /** The tab title's copy key. */
  title: string;
  glyph: GlyphName;
  /** The glyph's tint token. */
  tint: TintToken;
  /** The dim line under the body's big line. */
  note: string;
}

const SPECS: Record<SheetKind, SheetSpec> = {
  session: { title: K.sheet.sessionTitle, glyph: "chat", tint: "brand", note: K.sheet.sessionNote },
  terminal: { title: K.sheet.terminalTitle, glyph: "terminal", tint: "muted-foreground", note: K.sheet.terminalNote },
  claude: { title: K.sheet.claudeTitle, glyph: "terminal", tint: "warn", note: K.sheet.claudeNote },
  codex: { title: K.sheet.codexTitle, glyph: "terminal", tint: "up", note: K.sheet.codexNote },
  copilot: { title: K.sheet.copilotTitle, glyph: "terminal", tint: "info", note: K.sheet.copilotNote },
  webview: { title: K.sheet.webviewTitle, glyph: "globe", tint: "info", note: K.sheet.webviewNote },
  editor: { title: K.sheet.editorTitle, glyph: "file", tint: "muted-foreground", note: K.sheet.editorNote },
  diff: { title: K.sheet.diffTitle, glyph: "diff", tint: "muted-foreground", note: K.sheet.diffNote },
  files: { title: K.sheet.filesTitle, glyph: "folder", tint: "muted-foreground", note: K.sheet.filesNote },
  subagents: { title: K.sheet.subagentsTitle, glyph: "branch", tint: "muted-foreground", note: K.sheet.subagentsNote },
  tasks: { title: K.sheet.tasksTitle, glyph: "archive", tint: "muted-foreground", note: K.sheet.tasksNote },
  traces: { title: K.sheet.tracesTitle, glyph: "tree", tint: "muted-foreground", note: K.sheet.tracesNote },
  stats: { title: K.sheet.statsTitle, glyph: "pulse", tint: "muted-foreground", note: K.sheet.statsNote },
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
  if (kind === "session") {
    return instance ? sessionTitle(instance) : t(K.sheet.sessionTitle);
  }
  if (kind === "subagents") return t(K.subagents.title);
  const spec = SPECS[kind];
  return spec ? (instance ? `${t(spec.title)} · ${instance}` : t(spec.title)) : id;
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
  const { kind, instance } = sheetParts(props.id);
  const spec = SPECS[kind];
  if (kind === "session") return <SessionBody id={instance || "pending"} sheetId={props.id} />;
  if (kind === "subagents") return <SubagentsBody containerId={instance} />;
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
      <Text class="text-base font-semibold text-foreground">{t(spec.title)}</Text>
      <Text class="text-xs text-muted-foreground">{t(spec.note)}</Text>
      <Text class="text-[11px] font-mono text-faint">{props.id}</Text>
      <Text class="text-[11px] tabular-nums text-faint">{t(K.sheet.taps, { count: taps() })}</Text>
    </View>
  );
}

/** One transcript row: the user's messages right-aligned, the assistant's
 * plain prose, a tool step as a dim line. M1 renders text, not Markdown. */
function MessageRow(props: {
  role: string;
  text: string;
  tool?: { name: string; state: string };
  streaming: boolean;
}) {
  if (props.role === "tool") {
    const running = props.tool?.state === "running";
    const failed = props.tool?.state === "failed";
    const stateLabel =
      props.tool?.state === "running"
        ? t(K.tool.running)
        : props.tool?.state === "failed"
          ? t(K.tool.failed)
          : t(K.tool.done);
    return (
      <View class="flex-row items-center gap-2 self-start rounded-lg border border-line bg-inset px-2.5 py-1.5">
        {running ? (
          <Dot tint={token("info")} size={6} />
        ) : (
          <Glyph name={failed ? "alert" : "check"} size={11} tint={failed ? token("destructive") : token("up")} />
        )}
        <Text class="text-[11px] font-medium text-foreground">{props.tool?.name ?? props.text}</Text>
        <Text class="text-[10px] text-muted-foreground">{stateLabel}</Text>
      </View>
    );
  }
  if (props.role === "note") {
    return (
      <View class="flex-row items-center gap-2 self-start px-0.5">
        <Glyph name="branch" size={11} tint={token("brand")} />
        <Text class="text-[11px] text-muted-foreground">{props.text}</Text>
      </View>
    );
  }
  if (props.role === "user") {
    return (
      <View class="items-end">
        <View class="max-w-[82%] rounded-xl bg-raised px-3 py-2" style={{ borderWidth: 1, borderColor: token("border") }}>
          <Text class="text-[14.5px] leading-[22px] text-foreground">{props.text}</Text>
        </View>
      </View>
    );
  }
  return (
    <View class="px-0.5">
      <TextView
        markdown={props.text}
        options={{ streaming: props.streaming }}
        selectable
        codeBlockScrollbar={false}
        styles={{
          root: { gap: 8, fontSize: 14.5, lineHeight: 22, color: token("foreground") },
          heading1: { fontSize: 18, lineHeight: 26 },
          heading2: { fontSize: 16, lineHeight: 24 },
          heading3: { fontSize: 14.5, lineHeight: 22 },
          code: { color: token("code") },
          codeBlockCode: { color: token("code") },
          link: { color: token("brand") },
        }}
      />
    </View>
  );
}

/** A one-line state banner above the composer (interrupted turn, dead engine). */
function Banner(props: { text: string; tone: "warn" | "destructive" }) {
  return (
    <View class="flex-row items-center gap-2 border-b border-line bg-inset px-3 py-2">
      <Glyph name="alert" size={12} tint={token(props.tone)} />
      <Text class="text-[12px] text-muted-foreground" style={{ flex: 1 }}>
        {props.text}
      </Text>
    </View>
  );
}

/** A subagent's status in the shell's language. */
function statusLabel(status: string): string {
  switch (status) {
    case "running":
      return t(K.subagents.running);
    case "settled":
      return t(K.subagents.settled);
    case "failed":
      return t(K.subagents.failed);
    case "aborted":
      return t(K.subagents.aborted);
    default:
      return t(K.subagents.interrupted);
  }
}

/** The roster: live and settled runs, with a read-only transcript. */
function SubagentsBody(props: { containerId: string }) {
  void loadSubagents(props.containerId);
  const selected = () => runs().find((run) => run.runId === selectedRunId());
  return (
    <View class="flex-1 flex-row bg-card">
      <View class="border-r border-line" style={{ width: 300 }}>
        <View class="flex-row items-center gap-2 border-b border-line px-3 py-2">
          <Glyph name="branch" size={13} tint={token("muted-foreground")} />
          <Text class="flex-1 text-[12px] font-semibold text-foreground">{t(K.subagents.title)}</Text>
          <Chip label={String(runs().length)} />
        </View>
        <Scroll style={{ flex: 1 }} contentStyle={{ paddingVertical: 4 }}>
          <If
            when={runs().length === 0}
            else={
              <Each of={runs()} key={(run) => run.runId}>
                {(run) => {
                  const value = run();
                  const active = value.runId === selectedRunId();
                  return (
                    <View
                      role="button"
                      testID={`subagent-run-${value.runId}`}
                      accessibilityLabel={`Subagent ${value.agent} ${value.runId}`}
                      class={active ? "bg-accent" : "hover:bg-hover"}
                      style={{ paddingHorizontal: 12, paddingVertical: 7, gap: 2 }}
                      onPress={() => void selectRun(value.runId)}
                    >
                      <View class="flex-row items-center gap-1.5">
                        <Dot tint={token(value.status === "running" ? "info" : value.status === "settled" ? "up" : "destructive")} size={6} />
                        <Text class="text-[12px] font-medium text-foreground" style={{ flex: 1, numberOfLines: 1 }}>
                          {value.agent}
                        </Text>
                        <Text class="text-[10px] text-faint">{statusLabel(value.status)}</Text>
                      </View>
                      <Text class="text-[10.5px] text-muted-foreground" style={{ numberOfLines: 1 }}>
                        {value.task}
                      </Text>
                      <Text class="text-[10px] font-mono text-faint">{value.runId}</Text>
                    </View>
                  );
                }}
              </Each>
            }
          >
            <Text class="px-3 py-4 text-[11.5px] text-muted-foreground">{t(K.subagents.empty)}</Text>
          </If>
        </Scroll>
      </View>
      <View class="flex-1">
        <If
          when={!!selected()}
          else={
            <View class="flex-1 items-center justify-center gap-1">
              <Text class="text-[12px] text-muted-foreground">{t(K.subagents.transcript)}</Text>
            </View>
          }
        >
          <View class="flex-row items-center gap-2 border-b border-line px-3 py-2">
            <View style={{ flex: 1 }}>
              <Text class="text-[12px] font-semibold text-foreground">{`${selected()?.agent ?? ""} · ${selectedRunId() ?? ""}`}</Text>
              <Text class="text-[10.5px] text-muted-foreground" style={{ numberOfLines: 1 }}>
                {selected()?.task ?? ""}
              </Text>
            </View>
            <If when={selected()?.status === "running"}>
              <View
                role="button"
                testID="subagent-abort"
                accessibilityLabel={t(K.subagents.abort)}
                class="rounded-md border border-line px-2 py-1 hover:bg-hover"
                onPress={() => selectedRunId() && void abortRun(selectedRunId()!)}
              >
                <Text class="text-[11px] text-destructive">{t(K.subagents.abort)}</Text>
              </View>
            </If>
          </View>
          <Scroll style={{ flex: 1 }} contentStyle={{ paddingHorizontal: 16, paddingVertical: 10, gap: 8 }}>
            <Each of={transcript()} key="index">
              {(message) => (
                <MessageRow
                  role={message().role}
                  text={message().text}
                  streaming={false}
                />
              )}
            </Each>
          </Scroll>
        </If>
      </View>
    </View>
  );
}

/**
 * The conversation: one session's transcript, the streaming indicator and
 * the composer. Return sends; Shift+Return breaks the line. A sheet that is
 * not the displayed tab of its group (or is behind a zoom) draws only a
 * compact placeholder: its view keeps updating in the store, but the
 * Markdown tree and the composer are not mounted until it is visible again.
 */
export function SessionBody(props: { id: string; sheetId: string }) {
  const draft = signal("");
  const view = () => viewFor(props.id);
  const visible = () => visiblePanels().includes(props.sheetId);
  const canSend = () => !!draft().trim() && phase() === "connected" && !!view();
  const submit = () => {
    if (!canSend()) return;
    const text = draft();
    draft.set("");
    void send(text, props.id);
  };
  return (
    <View class="flex-1 bg-card">
      <If when={!visible()}>
        <View class="flex-1 items-center justify-center gap-2 bg-card">
          <Glyph name="chat" size={20} tint={token("faint")} />
          <Text class="text-[12px] font-medium text-muted-foreground">{sessionTitle(props.id)}</Text>
          <Text class="text-[11px] text-faint">{t(K.session.hidden, { count: view()?.messages.length ?? 0 })}</Text>
        </View>
      </If>
      <If when={visible()}>
        <If when={phase() !== "connected"}>
          <Banner text={t(K.session.degraded)} tone="destructive" />
        </If>
        <If when={view()?.interrupted ?? false}>
          <Banner text={t(K.session.interrupted)} tone="warn" />
        </If>
        <Scroll style={{ flex: 1 }} contentStyle={{ paddingHorizontal: 16, paddingVertical: 12, gap: 10 }}>
          <Each of={view()?.messages ?? []} key="index">
            {(message) => (
              <MessageRow
                role={message().role}
                text={message().text}
                tool={message().tool}
                streaming={view()?.streaming ?? false}
              />
            )}
          </Each>
          <If when={view()?.streaming ?? false}>
            <View class="flex-row items-center gap-2">
              <Dot tint={token("info")} size={6} />
              <Text class="text-[12px] text-muted-foreground">{t(K.session.running)}</Text>
            </View>
          </If>
        </Scroll>
        <View class="border-t border-line bg-background px-3 pb-2.5 pt-2">
          <View
            class="rounded-xl border border-border bg-card"
            style={{ paddingHorizontal: 10, paddingTop: 8, paddingBottom: 6, gap: 4, boxShadow: shadowCard() }}
          >
            <Input
              value={draft()}
              onChange={({ value }) => draft.set(value)}
              multiline
              placeholder={t(K.session.placeholder)}
              onSubmit={submit}
              style={{
                minHeight: 52,
                paddingHorizontal: 4,
                paddingVertical: 2,
                fontSize: 14,
                lineHeight: 21,
                color: token("foreground"),
                placeholderColor: token("faint"),
                caretColor: token("primary"),
              }}
            />
            <View class="flex-row items-center gap-2">
              <Text class="text-[10.5px] text-faint" style={{ flex: 1, numberOfLines: 1 }}>
                {t(K.session.composerHint)}
              </Text>
              <View
                role="button"
                testID="session-send"
                accessibilityLabel={view()?.streaming ? t(K.session.stop) : t(K.session.send)}
                class={
                  view()?.streaming
                    ? "items-center justify-center rounded-full bg-destructive hover:opacity-90 active:opacity-70 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
                    : canSend()
                      ? "items-center justify-center rounded-full bg-primary hover:opacity-90 active:opacity-70 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
                      : "items-center justify-center rounded-full bg-muted"
                }
                style={{ width: 30, height: 30, ...motionStyle("fast") }}
                onPress={() => (view()?.streaming ? void stop(props.id) : submit())}
              >
                <Glyph
                  name={view()?.streaming ? "stop" : "send"}
                  size={13}
                  tint={
                    view()?.streaming
                      ? token("destructive-foreground")
                      : canSend()
                        ? token("primary-foreground")
                        : token("faint")
                  }
                />
              </View>
            </View>
          </View>
        </View>
      </If>
    </View>
  );
}
