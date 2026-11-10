import { expect, test } from "nsh/test";
import {
  BROWSER_MESSAGE_LIMIT,
  BROWSER_MESSAGE_LIMIT_CHARS,
  addressErrorMessage,
  applyBrowserNavigation,
  browserPage,
  browserSheetId,
  browserTabTitle,
  clearBrowserMessages,
  dropBrowserPages,
  ensureBrowserPage,
  logBrowserMessage,
  nextBrowserInstance,
  normalizeAddress,
  parseBrowserSheetId,
  reportBrowserError,
  setBrowserNavigating,
  setBrowserStopped,
} from "./browser";
import { K, t } from "./i18n";

// The browser store and the address bar, without a web view: the headless
// host draws none, so its UI test covers rendering while these cover the
// address policy, the stable sheet ids and the state that must survive a
// remount. The capability declaration itself is checked by the Rust test in
// `src/lib.rs`, which reads `nsh.json`.

test("the address bar normalizes bare domains and refuses what it will not open", () => {
  expect(normalizeAddress("  example.com  ")).toEqual({ ok: true, url: "https://example.com" });
  expect(normalizeAddress("example.com/docs?q=1#top")).toEqual({
    ok: true,
    url: "https://example.com/docs?q=1#top",
  });
  expect(normalizeAddress("localhost:47834/docs")).toEqual({
    ok: true,
    url: "https://localhost:47834/docs",
  });
  expect(normalizeAddress("127.0.0.1:3000")).toEqual({ ok: true, url: "https://127.0.0.1:3000" });
  expect(normalizeAddress("HTTP://Example.com/Path")).toEqual({
    ok: true,
    url: "http://Example.com/Path",
  });
  expect(normalizeAddress("https://[::1]:8443/")).toEqual({ ok: true, url: "https://[::1]:8443/" });

  // Not a URL at all: bare words, spaces and broken ports are refused rather
  // than becoming a search or a guessed host.
  expect(normalizeAddress("")).toEqual({ ok: false, reason: "empty" });
  expect(normalizeAddress("   ")).toEqual({ ok: false, reason: "empty" });
  expect(normalizeAddress("hello world")).toEqual({ ok: false, reason: "invalid" });
  expect(normalizeAddress("example")).toEqual({ ok: false, reason: "invalid" });
  expect(normalizeAddress("example.com:port")).toEqual({ ok: false, reason: "invalid" });
  expect(normalizeAddress(".example.com")).toEqual({ ok: false, reason: "invalid" });
  expect(normalizeAddress("https://")).toEqual({ ok: false, reason: "invalid" });

  // Only the web is opened from the address bar.
  expect(normalizeAddress("javascript:alert(1)")).toEqual({ ok: false, reason: "unsupported" });
  expect(normalizeAddress("file:///etc/passwd")).toEqual({ ok: false, reason: "unsupported" });
  expect(normalizeAddress("data:text/html,hi")).toEqual({ ok: false, reason: "unsupported" });
  expect(normalizeAddress("about:blank")).toEqual({ ok: false, reason: "unsupported" });

  expect(addressErrorMessage({ ok: false, reason: "empty" })).toBeNull();
  expect(addressErrorMessage({ ok: false, reason: "invalid" })).toBe(t(K.browser.invalidAddress));
  expect(addressErrorMessage({ ok: false, reason: "unsupported" })).toBe(
    t(K.browser.unsupportedAddress),
  );
  expect(addressErrorMessage({ ok: true, url: "https://example.com" })).toBeNull();
});

test("a browser sheet id keeps its container even when the container id has colons", () => {
  expect(browserSheetId("pi:abc", 1)).toBe("webview:pi:abc:1");
  expect(parseBrowserSheetId("webview:pi:abc:1")).toEqual({ containerId: "pi:abc", instance: 1 });
  expect(parseBrowserSheetId("webview:external:terminal:u:12")).toEqual({
    containerId: "external:terminal:u",
    instance: 12,
  });
  expect(parseBrowserSheetId("webview:pi:abc:0")).toBeNull();
  expect(parseBrowserSheetId("webview:pi:abc:x")).toBeNull();
  expect(parseBrowserSheetId("files:pi:abc")).toBeNull();

  // Multiple sheets per container, numbered without reusing a closed one.
  const ids = ["webview:pi:a:1", "webview:pi:a:3", "webview:pi:b:9", "session:s1"];
  expect(nextBrowserInstance("pi:a", ids)).toBe(4);
  expect(nextBrowserInstance("pi:c", ids)).toBe(1);
});

test("the page state survives a remount and page messages stay in the log", () => {
  const id = browserSheetId("pi:store", 1);
  expect(browserPage(id).url).toBeNull();
  expect(browserTabTitle(id)).toBe(t(K.browser.newTab));

  ensureBrowserPage(id);
  setBrowserNavigating(id, "https://example.com/");
  expect(browserPage(id).url).toBe("https://example.com/");
  expect(browserPage(id).loading).toBe(true);

  applyBrowserNavigation(id, {
    url: "https://example.com/",
    title: "Example Domain",
    loading: false,
    canGoBack: true,
    canGoForward: false,
  });
  expect(browserPage(id)).toMatchObject({
    url: "https://example.com/",
    title: "Example Domain",
    loading: false,
    canGoBack: true,
    canGoForward: false,
    error: null,
  });
  expect(browserTabTitle(id)).toBe("Example Domain");

  // A failure carries its code; a new navigation clears it.
  reportBrowserError(id, { code: "ERR_ACCESS_DENIED", message: "not granted" });
  expect(browserPage(id).error).toEqual({ code: "ERR_ACCESS_DENIED", message: "not granted" });
  expect(browserPage(id).loading).toBe(false);
  applyBrowserNavigation(id, {
    url: "https://example.com/next",
    title: "Next",
    loading: true,
    canGoBack: true,
    canGoForward: false,
  });
  expect(browserPage(id).error).toBeNull();
  expect(browserPage(id).title).toBe("Next");
  setBrowserStopped(id);
  expect(browserPage(id).loading).toBe(false);

  // The page title wins in the tab; without one the address does.
  applyBrowserNavigation(id, {
    url: "https://example.com/next",
    title: "",
    loading: false,
    canGoBack: true,
    canGoForward: false,
  });
  expect(browserTabTitle(id)).toBe("example.com/next");

  // Page messages are capped, newest last, and clear on demand.
  for (let index = 0; index < BROWSER_MESSAGE_LIMIT + 5; index++) {
    logBrowserMessage(id, `message ${index}`);
  }
  const messages = browserPage(id).messages;
  expect(messages.length).toBe(BROWSER_MESSAGE_LIMIT);
  expect(messages[messages.length - 1]).toBe(`message ${BROWSER_MESSAGE_LIMIT + 4}`);
  expect(messages[0]).toBe("message 5");
  clearBrowserMessages(id);
  expect(browserPage(id).messages).toEqual([]);

  // One huge page message is clipped for the UI.
  logBrowserMessage(id, "x".repeat(BROWSER_MESSAGE_LIMIT_CHARS + 10));
  expect(browserPage(id).messages[0].length).toBe(BROWSER_MESSAGE_LIMIT_CHARS + 1);

  // Archiving a container drops only its sheets.
  const other = browserSheetId("pi:other", 1);
  ensureBrowserPage(other);
  setBrowserNavigating(other, "https://example.org/");
  dropBrowserPages("pi:store");
  expect(browserPage(id).url).toBeNull();
  expect(browserPage(other).url).toBe("https://example.org/");
});
