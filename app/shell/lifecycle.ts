import { signal } from "nsh";
import { Application, Tray, Window, isAvailable as desktopAvailable } from "nsh/desktop";
import { claimInstance, releaseInstance, type InstanceClaim } from "../domains/instance";
import { flushNotificationIntents } from "../core/notifications";
import { notifyAppQuit } from "../core/registry";
import { bootShell } from "./shell";
import { K, t } from "../ui/i18n";

/**
 * The app's lifecycle: one instance per state directory, and the decision
 * to boot the engine at all.
 *
 * A desktop app claims the state directory before it starts the sidecar.
 * When another live process owns it, this instance renders the
 * "already running" state instead and never boots an engine: the fixed
 * state directory (`~/.steer`) belongs to the first instance, and a second
 * sidecar would collide with it. The claim's file and pid check live in
 * `src/instance.rs`; this module only decides what the window shows.
 *
 * A headless run (the test runner, a phone build) has no desktop and
 * claims nothing: fixtures must not take a lock or require a tray.
 */

type LifecycleMode = "pending" | "headless" | "primary" | "duplicate";

/** What this process is: the owner, a blocked second instance, or headless. */
export const lifecycleMode = signal<LifecycleMode>("pending");
/** The claim this process made, if any (the duplicate's owner pid is here). */
export const instanceClaim = signal<InstanceClaim | null>(null);

let started = false;

/**
 * Starts the app once: claim (desktop only) and boot the engine unless
 * another live instance owns it. Idempotent so a re-render cannot claim or
 * boot twice.
 */
export function startLifecycle(): void {
  if (started) return;
  started = true;
  if (!desktopAvailable) {
    lifecycleMode.set("headless");
    void bootShell();
    return;
  }
  const claim = claimInstance();
  instanceClaim.set(claim);
  if (claim && !claim.acquired) {
    lifecycleMode.set("duplicate");
    // The first instance owns the engine and the window behavior. This
    // window is only a notice: it must be closable, and closing it must not
    // hide it in a tray that this instance never installs.
    try {
      Window.get("main")?.set({
        closeOnPress: true,
        title: t(K.lifecycle.alreadyRunningTitle),
      });
    } catch {
      // A platform without a window still shows the notice in the canvas.
    }
    return;
  }
  lifecycleMode.set("primary");
  void bootShell().then(
    () => flushNotificationIntents(),
    () => undefined,
  );
}

/**
 * Quits for real: gives the claim back (best effort; a crash is handled by
 * the next launch's pid check), removes the tray and ends the process.
 * `Application.quit()` is the same path the app menu's quit and Cmd+Q take.
 */
export function quitApp(): void {
  notifyAppQuit();
  releaseInstance();
  try {
    Tray.set(null);
  } catch {
    // No tray on this platform; nothing to remove.
  }
  try {
    Application.quit();
  } catch {
    // A view embedded in another app leaves the lifecycle to its host.
  }
}
