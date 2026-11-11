import { signal, WebView, type WebViewNavigation } from "nsh";
import { appendSheet, panelIds } from "./dock";
import { activeContainerId, layout, setLayout } from "./containers";
import { K, t } from "./i18n";

/**
 * The browser store: one page per sheet id (`webview:{containerId}:{n}`),
 * held here rather than in the sheet component so a container switch or a
 * remount keeps the address and the title.
 *
 * This is UI state only. A page's `postMessage` lands in `messages` and is
 * drawn in the sheet's log; nothing here imports the engine or the wire, and
 * no page content is ever sent to pi. `injectJavaScript` is not used at all:
 * the address and title come from `onNavigationStateChange`.
 */

export interface BrowserError {
  /** `ERR_ACCESS_DENIED`, `ERR_FEATURE_UNAVAILABLE_ON_PLATFORM`, or a platform code. */
  code: string;
  message: string;
}

export interface BrowserPageState {
  /** The last page the web view reported (what a remount loads). */
  url: string | null;
  /** The page's own title, as last reported. */
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  error: BrowserError | null;
  /** Page `postMessage` data, newest last. Display only. */
  messages: string[];
}

const EMPTY_PAGE: BrowserPageState = {
  url: null,
  title: "",
  loading: false,
  canGoBack: false,
  canGoForward: false,
  error: null,
  messages: [],
};

/** How many page messages a sheet keeps (the oldest fall off). */
export const BROWSER_MESSAGE_LIMIT = 50;

/** How much of one page message the log keeps (a page cannot fill the UI). */
export const BROWSER_MESSAGE_LIMIT_CHARS = 4096;

const pages = signal<Record<string, BrowserPageState>>({});

/** The browser state of every sheet, by id (read-only projection). */
export function browserPages(): Record<string, BrowserPageState> {
  return pages();
}

/** A sheet's browser state; a default page for an id not created yet. */
export function browserPage(id: string): BrowserPageState {
  return pages()[id] ?? EMPTY_PAGE;
}

/** Creates a sheet's state (opening it) without touching an existing one. */
export function ensureBrowserPage(id: string): BrowserPageState {
  const current = pages()[id];
  if (current) return current;
  const next: BrowserPageState = { ...EMPTY_PAGE, messages: [] };
  pages.set({ ...pages(), [id]: next });
  return next;
}

function patch(id: string, change: Partial<BrowserPageState>): void {
  const current = pages()[id] ?? EMPTY_PAGE;
  pages.set({ ...pages(), [id]: { ...current, ...change } });
}

/** The sheet id of browser instance `n` of a container (`n` starts at 1). */
export function browserSheetId(containerId: string, instance: number): string {
  return `webview:${containerId}:${instance}`;
}

/** A browser sheet id's container and instance, or null for another kind. */
export function parseBrowserSheetId(id: string): { containerId: string; instance: number } | null {
  const prefix = "webview:";
  if (!id.startsWith(prefix)) return null;
  const at = id.lastIndexOf(":");
  if (at < prefix.length) return null;
  const instance = Number(id.slice(at + 1));
  if (!Number.isInteger(instance) || instance < 1) return null;
  return { containerId: id.slice(prefix.length, at), instance };
}

/** The next free instance number of a container's browser sheets. */
export function nextBrowserInstance(containerId: string, ids: string[]): number {
  let highest = 0;
  for (const id of ids) {
    const parsed = parseBrowserSheetId(id);
    if (parsed?.containerId === containerId && parsed.instance > highest) highest = parsed.instance;
  }
  return highest + 1;
}

/** A container's browser sheet ids, in layout order. */
export function browserSheetsOf(containerId: string, ids: string[] = panelIds(layout())): string[] {
  return ids.filter((id) => parseBrowserSheetId(id)?.containerId === containerId);
}

/**
 * Opens a browser sheet in a container: the next instance number, so a
 * container can hold several. Returns the new sheet id, or null without a
 * container.
 */
export function openBrowserSheet(containerId: string | null = activeContainerId()): string | null {
  if (!containerId) return null;
  const ids = [...panelIds(layout()), ...Object.keys(pages())];
  const id = browserSheetId(containerId, nextBrowserInstance(containerId, ids));
  ensureBrowserPage(id);
  setLayout(appendSheet(layout(), id));
  return id;
}

