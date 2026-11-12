import { mount, signal, Text, View } from "nsh";
import { enqueueUIRequest, pushToast, UIHost } from "../ui/ui-host";

// The extension UI host without an engine: presses ask for each kind of
// request and the answers render as rows, so a headless test can walk the
// whole dialog matrix.
const answers = signal<string[]>([]);

function ask(request: Parameters<typeof enqueueUIRequest>[0]): void {
  void enqueueUIRequest(request).then((answer) => {
    answers.set([...answers(), `answer: ${String(answer)}`]);
  });
}

function Fixture() {
  return (
    <View class="flex-1 bg-background" style={{ padding: 20, gap: 8 }}>
      <View
        role="button"
        testID="ask-select"
        accessibilityLabel="ask select"
        class="rounded-md border border-line px-3 py-2"
        onPress={() => ask({ id: "", method: "select", title: "Pick one", options: ["alpha", "beta"] })}
      >
        <Text>ask select</Text>
      </View>
      <View
        role="button"
        testID="ask-input"
        accessibilityLabel="ask input"
        class="rounded-md border border-line px-3 py-2"
        onPress={() => ask({ id: "", method: "input", title: "Your name", placeholder: "name" })}
      >
        <Text>ask input</Text>
      </View>
      <View
        role="button"
        testID="ask-editor"
        accessibilityLabel="ask editor"
        class="rounded-md border border-line px-3 py-2"
        onPress={() => ask({ id: "", method: "editor", title: "Notes", prefill: "line one" })}
      >
        <Text>ask editor</Text>
      </View>
      <View
        role="button"
        testID="ask-confirm"
        accessibilityLabel="ask confirm"
        class="rounded-md border border-line px-3 py-2"
        onPress={() => ask({ id: "", method: "confirm", title: "Allow it?", message: "A fixture asks." })}
      >
        <Text>ask confirm</Text>
      </View>
      <View
        role="button"
        testID="notify"
        accessibilityLabel="notify"
        class="rounded-md border border-line px-3 py-2"
        onPress={() => pushToast("probe toast", "info")}
      >
        <Text>notify toast</Text>
      </View>
      <Each of={answers()} key="index">
        {(answer) => <Text class="text-foreground">{answer()}</Text>}
      </Each>
      <UIHost />
    </View>
  );
}

mount(Fixture);
