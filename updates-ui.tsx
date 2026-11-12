import { effect, Scroll, Text, token, View } from "nsh";
import { Dialog, Progress } from "nsh/base";
import { K, t } from "./ui/i18n";
import { motionStyle, shadowDialog, shadowRaised } from "./ui/ui";
import {
  availableUpdate,
  checkNow,
  closeUpdates,
  downloadNow,
  formatBytes,
  installNow,
  updateAvailability,
  updateEnv,
  updateError,
  updateProgress,
  updateStatus,
  updatesOpen,
} from "./stores/updates";
import {
  notificationPermission,
  notificationError,
  refreshNotificationPermission,
  requestNotificationPermission,
} from "./stores/notifications";

/**
 * The Updates dialog: the tray's "Check for Updates…" and the engine bar's
 * gear both open it.
 *
 * It says what this run is before it says anything about a release, so a
 * development build or an app packaged without an `"updater"` source is
 * never mistaken for "up to date": `nsh/updater` cannot check either. The
 * notification permission lives here too, next to the other app-level
 * state, and only asks the system from this explicit press.
 */

function Action(props: { label: string; onPress: () => void; primary?: boolean; testID?: string; disabled?: boolean }) {
  const disabled = () => props.disabled === true;
  return (
    <View
      role="button"
      testID={props.testID}
      accessibilityLabel={props.label}
      disabled={disabled()}
      class={
        disabled()
          ? "h-8 items-center justify-center rounded-lg border border-line px-3 opacity-40"
          : props.primary
            ? "h-8 items-center justify-center rounded-lg bg-primary px-3 hover:bg-primary/90 active:opacity-80 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
            : "h-8 items-center justify-center rounded-lg border border-line px-3 hover:bg-hover active:opacity-80 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
      }
      style={{ ...motionStyle("fast") }}
      onPress={() => {
        if (!disabled()) props.onPress();
      }}
    >
      <Text
        class={
          disabled()
            ? "text-[12px] font-medium text-faint"
            : props.primary
              ? "text-[12px] font-medium text-primary-foreground"
              : "text-[12px] font-medium text-foreground"
        }
      >
        {props.label}
      </Text>
    </View>
  );
}

function Row(props: { label: string; value: string; testID?: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
      <Text class="text-[11.5px] text-muted-foreground">{props.label}</Text>
      <Text testID={props.testID} class="text-[11.5px] text-foreground" style={{ flex: 1, numberOfLines: 2 }}>
        {props.value}
      </Text>
    </View>
  );
}

const PERMISSION_KEY: Record<string, string> = {
  unknown: K.notifications.permissionUnknown,
  default: K.notifications.permissionDefault,
  granted: K.notifications.permissionGranted,
  denied: K.notifications.permissionDenied,
  unavailable: K.notifications.permissionUnavailable,
};

/** The version this run is: the installed shell's, else the build's. */
export function versionLine(): string {
  const env = updateEnv();
  const version = env.shellVersion ?? env.appVersion ?? "";
  const build = env.shellBuild ?? env.appBuild;
  if (!version) return t(K.updates.versionUnknown);
  return build !== null && build !== undefined
    ? t(K.updates.version, { version, build })
    : t(K.updates.versionBare, { version });
}

function statusText(): string {
  switch (updateStatus()) {
    case "checking":
      return t(K.updates.checking);
    case "up-to-date":
      return t(K.updates.upToDate);
    case "downloading":
      return t(K.updates.downloading);
    case "ready":
      return t(K.updates.ready);
    case "installing":
      return t(K.updates.installing);
    case "available": {
      const update = availableUpdate();
      return update ? t(K.updates.found, { version: update.version }) : t(K.updates.foundBare);
    }
    case "unavailable": {
      const availability = updateAvailability();
      return availability === "development" ? t(K.updates.development) : t(K.updates.unconfigured);
    }
    default:
      return "";
  }
}

function progressText(): string {
  const progress = updateProgress();
  const received = formatBytes(progress?.received ?? 0);
  if (!progress?.total) return received;
  return t(K.updates.progress, { received, total: formatBytes(progress.total) });
}

function progressValue(): number {
  const progress = updateProgress();
  if (!progress?.total || progress.total <= 0) return 0;
  return Math.max(0, Math.min(100, (progress.received / progress.total) * 100));
}