/** Forgets every browser sheet of a container (archive). */
export function dropBrowserPages(containerId: string): void {
  const next: Record<string, BrowserPageState> = {};
  for (const [id, page] of Object.entries(pages())) {
    if (parseBrowserSheetId(id)?.containerId !== containerId) next[id] = page;
  }
  pages.set(next);
}

/** The address bar asked for a page: the sheet shows it and starts loading. */
export function setBrowserNavigating(id: string, url: string): void {
  patch(id, { url, loading: true, error: null });
}

/** The web view's own report (load start/finish, URL, title, history). */
export function applyBrowserNavigation(id: string, navigation: WebViewNavigation): void {
  const current = pages()[id] ?? EMPTY_PAGE;
  const url =
    navigation.url && navigation.url !== "about:blank" ? navigation.url : current.url;
  patch(id, {
    url,
    title: navigation.title ?? "",
    loading: navigation.loading,
    canGoBack: navigation.canGoBack,
    canGoForward: navigation.canGoForward,
    // A navigation that starts clears the previous page's failure; an
    // `onError` that follows sets it again.
    error: null,
  });
}

/** A load failed (capability, platform, or the page). */
export function reportBrowserError(
  id: string,
  error: { message: string; code?: string | null },
): void {
  patch(id, {
    loading: false,
    error: {
      code: error.code || "ERR_BROWSER",
      message: error.message,
    },
  });
}

/** The user pressed stop; the platform reports the rest. */
export function setBrowserStopped(id: string): void {
  patch(id, { loading: false });
}

/** A page called `window.nsh.postMessage`: keep it in the sheet's log only. */
export function logBrowserMessage(id: string, data: string): void {
  const current = pages()[id] ?? EMPTY_PAGE;
  const text = data.length > BROWSER_MESSAGE_LIMIT_CHARS ? `${data.slice(0, BROWSER_MESSAGE_LIMIT_CHARS)}…` : data;
  const messages = [...current.messages, text];
  patch(id, { messages: messages.slice(-BROWSER_MESSAGE_LIMIT) });
}

/** Empties a sheet's page-message log. */
export function clearBrowserMessages(id: string): void {
  patch(id, { messages: [] });
}

/** The tab title: the page's title, else its address, else "New tab". */
export function browserTabTitle(id: string): string {
  const page = browserPage(id);
  if (page.title.trim()) return page.title.trim();
  if (page.url) return page.url.replace(/^https?:\/\//, "") || page.url;
  return t(K.browser.newTab);
}

/* Platform availability -------------------------------------------------- */

export type BrowserPlatform = "unknown" | "available" | "unavailable";

/** Whether this platform shows web views (one answer for the process). */
export const browserPlatform = signal<BrowserPlatform>("unknown");

let platformProbe: Promise<boolean> | undefined;

/**
 * Asks `WebView.available()` once. It answers whether the platform draws web
 * views and the app's `webview` capability is granted; where it is false a
 * web view reports `ERR_FEATURE_UNAVAILABLE_ON_PLATFORM` /
 * `ERR_ACCESS_DENIED` instead of showing a page.
 */
export function probeBrowserPlatform(): Promise<boolean> {
  if (!platformProbe) {
    platformProbe = WebView.available()
      .then((available) => {
        browserPlatform.set(available ? "available" : "unavailable");
        return available;
      })
      .catch(() => {
        browserPlatform.set("unavailable");
        return false;
      });
  }
  return platformProbe;
}

/* Address normalization -------------------------------------------------- */

export type AddressResult =
  | { ok: true; url: string }
  | { ok: false; reason: "empty" | "invalid" | "unsupported" };

const SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):/;
const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;

