import { effect, signal, Text, token, View } from "nsh";
import { Input, Menu, MenuItem, MenuSeparator } from "nsh/base";
import { K, t } from "../../ui/i18n";
import { Glyph, motionStyle, shadowRaised, type GlyphName } from "../../ui/ui";
import {
  ActionType,
  connectionError,
  connectionStatus,
  dispatchAction,
  effectiveState,
  reconnect,
} from "./ahp";
import {
  cancelManoxTurn,
  chatResource,
  currentModelRef,
  manoxModels,
  sendManoxMessage,
  sessionResource,
  setManoxEffort,
  setManoxModel,
} from "./stores";
import { MessageKind, PendingMessageKind } from "../../../contracts/ahp/channels-chat/state";
import type { ChatState, Message } from "../../../contracts/ahp/channels-chat/state";
import type { SessionState } from "../../../contracts/ahp/channels-session/state";
import type { ModelCatalog } from "../../domains/manox";

/**
 * The manox composer (the pack's `composer-hairline`, DESIGN §3.2/§4.2).
 *
 * **Copied** from `app/sheets/composer.tsx`'s `ChatComposer` — the hairline
 * design already matched Steer, so migration rather than a rewrite — and
 * adapted to the manox pack; the pi original stays put (the pi composer
 * redesign is another batch):
 * - the footer's model picker, context gauge and slash palette are pi
 *   session semantics and are gone; the hairline over the bare input, the
 *   single right-aligned footer row, and the idle-send / streaming-stop
 *   spots are kept verbatim;
 * - the lanes line (§4.2: steering/queued) reads the chat's pending
 *   messages straight off the vendored reducer's fold;
 * - send dispatches `chat/turnStarted`; while a turn runs, Enter queues
 *   (`chat/pendingMessageSet{queued}`) — the host starts it as its own turn;
 * - a transport error (§3.4: a caught host-half panic) shows inline with the
 *   reconnect path beside it.
 */

