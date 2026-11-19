import { expect, open, test } from "nsh/test";
import { Fs } from "zu/native";

// M10's real-page acceptance. A target that draws the app loads the pages
// below and the tab titles/history buttons come from the WKWebView itself:
//
//   ZU_BROWSER_LIVE=1 nsh test app/tests/browser.live.test.tsx --target macos
//
// The headless host draws no web view, so there the test checks the sheet's
// default page and returns (the same command without `--target` passes
// trivially; that is not evidence of a page). The screenshots are written to
// docs/evidence/ by the explicit `--target macos` run; CI's headless test
// stage must never wait on real network pages.

const FILE_PAGE = "/tmp/zu-visualize-live.html";
const FILE_HTML = '<!doctype html><meta charset="utf-8"><title>Zu visualize live</title><h1>Zu visualize file page</h1><script>window.postMessage("visualize-live-script")</script>';

/** Only an explicit macOS live run loads network pages and writes evidence. */
const liveBrowserTest = process.env?.["ZU_BROWSER_LIVE"] === "1" ? test : test.skip;

function browserLine(app: any): string {
  return app.texts().find((text: string) => text.startsWith("webview:") && text.includes("|")) ?? "";
}

async function load(app: any, address: string, title: string | RegExp): Promise<void> {
  const host = address.replace(/^https?:\/\//, "").split(/[/?#]/)[0];
  await app.clear("id:browser-address");
  await app.type("id:browser-address", address);
  await app.submit("id:browser-address");
  // The tab title changes before the page finishes; wait for the store's own
  // final state (this sheet's URL, title, idle, no error) so the next load
  // does not cancel this one.
  await app.waitUntil(
    () => {
      const fields = browserLine(app).split("|");
      if (fields.length < 7) return false;
      const pageTitle = fields[2] ?? "";
      const matches = typeof title === "string" ? pageTitle.includes(title) : title.test(pageTitle);
      return (
        (fields[1] ?? "").includes(host) &&
        matches &&
        fields[3] === "idle" &&
        fields[5] === "-"
      );
    },
    { timeout: 45000 },
  );
}

liveBrowserTest(
  "the browser sheet loads a real page, a document page and a search, and walks history",
  async () => {
    await Fs.write("/tmp", "zu-visualize-live.html", FILE_HTML, null, "utf-8");
    const app = await open("../fixtures/browser.tsx", {
      width: 1100,
      height: 800,
      network: "live",
    });
    await app.waitFor("id:titlebar-tools");
    await app.press("id:titlebar-tools");
    await app.press("id:open-browser");
    await app.waitFor("id:browser-address");

    // The visualize host path: a file:// URL that the address bar itself
    // refuses, opened directly from a tool-generated artifact. The title,
    // heading and script message come from the WKWebView, not from the store.
    await app.press("id:open-file-page");
    await app.waitUntil(
      () => {
        const fields = browserLine(app).split("|");
        return fields[2] === "Zu visualize live" && fields[3] === "idle" && fields[5] === "-";
      },
      { timeout: 45000 },
    );
    expect(app.texts()).toContain("Zu visualize file page");
    expect(app.texts()).toContain("visualize-live-script");
    await app.screenshot("docs/evidence/visualize-file-page.png");

    // A bare domain through the address bar really loads.
    await load(app, "example.com", "Example Domain");
    expect(app.texts()).toContain("Example Domain");
    await app.screenshot("docs/evidence/m10-browser-example.png");
    await app.setColorScheme("dark");
    await app.screenshot("docs/evidence/m10-browser-example-dark.png");
    await app.setColorScheme("light");

    // A documentation page, then a search results page: both are real
    // navigations through the web view.
    await load(app, "https://www.iana.org/help/example-domains", "Example Domains");
    await load(app, "https://lite.duckduckgo.com/lite/?q=native+shell", "DuckDuckGo");
    expect(app.texts().some((text: string) => text.includes("native shell at DuckDuckGo"))).toBe(true);
    await app.screenshot("docs/evidence/m10-browser-search.png");

    // Back and forward are the web view's own history.
    expect(app.enabled("id:browser-back")).toBe(true);
    await app.press("id:browser-back");
    await app.waitUntil(() => app.texts().some((text) => text.includes("Example Domains")), {
      timeout: 45000,
    });
    expect(app.enabled("id:browser-forward")).toBe(true);
    await app.press("id:browser-forward");
    await app.waitUntil(() => app.texts().some((text) => text.includes("native shell at DuckDuckGo")), {
      timeout: 45000,
    });

    // The sheet's error and page-message states (fed by the fixture through
    // the same reducers the web view's events use: this is UI evidence, not
    // a real refusal).
    await app.press("id:seed-error");
    await app.waitFor("id:browser-error");
    await app.screenshot("docs/evidence/m10-browser-error.png");
    await app.press("id:seed-message");
    await app.press("id:browser-log-toggle");
    await app.waitFor("id:browser-message-log");
    await app.screenshot("docs/evidence/m10-browser-messages.png");
  },
  120000,
);
