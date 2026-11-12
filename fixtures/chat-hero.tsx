import { mount } from "nsh";
import { seedSession } from "../stores/sessions";
import { SessionBody } from "../sheets";
import { visiblePanels } from "../stores/dock";

// An empty session with a model and context window already known: the start
// page's hero and its inline composer, without an engine.
seedSession(
  "hero",
  [],
  {
    path: "/tmp/zu-hero.jsonl",
    cwd: "/tmp/zu",
    model: { provider: "bailian", id: "qwen3.8-flash", name: "Qwen3.8 Flash", contextWindow: 1_000_000, reasoning: true },
    thinkingLevel: "high",
    contextUsage: { tokens: 12300, contextWindow: 1_000_000, percent: 1 },
  },
);
visiblePanels.set(["session:hero"]);

mount(() => <SessionBody id="hero" sheetId="session:hero" />);
