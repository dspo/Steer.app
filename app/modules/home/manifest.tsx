import { K, t } from "../../ui/i18n";
import { StartPage } from "./launcher";
import type { SheetModule } from "../../../contracts/module";

/**
 * The container start page (`home:{containerId}` / `home:scratch`).
 *
 * It is a module like any other: the shell owns the *relationship* (a
 * container's empty canvas shows its start page) and this module owns the
 * content. Its tiles are launcher contributions from the modules that own
 * the objects (docs/sheet-module-ARCHITECTURE.md §8); this module resolves
 * the attributes and draws, and knows no harness.
 */
export const homeModule: SheetModule = {
  id: "home",
  kinds: [
    {
      kind: "home",
      title: () => t(K.launcher.title),
      body: ({ id }) => <StartPage id={id} />,
      glyph: "pi",
      tint: "brand",
      parse: (id) => (id.startsWith("home:") ? id.slice("home:".length) : null),
    },
  ],
};