/** The Updates dialog; mount it once with the shell. */
export function UpdatesDialog() {
  effect(() => {
    if (updatesOpen()) void refreshNotificationPermission();
  });
  const status = () => updateStatus();
  const update = () => availableUpdate();
  const busy = () => status() === "checking" || status() === "downloading" || status() === "installing";
  const canCheck = () => updateAvailability() === "available" && !busy();
  return (
    <Dialog
      testID="updates-dialog"
      open={updatesOpen()}
      animation="fade"
      class="m-auto w-[480px] gap-4 rounded-xl border border-border bg-card p-5"
      style={{ boxShadow: shadowDialog() }}
      backdropClass="bg-scrim"
      onCancel={closeUpdates}
    >
      <View style={{ gap: 2 }}>
        <Text class="text-[15px] font-semibold text-foreground">{t(K.updates.title)}</Text>
        <Text testID="updates-version" class="text-[12px] text-muted-foreground">
          {versionLine()}
        </Text>
      </View>

      <If when={!!statusText()}>
        <Text testID="updates-status" class="text-[12.5px] text-foreground">
          {statusText()}
        </Text>
      </If>

      <If when={status() === "available" || status() === "downloading" || status() === "ready" || status() === "installing"}>
        <View
          class="gap-2 rounded-lg border border-line bg-inset p-3"
          style={{ boxShadow: shadowRaised() }}
        >
          <Row label={t(K.updates.newVersion)} value={update()?.version ?? ""} testID="updates-version-new" />
          <If when={!!update()?.notes}>
            <Scroll style={{ maxHeight: 120 }}>
              <Text testID="updates-notes" class="text-[11.5px] leading-4 text-muted-foreground">
                {update()?.notes ?? ""}
              </Text>
            </Scroll>
          </If>
          <If when={status() === "downloading" || status() === "ready"}>
            <Progress
              value={progressValue()}
              accessibilityLabel={t(K.updates.progressLabel)}
              trackClass="h-1.5 overflow-hidden rounded-full bg-muted"
              indicatorClass="h-full rounded-full bg-primary"
            />
            <Text testID="updates-progress" class="text-[11px] tabular-nums text-faint">
              {progressText()}
            </Text>
          </If>
          <If when={!!update() && update()!.canInstall === false}>
            <Text testID="updates-url" class="text-[11px] text-muted-foreground">
              {t(K.updates.manual, { url: update()?.url ?? "" })}
            </Text>
          </If>
        </View>
      </If>

      <If when={!!updateError()}>
        <Text testID="updates-error" class="text-[11.5px] text-destructive">
          {t(K.updates.failed, { message: updateError() ?? "" })}
        </Text>
      </If>

      <View style={{ height: 1, backgroundColor: token("line") }} />
      <View style={{ gap: 6 }}>
        <Text class="text-[11px] font-semibold tracking-wide text-faint">{t(K.notifications.title)}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text testID="notifications-state" class="text-[11.5px] text-muted-foreground" style={{ flex: 1 }}>
            {t(PERMISSION_KEY[notificationPermission()] ?? K.notifications.permissionUnknown)}
          </Text>
          <If when={notificationPermission() === "default" || notificationPermission() === "unknown"}>
            <Action
              testID="notifications-enable"
              label={t(K.notifications.enable)}
              onPress={() => void requestNotificationPermission()}
            />
          </If>
        </View>
        <If when={!!notificationError()}>
          <Text class="text-[11px] text-destructive" style={{ numberOfLines: 2 }}>
            {notificationError() ?? ""}
          </Text>
        </If>
      </View>

      <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
        <Action testID="updates-close" label={t(K.dialog.close)} onPress={closeUpdates} />
        <Action
          testID="updates-check"
          label={t(K.updates.check)}
          onPress={() => void checkNow()}
          disabled={!canCheck()}
        />
        <If when={status() === "available" && update()?.canInstall === true}>
          <Action
            testID="updates-download"
            label={t(K.updates.download)}
            primary
            onPress={() => void downloadNow()}
          />
        </If>
        <If when={status() === "ready"}>
          <Action
            testID="updates-install"
            label={t(K.updates.install)}
            primary
            onPress={() => void installNow()}
          />
        </If>
      </View>
    </Dialog>
  );
}
