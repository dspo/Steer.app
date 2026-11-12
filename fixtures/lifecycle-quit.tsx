import { mount, signal, Text, View } from "nsh";
import { Menu } from "nsh/desktop";
import { Instance } from "zu/native";
import { quitApp } from "../shell/lifecycle";

/**
 * The application menu's Quit on a desktop, with the claim observable: the
 * fixture takes the single-instance claim the way the real bootstrap does,
 * and the Quit item calls the same `quitApp()` the app menu and tray use.
 * `Application.quit()` is a no-op headless, so the test checks the claim
 * was released and that the handler ran; the real process exit is native.
 */
const claim = Instance.claim();
const hits = signal(0);

Menu.setApplicationMenu([
  {
    label: "Zu",
    submenu: [
      {
        label: "Quit",
        shortcut: "mod+q",
        onSelect: () => {
          hits.set(hits() + 1);
          quitApp();
        },
      },
    ],
  },
]);

function Fixture() {
  return (
    <View class="flex-1 bg-background" style={{ padding: 20, gap: 8 }}>
      <Text testID="claim">{`claimed ${claim.acquired} already ${claim.already}`}</Text>
      <Text testID="hits">{`quit hits ${hits()}`}</Text>
    </View>
  );
}

mount(Fixture);