/** One footer action. Chips are the footer's scale: h-6, text 11. */
function ComposerChip(props: {
  testID: string;
  label: string;
  glyph?: GlyphName;
  primary?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const disabled = () => props.disabled ?? false;
  const look = () =>
    disabled()
      ? "bg-muted opacity-40"
      : props.primary
        ? "bg-primary hover:bg-primary/90 active:opacity-80"
        : "border border-line hover:bg-hover active:opacity-70";
  const ink = () =>
    disabled()
      ? token("faint")
      : props.primary
        ? token("primary-foreground")
        : props.danger
          ? token("destructive")
          : token("foreground");
  return (
    <View
      role="button"
      testID={props.testID}
      accessibilityLabel={props.label}
      tooltip={props.label}
      disabled={disabled()}
      class={`h-6 flex-row items-center justify-center gap-1 rounded-md px-2 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1 ${look()}`}
      style={{ ...motionStyle("fast") }}
      onPress={() => {
        if (!disabled()) props.onPress();
      }}
    >
      {props.glyph ? <Glyph name={props.glyph} size={11} tint={ink()} /> : null}
      <Text class="text-[11px] font-medium" style={{ color: ink() }}>
        {props.label}
      </Text>
    </View>
  );
}

/** The queued/steering lanes' one line, from the folded chat state. */
function LanesLine(props: { chat: ChatState }) {
  const parts = () => {
    const pieces: string[] = [];
    if (props.chat.steeringMessage) {
      pieces.push(t(K.manox.lanesSteering, { count: 1 }));
    }
    const queued = props.chat.queuedMessages?.length ?? 0;
    if (queued > 0) pieces.push(t(K.manox.lanesQueued, { count: queued }));
    return pieces.join(" · ");
  };
  return (
    <If when={parts().length > 0}>
      <View testID="manox-lanes" class="flex-row items-center gap-1.5">
        <Glyph name="sort" size={10} tint={token("faint")} />
        <Text class="text-[11px] text-faint">{parts()}</Text>
      </View>
    </If>
  );
}

/** `1M`, `128k`: one glance at a model's context window. */
function shortTokens(value: number): string {
  if (!value) return "—";
  return value >= 1_000_000 ? `${Math.round(value / 100_000) / 10}M` : `${Math.round(value / 1000)}k`;
}

const EFFORTS = ["high", "max"] as const;

/** The model/effort pickers live in the composer's footer (issue #55). They
 * read the host's callable catalogue and the folded session config; a
 * selection dispatches `session/configChanged`, applied on the next turn. */
function ManoxModelPicker(props: { threadId: string }) {
  const open = signal(false);
  const catalog = signal<ModelCatalog | null>(null);
  const error = signal<string | null>(null);
  const current = () => currentModelRef(props.threadId);
  const label = () => {
    const ref = current();
    if (!ref) return t(K.manox.model);
    const model = (catalog()?.providers ?? []).flatMap((p) => p.models).find((m) => m.reference === ref);
    return model ? `${model.provider} · ${model.id}` : ref;
  };
  // Warm the footer label on first paint: the selector should name the model
  // before the menu is opened once. The failure is the menu's empty state,
  // never an unhandled rejection (a machine without a callable catalogue).
  effect(() => {
    void (async () => {
      try {
        catalog.set(await manoxModels());
      } catch (failure) {
        error.set(failure instanceof Error ? failure.message : String(failure));
      }
    })();
  });
  const load = async () => {
    try {
      error.set(null);
      catalog.set(await manoxModels(true));
    } catch (failure) {
      error.set(failure instanceof Error ? failure.message : String(failure));
    }
  };
  return (
    <Menu
      open={open()}
      onOpenChange={({ open: next }) => {
        open.set(next);
        if (next) void load();
      }}
      align="start"
      offset={6}
      popupClass="rounded-xl border border-border bg-popover p-1"
      popupStyle={{ width: 300, maxHeight: 420, boxShadow: shadowRaised() }}
      trigger={
        <View
          role="button"
          testID="manox-model-picker"
          accessibilityLabel={t(K.manox.model)}
          class="h-6 flex-row items-center gap-1 rounded-md px-1.5 hover:bg-hover active:opacity-70 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
          style={{ ...motionStyle("fast") }}
        >
          <Text class="text-[11px] font-medium text-foreground" style={{ numberOfLines: 1 }}>{label()}</Text>
          <Glyph name="caret-down" size={8} tint={token("faint")} />
        </View>
      }
    >
      <If when={error() || (catalog() && catalog()!.providers.length === 0)}>
        <View class="px-2 py-2">
          <Text testID="manox-models-empty" class="text-[11px] text-faint">
            {error() ?? t(K.manox.modelsEmpty)}
          </Text>
          <MenuItem
            testID="manox-model-retry"
            class="rounded-lg px-2.5 py-1.5 hover:bg-hover"
            onSelect={() => void load()}
          >
            <Text class="text-[12px] text-foreground">{t(K.manox.modelsRetry)}</Text>
          </MenuItem>
        </View>
      </If>
      <Each of={catalog()?.providers ?? []} key={(provider) => provider.id}>
        {(provider) => (
          <View>
            <View class="px-2 py-1"><Text class="text-[10.5px] text-faint">{provider().name}</Text></View>
            <Each of={provider().models} key={(model) => model.reference}>
              {(model) => (
                <MenuItem
                  testID={`manox-model-${model().provider}-${model().reference}`}
                  checked={current() === model().reference}
                  role="menuitemradio"
                  closeOnSelect={false}
                  indicator={<Glyph name="check" size={11} tint={token("brand")} />}
                  indicatorClass="opacity-0 checked:opacity-100"
                  class="rounded-lg px-2.5 py-1.5 hover:bg-hover focus:bg-hover active:bg-accent"
                  onSelect={() => {
                    setManoxModel(props.threadId, model().reference);
                    open.set(false);
                  }}
                >
                  <View>
                    <Text class="text-[12px] text-foreground">{model().name}</Text>
                    <Text class="text-[10.5px] text-faint">{model().id} · {shortTokens(model().contextWindow)}</Text>
                  </View>
                </MenuItem>
              )}
            </Each>
          </View>
        )}
      </Each>
      <MenuSeparator class="my-1 h-px bg-line" />
      <View class="px-2 py-1"><Text class="text-[10.5px] text-faint">{t(K.manox.modelNextTurn)}</Text></View>
    </Menu>
  );
}

function ManoxEffortPicker(props: { threadId: string }) {
  const open = signal(false);
  const current = (): string => {
    const value = effectiveState<SessionState>(sessionResource(props.threadId))?.config?.values?.["reasoningEffort"];
    return typeof value === "string" ? value : "off";
  };
  return (
    <Menu
      open={open()}
      onOpenChange={({ open: next }) => open.set(next)}
      align="start"
      offset={6}
      popupClass="rounded-xl border border-border bg-popover p-1"
      popupStyle={{ width: 160, boxShadow: shadowRaised() }}
      trigger={
        <View
          role="button"
          testID="manox-effort-picker"
          accessibilityLabel={t(K.manox.effort)}
          class="h-6 flex-row items-center gap-1 rounded-md px-1.5 hover:bg-hover active:opacity-70 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
          style={{ ...motionStyle("fast") }}
        >
          <Text class="text-[11px] font-medium text-foreground">{current()}</Text>
          <Glyph name="caret-down" size={8} tint={token("faint")} />
        </View>
      }
    >
      <Each of={EFFORTS} key={(effort) => effort}>
        {(effort) => (
          <MenuItem
            testID={`manox-effort-${effort()}`}
            checked={current() === effort()}
            role="menuitemradio"
            closeOnSelect={false}
            indicator={<Glyph name="check" size={11} tint={token("brand")} />}
            indicatorClass="opacity-0 checked:opacity-100"
            class="rounded-lg px-2.5 py-1.5 hover:bg-hover focus:bg-hover active:bg-accent"
            onSelect={() => {
              setManoxEffort(props.threadId, effort());
              open.set(false);
            }}
          >
            <Text class="text-[12px] text-foreground">{effort()}</Text>
          </MenuItem>
        )}
      </Each>
    </Menu>
  );
}

/** The manox composer: the hairline input and one right-aligned footer row. */
export function ManoxComposer(props: {
  threadId: string;
  chatId: string;
  autofocus?: boolean;
  /** The message went out (or queued): the conversation scrolls to it. */
  onSend?: () => void;
}) {
  const draft = signal("");
  const chatUri = () => chatResource(props.chatId);
  const chat = () => effectiveState<ChatState>(chatUri());
  const streaming = () => chat()?.activeTurn != null;
  const canSubmit = () => draft().trim().length > 0;
  const status = () => connectionStatus();
  const take = () => {
    const text = draft();
    draft.set("");
    return text.trim();
  };
  const submit = () => {
    if (!canSubmit()) return;
    const text = take();
    if (streaming()) {
      // Enter is the polite lane while a turn runs: the message queues on
      // the chat's lane; the host starts it as its own turn afterwards.
      const message: Message = { text, origin: { kind: MessageKind.User } };
      dispatchAction(chatUri(), {
        type: ActionType.ChatPendingMessageSet,
        kind: PendingMessageKind.Queued,
        id: `queued-${Date.now()}`,
        message,
      } as never);
      props.onSend?.();
      return;
    }
    void sendManoxMessage(props.threadId, props.chatId, text);
    props.onSend?.();
  };
  return (
    <View
      style={{
        width: "100%",
        maxWidth: 820,
        alignSelf: "center",
        gap: 6,
        position: "relative",
        // The divider is the composer's own, exactly as wide as it is.
        borderTopWidth: 1,
        borderTopColor: token("line"),
        paddingTop: 8,
      }}
    >
      <If when={chat()}>
        <LanesLine chat={chat()!} />
      </If>
      <If when={status() === "error"}>
        <View testID="manox-transport-error" class="flex-row items-center gap-1.5">
          <Glyph name="alert" size={10} tint={token("destructive")} />
          <Text class="text-[11px] leading-[16px] text-destructive" style={{ flex: 1 }}>
            {t(K.manox.transportError, { error: connectionError() ?? "" })}
          </Text>
          <ComposerChip
            testID="manox-reconnect"
            label={t(K.engine.reconnect)}
            onPress={() => void reconnect()}
          />
        </View>
      </If>
      <Input
        testID="manox-input"
        value={draft()}
        onChange={({ value }) => draft.set(value)}
        multiline
        submitBehavior="submit"
        autoFocus={props.autofocus ?? false}
        placeholder={streaming() ? t(K.manox.placeholderStreaming) : t(K.manox.placeholder)}
        onSubmit={submit}
        style={{
          minHeight: 44,
          paddingHorizontal: 2,
          paddingVertical: 4,
          fontSize: 14,
          lineHeight: 21,
          color: token("foreground"),
          placeholderColor: token("faint"),
          caretColor: token("primary"),
          selectionColor: token("brand"),
          backgroundColor: "transparent",
          borderWidth: 0,
        }}
      />
      <View class="flex-row items-center justify-between gap-2">
        <View class="flex-row items-center gap-2">
          <ManoxModelPicker threadId={props.threadId} />
          <ManoxEffortPicker threadId={props.threadId} />
        </View>
        <If when={status() === "connecting"}>
          <Text class="text-[11px] text-faint">{t(K.manox.connecting)}</Text>
        </If>
        <If
          when={streaming()}
          else={
            <ComposerChip
              testID="manox-send"
              label={t(K.session.send)}
              glyph="send"
              primary
              disabled={!canSubmit()}
              onPress={submit}
            />
          }
        >
          {/* Stop is absolute: never gated by the draft. */}
          <ComposerChip
            testID="manox-stop"
            label={t(K.session.stop)}
            glyph="stop"
            danger
            disabled={false}
            onPress={() => void cancelManoxTurn(props.chatId)}
          />
        </If>
      </View>
    </View>
  );
}
