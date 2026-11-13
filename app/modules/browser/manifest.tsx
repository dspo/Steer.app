import { browserTabTitle, dropBrowserPages, openBrowserSheet } from "./store";
import { BrowserBody } from "./view";
import { K, t } from "../../ui/i18n";
import type { SheetModule } from "../../../contracts/module";

/**
 * The browser sheet (`webview:{containerId}:{n}`). It consumes no native
 * capability — `nsh`'s `WebView` is enough — which makes it the proof that a
 * zero-native module is a full citizen (docs/sheet-module-ARCHITECTURE.md §9).
 */
export const browserModule: SheetModule = {
  id: "browser",
  capabilities: [],
  titlebar: [
    {
      id: "open-browser",
      label: () => t(K.browser.open),
      glyph: "globe",
      testID: "open-browser",
      order: 20,
      onPress: () => openBrowserSheet(),
    },
  ],
  intents: {
    "browser.open": (payload) => {
      const { containerId = null, replace } = (payload ?? {}) as { containerId?: string | null; replace?: string };
      return openBrowserSheet(containerId, replace);
    },
  },
  onContainerArchive: (containerId) => dropBrowserPages(containerId),
  kinds: [
    {
      kind: "webview",
      title: (id) => browserTabTitle(id),
      body: ({ id }) => <BrowserBody id={id} />,
      glyph: "globe",
      tint: "info",
      parse: (id) => (id.startsWith("webview:") ? id.slice("webview:".length) : null),
    },
  ],
};
