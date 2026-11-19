import { effect, reduceMotion, Scroll, signal, Text, token, View } from "nsh";
import { SHEET_MONO } from "../../ui/fonts";
import { K, t } from "../../ui/i18n";
import { Glyph, motionStyle, type GlyphName } from "../../ui/ui";
import { activeContainerId } from "../../core/containers";
import { dispatchIntent } from "../../core/registry";
import { CopyButton } from "./copy-button";
import { toolCardFor, type ToolCardProps } from "./tool-cards";
import type { DiffBlock, ToolEntry } from "./transcript";

/**
 * A tool call is one shaded text block (issue #20 §4.5, revised after the
 * Pi TUI comparison): no title bar, no kind icon, no caret. Collapsed it is
 * the input's first line + `...`; expanded it is the input and the output.
 * The block itself toggles on a press, including its body.
 *
 * The footer is the one row of chrome: status spinner/check/alert, duration,
 * exit code, then the copy/open icons, separated from the body by a faint
 * hairline. Nothing in the body carries status — the command starts with `$`,
 * not a status glyph.
 *
 * A List cell is recycled across entries: every value reads `entry()` inside
 * a binding, and each kind is an `If` branch.
 */

/** One open/closed toggle per toolCallId (issue #20 §10.1). */
const expanded = signal<Record<string, boolean>>({});

function isOpen(id: string): boolean {
  return expanded()[id] ?? false;
}

function toggle(id: string): void {
  expanded.set({ ...expanded(), [id]: !isOpen(id) });
}

/** Tool content: body size, mono, and the light weight of the transcript. */
const CONTENT = { fontFamily: SHEET_MONO, fontSize: 13, lineHeight: 18, fontWeight: 300 } as const;
/** Footer/meta: a step below the content. */
const META = { fontFamily: SHEET_MONO, fontSize: 11, lineHeight: 14, fontWeight: 400 } as const;

/** `1.8s`, `420ms`: the execute duration at a glance. */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

const KINDS = ["execute", "read", "edit", "write", "search"];

/**
 * A tool row: a registered card when the live result carried `details`
 * (main's structured tool-result channel), else the compact transcript
 * block. A replay has no details, so it always takes the compact path.
 */
export function ToolBlock(props: { entry: () => ToolEntry }) {
  const entry = () => props.entry();
  const details = () => entry().meta?.details;
  const card = () => (details() !== undefined ? toolCardFor(entry().name ?? "") : undefined);
  const state = (): ToolCardProps["state"] => {
    const status = entry().status;
    return status === "failed" ? "failed" : status === "in_progress" || status === "pending" ? "running" : "done";
  };
  return (
    <If when={card()} else={<CompactTool entry={props.entry} />}>
      {(renderer) => {
        const Card = renderer();
        return (
          <View testID="tool-card">
            <Card
              name={entry().name ?? entry().title}
              entryId={entry().id}
              details={details()}
              state={state()}
            />
          </View>
        );
      }}
    </If>
  );
}

