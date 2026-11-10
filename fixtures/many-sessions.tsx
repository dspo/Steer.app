import { mount } from "nsh";
import { Workbench } from "../shell";
import { phase } from "../engine";
import { sessions } from "../sessions";
import { activeContainerId } from "../containers";

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
phase.set("connected");
mount(Workbench);
