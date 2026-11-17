import { State } from "../domains/state";
import { createProject } from "../core/projects";
import { createExternalContainer } from "../modules/terminal/view";

// The real App boots first (the Hero), and the terminal container is minted
// a moment later — the exact dynamism of the Hero's Terminal action and of
// a relaunched dev app restoring its sheet. `zu/native` only through the
// domain re-exports (the layer gate).
State.setStateDir("/tmp/zu-late-sheet");
const project = await createProject("L", [{ path: "/tmp", primary: true }]);
setTimeout(() => {
  void createExternalContainer("shell", project?.id ?? null);
}, 1500);
await import("../App");
