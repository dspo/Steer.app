import { mount } from "nsh";
import { seedSession } from "../modules/pi/sessions";
import { SessionBody } from "../modules/pi/view";
import { visiblePanels } from "../core/dock";
import { SESSION_MODES, THOUGHT_LEVEL } from "./chat-controls-data";

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
    modes: SESSION_MODES,
    mode: "auto",
    configOptions: [THOUGHT_LEVEL],
  },
);
visiblePanels.set(["session:hero"]);

mount(() => <SessionBody id="hero" sheetId="session:hero" />);
