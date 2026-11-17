import { mount } from "nsh";
import { assistantEntry, userEntry } from "../modules/pi/transcript";
import { seedSession } from "../modules/pi/sessions";
import { SessionBody } from "../modules/pi/view";
import { visiblePanels } from "../core/dock";

// A settled conversation: the composer is back to its one accent send.
seedSession(
  "idle",
  [
    userEntry("fx-user", "trace the composer"),
    assistantEntry("fx-assistant", "The footer carries the model and the context gauge."),
  ],
  {
    path: "/tmp/zu-idle.jsonl",
    cwd: "/tmp/zu",
    model: { provider: "bailian", id: "qwen3.8-flash", name: "Qwen3.8 Flash", contextWindow: 1_000_000, reasoning: true },
    thinkingLevel: "high",
    contextUsage: { tokens: 12300, contextWindow: 1_000_000, percent: 1 },
  },
);
visiblePanels.set(["session:idle"]);

mount(() => <SessionBody id="idle" sheetId="session:idle" />);
