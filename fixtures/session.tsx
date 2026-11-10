import { mount } from "nsh";
import { seedSession } from "../sessions";
import { SessionBody } from "../sheets";
import { visiblePanels } from "../dock";

// A conversation with a fixed transcript: the sheet renders history, the
// tool line and the assistant's prose without an engine.
seedSession("fixture", [
  { role: "user", text: "fold the extension channel" },
  { role: "tool", text: "read done" },
  { role: "assistant", text: "the projection keys rows by message id" },
]);
visiblePanels.set(["session:fixture"]);

mount(() => <SessionBody id="fixture" sheetId="session:fixture" />);
