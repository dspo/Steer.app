import { mount, signal, Text, View } from "nsh";
import type { NotificationPermission } from "nsh";
import { UpdatesDialog } from "../sheets/updates-ui";
import { openUpdates, setUpdateService, type UpdateEnv } from "../stores/updates";
import { setNotifier } from "../stores/notifications";

/**
 * The Updates dialog without `nsh/updater`: a fake service for a packaged
 * app with a newer release, and for a development build that has no
 * source. The notification permission row also gets a fake notifier, so
 * the press asks it and the row shows the answer.
 */

const DEV: UpdateEnv = {
  development: true,
  appVersion: "0.1.0",
  appBuild: 1,
  shellVersion: null,
  shellBuild: null,
  nshVersion: "0.4.0",
  configured: false,
};

const PACKAGED: UpdateEnv = {
  development: false,
  appVersion: "0.1.0",
  appBuild: 1,
  shellVersion: "0.1.0",
  shellBuild: 1,
  nshVersion: "0.4.0",
  configured: true,
};

let packaged = false;
let permission: NotificationPermission = "default";

setUpdateService({
  env: () => (packaged ? PACKAGED : DEV),
  check: async () => ({
    version: "0.2.0",
    notes: "notes for 0.2.0",
    url: "https://example.com/Zu-0.2.0-macos-aarch64.tar.gz",
    canInstall: true,
  }),
  download: async (onProgress) => {
    onProgress?.({ received: 512 * 1024, total: 1024 * 1024 });
  },
  install: async () => {
    // A real install ends the process; the fake just resolves so the test
    // can prove the shell does not claim a success it cannot see.
  },
});

setNotifier({
  permission: async () => permission,
  requestPermission: async () => {
    permission = "granted";
    return permission;
  },
  show: async () => true,
  close: async () => undefined,
});

const opened = signal("none");

function Fixture() {
  return (
    <View class="flex-1 bg-background" style={{ padding: 20, gap: 8 }}>
      <View
        role="button"
        testID="open-dev"
        accessibilityLabel="open dev"
        class="rounded-md border border-line px-3 py-2"
        onPress={() => {
          packaged = false;
          opened.set("dev");
          openUpdates();
        }}
      >
        <Text>open dev</Text>
      </View>
      <View
        role="button"
        testID="open-packaged"
        accessibilityLabel="open packaged"
        class="rounded-md border border-line px-3 py-2"
        onPress={() => {
          packaged = true;
          opened.set("packaged");
          openUpdates();
        }}
      >
        <Text>open packaged</Text>
      </View>
      <View
        role="button"
        testID="open-release-behind"
        accessibilityLabel="open release behind"
        class="rounded-md border border-line px-3 py-2"
        onPress={() => {
          packaged = true;
          permission = "default";
          openUpdates();
        }}
      >
        <Text>open release behind</Text>
      </View>
      <Text testID="opened">{opened()}</Text>
      <UpdatesDialog />
    </View>
  );
}

mount(Fixture);
