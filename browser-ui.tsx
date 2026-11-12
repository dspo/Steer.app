import { effect, Scroll, signal, Text, token, View, WebView, type WebViewNavigation, type WebViewRef } from "nsh";
import { Input } from "nsh/base";
import { visiblePanels } from "./stores/dock";
import {
  addressErrorMessage,
  applyBrowserNavigation,
  browserPage,
  browserPlatform,
  clearBrowserMessages,
  EXTERNAL_OPEN_SCRIPT,
  externalOpenUrl,
  logBrowserMessage,
  normalizeAddress,
  probeBrowserPlatform,
  reportBrowserError,
  setBrowserNavigating,
  setBrowserStopped,
} from "./stores/browser";
import { K, t } from "./ui/i18n";
import { Chip, Glyph, motionStyle, SheetIconButton } from "./ui/ui";

/**
 * The real browser sheet: an address bar over one native `WebView`, with the
 * page's title in the tab and the URL/loading/error state in `browser.ts`.
 *
 * Non-visible sheets are unmounted, not paused: nsh's `WebView` has no pause
 * prop. The address and title live in the store, so a remount reloads the
 * last page; the page's own runtime state (scroll, forms, in-page history) is
 * gone. The store is UI state only: page messages are appended to a log drawn
 * here and never reach the engine or the agent context.
 */

export function BrowserBody(props: { id: string }) {
  const shown = () => visiblePanels().includes(props.id);
  return (
    <If when={shown()} else={<HiddenBrowser />}>
      <BrowserSurface id={props.id} />
    </If>
  );
}

function HiddenBrowser() {
  return (
    <View class="flex-1 items-center justify-center gap-2 bg-background">
      <Glyph name="globe" size={20} tint={token("faint")} />
      <Text class="text-[11px] text-faint">{t(K.browser.hidden)}</Text>
    </View>
  );
}

