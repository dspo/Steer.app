import { signal } from "nsh";
import { Notifications, type NotificationPermission } from "nsh";
import { Window } from "nsh/desktop";
import { onDisconnect, onEngineEvent, onSnapshot, phase, request } from "./engine";
import { containersLoaded, openPath, switchContainer } from "./containers";
import { sessions, sessionTitle, views } from "./sessions";
import { openSubagents, selectRun } from "./subagents";
import type { SubagentRun } from "./contracts/protocol";
import { K, t } from "./i18n";

/**
 * System notifications for settled turns and settled subagent runs.
 *
 * The rule is deliberately simple and documented: a settle notifies when
 * the main window is hidden, minimized or not focused, so a run that
 * finishes while the user is elsewhere reaches them. A focused window
 * gets no notification at all (the transcript is already in front of the
 * user). That is the "first pass" M12 asks for; a later pass can add a
 * preference instead of changing the behaviour silently.
 *
 * Floods are avoided at the source: only `agent.state` leaving `running`
 * and `subagent.settled` notify (not every message or tool call), the id
 * is per session/run so the system replaces rather than stacks, and the
 * same body is not shown twice within five seconds. A press shows and
 * focuses the window and opens the session's sheet (or the subagent's
 * roster) when the engine has loaded; because a press can start the app
 * anew, the id carries the thing to open and the intent waits for the
 * engine instead of being dropped.
 *
 * Off the desktop (a headless test, a phone build) there is no window
 * state, so nothing is shown and nothing throws; a missing capability or
 * permission only records the state for the UI.
 */

/** How the shell reports the main window: null off a desktop. */
export type WindowProbe = () => { visible: boolean; focused: boolean } | null;

/** What the shell uses to show and close notifications (tests replace it). */
export type Notifier = {
  permission(): Promise<NotificationPermission>;
  requestPermission(): Promise<NotificationPermission>;
  show(options: { id: string; title: string; body?: string | null; silent?: boolean | null }): Promise<boolean>;
  close(id: string): Promise<void>;
};

/** The system's permission, as the shell last saw it. */
export const notificationPermission = signal<NotificationPermission | "unknown">("unknown");
/** The last notification failure (permission, capability, system error). */
export const notificationError = signal<string | null>(null);
/** The ids currently shown, for diagnostics and the tests. */
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

/** The main window's state as the notifications see it; null off a desktop. */
export function probeWindow(): { visible: boolean; focused: boolean } | null {
  try {
    return windowProbe();
  } catch {
    return null;
  }
}

