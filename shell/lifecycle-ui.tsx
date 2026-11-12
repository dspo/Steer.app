import { cleanup, effect, platform, Text, View } from "nsh";
import { currentWindow, Menu, Tray, Window, type MenuItem } from "nsh/desktop";
import trayIcon from "../assets/tray.svg";
import { K, t } from "../ui/i18n";
import { instanceClaim, quitApp } from "./lifecycle";
import { hideMain, mainWindowVisible, showMain, startNotifications } from "../stores/notifications";
import { openUpdates } from "../stores/updates";
import { motionStyle, shadowRaised } from "../ui/ui";

/**
 * The desktop half of the lifecycle: the tray, the window's close button
 * and the application menu.
 *
 * Closing the main window hides it instead of ending the app: agents,
 * turns and terminals keep running, the tray's Show brings the window back
 * and the tray's Quit (or the app menu's) is a real quit that gives the
 * single-instance claim back. This component mounts only in primary mode;
 * a second instance renders `AlreadyRunning` instead.
 *
 * The tray and the menus are effects over signals, so they follow the
 * window's visibility and the shell's language; the listeners are
 * registered while the component renders, so they go with the app's
 * lifetime.
 */

/** A template-color icon is drawn in the menu bar's text color; the Z is plain. */
export function LifecycleHost() {
  const win = currentWindow();
  // Belt and braces with `nsh.json`: the window reports the close press and
  // the app decides, so a close hides instead of ending the background work.
  win.set({ closeOnPress: false });
  win.on("closePress", () => win.hide());
  startNotifications();
  cleanup(() => Tray.set(null));

  const mac = platform.os === "macos";
  const shown = () => mainWindowVisible();
  const toggle = () => {
    if (shown()) hideMain();
    else showMain();
  };
  const updates = () => {
    showMain();
    openUpdates();
  };

  effect(() => {
    Tray.set({
      icon: trayIcon,
      tooltip: t(K.lifecycle.trayTooltip),
      onClick: () => showMain(),
      menu: [
        { label: shown() ? t(K.lifecycle.hide) : t(K.lifecycle.show), onSelect: toggle },
        { label: t(K.lifecycle.checkUpdates), onSelect: updates },
        { type: "separator" },
        { label: t(K.lifecycle.quit), onSelect: quitApp },
      ],
    });
  });

  effect(() => {
    const editItems: MenuItem[] = [
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "selectAll" },
    ];
    const appItems: MenuItem[] = [
      { role: "about" },
      { type: "separator" },
      { label: t(K.lifecycle.checkUpdates), onSelect: updates },
      { type: "separator" },
      { role: "hide" },
      { role: "hideOthers" },
      { role: "showAll" },
      { type: "separator" },
      { label: t(K.lifecycle.quit), shortcut: "mod+q", onSelect: quitApp },
    ];
    const windowItems: MenuItem[] = [
      { role: "minimize" },
      { role: "zoom" },
      { type: "separator" },
      { label: t(K.lifecycle.show), shortcut: "mod+0", onSelect: showMain },
      { role: "close" },
    ];
    Menu.setApplicationMenu([
      mac
        ? { label: "Zu", submenu: appItems }
        : {
            label: "Zu",
            submenu: [
              { label: t(K.lifecycle.show), onSelect: showMain },
              { label: t(K.lifecycle.hide), onSelect: hideMain },
              { type: "separator" },
              { label: t(K.lifecycle.checkUpdates), onSelect: updates },
              { type: "separator" },
              { label: t(K.lifecycle.quit), shortcut: "mod+q", onSelect: quitApp },
            ],
          },
      { label: t(K.lifecycle.window), submenu: windowItems },
      {
        // The editing roles keep the focused text field's own shortcuts
        // (copy, paste, undo) working on macOS, where the menu provides them.
        label: "Edit",
        submenu: editItems,
      },
    ]);
  });

  // A host: the tray and menus are state, not a view of their own.
  return <View style={{ width: 0, height: 0 }} />;
}

/**
 * The second instance's whole window: the first instance owns the state
 * directory and the engine, so this one explains that and offers to quit.
 * "Show existing" across processes is not something nsh exposes here, so
 * the notice points at the Dock/menu bar instead of pretending.
 */
export function AlreadyRunning() {
  const claim = () => instanceClaim();
  effect(() => {
    // The first instance owns the hide-on-close behavior; this window is
    // only a notice and must be closable (and must not install a tray).
    try {
      Window.get("main")?.set({ closeOnPress: true, title: t(K.lifecycle.alreadyRunningTitle) });
    } catch {
      // No window: the canvas still carries the notice.
    }
  });
  return (
    <View
      class="flex-1 items-center justify-center bg-background"
      style={{ paddingHorizontal: 48, paddingVertical: 40, gap: 10 }}
    >
      <Text testID="already-running" class="text-[17px] font-semibold text-foreground">
        {t(K.lifecycle.alreadyRunningHeading)}
      </Text>
      <Text
        class="text-[12px] leading-5 text-muted-foreground"
        style={{ maxWidth: 520, textAlign: "center" }}
      >
        {t(K.lifecycle.alreadyRunningBody, {
          pid: claim()?.ownerPid ?? claim()?.pid ?? 0,
          path: claim()?.path ?? "",
        })}
      </Text>
      <Text class="text-[11.5px] text-faint" style={{ maxWidth: 520, textAlign: "center" }}>
        {t(K.lifecycle.showHint)}
      </Text>
      <View
        role="button"
        testID="already-running-quit"
        accessibilityLabel={t(K.lifecycle.quit)}
        class="mt-2 h-8 items-center justify-center rounded-lg border border-line px-4 hover:bg-hover active:opacity-80 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
        style={{ boxShadow: shadowRaised(), ...motionStyle("fast") }}
        onPress={quitApp}
      >
        <Text class="text-[12px] font-medium text-foreground">{t(K.lifecycle.quit)}</Text>
      </View>
    </View>
  );
}