function CompactTool(props: { entry: () => ToolEntry }) {
  const entry = () => props.entry();
  const open = () => isOpen(entry().toolCallId);
  const emptyBody = () => {
    const value = entry();
    return (
      !(value.output ?? "") &&
      (value.diffs ?? []).length === 0 &&
      value.rawInput === undefined &&
      !pathOf(value)
    );
  };
  return (
    <View testID="tool-call" accessibilityLabel={toolLabel(entry())} style={{ gap: 6 }}>
      <View
        role="button"
        // The execute card owns the generic toggle (§4.5); the other kinds
        // carry their own, so a headless press reaches the right card. The
        // whole inset block is the target — a tool call is a shaded text
        // block with a footer, not a card with a title bar.
        testID={entry().toolKind === "execute" ? "tool-toggle" : `tool-toggle-${entry().toolKind ?? "other"}`}
        tooltip={t(K.tool.output)}
        accessibilityLabel={toolLabel(entry())}
        class="rounded-lg bg-inset focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
        style={{ paddingVertical: 6, paddingHorizontal: 10, gap: 4, userSelect: "text" }}
        onPress={() => toggle(entry().toolCallId)}
      >
        <If when={!open()}>
          <Text
            testID="tool-preview"
            class="text-foreground"
            style={{ ...CONTENT, numberOfLines: 1, flex: 1 }}
          >
            {previewOf(entry())}
          </Text>
        </If>
        <If when={open()}>
          <If when={emptyBody()}>
            <Text testID="tool-fallback" class="text-foreground" style={CONTENT}>
              {entry().title || entry().name || "tool"}
            </Text>
          </If>
          <Body entry={entry} open={open} />
        </If>
        <TruncatedNote entry={entry} />
        {/* The one chrome row, after a hairline that barely reads. */}
        <View style={{ height: 1, backgroundColor: token("line"), opacity: 0.7 }} />
        <Footer entry={entry} />
      </View>
    </View>
  );
}

/** Footer: status, duration, exit, then copy/open. */
function Footer(props: { entry: () => ToolEntry }) {
  const entry = props.entry;
  const stats = () => entry().meta;
  const copy = () => copyAction(entry());
  const path = () => pathOf(entry());
  const kind = () => entry().toolKind;
  return (
    <View testID="tool-footer" class="flex-row items-center gap-1.5">
      <StatusMark entry={entry} />
      <If when={!!stats()?.durationMs}>
        <Text testID="tool-duration" class="text-faint" style={META}>
          {formatDuration(stats()!.durationMs!)}
        </Text>
      </If>
      <If when={typeof stats()?.exitCode === "number"}>
        <Text
          testID="tool-exit"
          style={{ ...META, color: stats()!.exitCode === 0 ? token("up") : token("destructive") }}
        >
          {`exit ${stats()!.exitCode}`}
        </Text>
      </If>
      <If when={!!copy()}>
        <CopyButton
          testID={copy()?.testID ?? "tool-copy"}
          flashKey={() => `${entry().toolCallId}:copy`}
          label={copy()?.label ?? t(K.tool.copyOutput)}
          text={() => copy()?.text ?? ""}
        />
      </If>
      <If when={!!path() && (kind() === "read" || kind() === "edit" || kind() === "write")}>
        <GhostButton
          testID="tool-open"
          glyph="code"
          label={t(K.tool.openFile)}
          onPress={() => openInEditor(path()!)}
        />
      </If>
      <View style={{ flex: 1 }} />
    </View>
  );
}

/** A Braille-cell spinner, the TUI's progress glyph (not a glowing dot). */
const BRAILLE = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function BrailleSpinner() {
  // Per card: one shared frame would be advanced by every running card's
  // interval, so two concurrent tools would make each other's spinner jump.
  const spin = signal(0);
  effect(() => {
    if (reduceMotion()) return;
    const timer = setInterval(() => spin.set((spin() + 1) % BRAILLE.length), 80);
    return () => clearInterval(timer);
  });
  return (
    <Text
      testID="tool-running"
      style={{ ...META, color: token("muted-foreground") }}
    >
      {BRAILLE[spin()]}
    </Text>
  );
}

function StatusMark(props: { entry: () => ToolEntry }) {
  const status = () => props.entry().status;
  const running = () => status() === "pending" || status() === "in_progress";
  return (
    <>
      <If when={running()}>
        <BrailleSpinner />
      </If>
      <If when={status() === "failed"}>
        <Glyph name="alert" size={10} tint={token("destructive")} />
      </If>
      <If when={!running() && status() !== "failed"}>
        <Glyph name="check" size={10} tint={token("up")} />
      </If>
    </>
  );
}

// --- bodies -----------------------------------------------------------------

/** The kind's body as reactive branches: a recycled cell may become another
 * kind between renders. Only the expanded state renders it. */
