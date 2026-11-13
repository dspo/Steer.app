import { signal } from "nsh";
import { readState, writeState } from "../domains/state";
import type { SettingsData } from "../core/types";

/**
 * The shell's window furniture (`zu/settings.json`, via `zu/state`): what
 * the user arranges that is not a container, a project or a layout. Since
 * the v2 writer inversion this side owns the file — a write merges over it
 * here, so a drag survives a restart and a newer build's keys survive an
 * older one. The engine is not consulted.
 */

/** The sidebar's width, clamped (DESIGN §3: draggable 200–360). */
export const SIDEBAR_MIN_WIDTH = 200;
export const SIDEBAR_MAX_WIDTH = 360;
export const SIDEBAR_DEFAULT_WIDTH = 232;

export const sidebarWidth = signal(SIDEBAR_DEFAULT_WIDTH);

type SettingsTransport = (type: string, payload?: Record<string, unknown>, timeoutMs?: number) => Promise<any>;
let transport: SettingsTransport | null = null;

/**
 * Legacy hook: when set, reads and writes still ride the given transport
 * (fixtures and old tests). Null — the default, and the packaged app —
 * uses `zu/state` directly.
 */
export function setSettingsTransport(next: SettingsTransport | null): void {
  transport = next;
}

/** The stored width a drag starts from; a failed read keeps the default. */
export async function loadSettings(): Promise<void> {
  if (transport) {
    try {
      const data = (await transport("settings.get", {}, 10000)) as SettingsData;
      if (typeof data?.sidebarWidth === "number") sidebarWidth.set(clampSidebarWidth(data.sidebarWidth));
    } catch {
      // The default stands; the next drag writes the file.
    }
    return;
  }
  const data = await readState<SettingsData>("settings.json");
  if (typeof data?.sidebarWidth === "number") sidebarWidth.set(clampSidebarWidth(data.sidebarWidth));
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
  if (transport) {
    void transport("settings.put", { sidebarWidth: clamped }, 10000).catch(() => {
      // The width stays for this run; the next drag writes again.
    });
    return;
  }
  void writeState("settings.json", { sidebarWidth: clamped }).catch(() => {
    // The width stays for this run; the next drag writes again.
  });
}
