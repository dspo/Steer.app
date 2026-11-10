import { expect, open, test } from "nsh/test";

// M10's real-page acceptance. A target that draws the app loads the pages
// below and the tab titles/history buttons come from the WKWebView itself:
//
//   nsh test browser.live.test.tsx --target macos
//
// The headless host draws no web view, so there the test checks the sheet's
// default page and returns (the same command without `--target` passes
// trivially; that is not evidence of a page). The screenshots are written to
// docs/evidence/ by the `--target macos` run.

/** Whether this run draws the app (a screenshot exists only on a real target). */
async function drawsTheApp(app: any): Promise<boolean> {
  try {
    const shot = await app.screenshot();
    return shot.length > 0;
  } catch {
    return false;
  }
}

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

test(
  "the browser sheet loads a real page, a document page and a search, and walks history",
  async () => {
    const app = await open("./fixtures/browser.tsx", {
      width: 1100,
      height: 800,
      network: "live",
    });
    await app.waitFor("id:open-browser");
    await app.press("id:open-browser");
    await app.waitFor("id:browser-address");

    if (!(await drawsTheApp(app))) {
      // Headless: nothing loads. The default page is still the sheet's state.
      expect(app.count("id:browser-empty")).toBe(1);
      return;
    }

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
