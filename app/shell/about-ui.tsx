import { cleanup, effect, Image, signal, Text, token, View } from "nsh";
import { Clipboard } from "nsh";
import { Dialog } from "nsh/base";
import appIcon from "../assets/app-icon.png";
import { K, t } from "../ui/i18n";
import { shadowDialog, SheetAction } from "../ui/ui";
import { aboutClipboardText, aboutHeadline, aboutHeadlineText, aboutOpen, aboutRowTestID, aboutRows, closeAbout } from "./about";

/**
 * The About dialog: the app menu's 「关于 Zu」 and the tray's item. It is
 * what this run is before anything about updates (which keep their own
 * dialog): the app icon, the headline version, and manox-app's version
 * axis — labels right-aligned against a hairline, values left-aligned
 * beside it, one row per piece of the stack. The copy button puts the same
 * facts on the clipboard, formatted for a bug report.
 */

/** The axis: two columns over one hairline, so the rows read as pairs. */
function VersionAxis(props: { manoxVersion: string | null; ghosttyVersion: string | null }) {
  const rows = () => aboutRows(props.manoxVersion, props.ghosttyVersion);
  const line = token("border");
  return (
    <View testID="about-axis" style={{ flexDirection: "row", alignSelf: "center" }}>
      <View
        style={{
          alignItems: "flex-end",
          paddingRight: 12,
          gap: 6,
          borderRightWidth: 1,
          borderRightColor: line,
        }}
      >
        <Each of={rows()} key={(row) => row.label}>
          {(row) => (
            <Text class="text-[12px] leading-4 text-muted-foreground" style={{ textAlign: "right" }}>
              {row().label}
            </Text>
          )}
        </Each>
      </View>
      <View style={{ alignItems: "flex-start", paddingLeft: 12, gap: 6 }}>
        <Each of={rows()} key={(row) => row.label}>
          {(row) => (
            <Text testID={aboutRowTestID(row())} class="text-[12px] leading-4 text-foreground" style={{ numberOfLines: 1 }}>
              {row().value}
            </Text>
          )}
        </Each>
      </View>
    </View>
  );
}

/** The About dialog; mount it once with the app (App.tsx passes the manox
 * host and Ghostty kernel versions in — facts the shell may not import
 * itself). */
export function AboutDialog(props: { manoxVersion: string | null; ghosttyVersion: string | null }) {
  const copied = signal(false);
  let copiedTimer: ReturnType<typeof setTimeout> | null = null;
  cleanup(() => {
    if (copiedTimer !== null) clearTimeout(copiedTimer);
  });
  effect(() => {
    // Reopening starts over: the note says copied only right after a copy.
    if (!aboutOpen()) copied.set(false);
  });
  const copy = () => {
    // Deferred a tick, so even a synchronous refusal (a capability gate)
    // lands in the catch instead of the press handler.
    Promise.resolve()
      .then(() => Clipboard.writeText(aboutClipboardText(aboutHeadlineText(), props.manoxVersion, props.ghosttyVersion)))
      .then(() => {
        copied.set(true);
        if (copiedTimer !== null) clearTimeout(copiedTimer);
        copiedTimer = setTimeout(() => copied.set(false), 2000);
      })
      .catch(() => {
        // Nowhere to write (a headless run): the button stays as it is.
      });
  };
  return (
    <Dialog
      testID="about-dialog"
      open={aboutOpen()}
      animation="fade"
      class="m-auto w-[420px] gap-5 rounded-xl border border-border bg-card p-6"
      style={{ boxShadow: shadowDialog() }}
      backdropClass="bg-scrim"
      onCancel={closeAbout}
    >
      <View style={{ alignItems: "center", gap: 10 }}>
        <Image src={appIcon} style={{ width: 64, height: 64, borderRadius: 14 }} />
        <View style={{ alignItems: "center", gap: 3 }}>
          <Text testID="about-headline" class="text-[16px] font-semibold text-foreground">
            {aboutHeadlineText()}
          </Text>
          <If when={aboutHeadline().development}>
            <Text testID="about-development" class="text-[11px] text-faint">
              {t(K.about.development)}
            </Text>
          </If>
        </View>
        <VersionAxis manoxVersion={props.manoxVersion} ghosttyVersion={props.ghosttyVersion} />
      </View>
      <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
        <SheetAction
          testID="about-copy"
          label={copied() ? t(K.about.copied) : t(K.about.copy)}
          onPress={copy}
        />
        <SheetAction testID="about-close" label={t(K.dialog.close)} onPress={closeAbout} />
      </View>
    </Dialog>
  );
}
