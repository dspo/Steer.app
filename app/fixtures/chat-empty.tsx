import { mount } from "nsh";
import { seedSession } from "../modules/pi/sessions";
import { SessionBody } from "../modules/pi/view";
import { visiblePanels } from "../core/dock";

// An empty session with a model and context window already known: the
// conversation column before its first message, without an engine.
seedSession(
  "empty",
  [],
  {
    path: "/tmp/zu-empty.jsonl",
    cwd: "/tmp/zu",
    model: { provider: "bailian", id: "qwen3.8-flash", name: "Qwen3.8 Flash", contextWindow: 1_000_000, reasoning: true },
    thinkingLevel: "high",
    contextUsage: { tokens: 12300, contextWindow: 1_000_000, percent: 1 },
  },
);
visiblePanels.set(["session:empty"]);

mount(() => <SessionBody id="empty" sheetId="session:empty" />);
