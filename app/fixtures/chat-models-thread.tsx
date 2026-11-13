import { mount } from "nsh";
import { seedSession } from "../modules/pi/sessions";
import { SessionBody } from "../modules/pi/view";
import { visiblePanels } from "../core/dock";
import { installModelTransport, MODEL_SEED } from "./chat-models-data";

// The same model picker in an existing conversation's composer.

installModelTransport();
seedSession(
  "models-thread",
  [
    { role: "user", text: "which model is this?" },
    { role: "assistant", text: "The footer names it; the picker changes it." },
  ],
  { ...MODEL_SEED, path: "/tmp/zu-models-thread.jsonl", name: "Models thread" },
);
visiblePanels.set(["session:models-thread"]);

mount(() => <SessionBody id="models-thread" sheetId="session:models-thread" />);
