import { mount, Text, View } from "nsh";
import { LifecycleHost } from "../lifecycle-ui";
import { hideMain, mainWindowVisible, showMain } from "../stores/notifications";

/**
 * The primary lifecycle on a desktop: the real `LifecycleHost` (tray,
 * close-press handler, application menu) plus buttons that call the same
 * show/hide functions its tray and menu items call, and a readout of the
 * window's visibility. Opening this fixture with `platform: "macos"`
 * exercises the real window model headless; a tray click itself has no
 * headless model, so it is not simulated.
 */
function Fixture() {
  return (
    <View class="flex-1 bg-background" style={{ padding: 20, gap: 8 }}>
      <LifecycleHost />
      <View
        role="button"
        testID="show-main"
        accessibilityLabel="show main"
        class="rounded-md border border-line px-3 py-2"
        onPress={showMain}
      >
        <Text>show main</Text>
      </View>
      <View
        role="button"
        testID="hide-main"
        accessibilityLabel="hide main"
        class="rounded-md border border-line px-3 py-2"
        onPress={hideMain}
      >
        <Text>hide main</Text>
      </View>
      <Text testID="visibility">{mainWindowVisible() ? "window visible" : "window hidden"}</Text>
    </View>
  );
}

mount(Fixture);
