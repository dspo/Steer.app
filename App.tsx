import { effect, mount, View } from "nsh";
import { Window } from "nsh/desktop";
import { Workbench } from "./shell";
import { AlreadyRunning, LifecycleHost } from "./lifecycle-ui";
import { lifecycleMode, startLifecycle } from "./lifecycle";
import { followSystemLocale } from "./i18n";
import { applyScrollbarTheme } from "./ui";

/** The app: claim the state directory, boot the engine once, then render the workbench. */
let booted = false;

/** Draw our own title bar so the shell, not the system chrome, owns the top band. */
function configureWindow(): void {
  try {
    Window.get("main")?.set({
      titleBar: { style: "hidden", height: 40, controlsOffset: { x: 18, y: 13 } },
    });
  } catch {
    // A platform or embedding app without a hidden title bar keeps the system's.
  }
}

function App() {
  if (!booted) {
    booted = true;
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
