import { mount } from "nsh";
import { seedSession } from "../stores/sessions";
import { SessionBody } from "../canvas/sheets";
import { visiblePanels } from "../stores/dock";
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
