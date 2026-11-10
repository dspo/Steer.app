import { signal } from "nsh";
import { appInfo } from "nsh";
import { checkForUpdate, downloadUpdate, installAndRestart, shellInfo, type AppUpdate, type UpdateProgress } from "nsh/updater";

/**
 * The update surface, honestly.
 *
 * `nsh/updater` needs a source in `nsh.json` (`"updater"`) and, for a
 * self-hosted source, a public key; this repository has neither, so the
 * app is not configured for updates and says so instead of inventing a
 * release. In a development run `checkForUpdate` resolves `null` anyway,
 * and `shellInfo().version` is `null` for an app without `"updater"`:
 * both are reported as "updates are off here", never as "up to date".
 *
 * The state machine is the module's own so it can be tested headless with
 * an injected service: check → available (`canInstall` decides whether
 * download/install are offered) → downloading with real progress →
 * ready → installing. A successful `installAndRestart` quits the app, so
 * its promise settling at all means failure, as `nsh/updater` documents.
 */

/** What the running app can say about updates. */
export type UpdateEnv = {
  /** A development build (`nsh run`, `nsh test`, `nsh build` without `--release`). */
  development: boolean;
  /** `nsh.json`'s version in this build. */
  appVersion: string | null;
  /** `nsh.json`'s build number in this build. */
  appBuild: number | null;
  /** The installed app's version; null when it was packaged without `"updater"`. */
  shellVersion: string | null;
  /** The installed app's build number. */
  shellBuild: number | null;
  /** The NSH runtime built into the installed app. */
  nshVersion: string;
  /** The installed app reads an updater source from its `nsh.json`. */
  configured: boolean;
};

/** What the dialog is doing. */
export type UpdateStatus =
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "ready"
  | "installing"
  | "unavailable"
  | "error";

/** The dialog is open. */
export const updatesOpen = signal(false);
/** The state machine's current state. */
export const updateStatus = signal<UpdateStatus>("idle");
/** The last check/download/install failure, as the module reported it. */
export const updateError = signal<string | null>(null);
/** The update the last check found. */
export const availableUpdate = signal<AppUpdate | null>(null);
/** Download progress in bytes, or null before a download starts. */
export const updateProgress = signal<{ received: number; total: number | null } | null>(null);
/** What this run knows about its own packaging. */
export const updateEnv = signal<UpdateEnv>(readEnv());

/** What the system's updater gives this app. Tests inject their own. */
export type UpdateService = {
  env(): UpdateEnv;
  check(): Promise<AppUpdate | null>;
  download(onProgress?: ((progress: UpdateProgress) => void) | null): Promise<void>;
  install(): Promise<void>;
};

const systemService: UpdateService = {
  env: readEnv,
  check: () => checkForUpdate(),
  download: (onProgress) => downloadUpdate(onProgress ?? null),
  install: () => installAndRestart(),
};

let service: UpdateService = systemService;

/** Replaces the updater (tests); `null` restores `nsh/updater`. */
export function setUpdateService(next: UpdateService | null): void {
  service = next ?? systemService;
  resetUpdates();
}

/** Re-reads what the running app is and whether it can update. */
function readEnv(): UpdateEnv {
  let development = true;
  let appVersion: string | null = null;
  let appBuild: number | null = null;
  try {
    const app = appInfo();
    development = app.development;
    appVersion = app.version;
    appBuild = app.build;
  } catch {
    // No app info: treat it as a development run.
  }
  let shellVersion: string | null = null;
  let shellBuild: number | null = null;
  let nshVersion = "";
  try {
    const shell = shellInfo();
    shellVersion = shell?.version ?? null;
    shellBuild = shell?.build ?? null;
    nshVersion = shell?.nshVersion ?? "";
  } catch {
    // No installed-shell info (headless, development): no updater source.
  }
  return {
    development,
    appVersion,
    appBuild,
    shellVersion,
    shellBuild,
    nshVersion,
    configured: shellVersion !== null,
  };
}

/** Why updates are or are not offered here, from the environment alone. */
export function updateAvailability(env: UpdateEnv = updateEnv()): "available" | "development" | "unconfigured" {
  if (env.development) return "development";
  if (!env.configured) return "unconfigured";
  return "available";
}

/** Opens the dialog and refreshes what it says about this build. */
export function openUpdates(): void {
  try {
    updateEnv.set(service.env());
  } catch {
    updateEnv.set(readEnv());
  }
  updatesOpen.set(true);
  updateError.set(null);
  if (updateStatus() === "idle" && updateAvailability() !== "available") {
    updateStatus.set("unavailable");
  }
}

/** Closes the dialog; a download in flight keeps going. */
export function closeUpdates(): void {
  updatesOpen.set(false);
}

/** Asks the source for a newer version. */
export async function checkNow(): Promise<void> {
  if (updateStatus() === "checking" || updateStatus() === "downloading" || updateStatus() === "installing") return;
  let env: UpdateEnv;
  try {
    env = service.env();
  } catch {
    env = readEnv();
  }
  updateEnv.set(env);
  if (updateAvailability(env) !== "available") {
    updateStatus.set("unavailable");
    return;
  }
  updateStatus.set("checking");
  updateError.set(null);
  try {
    const found = await service.check();
    availableUpdate.set(found ?? null);
    updateStatus.set(found ? "available" : "up-to-date");
  } catch (error) {
    availableUpdate.set(null);
    updateStatus.set("error");
    updateError.set(String(error));
  }
}

/** Downloads the update the check found, reporting progress. */
export async function downloadNow(): Promise<void> {
  const found = availableUpdate();
  if (!found || updateStatus() !== "available" || !found.canInstall) return;
  updateStatus.set("downloading");
  updateError.set(null);
  updateProgress.set({ received: 0, total: null });
  try {
    await service.download((progress) => {
      const received = Number(progress?.received ?? 0);
      const total = typeof progress?.total === "number" ? progress.total : null;
      updateProgress.set({ received, total });
    });
    updateStatus.set("ready");
  } catch (error) {
    updateStatus.set("error");
    updateError.set(String(error));
    updateProgress.set(null);
  }
}

/**
 * Replaces the app and restarts it. The promise settles only on failure
 * (on success the process is gone), so a resolved call stays "installing"
 * rather than claiming an install that did not happen.
 */
export async function installNow(): Promise<void> {
  if (updateStatus() !== "ready") return;
  updateStatus.set("installing");
  updateError.set(null);
  try {
    await service.install();
  } catch (error) {
    updateStatus.set("error");
    updateError.set(String(error));
  }
}

/** A test hook: back to the idle state without touching the real updater. */
export function resetUpdates(): void {
  updatesOpen.set(false);
  updateStatus.set("idle");
  updateError.set(null);
  availableUpdate.set(null);
  updateProgress.set(null);
}

/** `1234567` as `1.2 MB` (binary units; the progress row's label). */
export function formatBytes(bytes: number | null | undefined): string {
  const value = Number(bytes ?? 0);
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  const rounded = size >= 10 || unit === 0 || Number.isInteger(size) ? String(Math.round(size)) : size.toFixed(1);
  return `${rounded} ${units[unit]}`;
}
