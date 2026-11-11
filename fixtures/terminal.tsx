import { mount, signal, Text, View, token } from "nsh";
import type { ContainerRecord } from "../contracts/protocol";
import { activeContainerId, containers } from "../containers";
import { visiblePanels } from "../dock";
import { TerminalBody } from "../sheets";
import { closeTerminal, terminalInfo, terminalRef, terminalSheetId, terminalSize } from "../terminals";
import { Glyph } from "../ui";

// A headless acceptance fixture for the real terminal sheet: one external
// container, its PTY store and `nsh/base`'s Terminal. The status lines read
// the emulator's own screen (`TerminalRef.text()`) and the PTY's size, so a
// test asserts what reached the view rather than copying output by hand.

const CONTAINER = "external:terminal:fixture";
const container: ContainerRecord = {
  id: CONTAINER,
  kind: "Terminal",
  cwd: "/tmp",
  archived: false,
  createdAt: 0,
  updatedAt: 0,
  sessions: [],
};

containers.set([container]);
activeContainerId.set(CONTAINER);
const SHEET = terminalSheetId(CONTAINER, 1);
visiblePanels.set([SHEET]);

const screen = signal("");
const size = signal("");
const closed = signal(false);

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
    void ref.text().then((text) => screen.set(visibleLines(text)));
  }, 120);

  return (
    <View class="flex-1 bg-background">
      <View class="flex-row items-center gap-2 border-b border-line bg-inset px-3 py-1.5">
        <Glyph name="terminal" size={11} tint={token("muted-foreground")} />
        <Text testID="terminal-size" class="text-[11px] font-mono text-faint">{size()}</Text>
        <Text testID="terminal-state" class="text-[11px] text-faint">
          {terminalInfo()[SHEET]?.running ? "running" : "stopped"}
        </Text>
        <Text testID="terminal-title" class="text-[11px] text-faint">
          {terminalInfo()[SHEET]?.title ?? ""}
        </Text>
        <View style={{ flex: 1 }} />
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
    </View>
  );
}

mount(TerminalFixture);