function Body(props: { entry: () => ToolEntry; open: () => boolean }) {
  const kind = () => props.entry().toolKind;
  return (
    <>
      <If when={kind() === "execute"}>
        <ExecuteBody entry={props.entry} open={props.open} />
      </If>
      <If when={kind() === "read"}>
        <ReadBody entry={props.entry} open={props.open} />
      </If>
      <If when={kind() === "edit" || kind() === "write"}>
        <EditBody entry={props.entry} open={props.open} />
      </If>
      <If when={kind() === "search"}>
        <SearchBody entry={props.entry} open={props.open} />
      </If>
      <If when={!KINDS.includes(kind() ?? "")}>
        <OtherBody entry={props.entry} open={props.open} />
      </If>
    </>
  );
}

function ExecuteBody(props: { entry: () => ToolEntry; open: () => boolean }) {
  const command = () => commandOf(props.entry());
  const output = () => props.entry().output ?? "";
  return (
    <View testID="tool-body" style={{ gap: 4 }}>
      <If when={!!command()}>
        <Text testID="tool-command" class="text-foreground" style={CONTENT}>
          {`$ ${command()}`}
        </Text>
      </If>
      {/* One Text, so a mouse drag selects across lines. */}
      <If when={output().length > 0}>
        <View testID="tool-full-output" style={{ maxHeight: 360 }}>
          <Scroll style={{ maxHeight: 348 }}>
            <Text class="text-muted-foreground" style={{ ...CONTENT, userSelect: "text" }}>
              {output()}
            </Text>
          </Scroll>
        </View>
      </If>
    </View>
  );
}

function ReadBody(props: { entry: () => ToolEntry; open: () => boolean }) {
  const output = () => props.entry().output ?? "";
  return (
    <View testID="tool-body" style={{ gap: 4 }}>
      <Text testID="tool-params" class="text-foreground" style={CONTENT}>
        {inputLine(props.entry())}
      </Text>
      <If when={output().length > 0}>
        <View testID="tool-full-output" style={{ maxHeight: 360 }}>
          <Scroll style={{ maxHeight: 348 }}>
            <Text class="text-muted-foreground" style={{ ...CONTENT, userSelect: "text" }}>
              {output()}
            </Text>
          </Scroll>
        </View>
      </If>
    </View>
  );
}

function EditBody(props: { entry: () => ToolEntry; open: () => boolean }) {
  const diffs = () => props.entry().diffs ?? [];
  const added = () => diffs().reduce((sum, diff) => sum + diff.newText.split("\n").length, 0);
  const removed = () =>
    diffs().reduce((sum, diff) => sum + (diff.oldText ? diff.oldText.split("\n").length : 0), 0);
  const output = () => props.entry().output ?? "";
  return (
    <View testID="tool-body" style={{ gap: 4 }}>
      <View class="flex-row items-baseline gap-2">
        <Text testID="tool-params" class="text-foreground" style={CONTENT}>
          {inputLine(props.entry())}
        </Text>
        <If when={added() > 0 || removed() > 0}>
          <View testID="tool-diff-summary" class="flex-row items-baseline gap-1">
            <Text style={{ ...CONTENT, color: token("up") }}>{`+${added()}`}</Text>
            <Text style={{ ...CONTENT, color: token("destructive") }}>{`−${removed()}`}</Text>
          </View>
        </If>
      </View>
      <If when={diffs().length > 0}>
        <View testID="tool-diff" style={{ maxHeight: 360 }}>
          <Scroll style={{ maxHeight: 348 }}>
            <View style={{ gap: 1 }}>
              {diffLines(diffs()).map((row) => (
                <Text style={{ ...CONTENT, color: row.tint, userSelect: "text" }}>{row.text}</Text>
              ))}
            </View>
          </Scroll>
        </View>
      </If>
      <If when={output().length > 0}>
        <Text testID="tool-output" class="text-muted-foreground" style={{ ...CONTENT, userSelect: "text" }}>
          {output()}
        </Text>
      </If>
    </View>
  );
}

