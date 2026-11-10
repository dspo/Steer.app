import { mount } from "nsh";
import { bootShell, Workbench } from "./shell";

/** The app: boot the engine once, then render the workbench. */
let booted = false;

function App() {
  if (!booted) {
    booted = true;
    void bootShell();
  }
  return <Workbench />;
}

mount(App);