function BrowserSurface(props: { id: string }) {
  const page = () => browserPage(props.id);
  const draft = signal(page().url ?? "");
  const src = signal(page().url ?? "");
  const web = signal<WebViewRef | null>(null);
  const editing = signal(false);
  const logOpen = signal(false);
  const addressError = signal<string | null>(null);

  effect(() => {
    if (browserPlatform() === "unknown") void probeBrowserPlatform();
  });

  const navigate = (raw: string) => {
    const result = normalizeAddress(raw);
    addressError.set(addressErrorMessage(result));
    if (!result.ok) return;
    const same = src() === result.url;
    setBrowserNavigating(props.id, result.url);
    if (same) web()?.reload();
    else src.set(result.url);
    draft.set(result.url);
  };

  const submit = () => navigate(draft());

  const onNavigation = (navigation: WebViewNavigation) => {
    applyBrowserNavigation(props.id, navigation);
    if (!editing() && navigation.url && navigation.url !== "about:blank") draft.set(navigation.url);
  };

  const back = () => web()?.goBack();
  const forward = () => web()?.goForward();
  const reload = () => {
    if (!page().url) return;
    setBrowserNavigating(props.id, page().url!);
    web()?.reload();
  };
  const stop = () => {
    web()?.stopLoading();
    setBrowserStopped(props.id);
  };
  const retry = () => {
    const url = page().url ?? draft();
    if (url) navigate(url);
  };

  const failure = () => {
    if (page().error) return page().error;
    if (browserPlatform() === "unavailable") {
      return { code: "ERR_FEATURE_UNAVAILABLE_ON_PLATFORM", message: t(K.browser.unavailable) };
    }
    return null;
  };
  const messages = () => page().messages;
  // The web view stays mounted when a load fails: a platform error such as a
  // cancellation (NSURLError -999) can arrive while the next page is already
  // loading, and unmounting here would cancel that one too. The failure is
  // drawn instead of the page; the next navigation shows it again.
  const canShowPage = () => browserPlatform() === "available" && !!page().url;

  return (
    <View class="flex-1 bg-background" style={{ flexDirection: "column" }} testID="browser-sheet">
      <View
        class="flex-row items-center gap-1 border-b border-line bg-background px-2"
        style={{ height: 36 }}
      >
        <SheetIconButton
          testID="browser-back"
          label={t(K.browser.back)}
          glyph="chevron-left"
          disabled={!page().canGoBack}
          onPress={back}
        />
        <SheetIconButton
          testID="browser-forward"
          label={t(K.browser.forward)}
          glyph="chevron-right"
          disabled={!page().canGoForward}
          onPress={forward}
        />
        <SheetIconButton
          testID="browser-reload"
          label={t(K.browser.reload)}
          glyph="reload"
          disabled={!page().url || page().loading}
          onPress={reload}
        />
        <SheetIconButton
          testID="browser-stop"
          label={t(K.browser.stop)}
          glyph="stop"
          disabled={!page().loading}
          onPress={stop}
        />
        <Input
          testID="browser-address"
          accessibilityLabel={t(K.browser.address)}
          value={draft()}
          onChange={({ value }) => {
            draft.set(value);
            if (addressError()) addressError.set(null);
          }}
          onSubmit={submit}
          onFocus={() => editing.set(true)}
          onBlur={() => {
            editing.set(false);
            draft.set(page().url ?? "");
          }}
          placeholder={t(K.browser.addressPlaceholder)}
          style={{
            flex: 1,
            height: 26,
            paddingHorizontal: 8,
            fontSize: 12,
            color: token("foreground"),
            placeholderColor: token("faint"),
            caretColor: token("primary"),
            borderWidth: 1,
            borderColor: token("border"),
            borderRadius: 8,
            backgroundColor: token("background"),
          }}
        />
        <If when={page().loading}>
          <Text class="text-[10.5px] text-muted-foreground" style={{ numberOfLines: 1 }}>
            {t(K.browser.loading)}
          </Text>
        </If>
        <View testID="browser-any-site" tooltip={t(K.browser.anySiteHint)}>
          <Chip label={t(K.browser.anySite)} tint={token("faint")} />
        </View>
      </View>

      <View
        testID="browser-progress"
        style={{
          height: 2,
          backgroundColor: page().loading ? token("primary") : token("line"),
          ...motionStyle("fast"),
        }}
      />

      <If when={!!addressError()}>
        <Text class="px-3 py-1 text-[10.5px] text-destructive" style={{ numberOfLines: 1 }}>
          {addressError() ?? ""}
        </Text>
      </If>

      <View class="flex-1" style={{ minHeight: 0 }}>
        <If when={!!failure()}>
          <BrowserFailure
            code={failure()?.code ?? ""}
            message={failure()?.message ?? ""}
            unavailable={browserPlatform() === "unavailable"}
            onRetry={retry}
          />
        </If>
        <If when={!failure() && !page().url}>
          <BrowserEmpty />
        </If>
        <If when={canShowPage()}>
          <View
            style={{
              display: failure() ? "none" : "flex",
              flex: 1,
              // The native web view is transparent; a page without its own
              // background (the common light page) gets the web canvas, not
              // the app's dark shell.
              backgroundColor: token("web-page"),
            }}
          >
            <WebView
              testID="browser-page"
              ref={(node) => web.set(node)}
              src={src()}
              style={{ flex: 1 }}
              desktop={{ allowsBackForwardNavigationGestures: true }}
              onLoadStart={onNavigation}
              onLoad={onNavigation}
              onNavigationStateChange={onNavigation}
              onError={(error) => {
                // A navigation cancelled by a newer one is not a page
                // failure (WebKit -999); showing it would hide a load that
                // is already on its way.
                if (/-999|cancell?ed/i.test(error.message)) return;
                reportBrowserError(props.id, error);
              }}
              injectedJavaScriptBeforeContentLoaded={EXTERNAL_OPEN_SCRIPT}
              onMessage={(message) => {
                // A `target=_blank` link or `window.open` moves this sheet
                // instead of opening a window the host cannot place.
                const target = externalOpenUrl(message.data);
                if (target) {
                  navigate(target);
                  return;
                }
                logBrowserMessage(props.id, message.data);
              }}
            />
          </View>
        </If>
        <If when={!failure() && !!page().url && browserPlatform() === "unknown"}>
          <View class="flex-1 items-center justify-center">
            <Text class="text-[11.5px] text-muted-foreground">{t(K.browser.loading)}</Text>
          </View>
        </If>
      </View>

      <View
        class="flex-row items-center gap-2 border-t border-line bg-background px-3"
        style={{ height: 24 }}
      >
        <View
          role="button"
          testID="browser-log-toggle"
          accessibilityLabel={t(K.browser.messagesCount, { count: messages().length })}
          class="flex-row items-center gap-1 rounded-md px-1 hover:bg-hover active:opacity-60 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
          style={{ ...motionStyle("fast") }}
          onPress={() => logOpen.set(!logOpen())}
        >
          <Glyph
            name="chat"
            size={11}
            tint={messages().length > 0 ? token("info") : token("faint")}
          />
          <Text class="text-[10.5px] font-medium text-muted-foreground">
            {t(K.browser.messagesCount, { count: messages().length })}
          </Text>
        </View>
        <Text class="flex-1 text-[10px] text-faint" style={{ numberOfLines: 1 }}>
          {t(K.browser.messagesHint)}
        </Text>
      </View>

      <If when={logOpen()}>
        <View
          testID="browser-message-log"
          class="border-t border-line bg-inset"
          style={{ height: 112 }}
        >
          <View class="flex-row items-center justify-between px-3" style={{ height: 22 }}>
            <Text class="text-[10.5px] font-medium text-muted-foreground">{t(K.browser.messages)}</Text>
            <View
              role="button"
              testID="browser-clear-messages"
              accessibilityLabel={t(K.browser.clearMessages)}
              disabled={messages().length === 0}
              class={
                messages().length === 0
                  ? "rounded-md px-1.5 py-0.5 opacity-40"
                  : "rounded-md px-1.5 py-0.5 hover:bg-hover active:opacity-60 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
              }
              style={{ ...motionStyle("fast") }}
              onPress={() => clearBrowserMessages(props.id)}
            >
              <Text class="text-[10px] font-medium text-muted-foreground">{t(K.browser.clearMessages)}</Text>
            </View>
          </View>
          <Scroll class="flex-1 px-3 pb-1.5">
            <If
              when={messages().length === 0}
              else={
                <View style={{ gap: 1 }}>
                  <Each of={messages()} key={(_message, index) => index}>
                    {(message) => (
                      <Text
                        class="text-[10.5px] font-mono text-muted-foreground"
                        style={{ numberOfLines: 2 }}
                      >
                        {message()}
                      </Text>
                    )}
                  </Each>
                </View>
              }
            >
              <Text class="text-[10.5px] text-faint">{t(K.browser.messagesEmpty)}</Text>
            </If>
          </Scroll>
        </View>
      </If>
    </View>
  );
}

