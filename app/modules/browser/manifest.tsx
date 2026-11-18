import { browserTabTitle, createBrowserContainer, dropBrowserPages, openBrowserSheet } from "./store";
import { BrowserBody } from "./view";
import { K, t } from "../../ui/i18n";
import { activeContainerId, containerError } from "../../core/containers";
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
      onPress: () => {
        const containerId = activeContainerId();
        if (containerId) openBrowserSheet(containerId);
        else
          void createBrowserContainer(null, null).catch((error) =>
            containerError.set(error instanceof Error ? error.message : String(error)),
          );
      },
    },
  ],
  intents: {
    "browser.open": (payload) => {
      const { containerId = null, url } = (payload ?? {}) as {
        containerId?: string | null;
        url?: string;
      };
      // A page is a container's resource; the start page mints one for an
      // external browser. An intent without a container has nothing to open.
      if (!containerId) return null;
      return openBrowserSheet(containerId, url);
    },
  },
  launchers: [
    {
      id: "browser",
      label: () => t(K.browser.open),
      glyph: "globe",
      group: "tool",
      order: 20,
      instantiate: async (context) => {
        if (context.containerId) {
          openBrowserSheet(context.containerId);
          return;
        }
        await createBrowserContainer(context.projectId, context.cwd);
      },
    },
  ],
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
