import { effect, mount } from "nsh";
import { Window } from "nsh/desktop";
import { bootShell, Workbench } from "./shell";
import { applyScrollbarTheme } from "./ui";

/** The app: boot the engine once, then render the workbench. */
let booted = false;

/** Draw our own title bar so the shell, not the system chrome, owns the top band. */
function configureWindow(): void {
  try {
    Window.get("main")?.set({
      titleBar: { style: "hidden", height: 48, controlsOffset: { x: 18, y: 17 } },
    });
  } catch {
    // A platform or embedding app without a hidden title bar keeps the system's.
  }
}

function App() {
  if (!booted) {
    booted = true;
    void bootShell();
  }
  effect(configureWindow);
  return <Workbench />;
}

applyScrollbarTheme();
mount(App);
