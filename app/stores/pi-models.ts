import { signal } from "nsh";
import { PiModels, type PiModelInfo, type PiProvider } from "zu/native";

/**
 * The machine's pi model configuration — the single model source for BOTH
 * harnesses' pickers (user ruling, 2026-11-13: the manox harness does not
 * use its cx provider config here). One snapshot per load, refreshed on
 * demand; pi's `~/.pi/agent` stays the authority.
 */

const providersSignal = signal<PiProvider[] | null>(null);
const errorSignal = signal<string | null>(null);

/** The providers with their models, credentials-first; null before load. */
export function piProviders(): PiProvider[] | null {
  return providersSignal();
}

/** Why the last refresh failed, when it did (a coded native error). */
export function piModelsError(): string | null {
  return errorSignal();
}

/** The models a picker offers: only providers with credentials, in pi's order. */
export function usableModels(): Array<{ provider: PiProvider; model: PiModelInfo }> {
  const rows: Array<{ provider: PiProvider; model: PiModelInfo }> = [];
  for (const provider of providersSignal() ?? []) {
    if (!provider.hasAuth) continue;
    for (const model of provider.models) rows.push({ provider, model });
  }
  return rows;
}

/** The canonical id the harnesses' config takes: `provider/model`. */
export function modelId(provider: string, model: string): string {
  return `${provider}/${model}`;
}

/** The display label: the model's own name, else its id. */
export function modelLabel(row: { provider: PiProvider; model: PiModelInfo }): string {
  return row.model.name || row.model.id;
}

/** Loads (or reloads) the snapshot. A failure keeps the previous rows and
 * records the error — an empty picker with a reason, never a throw. */
export async function loadPiModels(): Promise<void> {
  try {
    providersSignal.set(await PiModels.list());
    errorSignal.set(null);
  } catch (failure) {
    errorSignal.set(String(failure));
  }
}

/** pi's reasoning-effort ladder, low to high (the composer's own order). */
export const PI_EFFORTS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
