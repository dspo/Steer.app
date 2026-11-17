import { mount, Text, View } from "nsh";
import { seedSession } from "../modules/pi/sessions";
import { SessionBody } from "../modules/pi/view";
import { visiblePanels } from "../core/dock";
import { registerToolCard } from "../modules/pi/tool-cards";
import { assistantEntry, toolEntry, userEntry } from "../modules/pi/transcript";

// One fixture card: reads the details it was handed and nothing more.
// `plan_preview` stands in for the future ask/plan/visualize cards, which
// register themselves the same way.
registerToolCard("plan_preview", (props) => {
  const title = (props.details as { title?: string } | undefined)?.title ?? "";
  return (
    <View testID="fixture-card" class="rounded-md border border-line px-2 py-1">
      <Text class="text-[11px] text-foreground">{`plan: ${title} (${props.state})`}</Text>
    </View>
  );
});

// A settled transcript with one carded tool result and one plain one.
seedSession(
  "cards",
  [
    userEntry("u1", "plan the channel"),
    toolEntry("t1", "plan_preview", "completed", {
      name: "plan_preview",
      toolKind: "other",
      meta: { details: { title: "channel" } },
    }),
    toolEntry("t2", "read done", "completed", { name: "read", toolKind: "read" }),
    assistantEntry("a1", "the registry keyed the first row, the second stays compact"),
  ],
  { path: "/tmp/zu-cards.jsonl", cwd: "/tmp/zu" },
);
visiblePanels.set(["session:cards"]);

mount(() => <SessionBody id="cards" sheetId="session:cards" />);
