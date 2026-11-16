import { mount } from "nsh";
import { seedSession, setModelTransport, setSessionTransport } from "../modules/pi/sessions";
import { SessionBody } from "../modules/pi/view";
import { visiblePanels } from "../core/dock";
import { SESSION_MODES, THOUGHT_LEVEL } from "./chat-controls-data";

// The mode switch's and the effort picker's fake engine: `session.setMode`
// and `session.setThinking` answer with the `session.info` shape a real
// session folds back, so picking a mode (or a level) moves the triggers.

setModelTransport(async (type) => {
  if (type === "session.models") return { providers: [], thinkingLevel: "high" };
  throw new Error(`modes fixture transport: ${type}`);
});

setSessionTransport(async (type, payload: any = {}) => {
  switch (type) {
    case "session.setMode":
      return { mode: String(payload.mode ?? "ask") };
    case "session.setThinking":
      return { thinkingLevel: String(payload.level ?? "high") };
    default:
      throw new Error(`modes fixture transport: ${type}`);
  }
});

seedSession(
  "modes-controls",
  [
    { role: "user", text: "who decides what tools may run?" },
    { role: "assistant", text: "The distro's permission mode; the composer's switch changes it." },
  ],
  {
    path: "/tmp/zu-modes.jsonl",
    cwd: "/tmp/zu",
    model: { provider: "bailian", id: "qwen3.8-flash", name: "Qwen3.8 Flash", contextWindow: 1_000_000, reasoning: true },
    thinkingLevel: "high",
    modes: SESSION_MODES,
    mode: "auto",
    configOptions: [THOUGHT_LEVEL],
  },
);
visiblePanels.set(["session:modes-controls"]);

mount(() => <SessionBody id="modes-controls" sheetId="session:modes-controls" />);
