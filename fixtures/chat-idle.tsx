import { mount } from "nsh";
import { seedSession } from "../sessions";
import { SessionBody } from "../sheets";
import { visiblePanels } from "../dock";

// A settled conversation: the composer is back to its one accent send.
seedSession(
  "idle",
  [
    { role: "user", text: "trace the composer" },
    { role: "assistant", text: "The footer carries the model and the context gauge." },
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
