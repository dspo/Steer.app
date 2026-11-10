import { expect, test } from "nsh/test";
import type { NotificationPermission } from "nsh";
import {
  handleNotificationPress,
  notificationPermission,
  notificationTarget,
  notifySubagentSettled,
  notifyTurnSettled,
  resetNotificationState,
  sessionNotificationId,
  setNotifier,
  setWindowProbe,
  shownNotifications,
  subagentNotificationId,
  type Notifier,
} from "./notifications";
import { seedSession } from "./sessions";

/**
 * The notification policy without an engine or a system notification
 * center: a fake notifier records what the shell would show, and the fake
 * window probe says whether the window is in front.
 *
 * The real macOS notification (banner, permission prompt, press) is not
 * automatable here; this covers the decision, coalescing, permission
 * request and press routing around it.
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
    set requests(_value: number) {
      // Counted by the fake, not by the caller.
    },
    get permissions() {
      return permissions;
    },
    set permissions(_value: number) {
      // Counted by the fake, not by the caller.
    },
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
  seedSession("s1", [{ role: "assistant", text: "the build is green" }], {
    path: "/tmp/s1.jsonl",
    name: "Alpha",
    loaded: true,
  });

  setWindowProbe(() => ({ visible: true, focused: true }));
  expect(await notifyTurnSettled("s1")).toBe(false);
  expect(notifier.shows.length).toBe(0);

  // In front but not focused (another app has the keyboard) still notifies.
  setWindowProbe(() => ({ visible: true, focused: false }));
  expect(await notifyTurnSettled("s1")).toBe(true);
  expect(notifier.shows.length).toBe(1);
  expect(notifier.shows[0].id).toBe("zu:session:s1");
  expect(notifier.shows[0].title).toBe("Zu · Alpha");
  expect(notifier.shows[0].body).toBe("the build is green");

  // Hidden notifies too, and the id is the same one (replace, not stack).
  setWindowProbe(() => ({ visible: false, focused: false }));
  seedSession("s1", [{ role: "assistant", text: "second turn done" }], { name: "Alpha" });
  expect(await notifyTurnSettled("s1")).toBe(true);
  expect(notifier.shows.length).toBe(2);
  expect(notifier.shows[1].id).toBe("zu:session:s1");
  expect(shownNotifications()).toEqual(["zu:session:s1"]);
});

test("the same body is not shown twice within five seconds", async () => {
  reset();
  const notifier = fakeNotifier();
  setNotifier(notifier);
  setWindowProbe(() => ({ visible: false, focused: false }));
  seedSession("s2", [{ role: "assistant", text: "same" }], { path: "/tmp/s2.jsonl", name: "Beta" });

  expect(await notifyTurnSettled("s2")).toBe(true);
  expect(await notifyTurnSettled("s2")).toBe(false);
  expect(notifier.shows.length).toBe(1);

  seedSession("s2", [{ role: "assistant", text: "changed" }], { name: "Beta" });
  expect(await notifyTurnSettled("s2")).toBe(true);
  expect(notifier.shows.length).toBe(2);
  expect(new Set(notifier.shows.map((row) => row.id)).size).toBe(1);
});

test("the permission is asked once and a denial stops notifications", async () => {
  reset();
  const notifier = fakeNotifier({ permission: "default", request: "denied" });
  setNotifier(notifier);
  setWindowProbe(() => ({ visible: false, focused: false }));
  seedSession("s3", [{ role: "assistant", text: "done" }], { path: "/tmp/s3.jsonl", name: "Gamma" });

  expect(await notifyTurnSettled("s3")).toBe(false);
  expect(notifier.requests).toBe(1);
  expect(notifier.shows.length).toBe(0);
  expect(notificationPermission()).toBe("denied");

  // A second settle does not prompt again (the answer is remembered).
  expect(await notifyTurnSettled("s3")).toBe(false);
  expect(notifier.requests).toBe(1);
});

test("a permission granted by the prompt lets the first notification through", async () => {
  reset();
  const notifier = fakeNotifier({ permission: "default", request: "granted" });
  setNotifier(notifier);
  setWindowProbe(() => ({ visible: false, focused: false }));
  seedSession("s4", [{ role: "assistant", text: "granted" }], { path: "/tmp/s4.jsonl", name: "Delta" });

  expect(await notifyTurnSettled("s4")).toBe(true);
  expect(notifier.requests).toBe(1);
  expect(notificationPermission()).toBe("granted");
});

test("a subagent settle has its own id and body", async () => {
  reset();
  const notifier = fakeNotifier();
  setNotifier(notifier);
  setWindowProbe(() => ({ visible: false, focused: false }));

  await notifySubagentSettled({
    runId: "run-1",
    captainId: "cap-1",
    containerId: "pi:cap-1",
    agent: "reviewer",
    task: "review the diff",
    status: "settled",
    startedAt: 1,
    verdict: "looks good",
  });
  expect(notifier.shows.length).toBe(1);
  expect(notifier.shows[0].id).toBe("zu:subagent:run-1");
  expect(notifier.shows[0].title).toContain("reviewer");
  expect(notifier.shows[0].body).toBe("looks good");
});

test("a press closes its notification and waits for the engine", async () => {
  reset();
  const notifier = fakeNotifier();
  setNotifier(notifier);
  setWindowProbe(() => ({ visible: false, focused: false }));

  seedSession("s5", [], { path: "/tmp/s5.jsonl", name: "Epsilon" });
  expect(await notifyTurnSettled("s5")).toBe(true);
  handleNotificationPress(sessionNotificationId("s5"));
  // The notification is dismissed; opening the sheet waits for a connected
  // engine (this test has none), so it neither throws nor fakes an open.
  expect(notifier.closed).toEqual([sessionNotificationId("s5")]);
  expect(shownNotifications()).toEqual([]);
});

test("notification ids name their target and foreign ids are ignored", () => {
  expect(notificationTarget(sessionNotificationId("s6"))).toEqual({ kind: "session", sessionId: "s6" });
  expect(notificationTarget(subagentNotificationId("run-2"))).toEqual({ kind: "subagent", runId: "run-2" });
  expect(notificationTarget("other:app:thing")).toBeNull();
  expect(notificationTarget("zu:session:")).toBeNull();
  // A foreign id is not ours to handle.
  handleNotificationPress("other:app:thing");
  expect(shownNotifications()).toEqual([]);
});

test("headless with no window and no capability does nothing", async () => {
  reset();
  const notifier = fakeNotifier();
  setNotifier(notifier);
  setWindowProbe(() => null);
  seedSession("s7", [{ role: "assistant", text: "quiet" }], { path: "/tmp/s7.jsonl", name: "Zeta" });
  expect(await notifyTurnSettled("s7")).toBe(false);
  expect(notifier.shows.length).toBe(0);
  expect(notifier.permissions).toBe(0);
});
