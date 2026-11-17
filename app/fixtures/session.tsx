import { mount } from "nsh";
import { assistantEntry, toolEntry, userEntry } from "../modules/pi/transcript";
import { seedSession } from "../modules/pi/sessions";
import { SessionBody } from "../modules/pi/view";
import { visiblePanels } from "../core/dock";

// A conversation with a fixed transcript: the sheet renders history, the
// tool line and the assistant's prose without an engine.
seedSession("fixture", [
  userEntry("fx-user", "fold the extension channel"),
  toolEntry("fx-tool", "read src/foo.ts", "completed", { name: "read", toolKind: "read" }),
  assistantEntry("fx-assistant", "the projection keys rows by message id"),
]);
visiblePanels.set(["session:fixture"]);

mount(() => <SessionBody id="fixture" sheetId="session:fixture" />);
