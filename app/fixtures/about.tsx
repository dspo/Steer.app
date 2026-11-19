import { mount, signal, Text, View } from "nsh";
import { AboutDialog } from "../shell/about-ui";
import { aboutOpen, openAbout } from "../shell/about";
import { setUpdateService, type UpdateEnv } from "../shell/updates";

/**
 * The About dialog without the platform: a fake update service stands in
 * for the packaged app's env, so the version axis can be asserted headless.
 * The manox and Ghostty versions arrive the way `App.tsx` passes them —
 * props — and a bare variant passes `null` for both, so the tests can see
 * a row left out. The OS row is whatever machine runs the test, so the
 * tests only check that it is there.
 */

const PACKAGED: UpdateEnv = {
  development: false,
  appVersion: "0.1.0",
  appBuild: 1,
  shellVersion: "0.1.0",
  shellBuild: 1,
  nshVersion: "0.5.0",
  configured: true,
};

const DEV: UpdateEnv = {
  development: true,
  appVersion: "0.1.0",
  appBuild: 1,
  shellVersion: null,
  shellBuild: null,
  nshVersion: "",
  configured: false,
};

let packaged = true;

setUpdateService({
  env: () => (packaged ? PACKAGED : DEV),
  check: async () => null,
  download: async () => undefined,
  install: async () => undefined,
});

const opened = signal("none");
const native = signal<{ manox: string | null; ghostty: string | null }>({
  manox: "v0.12.1",
  ghostty: "042b16b6",
});

function Fixture() {
  return (
    <View class="flex-1 bg-background" style={{ padding: 20, gap: 8 }}>
      <View
        role="button"
        testID="open-about"
        accessibilityLabel="open about"
        class="rounded-md border border-line px-3 py-2"
        onPress={() => {
          packaged = true;
          native.set({ manox: "v0.12.1", ghostty: "042b16b6" });
          opened.set("packaged");
          openAbout();
        }}
      >
        <Text>open about</Text>
      </View>
      <View
        role="button"
        testID="open-about-dev"
        accessibilityLabel="open about dev"
        class="rounded-md border border-line px-3 py-2"
        onPress={() => {
          packaged = false;
          opened.set("dev");
          openAbout();
        }}
      >
        <Text>open about dev</Text>
      </View>
      <View
        role="button"
        testID="open-about-bare"
        accessibilityLabel="open about bare"
        class="rounded-md border border-line px-3 py-2"
        onPress={() => {
          packaged = true;
          native.set({ manox: null, ghostty: null });
          opened.set("bare");
          openAbout();
        }}
      >
        <Text>open about bare</Text>
      </View>
      <Text testID="opened">{opened()}</Text>
      <Text testID="about-open-state">{String(aboutOpen())}</Text>
      <AboutDialog manoxVersion={native().manox} ghosttyVersion={native().ghostty} />
    </View>
  );
}

mount(Fixture);
