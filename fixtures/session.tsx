import { mount } from "nsh";
import { messages } from "../sessions";
import { SessionBody } from "../sheets";

// A conversation with a fixed transcript: the sheet renders history, the
// tool line and the assistant's prose without an engine.
messages.set([
  { role: "user", text: "fold the extension channel" },
  { role: "tool", text: "read done" },
  { role: "assistant", text: "the projection keys rows by message id" },
]);

mount(SessionBody);