function splitAuthority(url: string): string | null {
  const at = url.indexOf("://");
  if (at < 0) return null;
  const after = url.slice(at + 3);
  const end = after.search(/[/?#]/);
  return end < 0 ? after : after.slice(0, end);
}

function hostOf(authority: string): string {
  let host = authority;
  const user = host.lastIndexOf("@");
  if (user >= 0) host = host.slice(user + 1);
  if (host.startsWith("[")) {
    const close = host.indexOf("]");
    return close < 0 ? "" : host.slice(1, close);
  }
  const colon = host.lastIndexOf(":");
  if (colon >= 0 && /^\d*$/.test(host.slice(colon + 1))) host = host.slice(0, colon);
  return host;
}

function validAuthority(authority: string): boolean {
  if (!authority || /\s/.test(authority)) return false;
  let host = authority;
  const user = host.lastIndexOf("@");
  if (user >= 0) host = host.slice(user + 1);
  if (host.startsWith("[")) {
    const close = host.indexOf("]");
    if (close < 0) return false;
    const literal = host.slice(1, close);
    if (!literal || !/^[0-9A-Fa-f:.]+$/.test(literal)) return false;
    const after = host.slice(close + 1);
    return after === "" || /^:\d{1,5}$/.test(after);
  }
  const colon = host.lastIndexOf(":");
  let port: string | null = null;
  if (colon >= 0) {
    port = host.slice(colon + 1);
    host = host.slice(0, colon);
  }
  if (!host) return false;
  if (port !== null && (!/^\d{1,5}$/.test(port) || Number(port) > 65535)) return false;
  return !host.startsWith(".") && !host.endsWith(".");
}

function looksLikeBareHost(authority: string): boolean {
  const host = hostOf(authority);
  if (!host) return false;
  if (host === "localhost") return true;
  if (host.includes(":")) return true; // an IPv6 literal
  if (IPV4.test(host)) return host.split(".").every((part) => Number(part) <= 255);
  return host.includes(".");
}

/**
 * Turns what the address bar holds into a page URL: a bare domain becomes
 * `https://`, http/https is kept, and anything else (a non-web scheme, or
 * text that is not a host) is refused rather than guessed at.
 */
export function normalizeAddress(raw: string): AddressResult {
  const text = raw.trim();
  if (!text) return { ok: false, reason: "empty" };
  if (/\s/.test(text)) return { ok: false, reason: "invalid" };

  let url: string;
  let bare = false;
  const scheme = SCHEME.exec(text);
  // `localhost:47834` and `example.com:8080` are hosts with ports, not
  // schemes: a host-shaped prefix takes the bare-domain path (and a bad port
  // is then refused as an address, not as a scheme).
  const hostPrefix = scheme ? scheme[1] : "";
  if (scheme && looksLikeBareHost(hostPrefix)) {
    url = `https://${text}`;
    bare = true;
  } else if (scheme) {
    const name = scheme[1].toLowerCase();
    if (name !== "http" && name !== "https") return { ok: false, reason: "unsupported" };
    url = `${name}:${text.slice(scheme[0].length)}`;
  } else if (text.startsWith("//")) {
    url = `https:${text}`;
    bare = true;
  } else {
    url = `https://${text}`;
    bare = true;
  }

  const authority = splitAuthority(url);
  if (!authority || !validAuthority(authority)) return { ok: false, reason: "invalid" };
  if (bare && !looksLikeBareHost(authority)) return { ok: false, reason: "invalid" };
  return { ok: true, url };
}

/** The address bar's message for a refused address, or null. */
export function addressErrorMessage(result: AddressResult): string | null {
  if (result.ok) return null;
  if (result.reason === "unsupported") return t(K.browser.unsupportedAddress);
  if (result.reason === "empty") return null;
  return t(K.browser.invalidAddress);
}

/**
 * Runs before a page's own scripts: `target=_blank` links and `window.open`
 * would leave the sheet (nsh has no new-window callback), so they are turned
 * into a host message and the sheet navigates itself. The page never reaches
 * the wire or the agent; this only moves the sheet.
 */
export const EXTERNAL_OPEN_SCRIPT = `(() => {
  const post = (url) => {
    try { window.nsh && window.nsh.postMessage(JSON.stringify({ type: "zu.open", url: String(url) })); } catch {}
  };
  window.open = function (url) { if (url) post(url); return null; };
  document.addEventListener("click", (event) => {
    const link = event.target && event.target.closest && event.target.closest("a[target=_blank]");
    if (!link || !link.href) return;
    event.preventDefault();
    post(link.href);
  }, true);
})();`;

/** The URL in a page's `zu.open` message, or null for anything else. */
export function externalOpenUrl(data: string): string | null {
  try {
    const parsed = JSON.parse(data);
    if (parsed && parsed.type === "zu.open" && typeof parsed.url === "string" && parsed.url) {
      return parsed.url;
    }
  } catch {
    // Not a host message.
  }
  return null;
}
