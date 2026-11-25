import { mount, View } from "nsh";
import { assistantEntry, userEntry } from "../modules/pi/transcript";
import { seedSession } from "../modules/pi/sessions";
import { SessionBody } from "../modules/pi/view";
import { ModelMenuLayer } from "../modules/pi/model-menu";
import { visiblePanels } from "../core/dock";
import { installModelTransport, MODEL_SEED } from "./chat-models-data";

// The same model picker in an existing conversation's composer.

installModelTransport();
seedSession(
  "models-thread",
  [
    userEntry("fx-user", "which model is this?"),
    assistantEntry("fx-assistant", "The footer names it; the picker changes it."),
  ],
  { ...MODEL_SEED, path: "/tmp/zu-models-thread.jsonl", name: "Models thread" },
);
visiblePanels.set(["session:models-thread"]);

mount(() => (
  <View style={{ flex: 1 }}>
    <SessionBody id="models-thread" sheetId="session:models-thread" />
    <ModelMenuLayer />
  </View>
));
