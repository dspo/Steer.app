import { signal } from "nsh";
import { PiModels, type PiModelInfo, type PiProvider } from "zu/native";

export type { PiModelInfo, PiProvider } from "zu/native";

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
/** One load at a time: the Hero, the composer and the conversation all ask
 * for the catalogue, and a reload per caller (or per channel envelope) meant
 * a fresh array on every request and a re-render storm behind it. */
let catalogLoad: Promise<void> | null = null;

export function loadPiModels(): Promise<void> {
  if (catalogLoad) return catalogLoad;
  catalogLoad = (async () => {
    try {
      providersSignal.set(await PiModels.list());
      errorSignal.set(null);
    } catch (failure) {
      errorSignal.set(String(failure));
    } finally {
      catalogLoad = null;
    }
  })();
  return catalogLoad;
}

/** pi's reasoning-effort ladder, low to high (the composer's own order). */
export const PI_EFFORTS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

/** pi's `api` value onto the manox kernel's endpoint wire key (the same map
 * `native/manox`'s provider bridge applies when registering). */
export function wireKey(api: string | null | undefined): string | null {
  switch (api) {
    case "anthropic-messages":
    case "anthropic":
      return "anthropic";
    case "openai-completions":
    case "openai-chat":
    case "completions":
      return "completions";
    case "openai-responses":
    case "responses":
      return "responses";
    default:
      return null;
  }
}

/** The model ref the manox kernel resolves: registration-qualified
 * `{provider}-{wire}/{model}` (register_providers names every endpoint
 * `{cx_name}-{wire_api}`, and `resolve_model_ref` pins the endpoint on a
 * `provider/id` exact match). Falls back to the bare pi ref. */
export function manoxModelRef(row: { provider: PiProvider; model: PiModelInfo }): string {
  const wire = wireKey(row.provider.api);
  return wire ? `${row.provider.id}-${wire}/${row.model.id}` : modelId(row.provider.id, row.model.id);
}
