import { mount } from "nsh";
import { assistantEntry, userEntry } from "../modules/pi/transcript";
import { seedSession } from "../modules/pi/sessions";
import { SessionBody } from "../modules/pi/view";
import { visiblePanels } from "../core/dock";

// A turn in flight: the assistant's Markdown is streaming and the composer
// shows the stop/queue/steer/interrupt lane, with the model and context gauge
// from `session.info` (seeded here; no engine).
seedSession(
  "stream",
  [
    userEntry("fx-user", "trace the composer"),
    assistantEntry("fx-assistant", "## Composer\n\nThe footer carries `model` and context. It stays one line."),
  ],
  {
    path: "/tmp/zu-stream.jsonl",
    cwd: "/tmp/zu",
    streaming: true,
    model: { provider: "bailian", id: "qwen3.8-flash", name: "Qwen3.8 Flash", contextWindow: 1_000_000, reasoning: true },
    thinkingLevel: "high",
    contextUsage: { tokens: 12300, contextWindow: 1_000_000, percent: 1 },
  },
);
visiblePanels.set(["session:stream"]);

mount(() => <SessionBody id="stream" sheetId="session:stream" />);
