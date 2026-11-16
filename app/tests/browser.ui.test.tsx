import { expect, open, test } from "nsh/test";
import { K, t } from "../ui/i18n";

// The browser sheet in the real Workbench, headless. The headless host
// draws no web view (`WebView.available()` is still true, but no page loads
// and no navigation event arrives), so a real page is covered only by
// `browser.live.test.tsx` on `--target macos`. Here the WebView's own events
// are fed through the fixture's seed buttons, which call the same reducers.

function pageDebug(app: { texts: () => string[] }): string {
  return app.texts().find((text) => text.includes("webview:") && text.includes("|")) ?? "";
}

async function address(app: { type: (selector: string, text: string) => Promise<void>; submit: (selector: string) => Promise<void> }, value: string) {
  await app.type("id:browser-address", value);
  await app.submit("id:browser-address");
}

test("the top bar opens browser sheets, and the address bar normalizes a domain", async () => {
  const app = await open("../fixtures/browser.tsx", { width: 1200, height: 800 });
  await app.waitFor("id:open-hero");
  // The Hero's Browser action is an entry too: it opens the sheet in the
  // active container and becomes a tab beside it.
  await app.press("id:open-hero");
  await app.waitFor("id:hero-browser");
  await app.press("id:hero-browser");
  await app.waitFor("id:browser-address");
  expect(app.shows("id:hero-browser")).toBe(false);
  // The browser took the Hero's tab; the Hero is gone, not beside it.
  expect(app.count("id:hero-input")).toBe(0);

  // The default page says what may load and where page messages go.
  expect(app.count("id:browser-empty")).toBe(1);
  expect(app.texts()).toContain(t(K.browser.emptyTitle));
  expect(app.texts()).toContain(t(K.browser.emptyLine));
  // The address bar's policy marker sits beside it.
  expect(app.count("id:browser-any-site")).toBe(1);
  expect(app.texts()).toContain(t(K.browser.anySite));

  // A new tab has no history: those controls are disabled, not hidden.
  expect(app.enabled("id:browser-back")).toBe(false);
  expect(app.enabled("id:browser-forward")).toBe(false);
  expect(app.enabled("id:browser-stop")).toBe(false);
  expect(app.enabled("id:browser-reload")).toBe(false);

  // A bare domain becomes https; the store and the address bar agree, and
  // the one web view for the sheet is mounted while the platform has one.
  await address(app, "example.com");
  await app.waitUntil(() => app.value("id:browser-address") === "https://example.com");
  expect(app.value("id:browser-address")).toBe("https://example.com");
  expect(pageDebug(app)).toContain("webview:pi:browser-fixture:1|https://example.com");
  expect(app.count("id:browser-page")).toBe(1);
  expect(app.enabled("id:browser-stop")).toBe(true);

  // The sheet's address bar has one web view; opening a second browser sheet
  // gives it the next instance number.
  await app.press("id:titlebar-tools");
  await app.press("id:open-browser");
  await app.waitUntil(() => pageDebug(app).includes("webview:pi:browser-fixture:2"));
  expect(app.count("id:browser-address")).toBe(1);
  expect(pageDebug(app)).toContain("webview:pi:browser-fixture:2");
});

test("the tab follows the page title, and a hidden sheet keeps its address", async () => {
  const app = await open("../fixtures/browser.tsx", { width: 1200, height: 800 });
  await app.waitFor("id:titlebar-tools");
  await app.press("id:titlebar-tools");
  await app.press("id:open-browser");
  await app.waitFor("id:browser-address");
  await address(app, "example.com");
  await app.waitUntil(() => app.value("id:browser-address") === "https://example.com");

  // The web view reports a page (the same reducer `onNavigationStateChange`
  // calls): its title reaches the tab and the history buttons wake up.
  await app.press("id:seed-nav");
  await app.waitUntil(() => app.texts().includes("Example Domain"));
  expect(app.texts()).toContain("Example Domain");
  expect(app.enabled("id:browser-back")).toBe(true);
  expect(app.enabled("id:browser-forward")).toBe(false);
  expect(pageDebug(app)).toContain("Example Domain");

  // Another browser sheet hides this one. The web view stays mounted (a
  // remount would load the page again), so the sheet comes back as it was:
  // its bar keeps what the user typed, its page keeps the page.
  await app.press("id:titlebar-tools");
  await app.press("id:open-browser");
  await app.waitUntil(() => pageDebug(app).includes("webview:pi:browser-fixture:2"));
  expect(app.value("id:browser-address")).toBe("");
  // The hidden sheet kept its state: closing the blank tab reveals the first
  // again, with its address back in the bar.
  await app.press("id:tab-close-webview:pi:browser-fixture:2");
  // The bar shows the address the user gave (the seeded navigation is the
  // fixture's, not the web view's, so no load event moved the draft).
  await app.waitUntil(() => app.value("id:browser-address") === "https://example.com");
  expect(app.value("id:browser-address")).toBe("https://example.com");
  // The page it kept is the one it had, not a fresh load.
  expect(pageDebug(app)).toContain("webview:pi:browser-fixture:1|https://example.com/|Example Domain");

  // A refusal is shown with its code; the platform-unavailable case uses the
  // same panel (the browser store's `failure`).
  await app.press("id:seed-error");
  await app.waitFor("id:browser-error");
  expect(app.texts()).toContain("ERR_ACCESS_DENIED");
  expect(app.count("id:browser-retry")).toBe(1);

  // Page messages are a visible log in the sheet and nothing else: feeding
  // one does not touch the engine transport.
  const callsBefore = app.texts().find((text) => text.startsWith("calls:")) ?? "";
  await app.press("id:seed-message");
  await app.press("id:browser-log-toggle");
  await app.waitFor("id:browser-message-log");
  expect(app.texts().some((text) => text.includes("hello from the page"))).toBe(true);
  expect(app.texts()).toContain(t(K.browser.messagesHint));
  await app.wait(50);
  expect(app.texts().find((text) => text.startsWith("calls:")) ?? "").toBe(callsBefore);

  // Clear empties the log (the count goes back to zero).
  await app.press("id:browser-clear-messages");
  await app.waitUntil(() => app.texts().includes(t(K.browser.messagesEmpty)));
  expect(app.texts()).toContain(t(K.browser.messagesEmpty));
});

test("a container switch keeps the browser address and title", async () => {
  const app = await open("../fixtures/browser.tsx", { width: 1200, height: 800 });
  await app.waitFor("id:titlebar-tools");
  await app.press("id:titlebar-tools");
  await app.press("id:open-browser");
  await app.waitFor("id:browser-address");
  await address(app, "example.com");
  await app.press("id:seed-nav");
  await app.waitUntil(() => app.texts().includes("Example Domain"));

  // The other container has no browser sheet; switching back finds the same
  // sheet body (a container switch shows another canvas, it does not rebuild
  // one): its bar keeps what was typed, and its page was never loaded again.
  await app.press("Open container zu-browser-2");
  await app.waitUntil(() => !app.shows("id:browser-address"));
  // The first container is titled by its earliest sheet — the page (S2).
  await app.press("Open container Example Domain");
  await app.waitFor("id:browser-address");
  expect(app.value("id:browser-address")).toBe("https://example.com");
  expect(app.texts()).toContain("Example Domain");
  expect(pageDebug(app)).toContain("webview:pi:browser-fixture:1");
});
