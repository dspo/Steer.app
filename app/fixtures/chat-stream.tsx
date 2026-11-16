import { mount } from "nsh";
import { seedSession } from "../modules/pi/sessions";
import { SessionBody } from "../modules/pi/view";
import { visiblePanels } from "../core/dock";
import { SESSION_MODES, THOUGHT_LEVEL } from "./chat-controls-data";

// A turn in flight: the assistant's Markdown is streaming and the composer's
// action is the stop, with the model, the mode and the context gauge from
// `session.info` (seeded here; no engine).
seedSession(
  "stream",
  [
    { role: "user", text: "trace the composer" },
    {
      role: "assistant",
      text: "## Composer\n\nThe footer carries `model` and context. It stays one line.",
    },
  ],
  {
    path: "/tmp/zu-stream.jsonl",
    cwd: "/tmp/zu",
    streaming: true,
    model: { provider: "bailian", id: "qwen3.8-flash", name: "Qwen3.8 Flash", contextWindow: 1_000_000, reasoning: true },
    thinkingLevel: "high",
    contextUsage: { tokens: 12300, contextWindow: 1_000_000, percent: 1 },
    modes: SESSION_MODES,
    mode: "auto",
    configOptions: [THOUGHT_LEVEL],
  },
);
visiblePanels.set(["session:stream"]);

mount(() => <SessionBody id="stream" sheetId="session:stream" />);
