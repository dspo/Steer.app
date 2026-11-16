import { expect, test } from "nsh/test";
import type { NotificationPermission } from "nsh";
import {
  handleNotificationPress,
  notificationPermission,
  notificationSheet,
  notifySettled,
  resetNotificationState,
  sheetNotificationId,
  setNotifier,
  setWindowProbe,
  shownNotifications,
  type Notifier,
} from "../core/notifications";
import {
  activeContainerId,
  containers,
  containersLoaded,
  layout,
  sheetOrder,
} from "../core/containers";
import { panelIds } from "../core/dock";

/**
 * The notification policy without a system notification center: a fake
 * notifier records what the shell would show, and the fake window probe says
 * whether the window is in front. The unit is a sheet id — no harness.
 */

type Shown = { id: string; title: string; body?: string | null };

function fakeNotifier(options: {
  permission?: NotificationPermission;
  request?: NotificationPermission;
  take?: boolean;
} = {}): Notifier & { shows: Shown[]; closed: string[]; requests: number; permissions: number } {
  const shows: Shown[] = [];
  const closed: string[] = [];
  let requests = 0;
  let permissions = 0;
  const state = options.permission ?? "granted";
  return {
    shows,
    closed,
    get requests() {
      return requests;
    },
    set requests(_value: number) {},
    get permissions() {
      return permissions;
    },
    set permissions(_value: number) {},
    async permission() {
      permissions += 1;
      return state;
    },
    async requestPermission() {
      requests += 1;
      return options.request ?? state;
    },
    async show(notification) {
      shows.push(notification);
      return options.take ?? true;
    },
    async close(id) {
      closed.push(id);
    },
  };
}

function reset(): void {
  resetNotificationState();
  setWindowProbe(() => null);
  setNotifier(null);
}

test("a settle notifies only while the window is not in front", async () => {
  reset();
  const notifier = fakeNotifier();
  setNotifier(notifier);

  setWindowProbe(() => ({ visible: true, focused: true }));
  expect(await notifySettled({ sheetId: "session:s1", title: "Alpha", body: "the build is green" })).toBe(false);
  expect(notifier.shows.length).toBe(0);

  setWindowProbe(() => ({ visible: true, focused: false }));
  expect(await notifySettled({ sheetId: "session:s1", title: "Alpha", body: "the build is green" })).toBe(true);
  expect(notifier.shows[0].id).toBe("zu:sheet:session:s1");
  expect(notifier.shows[0].title).toBe("Zu · Alpha");
  expect(notifier.shows[0].body).toBe("the build is green");
  expect(shownNotifications()).toEqual(["zu:sheet:session:s1"]);
});

test("the same body is not shown twice within five seconds", async () => {
  reset();
  const notifier = fakeNotifier();
  setNotifier(notifier);
  setWindowProbe(() => ({ visible: false, focused: false }));
  const notice = { sheetId: "session:s2", title: "Beta", body: "same" };

  expect(await notifySettled(notice)).toBe(true);
  expect(await notifySettled(notice)).toBe(false);
  expect(notifier.shows.length).toBe(1);

  expect(await notifySettled({ ...notice, body: "changed" })).toBe(true);
  expect(notifier.shows.length).toBe(2);
  expect(new Set(notifier.shows.map((row) => row.id)).size).toBe(1);
});

test("the permission is asked once and a denial stops notifications", async () => {
  reset();
  const notifier = fakeNotifier({ permission: "default", request: "denied" });
  setNotifier(notifier);
  setWindowProbe(() => ({ visible: false, focused: false }));

  expect(await notifySettled({ sheetId: "session:s3", title: "Gamma", body: "done" })).toBe(false);
  expect(notifier.requests).toBe(1);
  expect(notifier.shows.length).toBe(0);
  expect(notificationPermission()).toBe("denied");
  expect(await notifySettled({ sheetId: "session:s3", title: "Gamma", body: "done" })).toBe(false);
  expect(notifier.requests).toBe(1);
});

test("a permission granted by the prompt lets the first notification through", async () => {
  reset();
  const notifier = fakeNotifier({ permission: "default", request: "granted" });
  setNotifier(notifier);
  setWindowProbe(() => ({ visible: false, focused: false }));

  expect(await notifySettled({ sheetId: "session:s4", title: "Delta", body: "granted" })).toBe(true);
  expect(notifier.requests).toBe(1);
  expect(notificationPermission()).toBe("granted");
});

test("a press closes its notification and reopens the sheet's container", async () => {
  reset();
  const notifier = fakeNotifier();
  setNotifier(notifier);
  setWindowProbe(() => ({ visible: false, focused: false }));
  containers.set([
    { id: "pi:s5", cwd: "/tmp", archived: false, createdAt: 0, updatedAt: 0 },
  ]);
  containersLoaded.set(true);
  sheetOrder.set({ "pi:s5": ["session:s5"] });
  layout.set({ center: { type: "tabs", panels: [], activeIndex: 0 } });
  activeContainerId.set(null);

  expect(await notifySettled({ sheetId: "session:s5", title: "Epsilon", body: "done" })).toBe(true);
  handleNotificationPress(sheetNotificationId("session:s5"));
  await new Promise<void>((resolve) => setTimeout(resolve, 20));
  expect(notifier.closed).toEqual([sheetNotificationId("session:s5")]);
  expect(shownNotifications()).toEqual([]);
  expect(activeContainerId()).toBe("pi:s5");
  expect(panelIds(layout())).toContain("session:s5");
});

test("notification ids name their sheet and foreign ids are ignored", () => {
  expect(notificationSheet(sheetNotificationId("session:s6"))).toBe("session:s6");
  expect(notificationSheet("other:app:thing")).toBeNull();
  expect(notificationSheet("zu:sheet:")).toBeNull();
  handleNotificationPress("other:app:thing");
  expect(shownNotifications()).toEqual([]);
});

test("headless with no window and no capability does nothing", async () => {
  reset();
  const notifier = fakeNotifier();
  setNotifier(notifier);
  setWindowProbe(() => null);
  expect(await notifySettled({ sheetId: "session:s7", title: "Zeta", body: "quiet" })).toBe(false);
  expect(notifier.shows.length).toBe(0);
  expect(notifier.permissions).toBe(0);
});
