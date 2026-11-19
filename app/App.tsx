import { effect, mount, View } from "nsh";
import { Window } from "nsh/desktop";
import { Workbench } from "./shell/shell";
import { AlreadyRunning, LifecycleHost } from "./shell/lifecycle-ui";
import { lifecycleMode, startLifecycle } from "./shell/lifecycle";
import { AboutDialog } from "./shell/about-ui";
import { UpdatesDialog } from "./shell/updates-ui";
import { manoxVersion } from "./domains/manox";
import { ghosttyVersion } from "./domains/terminal";
import { followSystemLocale } from "./ui/i18n";
import { applyScrollbarTheme } from "./ui/ui";
import { TrustDialog } from "./ui/trust";
import { startModules } from "./modules/register-all";

/** The app: claim the state directory, boot the engine once, then render the workbench. */
let booted = false;

/** Draw our own title bar so the shell, not the system chrome, owns the top band. */
function configureWindow(): void {
  try {
    Window.get("main")?.set({
      // The lights keep their native proportion (12pt diameter, 8pt apart):
      // left edge 16, vertically centered in the 40pt bar (DESIGN §3).
      titleBar: { style: "hidden", height: 40, controlsOffset: { x: 16, y: 14 } },
    });
  } catch {
    // A platform or embedding app without a hidden title bar keeps the system's.
  }
}

function App() {
  if (!booted) {
    booted = true;
    // The assembly point: every sheet kind, Hero starter and intent comes from
    // a module registered here. The shell imports none of them.
    startModules();
    // The language follows the system's, read once before the first draw.
    followSystemLocale();
    // Claim the state directory (desktop only) and boot the engine unless
    // another live Zu owns it; the second instance renders a notice instead.
    startLifecycle();
  }
  effect(configureWindow);
  return (
    <View class="flex-1 bg-background">
      <If when={lifecycleMode() === "duplicate"}>
        <AlreadyRunning />
      </If>
      <If when={lifecycleMode() !== "duplicate"}>
        <Workbench />
      </If>
      {/* `session/new` can ask for project trust before any sheet exists. */}
      <TrustDialog />
      {/* The About and Updates dialogs answer the app menu; their open
          signals only fire in the primary instance, and About receives the
          manox and Ghostty versions here — the assembly point is where the
          domains are allowed to be read. */}
      <AboutDialog manoxVersion={manoxVersion()} ghosttyVersion={ghosttyVersion()} />
      <UpdatesDialog />
      {/* The tray and the notification listeners are a desktop app's; a
          headless run (the test runner) renders neither. */}
      <If when={lifecycleMode() === "primary"}>
        <LifecycleHost />
      </If>
    </View>
  );
}

applyScrollbarTheme();
mount(App);
