/**
 * The manox capability's typed face: the in-proc AHP pump and the host's
 * callable model catalogue.
 *
 * Only `app/domains/` may import `manox/native` (docs/sheet-module-ARCHITECTURE.md
 * §5).
 */
import { Manox as NativeManox, TitleBridge as NativeTitleBridge } from "manox/native";
export type { ManoxFrame } from "manox/native";

/**
 * The session's title bridge (issue #73): the kernel's bash tap feeds a
 * thread-scoped headless emulator; `open` posts each new OSC title. The
 * manox module's titles store reads it.
 */
export const TitleBridge = NativeTitleBridge;
export type TitleBridgeHandle = ReturnType<typeof NativeTitleBridge.open>;
export type { ModelCatalog, CatalogProvider, CatalogModel } from "manox/native";

/** nsh exposes JSObject fields as getters; normalise once for app consumers. */
type Getter<T> = T | (() => T);
function value<T>(field: Getter<T>): T {
  return typeof field === "function" ? (field as () => T)() : field;
}

function list<T>(field: Getter<T[]>): T[] {
  return value(field) ?? [];
}

export const Manox = {
  ...NativeManox,
  models: async () => {
    const catalog = await NativeManox.models();
    return {
      providers: list(catalog.providers).map((provider) => ({
        id: value(provider.id),
        name: value(provider.name),
        models: list(provider.models).map((model) => ({
          id: value(model.id),
          name: value(model.name),
          provider: value(model.provider),
          reference: value(model.reference),
          contextWindow: value(model.contextWindow),
          maxTokens: value(model.maxTokens),
          reasoning: value(model.reasoning),
          efforts: list(model.efforts),
        })),
      })),
    };
  },
};

/** The manox host's version — the build's one `tag = "v…"` pin, as the
 * native module read it from its Cargo.toml. Null when the native module is
 * not there to ask (a headless run, a second instance), so the About axis
 * can leave the row out. */
export function manoxVersion(): string | null {
  try {
    return value(NativeManox.version()).trim() || null;
  } catch {
    return null;
  }
}
