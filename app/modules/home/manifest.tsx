import { K, t } from "../../ui/i18n";
import { HeroSheet } from "./hero";
import type { SheetModule } from "../../../contracts/module";

/**
 * The container start page (`home:{containerId}` / `home:scratch`).
 *
 * It is a module like any other: the shell owns the *relationship* (a
 * container's empty canvas shows its start page) and this module owns the
 * content. The Hero's harness starters and tool rows are contributions from
 * the modules that provide them (docs/sheet-module-ARCHITECTURE.md §8).
 */
export const homeModule: SheetModule = {
  id: "home",
  kinds: [
    {
      kind: "home",
      title: () => t(K.sheet.homeTitle),
      body: ({ id }) => <HeroSheet id={id} />,
      glyph: "pi",
      tint: "brand",
      parse: (id) => (id.startsWith("home:") ? id.slice("home:".length) : null),
    },
  ],
};
