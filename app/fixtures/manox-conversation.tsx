import { mount, signal, Text, View } from "nsh";
import { setEnsureConnectionForTest } from "../modules/manox/ahp";
import { ManoxChatBody } from "../modules/manox/conversation";
import { chatResource, seedChatForTest, seedMetricsForTest } from "../modules/manox/stores";
import type { ChatState, Turn } from "../../contracts/ahp/channels-chat/state";
import type { XManoxState } from "../modules/manox/ext";

// A seeded manox conversation with no host: the handshake is a no-op, the
// chat cell is written straight into the channel map, and the sheet renders
// the fold exactly as a live one would. The append button grows the chat so
// the scroll-follow behavior is testable without a stream. The metrics cell
// carries the settled runs' timing rows: `r1` closed in 3s (the label says
// so), `r2` predates the anchor (the label stays durationless).

setEnsureConnectionForTest(async () => {});

const toolCall = (overrides: Record<string, unknown>) =>
  ({
    toolCallId: "tc-1",
    toolName: "bash",
    displayName: "Run tests",
    intention: "Run the suite",
    status: "completed",
    success: true,
    pastTenseMessage: "Ran the suite",
    ...overrides,
  }) as never;

const turn = (id: string, startedAt: string, text: string, parts: unknown[]): Turn =>
  ({
    id,
    startedAt,
    message: { text, origin: { kind: "user" } },
    responseParts: parts,
    usage: undefined,
    state: "complete",
  }) as never;

const rich: Turn[] = [
  turn("t1", "2026-11-15T10:00:00.000Z", "run the tests", [
    { kind: "reasoning", id: "r1", content: "The suite is the fastest signal; run it before reading anything." },
    {
      kind: "toolCall",
      toolCall: toolCall({
        content: [
          {
            type: "terminal",
            resource: "terminal:/1",
            title: "bun test",
            result: { exitCode: 0, preview: "52 pass, 0 fail" },
          },
        ],
      }),
    },
    { kind: "markdown", id: "m1", content: "## 结果\n\n**52** 个测试通过，0 失败。" },
  ]),
  turn("t2", "2026-11-16T09:30:00.000Z", "now edit the file", [
    { kind: "reasoning", id: "r2", content: "A patch is safer than a rewrite." },
    {
      kind: "toolCall",
      toolCall: toolCall({
        toolCallId: "tc-2",
        toolName: "edit",
        displayName: "Edit widgets.ts",
        intention: "Replace two blocks",
        status: "pending-confirmation",
        success: undefined,
        pastTenseMessage: undefined,
        content: undefined,
      }),
    },
    { kind: "error", error: { message: "the provider refused the second request" } },
    { kind: "markdown", id: "m2", content: "改完了。" },
  ]),
];

const filler: Turn[] = Array.from({ length: 40 }, (_, index) =>
  turn(`f${index}`, "2026-11-15T12:00:00.000Z", `filler-${index + 1}`, [
    { kind: "markdown", id: `fm${index}`, content: `filler reply ${index + 1}` },
  ]),
);

const chat = (turns: Turn[]): ChatState =>
  ({
    resource: chatResource("chat-1"),
    title: "manox",
    status: 0,
    modifiedAt: new Date().toISOString(),
    turns,
  }) as ChatState;

let appended = 0;
const state = signal<ChatState>(chat([...filler, ...rich]));
seedChatForTest("chat-1", state());

const metrics: XManoxState = {
  reasoningTimings: {
    r1: { partId: "r1", turnId: "t1", startedAt: "2026-11-15T10:00:00.000Z", durationMs: 3000 },
  },
};
seedMetricsForTest("chat-1", metrics);

const append = () => {
  appended += 1;
  state.set(
    chat([
      ...filler,
      ...rich,
      turn(`extra-${appended}`, "2026-11-16T13:00:00.000Z", `extra-${appended}`, [
        { kind: "markdown", id: `em-${appended}`, content: `extra reply ${appended}` },
      ]),
    ]),
  );
  seedChatForTest("chat-1", state());
};

mount(() => (
  <View class="flex-1 bg-background">
    <View
      role="button"
      testID="fixture-append"
      class="h-6 items-center justify-center bg-card"
      onPress={append}
    >
      <Text class="text-[10px] text-muted-foreground">append</Text>
    </View>
    <ManoxChatBody id="manox-chat:thread-1:chat-1" />
  </View>
));
