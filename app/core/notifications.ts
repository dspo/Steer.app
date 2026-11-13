import { signal } from "nsh";
import { Notifications, type NotificationPermission } from "nsh";
import { Window } from "nsh/desktop";
import { containersLoaded, containerOfSheet, openSheet, switchContainer } from "../core/containers";
import { K, t } from "../ui/i18n";

/**
 * System notifications for settled conversations (docs/sheet-module-ARCHITECTURE.md
 * §6): a settle notifies when the main window is hidden, minimized or not
 * focused. A focused window gets no notification (the transcript is already
 * in front of the user).
 *
 * The unit is a **sheet id**, not a harness's id: a module calls
 * `notifySettled({ sheetId, title, body })`, and a press switches to the
 * sheet's container, opens the sheet if it was closed and shows the window.
 * The id is per sheet, so the system replaces rather than stacks, and the same
 * body is not shown twice within five seconds.
 */

/** How the shell reports the main window: null off a desktop. */
type WindowProbe = () => { visible: boolean; focused: boolean } | null;

/** What the shell uses to show and close notifications (tests replace it). */
export type Notifier = {
  permission(): Promise<NotificationPermission>;
  requestPermission(): Promise<NotificationPermission>;
  show(options: { id: string; title: string; body?: string | null; silent?: boolean | null }): Promise<boolean>;
  close(id: string): Promise<void>;
};

export const notificationPermission = signal<NotificationPermission | "unknown">("unknown");
export const notificationError = signal<string | null>(null);
export const shownNotifications = signal<string[]>([]);

const nshNotifier: Notifier = {
  permission: () => Notifications.permission(),
  requestPermission: () => Notifications.requestPermission(),
  show: (options) => Notifications.show(options),
  close: (id) => Notifications.close(id),
};

let notifier: Notifier = nshNotifier;

/** Replaces the notification transport; `null` restores the system's. */
export function setNotifier(next: Notifier | null): void {
  notifier = next ?? nshNotifier;
}

let windowProbe: WindowProbe = () => {
  try {
    const state = Window.get("main")?.state();
    return state ? { visible: state.visible, focused: state.focused } : null;
  } catch {
    return null;
  }
};

/** Replaces how the shell asks whether its window is in front (tests use it). */
export function setWindowProbe(next: WindowProbe | null): void {
  windowProbe = next ?? (() => null);
}

function probeWindow(): { visible: boolean; focused: boolean } | null {
  try {
    return windowProbe();
  } catch {
    return null;
  }
}

/** Whether a settle should notify: a desktop window that is not in front. */
function shouldNotify(): boolean {
  const window = probeWindow();
  return !!window && (!window.visible || !window.focused);
}

/** Shows and focuses the main window; a no-op off a desktop. */
export function showMain(): void {
  try {
    const main = Window.get("main");
    main?.show();
    main?.focus();
  } catch {
    // Headless or no window capability: there is nothing to show.
  }
}

/** Hides the main window; a no-op off a desktop. */
export function hideMain(): void {
  try {
    Window.get("main")?.hide();
  } catch {
    // Headless or no window capability: there is nothing to hide.
  }
}

/** Whether the main window is visible (false when there is none). */
export function mainWindowVisible(): boolean {
  return probeWindow()?.visible ?? false;
}

/** Asks for the permission on first use, then remembers the answer. */
let askedPermission = false;

export async function ensureNotificationPermission(): Promise<NotificationPermission | "unknown"> {
  let permission: NotificationPermission;
  try {
    permission = await notifier.permission();
  } catch (error) {
    notificationError.set(String(error));
    notificationPermission.set("unavailable");
    return "unavailable";
  }
  if (permission === "default" && !askedPermission) {
    askedPermission = true;
    try {
      permission = await notifier.requestPermission();
    } catch (error) {
      notificationError.set(String(error));
      permission = "unavailable";
    }
  }
  notificationPermission.set(permission);
  return permission;
}

/** Re-reads the permission without prompting (the settings row). */
export async function refreshNotificationPermission(): Promise<void> {
  try {
    notificationPermission.set(await notifier.permission());
    notificationError.set(null);
  } catch (error) {
    notificationError.set(String(error));
    notificationPermission.set("unavailable");
  }
}