function SearchBody(props: { entry: () => ToolEntry; open: () => boolean }) {
  const output = () => props.entry().output ?? "";
  return (
    <View testID="tool-body" style={{ gap: 4 }}>
      <Text testID="tool-params" class="text-foreground" style={CONTENT}>
        {inputLine(props.entry())}
      </Text>
      <If when={output().length > 0}>
        <View testID="tool-full-output" style={{ maxHeight: 360 }}>
          <Scroll style={{ maxHeight: 348 }}>
            <Text class="text-muted-foreground" style={{ ...CONTENT, userSelect: "text" }}>
              {output()}
            </Text>
          </Scroll>
        </View>
      </If>
    </View>
  );
}

function OtherBody(props: { entry: () => ToolEntry; open: () => boolean }) {
  const input = () => {
    const raw = props.entry().rawInput;
    return raw !== undefined ? JSON.stringify(raw, null, 2) : "";
  };
  const output = () => props.entry().output ?? "";
  return (
    <View testID="tool-body" style={{ gap: 4 }}>
      <If when={!!input()}>
        <Text testID="tool-params" class="text-foreground" style={{ ...CONTENT, userSelect: "text" }}>
          {input()}
        </Text>
      </If>
      <If when={output().length > 0}>
        <View testID="tool-full-output" style={{ maxHeight: 360 }}>
          <Scroll style={{ maxHeight: 348 }}>
            <Text class="text-muted-foreground" style={{ ...CONTENT, userSelect: "text" }}>
              {output()}
            </Text>
          </Scroll>
        </View>
      </If>
    </View>
  );
}

/** pi truncated this output: name the fact, offer the full file. */
function TruncatedNote(props: { entry: () => ToolEntry }) {
  const stats = () => props.entry().meta;
  return (
    <If when={!!stats()?.truncated}>
      <View class="flex-row items-center gap-2">
        <If when={!!stats()?.totalLines}>
          <Text testID="tool-total-lines" class="text-faint" style={META}>
            {t(K.tool.fullOutput, { count: stats()!.totalLines! })}
          </Text>
        </If>
        <If when={!!stats()?.fullOutputPath}>
          <GhostButton
            testID="tool-open-full"
            glyph="file"
            label={t(K.tool.openFullOutput)}
            onPress={() => openInEditor(stats()!.fullOutputPath!)}
          />
        </If>
      </View>
    </If>
  );
}

// --- copy/open ---------------------------------------------------------------

/** One context-appropriate copy action: diff, else output, else command/input. */
function copyAction(entry: ToolEntry): { testID: string; label: string; text: string } | null {
  const output = entry.output ?? "";
  const diffs = entry.diffs ?? [];
  if (diffs.length > 0) {
    return {
      testID: "tool-copy-diff",
      label: t(K.tool.copyDiff),
      text: diffLines(diffs)
        .map((row) => row.text)
        .join("\n"),
    };
  }
  if (output) return { testID: "tool-copy-output", label: t(K.tool.copyOutput), text: output };
  const command = commandOf(entry);
  if (entry.toolKind === "execute" && command) {
    return { testID: "tool-copy-command", label: t(K.tool.copyCommand), text: command };
  }
  if (entry.rawInput !== undefined) {
    return {
      testID: "tool-copy-input",
      label: t(K.tool.copyInput),
      text: JSON.stringify(entry.rawInput, null, 2),
    };
  }
  return null;
}

function GhostButton(props: { testID: string; glyph: GlyphName; label: string; onPress: () => void }) {
  return (
    <View
      role="button"
      testID={props.testID}
      accessibilityLabel={props.label}
      tooltip={props.label}
      class="h-5 w-5 items-center justify-center rounded hover:bg-hover active:opacity-70 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
      style={{ ...motionStyle("fast") }}
      onPress={props.onPress}
    >
      <Glyph name={props.glyph} size={10} tint={token("muted-foreground")} />
    </View>
  );
}

