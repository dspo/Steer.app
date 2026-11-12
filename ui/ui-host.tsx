import {
  onEngineEvent,
  requestUITimeout,
  respondUI,
} from "../engine";
import { K, t } from "./i18n";
import { effect, Scroll, signal, Text, token, View } from "nsh";
import { AlertDialog, Dialog, Input } from "nsh/base";
import { Window } from "nsh/desktop";
import { Dot, motionStyle, shadowDialog, shadowRaised } from "./ui";

/**
 * The shell's half of the extension host: extension UI requests become
 * native dialogs, `notify` becomes a toast, `setStatus` a status line and
 * `setTitle` the window title. A request is answered once; whatever arrives
 * after the engine's timeout is ignored there.
 *
 * `confirm` uses the platform's alert dialog (pi's own semantic: a
 * consequential decision); `select`, `input` and `editor` use an in-app
 * dialog so a long option list and a multi-line editor have room.
 */

export type UIRequest = {
  id: string;
  method: "confirm" | "select" | "input" | "editor";
  timeoutMs?: number;
  title?: string;
  message?: string;
  options?: string[];
  placeholder?: string;
  prefill?: string;
  sessionId?: string;
};

type Toast = { id: number; message: string; kind: "info" | "warning" | "error" };

/** The dialog the shell is drawing, if any. */
export const pendingUI = signal<UIRequest | null>(null);
/** The draft of an input/editor request. */
export const draft = signal("");
/** Extension notifications, newest last. */
export const toasts = signal<Toast[]>([]);
/** Extension status lines, by key; absent text clears one. */
const statuses = signal<Record<string, string>>({});
/** The window title an extension asked for, if any. */
const windowTitle = signal<string | null>(null);
/** Methods the shell cannot show, newest last (also in engine.log). */
export const unsupportedMethods = signal<string[]>([]);

type Entry = {
  request: UIRequest;
  resolve: (value: unknown) => void;
  done: boolean;
  timer?: any;
};

const queue: Entry[] = [];
let current: Entry | null = null;
let toastSeq = 0;

/** Asks the shell for a decision; resolves when the user answers. */
export function enqueueUIRequest(request: UIRequest): Promise<unknown> {
  return new Promise((resolve) => {
    queue.push({ request, resolve, done: false });
    pump();
  });
}

function pump(): void {
  if (current) return;
  const next = queue.shift();
  if (!next) return;
  current = next;
  const timeout = (next.request.timeoutMs ?? requestUITimeout(next.request.method)) + 1000;
  next.timer = setTimeout(() => finish(undefined), timeout);
  draft.set(next.request.prefill ?? "");
  if (next.request.method === "confirm") {
    pendingUI.set(null);
    void showConfirm(next);
  } else {
    pendingUI.set(next.request);
  }
}

async function showConfirm(entry: Entry): Promise<void> {
  const request = entry.request;
  const answer = await AlertDialog.show({
    title: request.title ?? t(K.dialog.confirm),
    description: request.message ?? "",
    actions: [
      { id: "yes", label: t(K.dialog.confirm), role: "default" },
      { id: "no", label: t(K.dialog.cancel), role: "cancel" },
    ],
    closeOnEscape: true,
  });
  finish(answer?.action === "yes");
}

/** Answers the current request (if any) and moves to the next. */
export function finish(value: unknown): void {
  const entry = current;
  if (!entry || entry.done) return;
  entry.done = true;
  clearTimeout(entry.timer);
  current = null;
  pendingUI.set(null);
  entry.resolve(value);
  if (entry.request.id) respondUI(entry.request.id, value);
  pump();
}

/** The option a press on `option` chose. */
export function choose(option: string): void {
  finish(option);
}

/** Saves the input/editor draft. */
function submitDraft(): void {
  finish(draft());
}

/** Dismisses a toast by id. */
function dismissToast(id: number): void {
  toasts.set(toasts().filter((toast) => toast.id !== id));
}

export function pushToast(message: string, kind: Toast["kind"]): void {
  const toast: Toast = { id: ++toastSeq, message, kind };
  toasts.set([...toasts().slice(-3), toast]);
  setTimeout(() => dismissToast(toast.id), 6000);
}

function unsupported(method: string): void {
  const list = unsupportedMethods();
  if (list.includes(method)) return;
  unsupportedMethods.set([...list.slice(-7), method]);
}

onEngineEvent((event) => {
  switch (event.type) {
    case "ui.request": {
      const data = (event.data ?? {}) as any;
      const params = (data.params ?? {}) as any;
      void enqueueUIRequest({
        id: String(event.id ?? ""),
        method: data.method,
        timeoutMs: typeof data.timeoutMs === "number" ? data.timeoutMs : undefined,
        title: params.title,
        message: params.message,
        options: Array.isArray(params.options) ? params.options.map((option: unknown) => String(option)) : undefined,
        placeholder: params.placeholder,
        prefill: params.prefill,
        sessionId: event.sessionId,
      });
      break;
    }
    case "ui.notify": {
      const data = (event.data ?? {}) as any;
      const kind = data.type === "error" || data.type === "warning" ? data.type : "info";
      pushToast(String(data.message ?? ""), kind);
      break;
    }
    case "ui.status": {
      const data = (event.data ?? {}) as any;
      const key = String(data.key ?? "");
      if (!key) break;
      const text = data.text;
      const next = { ...statuses() };
      if (text === undefined || text === null || text === "") delete next[key];
      else next[key] = String(text);
      statuses.set(next);
      break;
    }
    case "ui.title": {
      const data = (event.data ?? {}) as any;
      windowTitle.set(String(data.title ?? ""));
      break;
    }
    case "ui.unsupported":
      unsupported(String((event.data as any)?.method ?? "unknown"));
      break;
    default:
      break;
  }
});

