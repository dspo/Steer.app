import { mount, signal, Text, View } from "nsh";
import { AskCard } from "../modules/pi/ask";
import { pendingAsks } from "../modules/pi/sessions";

// The ask_user_question card (A1): a fixture store with two scenario
// buttons — a single-question card and a two-question multiSelect card.
// The submitted dump line carries whatever the live resolve received, so
// the test asserts the wire payload through the screen.

const SINGLE = [
  {
    question: "Which database should we use?",
    header: "Database",
    multiSelect: false,
    options: [
      { label: "Postgres", description: "Boring and proven", recommendedReason: "Team knows it" },
      { label: "SQLite", description: "Zero ops" },
    ],
  },
];

const MULTI = [
  SINGLE[0],
  {
    question: "Run the tests too?",
    header: "Tests",
    multiSelect: true,
    options: [
      { label: "unit", description: "the fast suite" },
      { label: "e2e", description: "the slow suite" },
    ],
  },
];

const submitted = signal<string>("");

function seed(toolCallId: string, questions: unknown): void {
  pendingAsks.set({
    [`fx-ask:${toolCallId}`]: {
      sessionId: "fx-ask",
      toolCallId,
      args: { questions },
      resolve: (response: unknown) => submitted.set(JSON.stringify(response)),
    },
  });
}

seed("tc-single", SINGLE);

function load(toolCallId: string, questions: unknown): () => void {
  return () => {
    submitted.set("");
    pendingAsks.set({});
    seed(toolCallId, questions);
  };
}

mount(() => (
  <View style={{ flex: 1, padding: 20, gap: 10 }}>
    <View style={{ gap: 6 }}>
      <View role="button" testID="load-single" accessibilityLabel="load-single" onPress={load("tc-single", SINGLE)}>
        <Text class="text-[12px] text-foreground">single</Text>
      </View>
      <View role="button" testID="load-multi" accessibilityLabel="load-multi" onPress={load("tc-multi", MULTI)}>
        <Text class="text-[12px] text-foreground">multi</Text>
      </View>
    </View>
    <AskCard sessionId="fx-ask" />
    <If when={submitted().length > 0}>
      <Text testID="ask-submitted" class="text-[12px] text-secondary">
        {submitted()}
      </Text>
    </If>
  </View>
));
