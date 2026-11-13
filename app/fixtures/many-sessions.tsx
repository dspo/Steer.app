import { mount } from "nsh";
import { Workbench } from "../shell/shell";
import { sessions } from "../modules/pi/sessions";
import { activeContainerId } from "../core/containers";
import { registerAllModules } from "../modules/register-all";

registerAllModules();

// 700 sessions, no containers: the sidebar's virtualized list must keep the
// rendered row set small while scrolling to the end.
const rows = Array.from({ length: 700 }, (_, index) => ({
  id: `s${index}`,
  path: `/tmp/session-${index}.jsonl`,
  cwd: "/tmp",
  name: `Session ${index}`,
  created: index,
  modified: index,
  messageCount: index % 7,
  preview: `preview ${index}`,
}));
sessions.set(rows);
activeContainerId.set(null);
mount(Workbench);
