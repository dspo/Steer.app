/**
 * The manox capability's typed face: the in-proc AHP pump and the host's
 * callable model catalogue.
 *
 * Only `app/domains/` may import `manox/native` (docs/sheet-module-ARCHITECTURE.md
 * §5).
 */
import { Manox as NativeManox } from "manox/native";
export type { ManoxFrame } from "manox/native";
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
