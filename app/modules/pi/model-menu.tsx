import { signal, Text, token, View } from "nsh";
import { Menu, MenuItem, MenuSeparator, Submenu } from "nsh/base";
import { K, t } from "../../ui/i18n";
import {
  MenuLabel,
  MenuPanel,
  MenuScroller,
  menuItemLabel,
  menuItemLook,
  menuItemNote,
  menuItemSize,
  menuSeparator,
  SubmenuBack,
  SubmenuRow,
} from "../../ui/menu";
import { Glyph } from "../../ui/ui";
import type { SessionModelsReason } from "./protocol";
import {
  chooseSessionModel,
  ensureSessionModels,
  sessionModels,
  setSessionMode,
  viewFor,
} from "./sessions";

/**
 * The model menu, hosted at the window root and anchored to the composer's
 * chip.
 *
 * A menu anchored *inside* a sheet does not hear presses at the rows it
 * paints (the sheet's frame is not in the pick chain there), while a menu
 * hosted beside the workbench — the title bar's, a dialog's — does. So the
 * chip measures itself and opens this layer, which lives next to `Workbench`
 * in `App` and gives the menu a trigger at the chip's own rectangle: the
 * popup lands where an anchored menu would, and its rows are clickable.
 */

/** Where the chip is, in the window's points. */
export type ModelMenuAnchor = { x: number; y: number; width: number; height: number };

const sessionId = signal<string | null>(null);
const anchor = signal<ModelMenuAnchor | null>(null);

/** Opens the model menu for `session`, at `at` (the chip's rectangle). */
export function openModelMenu(session: string, at: ModelMenuAnchor): void {
  anchor.set(at);
  sessionId.set(session);
  void ensureSessionModels(session);
}

export function closeModelMenu(): void {
  sessionId.set(null);
}

/** Whether the model menu is showing (the chip draws its pressed look). */
export function modelMenuShown(): boolean {
  return sessionId() !== null;
}

/** The model menu's layer: rendered by `App`, outside the sheets. */
export function ModelMenuLayer() {
  const session = () => sessionId();
  const at = () => anchor();
  return (
    <If when={!!session() && !!at()}>
      <View
        style={{
          position: "absolute",
          left: at()!.x,
          top: at()!.y,
          width: at()!.width,
          height: at()!.height,
        }}
      >
        <Menu
          open
          align="start"
          offset={4}
          margin={8}
          onOpenChange={({ open: next }) => {
            if (!next) closeModelMenu();
          }}
          trigger={<View testID="model-menu-anchor" style={{ flex: 1, pointerEvents: "none" }} />}
        >
          <ModelCascade sessionId={session()!} />
        </Menu>
      </View>
    </If>
  );
}

/** Why an empty list is empty: the engine's code, in the user's words. */
function modelsReasonText(reason: SessionModelsReason | undefined, error?: string): string {
  if (error) return t(K.session.modelsError, { error });
  switch (reason?.code) {
    case "no_credentials":
      return t(K.session.modelsNoCredentials);
    case "no_catalog":
      return t(K.session.modelsNoCatalog);
    case "no_models":
      return t(K.session.modelsNoChat);
    case "unavailable":
      return t(K.session.modelsError, { error: reason.message ?? "" });
    default:
      return t(K.session.modelsEmpty);
  }
}

/** A provider's credential source, in the user's words (issue #54). */
function authSourceText(source: string | undefined, label: string | undefined): string {
  switch (source) {
    case "stored":
      return t(K.session.authStored);
    case "environment":
      return t(K.session.authEnvironment, { label: label ?? "" });
    case "models_json_command":
      return t(K.session.authCommand);
    case "models_json_key":
    case "runtime":
    case "fallback":
      return t(K.session.authKey);
    case "none":
      return t(K.session.authNone);
    default:
      return source ?? "";
  }
}

/** `12.3k`, `1M`, `840`: a token count at a glance. */
function formatTokens(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens < 0) return "—";
  if (tokens >= 1_000_000) {
    const value = tokens / 1_000_000;
    return `${value >= 10 ? Math.round(value) : Math.round(value * 10) / 10}M`;
  }
  if (tokens >= 1_000) {
    const value = tokens / 1_000;
    return `${value >= 100 ? Math.round(value) : Math.round(value * 10) / 10}k`;
  }
  return String(Math.round(tokens));
}

