import { expect, test } from "nsh/test";
import type { AppUpdate } from "nsh/updater";
import {
  availableUpdate,
  checkNow,
  downloadNow,
  formatBytes,
  installNow,
  openUpdates,
  resetUpdates,
  setUpdateService,
  updateEnv,
  updateError,
  updateProgress,
  updateStatus,
  updatesOpen,
  updateAvailability,
  type UpdateEnv,
  type UpdateService,
} from "./updates";

/**
 * The update state machine without a source or a release: the environment
 * says whether this build can update, and a fake service stands in for
 * `nsh/updater`. Nothing here installs anything: the fake's `install`
 * records the call, and the state stays "installing" because a real
 * successful install ends the process.
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

const UPDATE: AppUpdate = {
  version: "0.2.0",
  notes: "what changed",
  url: "https://example.com/Zu-0.2.0-macos-aarch64.tar.gz",
  canInstall: true,
};

function fakeService(options: {
  env?: UpdateEnv;
  found?: AppUpdate | null;
  checkError?: string;
  downloadError?: string;
  installError?: string;
  progress?: { received: number; total: number | null };
} = {}): UpdateService & { checks: number; downloads: number; installs: number } {
  let checks = 0;
  let downloads = 0;
  let installs = 0;
  return {
    get checks() {
      return checks;
    },
    set checks(_value: number) {},
    get downloads() {
      return downloads;
    },
    set downloads(_value: number) {},
    get installs() {
      return installs;
    },
    set installs(_value: number) {},
    env: () => options.env ?? PACKAGED,
    async check() {
      checks += 1;
      if (options.checkError) throw new Error(options.checkError);
      return options.found === undefined ? UPDATE : options.found;
    },
    async download(onProgress) {
      downloads += 1;
      if (options.downloadError) throw new Error(options.downloadError);
      onProgress?.(options.progress ?? { received: 1024, total: 2048 });
    },
    async install() {
      installs += 1;
      if (options.installError) throw new Error(options.installError);
    },
  };
}

test("a development build says so instead of checking", async () => {
  resetUpdates();
  const service = fakeService({ env: DEV });
  setUpdateService(service);
  openUpdates();
  expect(updatesOpen()).toBe(true);
  expect(updateAvailability(updateEnv())).toBe("development");
  expect(updateStatus()).toBe("unavailable");
  await checkNow();
  expect(service.checks).toBe(0);
  expect(updateStatus()).toBe("unavailable");
});

test("a packaged app without an updater source says it is not configured", async () => {
  resetUpdates();
  const service = fakeService({ env: { ...DEV, development: false } });
  setUpdateService(service);
  openUpdates();
  expect(updateAvailability(updateEnv())).toBe("unconfigured");
  expect(updateStatus()).toBe("unavailable");
});

test("check, download and install walk the whole state machine", async () => {
  resetUpdates();
  const service = fakeService();
  setUpdateService(service);
  openUpdates();
  expect(updateStatus()).toBe("idle");

  await checkNow();
  expect(service.checks).toBe(1);
  expect(updateStatus()).toBe("available");
  expect(availableUpdate()?.version).toBe("0.2.0");

  await downloadNow();
  expect(service.downloads).toBe(1);
  expect(updateProgress()).toEqual({ received: 1024, total: 2048 });
  expect(updateStatus()).toBe("ready");

  await installNow();
  expect(service.installs).toBe(1);
  // A successful install quits the app, so its promise settling means
  // failure; a resolved fake leaves "installing" and never claims success.
  expect(updateStatus()).toBe("installing");
  expect(updateError()).toBeNull();
});

test("an up-to-date check reports no update, not an error", async () => {
  resetUpdates();
  setUpdateService(fakeService({ found: null }));
  openUpdates();
  await checkNow();
  expect(updateStatus()).toBe("up-to-date");
  expect(availableUpdate()).toBeNull();
});

test("a check or download failure is shown and keeps the app as it was", async () => {
  resetUpdates();
  const service = fakeService({ checkError: "source unreachable" });
  setUpdateService(service);
  openUpdates();
  await checkNow();
  expect(updateStatus()).toBe("error");
  expect(updateError()).toContain("source unreachable");
  expect(availableUpdate()).toBeNull();

  const failingDownload = fakeService({ downloadError: "checksum mismatch" });
  setUpdateService(failingDownload);
  openUpdates();
  await checkNow();
  await downloadNow();
  expect(updateStatus()).toBe("error");
  expect(updateError()).toContain("checksum mismatch");
  expect(updateProgress()).toBeNull();
});

test("an update that cannot install is not downloaded", async () => {
  resetUpdates();
  const service = fakeService({ found: { ...UPDATE, canInstall: false } });
  setUpdateService(service);
  openUpdates();
  await checkNow();
  expect(updateStatus()).toBe("available");
  await downloadNow();
  expect(service.downloads).toBe(0);
  expect(updateStatus()).toBe("available");
});

test("a failed install reports the error and does not pretend to have installed", async () => {
  resetUpdates();
  const service = fakeService({ installError: "cannot replace the app" });
  setUpdateService(service);
  openUpdates();
  await checkNow();
  await downloadNow();
  await installNow();
  expect(updateStatus()).toBe("error");
  expect(updateError()).toContain("cannot replace the app");
});

test("formatBytes keeps the progress row readable", () => {
  expect(formatBytes(0)).toBe("0 B");
  expect(formatBytes(512)).toBe("512 B");
  expect(formatBytes(1024)).toBe("1 KB");
  expect(formatBytes(1024 * 1024)).toBe("1 MB");
  expect(formatBytes(1536 * 1024)).toBe("1.5 MB");
});
