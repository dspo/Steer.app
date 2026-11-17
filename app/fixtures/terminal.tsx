import { Clipboard, mount, signal, Text, View, token } from "nsh";
import type { ContainerRecord } from "../core/types";
import { activeContainerId, containers } from "../core/containers";
import { visiblePanels } from "../core/dock";
import { TerminalBody } from "../modules/terminal/view";
import { closeTerminal, terminalInfo, terminalRef, terminalSheetId, terminalSize } from "../domains/pty";
import { Glyph } from "../ui/ui";

// A headless acceptance fixture for the real terminal sheet: one external
// container, its PTY store and the Spike terminal component. The status lines
// read the emulator's viewport (`TerminalRef.viewportText()`) and the PTY's
// size, so a test asserts what reached the view rather than copying output by
// hand.

const CONTAINER = "external:terminal:fixture";
const container: ContainerRecord = {
  id: CONTAINER,
  cwd: "/tmp",
  archived: false,
  createdAt: 0,
  updatedAt: 0,
};

containers.set([container]);
activeContainerId.set(CONTAINER);
const SHEET = terminalSheetId(CONTAINER, 1);
visiblePanels.set([SHEET]);

const screen = signal("");
const selection = signal("");
const clipboard = signal("");
const size = signal("");
const closed = signal(false);
const font = signal("");

function visibleLines(text: string): string {
  const lines = text
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .filter((line) => line.length > 0);
  return lines.slice(-40).join("\n");
}

export function TerminalFixture() {
  setInterval(() => {
    size.set(terminalSize(SHEET)?.join("x") ?? "none");
    const ref = terminalRef(SHEET);
    if (!ref) return;
    const read = ref.viewportText ? ref.viewportText : ref.text;
    void read().then((text) => screen.set(visibleLines(text)));
    void ref.selectedText?.().then((text) => {
      if (text) selection.set(text);
    });
    void ref.font?.().then((family) => font.set(family));
    void Clipboard.readText().then((text) => clipboard.set(text ?? ""));
  }, 120);

  return (
    <View class="flex-1 bg-background">
      <View class="flex-row items-center gap-2 border-b border-line bg-inset px-3 py-1.5">
        <Glyph name="terminal" size={11} tint={token("muted-foreground")} />
        <Text testID="terminal-size" class="text-[11px] font-mono text-faint">{size()}</Text>
        <Text testID="terminal-font" class="text-[11px] text-faint">{font() ? `font:${font()}` : ""}</Text>
        <Text testID="terminal-state" class="text-[11px] text-faint">
          {terminalInfo()[SHEET]?.running ? "running" : "stopped"}
        </Text>
        <Text testID="terminal-title" class="text-[11px] text-faint">
          {terminalInfo()[SHEET]?.title ?? ""}
        </Text>
        <View style={{ flex: 1 }} />
        <View
          role="button"
          testID="fixture-scroll-up"
          accessibilityLabel="Scroll up"
          class="rounded-md border border-line px-2 py-1 hover:bg-hover"
          onPress={() => {
            void terminalRef(SHEET)?.scrollBy?.(-1000);
          }}
        >
          <Text class="text-[11px] text-foreground">Up</Text>
        </View>
        <View
          role="button"
          testID="fixture-scroll-bottom"
          accessibilityLabel="Scroll to the end"
          class="rounded-md border border-line px-2 py-1 hover:bg-hover"
          onPress={() => {
            void terminalRef(SHEET)?.scrollToBottom?.();
          }}
        >
          <Text class="text-[11px] text-foreground">Bottom</Text>
        </View>
        <View
          role="button"
          testID="fixture-select-all"
          accessibilityLabel="Select all"
          class="rounded-md border border-line px-2 py-1 hover:bg-hover"
          onPress={() => {
            // As Cmd+A in the terminal: the selection and the keyboard are
            // the terminal's, so Cmd+C copies it rather than the button's.
            terminalRef(SHEET)?.selectAll?.();
            terminalRef(SHEET)?.focus();
          }}
        >
          <Text class="text-[11px] text-foreground">Select</Text>
        </View>
        <View
          role="button"
          testID="fixture-close"
          accessibilityLabel="Close PTY"
          class="rounded-md border border-line px-2 py-1 hover:bg-hover active:opacity-70"
          onPress={() => {
            closeTerminal(SHEET);
            closed.set(true);
          }}
        >
          <Text class="text-[11px] text-foreground">Close PTY</Text>
        </View>
      </View>
      <TerminalBody id={SHEET} />
      <Text testID="fixture-closed" class="text-[11px] text-faint">{closed() ? "closed" : ""}</Text>
      <Text testID="terminal-screen" class="text-[10px] font-mono text-foreground" style={{ height: 120 }}>
        {screen()}
      </Text>
      <Text testID="fixture-selection" class="text-[10px] font-mono text-faint" style={{ height: 60 }}>
        {selection()}
      </Text>
      <Text testID="fixture-clipboard" class="text-[10px] font-mono text-faint" style={{ height: 40 }}>
        {clipboard() ? `CLIP:${clipboard()}` : ""}
      </Text>
    </View>
  );
}

mount(TerminalFixture);
