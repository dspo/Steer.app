import { mount } from "nsh";
import { seedSession } from "../modules/pi/sessions";
import { SessionBody } from "../modules/pi/view";
import { visiblePanels } from "../core/dock";
import { toolEntry } from "../modules/pi/transcript";

// A write tool has no diff: its expanded body must still show the tool
// name + path as the input and the result sentence as the output.
seedSession(
  "write",
  [
    toolEntry("w1", "write /tmp/demo.rs", "completed", {
      name: "write",
      toolKind: "edit",
      rawInput: { path: "/tmp/demo.rs", content: "fn main() {}\n" },
      output: "Successfully wrote to /tmp/demo.rs",
      locations: [{ path: "/tmp/demo.rs" }],
    }),
  ],
  { path: "/tmp/zu-write.jsonl", cwd: "/tmp/zu" },
);
visiblePanels.set(["session:write"]);

mount(() => <SessionBody id="write" sheetId="session:write" />);
