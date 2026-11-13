import { signal, Text, token, View } from "nsh";
import { Dialog } from "nsh/base";
import { K, t } from "./i18n";
import { Glyph, motionStyle, shadowDialog } from "./ui";

/**
 * The project-trust question that arrives while `session/new` is still in
 * flight (docs/pi-acp-IMPLEMENTATION.md G2). It is a standard ACP
 * `elicitation/create`, but there is no session sheet to hang it on yet, so
 * the dialog lives at the app root and queues by cwd.
 */

export interface PendingTrust {
  cwd: string;
  message: string;
  resolve: (trusted: boolean) => void;
}

export const trustQueue = signal<PendingTrust[]>([]);

/** Set by <TrustDialog />; headless runs answer "no" without hanging. */
let mounted = false;
const waiting = new Map<string, Promise<boolean>>();

export function askProjectTrust(cwd: string, message: string): Promise<boolean> {
  if (!mounted) return Promise.resolve(false);
  const existing = waiting.get(cwd);
  if (existing) return existing;
  const answer = new Promise<boolean>((resolve) => {
    trustQueue.set([...trustQueue(), { cwd, message, resolve }]);
  });
  waiting.set(cwd, answer);
  return answer.finally(() => waiting.delete(cwd));
}

function answer(trusted: boolean): void {
  const [first, ...rest] = trustQueue();
  if (!first) return;
  trustQueue.set(rest);
  first.resolve(trusted);
}

export function TrustDialog() {
  mounted = true;
  const current = () => trustQueue()[0];
  return (
    <Dialog
      testID="project-trust"
      open={!!current()}
      animation="fade"
      class="m-auto w-[520px] gap-4 rounded-xl border border-border bg-card p-5"
      style={{ boxShadow: shadowDialog() }}
      backdropClass="bg-scrim"
      onCancel={() => answer(false)}
    >
      <View class="flex-row items-center gap-2">
        <Glyph name="alert" size={14} tint={token("warn")} />
        <Text class="text-[14px] font-semibold text-foreground">{t(K.trust.title)}</Text>
      </View>
      <Text class="text-[12px] leading-[18px] text-muted-foreground">
        {current()?.message ?? ""}
      </Text>
      <View class="flex-row justify-end gap-2">
        <TrustButton
          testID="trust-decline"
          label={t(K.trust.decline)}
          onPress={() => answer(false)}
        />
        <TrustButton
          testID="trust-accept"
          label={t(K.trust.accept)}
          primary
          onPress={() => answer(true)}
        />
      </View>
    </Dialog>
  );
}

function TrustButton(props: { testID: string; label: string; primary?: boolean; onPress: () => void }) {
  return (
    <View
      role="button"
      testID={props.testID}
      accessibilityLabel={props.label}
      class={
        props.primary
          ? "h-8 items-center justify-center rounded-lg bg-primary px-3.5 active:opacity-80"
          : "h-8 items-center justify-center rounded-lg border border-line px-3.5 hover:bg-hover active:opacity-70"
      }
      style={{ ...motionStyle("fast") }}
      onPress={props.onPress}
    >
      <Text
        class={
          props.primary
            ? "text-[12px] font-medium text-primary-foreground"
            : "text-[12px] font-medium text-foreground"
        }
      >
        {props.label}
      </Text>
    </View>
  );
}
