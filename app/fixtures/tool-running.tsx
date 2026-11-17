import { mount } from "nsh";
import { seedSession } from "../modules/pi/sessions";
import { SessionBody } from "../modules/pi/view";
import { visiblePanels } from "../core/dock";
import { toolEntry } from "../modules/pi/transcript";

// A running tool: the footer carries the Braille spinner, not a glowing dot.
seedSession(
  "running",
  [
    toolEntry("r1", "bash sleep 5", "in_progress", {
      name: "bash",
      toolKind: "execute",
      rawInput: { command: "sleep 5" },
    }),
  ],
  { path: "/tmp/zu-running.jsonl", cwd: "/tmp/zu" },
);
visiblePanels.set(["session:running"]);

mount(() => <SessionBody id="running" sheetId="session:running" />);