/** Whether a settle should notify: a desktop window that is not in front. */
export function shouldNotify(): boolean {
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
    // The system's prompt. Asked once per run from a settle (or the
    // settings button); a dismissed prompt is not asked again.
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

const NOTIFICATION_PREFIX = "zu:";
const SESSION_PREFIX = `${NOTIFICATION_PREFIX}session:`;
const SUBAGENT_PREFIX = `${NOTIFICATION_PREFIX}subagent:`;

/** The notification id for a pi session. */
export function sessionNotificationId(sessionId: string): string {
  return `${SESSION_PREFIX}${sessionId}`;
}

/** The notification id for a subagent run. */
export function subagentNotificationId(runId: string): string {
  return `${SUBAGENT_PREFIX}${runId}`;
}

/** What a notification press should open. */
export type NotificationTarget =
  | { kind: "session"; sessionId: string }
  | { kind: "subagent"; runId: string; containerId?: string };

/** The target a notification id names, or null for an id we did not make. */
export function notificationTarget(id: string): NotificationTarget | null {
  if (id.startsWith(SESSION_PREFIX)) {
    const sessionId = id.slice(SESSION_PREFIX.length);
    return sessionId ? { kind: "session", sessionId } : null;
  }
  if (id.startsWith(SUBAGENT_PREFIX)) {
    const runId = id.slice(SUBAGENT_PREFIX.length);
    return runId ? { kind: "subagent", runId } : null;
  }
  return null;
}

const shown = new Map<string, { body: string; at: number }>();
const runContainers = new Map<string, string>();

function syncShown(): void {
  shownNotifications.set([...shown.keys()]);
}

async function showNotification(id: string, title: string, body: string): Promise<boolean> {
  const previous = shown.get(id);
  const now = Date.now();
  // The system replaces by id; not asking it to redraw an identical body
  // within five seconds keeps a fast burst from flashing.
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

/** The last assistant sentence, as a short body; empty when there is none. */
function turnPreview(sessionId: string): string {
  const view = views()[sessionId];
  const list = view?.messages ?? [];
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const message = list[index];
    if (message.role !== "assistant" || !message.text) continue;
    const line = message.text.replace(/\s+/g, " ").trim();
    if (!line) continue;
    return line.length > 140 ? `${line.slice(0, 137)}…` : line;
  }
  return "";
}

/**
 * Notifies that a pi turn settled. The caller is the engine event hook; it
 * is public so tests can drive the decision and the fake notifier.
 */
export async function notifyTurnSettled(sessionId: string): Promise<boolean> {
  if (!sessionId || !shouldNotify()) return false;
  const permission = await ensureNotificationPermission();
  if (permission !== "granted") return false;
  const title = `Zu · ${sessionTitle(sessionId)}`;
  const body = turnPreview(sessionId) || t(K.notifications.turnDone);
  return showNotification(sessionNotificationId(sessionId), title, body);
}

/** Notifies that a subagent run settled. */
export async function notifySubagentSettled(run: SubagentRun): Promise<boolean> {
  if (!run?.runId || !shouldNotify()) return false;
  const permission = await ensureNotificationPermission();
  if (permission !== "granted") return false;
  if (run.containerId) runContainers.set(run.runId, run.containerId);
  const title = `Zu · ${t(K.notifications.subagent, { agent: run.agent || "subagent" })}`;
  const body = run.verdict?.trim() || run.output?.replace(/\s+/g, " ").trim().slice(0, 140) || t(K.notifications.subagentDone);
  return showNotification(subagentNotificationId(run.runId), title, body);
}

let pending: NotificationTarget[] = [];

/** How many times the shell tried to open a queued press target. */
const NOTIFICATION_TARGET_ATTEMPTS = 20;

/**
 * Handles a notification press: brings the window forward and remembers
 * what to open until the engine's registry is loaded (a press can start
 * the app anew).
 */
export function handleNotificationPress(id: string): void {
  const target = notificationTarget(id);
  if (!target) return;
  void dismissNotification(id);
  showMain();
  pending.push(target);
  void flushNotificationIntents();
}

/** Opens the queued press targets once the engine and registry are ready. */
export async function flushNotificationIntents(): Promise<void> {
  if (pending.length === 0) return;
  if (phase() !== "connected" || !containersLoaded()) return;
  const intents = pending;
  pending = [];
  const retry: NotificationTarget[] = [];
  for (const intent of intents) {
    try {
      if (intent.kind === "session") {
        const path = sessionPath(intent.sessionId);
        if (!path) {
          if (attempts(intent) < NOTIFICATION_TARGET_ATTEMPTS) retry.push(intent);
          continue;
        }
        await openPath(path);
      } else {
        const containerId = intent.containerId ?? (await containerForRun(intent.runId));
        if (!containerId) continue;
        await switchContainer(containerId);
        openSubagents();
        await selectRun(intent.runId);
      }
    } catch (error) {
      notificationError.set(String(error));
    }
  }
  pending = [...pending, ...retry];
}

/** How many times this intent was retried (bounded so a dead id is dropped). */
const tries = new WeakMap<NotificationTarget, number>();

function attempts(intent: NotificationTarget): number {
  const count = tries.get(intent) ?? 0;
  tries.set(intent, count + 1);
  return count + 1;
}

/** The session's file, from the open views or the sidebar's list. */
function sessionPath(sessionId: string): string | null {
  const view = views()[sessionId];
  if (view?.path) return view.path;
  const meta = sessions().find((row) => row.id === sessionId);
  return meta?.path ?? null;
}

/** A settled run's container: remembered at notify time, else read from the engine. */
async function containerForRun(runId: string): Promise<string | undefined> {
  const remembered = runContainers.get(runId);
  if (remembered) return remembered;
  try {
    const data = await request("subagent.list", {}, 10000);
    const run = ((data?.runs ?? []) as SubagentRun[]).find((row) => row.runId === runId);
    if (run?.containerId) runContainers.set(runId, run.containerId);
    return run?.containerId;
  } catch {
    return undefined;
  }
}

let started = false;
const wasRunning = new Set<string>();

/**
 * Starts the notification listeners (desktop only). Registers the engine
 * hooks and the system's press callback once; repeated calls are no-ops.
 */
export function startNotifications(): void {
  if (started) return;
  started = true;
  onEngineEvent((event) => observeEngineEvent(event));
  // A turn already running when the shell connects (a reconnect, an app
  // restart) gets its edge here, so its settle still notifies.
  onSnapshot((state) => {
    for (const row of state.openSessions ?? []) {
      if (row.running) wasRunning.add(row.sessionId);
    }
  });
  onDisconnect(() => {
    // Interrupted turns are not completed turns: no notification for them.
    wasRunning.clear();
  });
  void refreshNotificationPermission();
  try {
    Notifications.on("press", (press) => handleNotificationPress(press.id));
  } catch (error) {
    // No capability or no notification center: keep the decision logic
    // quiet, and let the settings row show the state.
    notificationError.set(String(error));
  }
}

/** The engine event the shell calls (and tests can call directly). */
export function observeEngineEvent(event: { type: string; sessionId?: string; data?: unknown }): void {
  if (event.type === "agent.state") {
    const id = event.sessionId ?? "";
    if (!id) return;
    const running = (event.data as { state?: string } | undefined)?.state === "running";
    if (running) {
      wasRunning.add(id);
      return;
    }
    // The first idle of a session that never streamed here is a reconnect
    // snapshot, not a finished turn: only a running → idle edge counts.
    if (!wasRunning.delete(id)) return;
    void notifyTurnSettled(id);
    return;
  }
  if (event.type === "subagent.settled") {
    const run = (event.data as { run?: SubagentRun } | undefined)?.run;
    if (run) void notifySubagentSettled(run);
  }
}

/** A test hook: forget the "running" edges and the listeners' state. */
export function resetNotificationState(): void {
  wasRunning.clear();
  shown.clear();
  runContainers.clear();
  syncShown();
  pending = [];
  notificationError.set(null);
  notificationPermission.set("unknown");
  askedPermission = false;
  started = false;
}