// --- inputs and helpers ------------------------------------------------------

/** The tool's own name, falling back to its ACP kind. */
function nameOf(entry: ToolEntry): string {
  if (entry.name) return entry.name;
  switch (entry.toolKind) {
    case "execute":
      return "bash";
    case "read":
      return "read";
    case "edit":
      return "edit";
    case "search":
      return "grep";
    default:
      return entry.toolKind ?? "tool";
  }
}

function pathOf(entry: ToolEntry): string | undefined {
  const raw = entry.rawInput as { path?: unknown } | undefined;
  if (typeof raw?.path === "string" && raw.path) return raw.path;
  return entry.locations?.[0]?.path;
}

function commandOf(entry: ToolEntry): string {
  const raw = entry.rawInput as { command?: unknown } | undefined;
  return typeof raw?.command === "string" ? raw.command : "";
}

/** `read path:878-917`, `write path`, `edit path`, `grep pattern`, `bash $ cmd`. */
function inputLine(entry: ToolEntry): string {
  const name = nameOf(entry);
  const kind = entry.toolKind;
  if (kind === "execute") {
    const command = commandOf(entry);
    return command ? `$ ${command}` : entry.title;
  }
  if (kind === "read") {
    const path = pathOf(entry);
    if (!path) return entry.title;
    const raw = entry.rawInput as { line?: unknown; limit?: unknown } | undefined;
    const from = typeof raw?.line === "number" ? raw.line : undefined;
    const to = typeof raw?.limit === "number" && from !== undefined ? from + raw.limit - 1 : undefined;
    const range = from !== undefined ? `:${from}${to !== undefined ? `-${to}` : ""}` : "";
    return `${name} ${path}${range}`;
  }
  if (kind === "edit" || kind === "write") {
    const path = pathOf(entry);
    return path ? `${name} ${path}` : entry.title;
  }
  if (kind === "search") {
    const raw = entry.rawInput as { pattern?: unknown } | undefined;
    const pattern = typeof raw?.pattern === "string" ? raw.pattern : "";
    return pattern ? `${name} ${pattern}` : entry.title;
  }
  const json = entry.rawInput !== undefined ? JSON.stringify(entry.rawInput) : "";
  return json ? `${name} ${json}` : entry.title;
}

function firstLine(text: string): string {
  return (text.split("\n").find((line) => line.trim().length > 0) ?? "").trim();
}

/** The collapsed card's one line: the input's first line, not a title. */
function previewOf(entry: ToolEntry): string {
  return firstLine(inputLine(entry)) || entry.title;
}

function diffLines(diffs: DiffBlock[]): Array<{ text: string; tint: string }> {
  const rows: Array<{ text: string; tint: string }> = [];
  for (const diff of diffs) {
    for (const line of (diff.oldText ?? "").split("\n")) {
      if (line.length > 0) rows.push({ text: `-${line}`, tint: token("destructive") });
    }
    for (const line of diff.newText.split("\n")) {
      rows.push({ text: `+${line}`, tint: token("up") });
    }
  }
  return rows;
}

/** A card's spoken shape: the tool, its state and its exit. */
function toolLabel(entry: ToolEntry): string {
  const state =
    entry.status === "in_progress" || entry.status === "pending"
      ? t(K.tool.running)
      : entry.status === "failed"
        ? t(K.tool.failed)
        : t(K.tool.done);
  const exit = typeof entry.meta?.exitCode === "number" ? ` · exit ${entry.meta.exitCode}` : "";
  return `${entry.title} · ${state}${exit}`;
}

/** The editor sheet, through the files module's intent (modules stay apart). */
function openInEditor(path: string): void {
  const containerId = activeContainerId();
  if (!containerId || !path) return;
  dispatchIntent("editor.open", { containerId, path }, { containerId });
}