/** Asks the system for permission from a user gesture (the settings row). */
export async function requestNotificationPermission(): Promise<void> {
  askedPermission = true;
  try {
    notificationPermission.set(await notifier.requestPermission());
    notificationError.set(null);
  } catch (error) {
    notificationError.set(String(error));
    notificationPermission.set("unavailable");
  }
}

const NOTIFICATION_PREFIX = "zu:sheet:";

/** The notification id for a sheet. */
export function sheetNotificationId(sheetId: string): string {
  return `${NOTIFICATION_PREFIX}${sheetId}`;
}

/** The sheet a notification id names, or null for an id we did not make. */
export function notificationSheet(id: string): string | null {
  if (!id.startsWith(NOTIFICATION_PREFIX)) return null;
  const sheetId = id.slice(NOTIFICATION_PREFIX.length);
  return sheetId || null;
}

const shown = new Map<string, { body: string; at: number }>();

function syncShown(): void {
  shownNotifications.set([...shown.keys()]);
}

async function showNotification(id: string, title: string, body: string): Promise<boolean> {
  const previous = shown.get(id);
  const now = Date.now();
  if (previous && previous.body === body && now - previous.at < 5000) return false;
  try {
    const took = await notifier.show({ id, title, body, silent: false });
    if (took) {
      shown.set(id, { body, at: now });
      syncShown();
    }
    notificationError.set(null);
    return took;
  } catch (error) {
    notificationError.set(String(error));
    return false;
  }
}

/** Closes one notification, if it is showing. */
export async function dismissNotification(id: string): Promise<void> {
  shown.delete(id);
  syncShown();
  try {
    await notifier.close(id);
  } catch {
    // Closing something the system already dropped is not a failure.
  }
}

/** What a module reports when its conversation settles. */
export interface SettledNotice {
  sheetId: string;
  title?: string;
  body?: string;
}

/**
 * Notifies that a conversation settled. The module owning the sheet calls
 * this; the shell owns the window/permission policy and the press routing.
 */
export async function notifySettled(notice: SettledNotice): Promise<boolean> {
  if (!notice?.sheetId || !shouldNotify()) return false;
  const permission = await ensureNotificationPermission();
  if (permission !== "granted") return false;
  const title = notice.title || "Zu";
  const body = notice.body?.trim() || t(K.notifications.turnDone);
  return showNotification(sheetNotificationId(notice.sheetId), `Zu · ${title}`, body);
}

let pending: string[] = [];

/** How many times the shell tried to open a queued press target. */
const NOTIFICATION_TARGET_ATTEMPTS = 20;
const tries = new Map<string, number>();

/** Handles a notification press: shows the window and remembers the sheet. */
export function handleNotificationPress(id: string): void {
  const sheetId = notificationSheet(id);
  if (!sheetId) return;
  void dismissNotification(id);
  showMain();
  pending.push(sheetId);
  void flushNotificationIntents();
}

/** Opens the queued press targets once the container registry is loaded. */
export async function flushNotificationIntents(): Promise<void> {
  if (pending.length === 0) return;
  if (!containersLoaded()) return;
  const intents = pending;
  pending = [];
  const retry: string[] = [];
  for (const sheetId of intents) {
    try {
      const containerId = containerOfSheet(sheetId);
      if (!containerId) {
        const count = (tries.get(sheetId) ?? 0) + 1;
        tries.set(sheetId, count);
        if (count < NOTIFICATION_TARGET_ATTEMPTS) retry.push(sheetId);
        continue;
      }
      await switchContainer(containerId);
      openSheet(sheetId);
    } catch (error) {
      notificationError.set(String(error));
    }
  }
  pending = [...pending, ...retry];
}

let started = false;

/** Starts the notification listener (desktop only). */
export function startNotifications(): void {
  if (started) return;
  started = true;
  void refreshNotificationPermission();
  try {
    Notifications.on("press", (press) => handleNotificationPress(press.id));
  } catch (error) {
    notificationError.set(String(error));
  }
}

/** A test hook: forget the shown ids, queued presses and permission state. */
export function resetNotificationState(): void {
  shown.clear();
  syncShown();
  pending = [];
  tries.clear();
  notificationError.set(null);
  notificationPermission.set("unknown");
  askedPermission = false;
  started = false;
}
