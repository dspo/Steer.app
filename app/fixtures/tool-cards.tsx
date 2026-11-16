import { mount, Text, View } from "nsh";
import { seedSession } from "../modules/pi/sessions";
import { SessionBody } from "../modules/pi/view";
import { visiblePanels } from "../core/dock";
import { registerToolCard } from "../modules/pi/tool-cards";

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
    { role: "user", text: "plan the channel" },
    {
      role: "tool",
      text: "plan_preview",
      tool: { name: "plan_preview", state: "done", details: { title: "channel" } },
    },
    { role: "tool", text: "read done", tool: { name: "read", state: "done" } },
    { role: "assistant", text: "the registry keyed the first row, the second stays compact" },
  ],
  { path: "/tmp/zu-cards.jsonl", cwd: "/tmp/zu" },
);
visiblePanels.set(["session:cards"]);

mount(() => <SessionBody id="cards" sheetId="session:cards" />);