function BrowserEmpty() {
  return (
    <View testID="browser-empty" class="flex-1 items-center justify-center gap-2 bg-background px-8">
      <Glyph name="globe" size={28} tint={token("faint")} />
      <Text class="text-[14px] font-semibold text-foreground">{t(K.browser.emptyTitle)}</Text>
      <Text class="text-[12px] text-muted-foreground" style={{ maxWidth: 460, textAlign: "center" }}>
        {t(K.browser.emptyLine)}
      </Text>
      <Text class="text-[10.5px] font-mono text-faint">webview.hosts: ["*"] · {t(K.browser.anySite)}</Text>
    </View>
  );
}

function BrowserFailure(props: {
  code: string;
  message: string;
  unavailable: boolean;
  onRetry: () => void;
}) {
  return (
    <View testID="browser-error" class="flex-1 items-center justify-center gap-2 bg-background px-8">
      <Glyph name="alert" size={24} tint={token("destructive")} />
      <Text class="text-[13.5px] font-semibold text-foreground">{t(K.browser.errorTitle)}</Text>
      <Text testID="browser-error-code" class="text-[11px] font-mono text-destructive">
        {props.code}
      </Text>
      <Text class="text-[11.5px] text-muted-foreground" style={{ maxWidth: 520, textAlign: "center", numberOfLines: 4 }}>
        {props.message}
      </Text>
      <If when={!props.unavailable}>
        <View
          role="button"
          testID="browser-retry"
          accessibilityLabel={t(K.browser.retry)}
          class="mt-1 h-7 flex-row items-center justify-center rounded-lg border border-line px-3 hover:bg-hover active:opacity-70 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
          style={{ ...motionStyle("fast") }}
          onPress={props.onRetry}
        >
          <Text class="text-[11.5px] font-medium text-foreground">{t(K.browser.retry)}</Text>
        </View>
      </If>
    </View>
  );
}
