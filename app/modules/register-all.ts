import { initializeModules, registerModule } from "../core/registry";
import { homeModule } from "./home/manifest";
import { browserModule } from "./browser/manifest";
import { terminalModule } from "./terminal/view";
import { piModule } from "./pi/view";
import { filesModule } from "./files/manifest";
import { gitModule } from "./git/manifest";
import { problemsModule } from "./problems/manifest";
import { registerManoxModule } from "./manox/manifest";

/**
 * The assembly point's list (docs/sheet-module-ARCHITECTURE.md §4.1): every
 * module the app ships, in registration order. `App.tsx` calls this; test
 * fixtures that mount `Workbench` directly call it too, because the shell
 * imports no module and a missing registration is an unknown-kind placeholder.
 */
export function registerAllModules(): void {
  registerModule(homeModule);
  registerModule(browserModule);
  registerModule(terminalModule);
  registerModule(piModule);
  registerModule(filesModule);
  registerModule(gitModule);
  registerModule(problemsModule);
  registerManoxModule();
}

/** The assembly point's single call: register every module, then initialize
 * them. `App.tsx` imports this and nothing else from a module. */
export function startModules(): void {
  registerAllModules();
  initializeModules();
}
