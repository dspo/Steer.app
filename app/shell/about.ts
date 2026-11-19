import { platform, signal } from "nsh";
import { K, t } from "../ui/i18n";
import { refreshUpdateEnv, updateEnv } from "./updates";

/**
 * The About dialog's state and data: what this run is and what it carries.
 * About is app-global — no module, project or container is involved — so the
 * shell owns it, and the assembly point (`App.tsx`) hands in the one version
 * the shell may not import (manox's, from the domain).
 *
 * The layout follows manox-app's about window: the app itself is the
 * headline, the stack beneath it is a version axis of label/value rows, and
 * a row with nothing to say is left out rather than shown empty. The copy
 * button writes the whole block, the way a bug report wants it.
 */

/** The dialog is open. */
export const aboutOpen = signal(false);

/** Opens the dialog, re-reading what this run is. */
export function openAbout(): void {
  refreshUpdateEnv();
  aboutOpen.set(true);
}

/** Closes the dialog. */
export function closeAbout(): void {
  aboutOpen.set(false);
}

/**
 * The Pi SDK the bundled pi-harness pins (`@earendil-works/pi-coding-agent`),
 * mirrored from `pi-harness/package.json` — whose own twin mirror is
 * `pi-harness/src/version.ts`, for the compiled binary. A packaged app can
 * read none of those files, so the shell carries the pin too;
 * `pi-harness/scripts/check-version.mjs` fails when the three drift apart.
 */
export const PI_SDK_VERSION = "1.5.0";

/** One axis row: a component of the stack and the version this run carries. */
export type AboutRow = { label: string; value: string };

/** The OS's display name (`macos` → `macOS`); a name we do not know passes
 * through, the way `platform.name` documents itself. */
function osName(os: string): string {
  switch (os) {
    case "macos":
      return "macOS";
    case "ios":
      return "iOS";
    case "android":
      return "Android";
    case "windows":
      return "Windows";
    case "linux":
      return "Linux";
    default:
      return os;
  }
}

/** What the headline says about this app itself: the installed shell's
 * version falling back to the build's — the updates dialog's rule — plus
 * whether this run is a development one. */
export function aboutHeadline(): { version: string; build: number | null; development: boolean } {
  const env = updateEnv();
  return {
    version: env.shellVersion ?? env.appVersion ?? "",
    build: env.shellBuild ?? env.appBuild,
    development: env.development,
  };
}

/** The headline's text: the app's name (a product name, both languages)
 * carries the version; the build number's annotation is the only translated
 * part. Without a version at all (no app info) it is just the name, and the
 * development note below explains the rest. */
export function aboutHeadlineText(): string {
  const head = aboutHeadline();
  if (!head.version) return "Zu";
  const base = `Zu ${head.version}`;
  return head.build !== null ? base + t(K.about.buildSuffix, { build: head.build }) : base;
}

/**
 * The version axis under the headline. The app's own row is the headline;
 * the Native Shell of a development run has no version to name, so its row
 * says the run is a development one instead.
 */
export function aboutRows(manoxVersion: string | null, ghosttyVersion: string | null): AboutRow[] {
  const rows: AboutRow[] = [];
  const nsh = updateEnv().nshVersion.trim();
  rows.push({ label: "Native Shell", value: nsh || t(K.about.development) });
  rows.push({ label: "Pi", value: PI_SDK_VERSION });
  if (manoxVersion?.trim()) rows.push({ label: "manox", value: manoxVersion.trim() });
  if (ghosttyVersion?.trim()) rows.push({ label: "Ghostty", value: ghosttyVersion.trim() });
  if (platform.version && platform.version !== "0.0") {
    rows.push({ label: "OS", value: `${osName(platform.os)} ${platform.version}` });
  }
  return rows;
}

/** A row's test id (`Native Shell` → `about-row-native-shell`). */
export function aboutRowTestID(row: AboutRow): string {
  return `about-row-${row.label.toLowerCase().replace(/\s+/g, "-")}`;
}

/** The block the copy button writes: the headline, then every row. */
export function aboutClipboardText(headline: string, manoxVersion: string | null, ghosttyVersion: string | null): string {
  return [headline, ...aboutRows(manoxVersion, ghosttyVersion).map((row) => `${row.label} ${row.value}`)].join("\n");
}
