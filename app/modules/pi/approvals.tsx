import { signal, Text, token, View } from "nsh";
import { Dialog, Input } from "nsh/base";
import { K, t } from "../../ui/i18n";
import { Glyph, motionStyle, shadowDialog, shadowRaised } from "../../ui/ui";
import {
  answerElicitation,
  answerPermission,
  pendingElicitations,
  pendingPermissions,
  type PendingElicitation,
  type PendingPermission,
} from "./sessions";

/**
 * The two server→client request surfaces (docs/pi-acp-IMPLEMENTATION.md §6):
 * a tool approval is an inline card in the transcript, and an extension's
 * confirm/select/input/editor is a dialog. Neither blocks the rest of the
 * app; the session's composer shows "waiting for your confirmation".
 */

function firstPermission(sessionId: string): PendingPermission | null {
  return Object.values(pendingPermissions()).find((entry) => entry.sessionId === sessionId) ?? null;
}

function firstElicitation(sessionId: string): PendingElicitation | null {
  return Object.values(pendingElicitations()).find((entry) => entry.sessionId === sessionId) ?? null;
}

/** The inline approval card above the composer. */
export function ApprovalCard(props: { sessionId: string }) {
  const pending = () => firstPermission(props.sessionId);
  const count = () =>
    Object.values(pendingPermissions()).filter((entry) => entry.sessionId === props.sessionId).length;
  const call = pending()?.request?.toolCall;
  return (
    <If when={!!pending()}>
      <View
        testID="session-approval"
        class="rounded-xl border border-warn bg-card"
        style={{ gap: 8, paddingHorizontal: 12, paddingVertical: 10, ...motionStyle("fast") }}
      >
        <View class="flex-row items-center gap-2">
          <Glyph name="alert" size={12} tint={token("warn")} />
          <Text class="text-[11.5px] font-semibold text-foreground">
            {t(K.session.approvalTitle)}
          </Text>
          <View style={{ flex: 1 }} />
          <If when={count() > 1}>
            <Text class="text-[10.5px] text-faint">{`1/${count()}`}</Text>
          </If>
        </View>
        <Text class="text-[12px] text-foreground" style={{ numberOfLines: 3 }}>
          {call?.title ?? "tool call"}
        </Text>
        <View class="flex-row items-center gap-2">
          <ApprovalButton
            testID="approval-allow-once"
            label={t(K.session.approvalAllowOnce)}
            primary
            onPress={() => answerPermission(props.sessionId, "allow_once")}
          />
          <ApprovalButton
            testID="approval-allow-always"
            label={t(K.session.approvalAllowAlways)}
            onPress={() => answerPermission(props.sessionId, "allow_always")}
          />
          <ApprovalButton
            testID="approval-reject"
            label={t(K.session.approvalReject)}
            destructive
            onPress={() => answerPermission(props.sessionId, "reject")}
          />
        </View>
      </View>
    </If>
  );
}

function ApprovalButton(props: {
  testID: string;
  label: string;
  primary?: boolean;
  destructive?: boolean;
  onPress: () => void;
}) {
  return (
    <View
      role="button"
      testID={props.testID}
      accessibilityLabel={props.label}
      class={
        props.primary
          ? "h-7 items-center justify-center rounded-lg bg-primary px-3 active:opacity-80"
          : "h-7 items-center justify-center rounded-lg border border-line px-3 hover:bg-hover active:opacity-70"
      }
      onPress={props.onPress}
    >
      <Text
        class={
          props.primary
            ? "text-[11.5px] font-medium text-primary-foreground"
            : props.destructive
              ? "text-[11.5px] font-medium text-destructive"
              : "text-[11.5px] font-medium text-foreground"
        }
      >
        {props.label}
      </Text>
    </View>
  );
}

/** The extension's form dialog (confirm / select / input / editor). */
export function ElicitationDialog(props: { sessionId: string }) {
  const pending = () => firstElicitation(props.sessionId);
  const draft = signal("");
  const schema = () => (pending()?.request.requestedSchema ?? {}) as {
    properties?: Record<string, { type?: string; title?: string; description?: string; enum?: string[]; default?: string }>;
    required?: string[];
  };
  const field = () => {
    const properties = schema().properties ?? {};
    const keys = Object.keys(properties);
    if (keys.length === 0) return null;
    const key = keys[0];
    return { key, spec: properties[key] };
  };
  const message = () => pending()?.request.message ?? "";
  const close = () => answerElicitation(props.sessionId, "decline");
  const accept = () => {
    const current = field();
    if (!current) {
      answerElicitation(props.sessionId, "accept");
      return;
    }
    const value =
      current.spec.type === "boolean"
        ? draft() === "true"
        : current.spec.enum
          ? draft()
          : draft();
    answerElicitation(props.sessionId, "accept", { [current.key]: value });
  };
  // Reset the draft whenever another elicitation arrives.
  const shown = signal<string | null>(null);
  if (pending() && shown() !== message()) {
    shown.set(message());
    const current = field();
    draft.set(current?.spec.default ?? "");
  }
  const spec = () => field()?.spec;
  return (
    <Dialog
      testID="session-elicitation"
      open={!!pending()}
      animation="fade"
      class="m-auto w-[520px] gap-4 rounded-xl border border-border bg-card p-5"
      style={{ boxShadow: shadowDialog() }}
      backdropClass="bg-scrim"
      onCancel={close}
    >
      <Text class="text-[14px] font-semibold text-foreground">{t(K.session.elicitationTitle)}</Text>
      <Text class="text-[12px] leading-[18px] text-muted-foreground">{message()}</Text>
      <If when={spec()?.type === "boolean"}>
        <View class="flex-row items-center gap-2">
          <ApprovalButton
            testID="elicit-yes"
            label={t(K.dialog.confirm)}
            primary={draft() === "true"}
            onPress={() => draft.set("true")}
          />
          <ApprovalButton
            testID="elicit-no"
            label={t(K.dialog.cancel)}
            onPress={() => draft.set("false")}
          />
        </View>
      </If>
      <If when={spec()?.enum !== undefined}>
        <View style={{ gap: 2 }}>
          {spec()?.enum?.map((option) => (
            <View
              role="button"
              testID={`elicit-option-${option}`}
              class={
                draft() === option
                  ? "rounded-lg bg-accent px-2.5 py-1.5"
                  : "rounded-lg px-2.5 py-1.5 hover:bg-hover"
              }
              onPress={() => draft.set(option)}
            >
              <Text class="text-[12px] text-foreground">{option}</Text>
            </View>
          ))}
        </View>
      </If>
      <If when={spec()?.enum === undefined && spec()?.type !== "boolean"}>
        <Input
          testID="elicit-input"
          value={draft()}
          onChange={({ value }) => draft.set(value)}
          placeholder={spec()?.description ?? ""}
          style={{
            height: spec()?.type === "string" && (spec()?.title?.length ?? 0) > 40 ? 88 : 34,
            paddingHorizontal: 10,
            fontSize: 13,
            color: token("foreground"),
            placeholderColor: token("faint"),
            caretColor: token("primary"),
            borderWidth: 1,
            borderColor: token("border"),
            borderRadius: 8,
            backgroundColor: token("background"),
          }}
        />
      </If>
      <View class="flex-row justify-end gap-2">
        <ApprovalButton testID="elicit-decline" label={t(K.dialog.cancel)} onPress={close} />
        <ApprovalButton testID="elicit-accept" label={t(K.dialog.confirm)} primary onPress={accept} />
      </View>
    </Dialog>
  );
}
