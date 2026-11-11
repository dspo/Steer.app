import { signal } from "nsh";
import { request } from "./engine";
import type { SettingsData } from "./contracts/protocol";

/**
 * The shell's window furniture (`zu/settings.json`, via `settings.*`): what
 * the user arranges that is not a container, a project or a layout. A write
 * merges over the file engine-side, so a drag survives a restart and a
 * newer build's keys survive an older one.
 */

/** The sidebar's width, clamped (DESIGN §3: draggable 200–360). */
export const SIDEBAR_MIN_WIDTH = 200;
export const SIDEBAR_MAX_WIDTH = 360;
export const SIDEBAR_DEFAULT_WIDTH = 232;

export const sidebarWidth = signal(SIDEBAR_DEFAULT_WIDTH);

type SettingsTransport = (type: string, payload?: Record<string, unknown>, timeoutMs?: number) => Promise<any>;
let transport: SettingsTransport = request;

/** Replaces the engine transport (tests drive the store without a sidecar). */
export function setSettingsTransport(next: SettingsTransport | null): void {
  transport = next ?? request;
}

/** The stored width a drag starts from; a failed read keeps the default. */
export async function loadSettings(): Promise<void> {
  try {
    const data = (await transport("settings.get", {}, 10000)) as SettingsData;
    if (typeof data?.sidebarWidth === "number") sidebarWidth.set(clampSidebarWidth(data.sidebarWidth));
  } catch {
    // The default stands; the next drag writes the file.
  }
}

/** Clamps a width into the draggable range, on whole points. */
export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return SIDEBAR_DEFAULT_WIDTH;
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)));
}

/** Applies a drag's width at once and persists it (fire-and-forget). */
export function setSidebarWidth(width: number): void {
  const clamped = clampSidebarWidth(width);
  sidebarWidth.set(clamped);
  void transport("settings.put", { sidebarWidth: clamped }, 10000).catch(() => {
    // The width stays for this run; the next drag writes again.
  });
}
