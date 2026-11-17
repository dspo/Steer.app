import { mount, signal, Text, View } from "nsh";
import { EntryRow } from "../modules/pi/entry-row";
import { assistantEntry, toolEntry, userEntry, type Entry } from "../modules/pi/transcript";

// A List cell is recycled across entries: the same EntryRow instance must
// follow the kind, title and body of whatever its `entry` getter now names.
// The button steps through a tool, another tool, a user row and a reply.
const read = toolEntry("a", "read alpha", "completed", {
  name: "read",
  toolKind: "read",
  rawInput: { path: "alpha.ts" },
  output: "alpha content",
});
const edit = toolEntry("b", "edit beta", "completed", {
  name: "edit",
  toolKind: "edit",
  rawInput: { path: "beta.ts" },
  diffs: [{ path: "beta.ts", oldText: "old beta", newText: "new beta" }],
});
const steps: Entry[] = [read, edit, userEntry("c", "user gamma"), assistantEntry("d", "assistant delta")];
const current = signal<Entry>(read);
let index = 0;

mount(() => (
  <View style={{ flex: 1, padding: 20, gap: 10 }}>
    <View
      role="button"
      testID="swap"
      accessibilityLabel="swap"
      onPress={() => {
        index = (index + 1) % steps.length;
        current.set(steps[index]!);
      }}
    >
      <Text>swap</Text>
    </View>
    <EntryRow entry={() => current()} streaming={() => false} />
  </View>
));