/** The toast stack: top-right, newest nearest the edge (M2's notification). */
function toastTint(kind: Toast["kind"]): string {
  return kind === "error" ? token("destructive") : kind === "warning" ? token("warn") : token("info");
}

/** One row of the dialog's footer. */
function DialogAction(props: { label: string; primary?: boolean; onPress: () => void; testID?: string }) {
  return (
    <View
      role="button"
      testID={props.testID}
      accessibilityLabel={props.label}
      class={
        props.primary
          ? "h-8 items-center justify-center rounded-lg bg-primary px-3 hover:bg-primary/90 active:opacity-80 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
          : "h-8 items-center justify-center rounded-lg border border-line px-3 hover:bg-hover active:opacity-80 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
      }
      style={{ ...motionStyle("fast") }}
      onPress={props.onPress}
    >
      <Text
        class={props.primary ? "text-[12px] font-medium text-primary-foreground" : "text-[12px] font-medium text-foreground"}
      >
        {props.label}
      </Text>
    </View>
  );
}

/** The dialog half of the host: one modal, then the next request. */
function RequestDialog() {
  const method = () => pendingUI()?.method;
  const isSelect = () => method() === "select";
  const isText = () => method() === "input" || method() === "editor";
  const isEditor = () => method() === "editor";
  const title = () =>
    pendingUI()?.title ?? (isSelect() ? t(K.dialog.select) : t(K.dialog.confirm));
  return (
    <Dialog
      testID="ui-dialog"
      open={!!pendingUI()}
      animation="fade"
      class="m-auto w-[440px] gap-4 rounded-xl border border-border bg-card p-5"
      style={{ boxShadow: shadowDialog() }}
      backdropClass="bg-scrim"
      onCancel={() => finish(undefined)}
    >
      <Text class="text-[15px] font-semibold text-foreground">{title()}</Text>
      <If when={!!pendingUI()?.message}>
        <Text class="text-[12px] leading-5 text-muted-foreground">{pendingUI()?.message ?? ""}</Text>
      </If>
      <If
        when={isSelect()}
        else={
          <If when={isText()}>
            <Input
              testID="ui-input"
              value={draft()}
              onChange={({ value }) => draft.set(value)}
              multiline={isEditor()}
              placeholder={
                pendingUI()?.placeholder ??
                (isEditor() ? t(K.dialog.editorPlaceholder) : t(K.dialog.inputPlaceholder))
              }
              autoFocus
              onSubmit={submitDraft}
              submitBehavior={isEditor() ? "newline" : "blurAndSubmit"}
              style={{
                minHeight: isEditor() ? 160 : 36,
                paddingHorizontal: 10,
                paddingVertical: 8,
                fontSize: 13,
                lineHeight: 19,
                color: token("foreground"),
                placeholderColor: token("faint"),
                borderWidth: 1,
                borderColor: token("border"),
                borderRadius: 8,
                backgroundColor: token("background"),
              }}
            />
            <View class="flex-row justify-end gap-2">
              <DialogAction label={t(K.dialog.cancel)} onPress={() => finish(undefined)} testID="ui-cancel" />
              <DialogAction label={t(K.dialog.save)} primary onPress={submitDraft} testID="ui-save" />
            </View>
          </If>
        }
      >
        <Scroll style={{ maxHeight: 300 }}>
          <View style={{ gap: 4 }}>
            <Each of={pendingUI()?.options ?? []} key="index">
              {(option, index) => (
                <View
                  role="button"
                  testID={`ui-option-${index()}`}
                  accessibilityLabel={option()}
                  class="rounded-lg px-2.5 py-2 hover:bg-hover focus:bg-hover active:bg-accent focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[-1px]"
                  onPress={() => choose(option())}
                >
                  <Text class="text-[12px] text-foreground">{option()}</Text>
                </View>
              )}
            </Each>
          </View>
        </Scroll>
        <View class="flex-row justify-end">
          <DialogAction label={t(K.dialog.cancel)} onPress={() => finish(undefined)} testID="ui-cancel" />
        </View>
      </If>
    </Dialog>
  );
}

/**
 * The host's visible half, mounted once by the shell: the dialog layer, the
 * toast stack and the window title extension requests ask for.
 */
export function UIHost() {
  effect(() => {
    const title = windowTitle();
    if (!title) return;
    try {
      Window.get("main")?.set({ title });
    } catch {
      // Headless or no window capability: the title stays a shell signal.
    }
  });
  return (
    <View class="absolute top-0 right-0" style={{ width: 460, height: 320, pointerEvents: "box-none" }}>
      <View style={{ gap: 8, alignItems: "flex-end", paddingTop: 12, paddingRight: 12 }}>
        <Each of={toasts()} key={(toast) => String(toast.id)}>
          {(toast) => {
            const value = toast();
            return (
              <View
                testID="toast"
                role="alert"
                accessibilityLabel={value.message}
                class="flex-row items-center gap-2 rounded-xl border border-border bg-toast px-3 py-2 hover:bg-muted active:opacity-90 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
                style={{ minWidth: 240, maxWidth: 360, boxShadow: shadowRaised(), ...motionStyle("fast") }}
                onPress={() => dismissToast(value.id)}
              >
                <Dot tint={toastTint(value.kind)} size={6} />
                <Text class="text-[12px] text-foreground" style={{ flex: 1 }}>
                  {value.message}
                </Text>
              </View>
            );
          }}
        </Each>
      </View>
      <RequestDialog />
    </View>
  );
}
