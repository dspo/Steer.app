import { mount, signal, Text, View } from "nsh";
import { EntryRow } from "../modules/pi/entry-row";
import { assistantEntry, toolEntry, userEntry, type Entry } from "../modules/pi/transcript";

// A List cell is recycled across entries: the same EntryRow instance must
// follow the kind, title and body of whatever its `entry` getter now names.
// The button steps through a tool, another tool, a user row, a reply, and
// two replies with folded thinking (multi-line, then a single long line).
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
const thinkMulti: Entry = {
  kind: "assistant",
  id: "e",
  text: "",
  thoughts: "first line alpha\nsecond line beta",
};
const thinkSingle: Entry = {
  kind: "assistant",
  id: "f",
  text: "",
  thoughts:
    "one long single line gamma that keeps going so its folded preview must ellipsize at the row's width instead of running past it",
};
const steps: Entry[] = [
  read,
  edit,
  userEntry("c", "user gamma"),
  assistantEntry("d", "assistant delta"),
  thinkMulti,
  thinkSingle,
];
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