/**
 * The two-level cascade: a provider per row, its models in the submenu beside
 * it, then the approval policies. Shaped as nsh's own gallery draws a menu
 * (`examples/gallery/demos/Menus.tsx`): a flush panel around the scrolling
 * items with `ui/menu`'s 26-point rows, and a panel of its own per submenu.
 */
function ModelCascade(props: { sessionId: string }) {
  const view = () => viewFor(props.sessionId);
  const state = () => sessionModels()[props.sessionId];
  const providers = () => state()?.data?.providers ?? [];
  const current = () => view()?.model ?? state()?.data?.current;
  const currentKey = () => (current() ? `${current()!.provider}/${current()!.id}` : "");
  const modes = () => view()?.modes ?? [];
  const mode = () => view()?.mode ?? "ask";
  const choose = async (provider: string, id: string) => {
    if (await chooseSessionModel(props.sessionId, provider, id)) closeModelMenu();
  };
  const retry = () => void ensureSessionModels(props.sessionId, true);
  return (
    <MenuPanel flush>
      <MenuScroller maxHeight={320}>
        <If when={state()?.status === "loading"}>
          <Text style={{ ...menuItemNote(), fontSize: menuItemSize.font }}>{t(K.session.modelsLoading)}</Text>
        </If>
        <If when={state()?.status === "error"}>
          <Text style={{ ...menuItemNote(), fontSize: menuItemSize.font, color: token("destructive") }}>
            {t(K.session.modelsError, { error: state()?.error ?? "" })}
          </Text>
          <MenuItem testID="model-retry" {...menuItemLook()} onSelect={retry}>
            <Text style={menuItemLabel()}>{t(K.engine.retry)}</Text>
          </MenuItem>
        </If>
        <If when={state()?.status === "ready" && providers().length === 0}>
          <Text testID="model-reason" style={{ ...menuItemNote(), fontSize: menuItemSize.font }}>
            {modelsReasonText(state()?.data?.reason)}
          </Text>
          <MenuItem testID="model-retry" {...menuItemLook()} onSelect={retry}>
            <Text style={menuItemLabel()}>{t(K.engine.retry)}</Text>
          </MenuItem>
        </If>
        <Each of={providers()} key={(provider) => provider.id}>
          {(provider) => (
            <Submenu
              offset={4}
              trigger={
                <SubmenuRow
                  testID={`model-provider-${provider().id}`}
                  label={provider().name}
                  note={
                    provider().authSource
                      ? authSourceText(provider().authSource, provider().authLabel)
                      : provider().id
                  }
                />
              }
              back={<SubmenuBack label={provider().name} />}
            >
              <MenuPanel>
                <Each of={provider().models} key={(model) => `${model.provider}/${model.id}`}>
                  {(model) => (
                    <MenuItem
                      testID={`model-${model().provider}-${model().id}`}
                      {...menuItemLook()}
                      checked={currentKey() === `${model().provider}/${model().id}`}
                      role="menuitemradio"
                      closeOnSelect={false}
                      indicator={<Glyph name="check" size={11} tint={token("brand")} />}
                      indicatorClass="opacity-0 checked:opacity-100"
                      onSelect={() => void choose(model().provider, model().id)}
                    >
                      <Text style={menuItemLabel()}>{model().name}</Text>
                      <If when={!!model().contextWindow}>
                        <Text style={menuItemNote()}>{formatTokens(model().contextWindow!)}</Text>
                      </If>
                    </MenuItem>
                  )}
                </Each>
              </MenuPanel>
            </Submenu>
          )}
        </Each>
        <If when={modes().length > 0}>
          <MenuSeparator style={menuSeparator()} />
          <MenuLabel text={t(K.session.permissions)} />
          <Each of={modes()} key={(entry) => entry.id}>
            {(entry) => (
              <MenuItem
                testID={`session-mode-${entry().id}`}
                {...menuItemLook()}
                checked={mode() === entry().id}
                role="menuitemradio"
                closeOnSelect={false}
                indicator={<Glyph name="check" size={11} tint={token("brand")} />}
                indicatorClass="opacity-0 checked:opacity-100"
                onSelect={() => void setSessionMode(props.sessionId, entry().id)}
              >
                <Text style={menuItemLabel()}>{entry().name}</Text>
                <If when={!!entry().description}>
                  <Text style={menuItemNote()}>{entry().description ?? ""}</Text>
                </If>
              </MenuItem>
            )}
          </Each>
        </If>
      </MenuScroller>
    </MenuPanel>
  );
}
