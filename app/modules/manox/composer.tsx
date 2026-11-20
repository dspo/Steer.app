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
  latestChatUsage,
  manoxModels,
  sendManoxMessage,
  sessionResource,
  setManoxEffort,
  setManoxModel,
} from "./stores";
import {
  ManoxAction,
  ManoxContextRing,
  ManoxMode,
  ManoxPlus,
  contextMaxTokens,
  contextUsedTokens,
} from "./composer-controls";
import { MessageKind, PendingMessageKind } from "../../../contracts/ahp/channels-chat/state";
import type { ChatState, Message } from "../../../contracts/ahp/channels-chat/state";
import type { SessionState } from "../../../contracts/ahp/channels-session/state";
import type { ModelCatalog } from "../../domains/manox";

/**
 * The manox composer (DESIGN §3.6a, Q124): ZCode's rounded input card — the
 * input on top, one footer row under it (left: the disabled `+` and the
 * access mode; right: the context ring, the model, the reasoning effort and
 * the one action), and the manox lanes / transport-error lines above the
 * card, not inside it. No hairline: the card's own border is the boundary,
 * answering hover and focus-within. This file owns the shell, the input and
 * the submit; the footer's model/effort pickers are the kernel-catalogue
 * menus (issue #55) kept from main's hairline composer, and the card's other
 * controls live in `composer-controls.tsx`.
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

/** The model/effort pickers live in the card's footer (issue #55). They
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

/** The manox composer: the state lines, then the input card. */
export function ManoxComposer(props: {
  threadId: string;
  chatId: string;
  autofocus?: boolean;
  /** The message went out (or queued): the conversation scrolls to it. */
  onSend?: () => void;
}) {
  const draft = signal("");
  /** The input's grown height; the clamp lives where the content reports it. */
  const inputHeight = signal(44);
  /** The kernel catalogue, warmed once for the ring (the pickers load their own). */
  const catalog = signal<ModelCatalog | null>(null);
  effect(() => {
    void (async () => {
      try {
        catalog.set(await manoxModels());
      } catch {
        // No catalogue, no ring; the model picker's menu carries the reason.
      }
    })();
  });
  const chatUri = () => chatResource(props.chatId);
  const chat = () => effectiveState<ChatState>(chatUri());
  const streaming = () => chat()?.activeTurn != null;
  const hasTurns = () => (chat()?.turns.length ?? 0) > 0;
  const canSubmit = () => draft().trim().length > 0;
  const status = () => connectionStatus();
  // The ring reads the last turn's usage over the current model's context
  // window in the kernel catalogue; it stays quiet until both sides exist.
  const ringUsed = () => contextUsedTokens(latestChatUsage(props.chatId));
  const ringMax = () => contextMaxTokens(currentModelRef(props.threadId), catalog());
  const take = () => {
    const text = draft();
    draft.set("");
    inputHeight.set(44);
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
  const placeholder = () =>
    streaming()
      ? t(K.manox.placeholderStreaming)
      : hasTurns()
        ? t(K.manox.placeholderFollowUp)
        : t(K.manox.placeholder);
  return (
    <View
      style={{
        width: "100%",
        maxWidth: 820,
        alignSelf: "center",
        gap: 8,
        position: "relative",
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
      <If when={status() === "connecting"}>
        <Text class="text-[11px] text-faint">{t(K.manox.connecting)}</Text>
      </If>
      {/* The card: a flat surface, one border, no shadow. The border answers
          hover and focus-within — the input inside stays bare. */}
      <View
        class="rounded-xl border border-border bg-card hover:border-input focus-within:border-ring"
        style={{ padding: 12, gap: 12, ...motionStyle("fast") }}
      >
        <Input
          testID="manox-input"
          value={draft()}
          onChange={({ value }) => draft.set(value)}
          multiline
          submitBehavior="submit"
          autoFocus={props.autofocus ?? false}
          placeholder={placeholder()}
          onSubmit={submit}
          onContentSizeChange={({ size }) => {
            inputHeight.set(Math.min(176, Math.max(44, size.height)));
          }}
          style={{
            height: inputHeight(),
            minHeight: 44,
            padding: 0,
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
        {/* One footer row, two clusters (DESIGN §3.6a): left the `+` and the
            access mode, right the gauge, the model/effort pickers and the
            action — idle's ↑ send and streaming's ■ stop in the same spot. */}
        <View class="flex-row items-center justify-between" style={{ gap: 8 }}>
          <View class="flex-row items-center" style={{ gap: 4, flexShrink: 0 }}>
            <ManoxPlus />
            <ManoxMode threadId={props.threadId} />
          </View>
          <View class="flex-row items-center" style={{ gap: 4, flexShrink: 1, minWidth: 0 }}>
            <ManoxContextRing used={ringUsed} max={ringMax} />
            <ManoxModelPicker threadId={props.threadId} />
            <ManoxEffortPicker threadId={props.threadId} />
            {/* Stop is absolute: never gated by the draft. */}
            <ManoxAction
              streaming={streaming()}
              disabled={!canSubmit()}
              onSubmit={submit}
              onStop={() => void cancelManoxTurn(props.chatId)}
            />
          </View>
        </View>
      </View>
    </View>
  );
}
