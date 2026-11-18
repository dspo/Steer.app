/**
 * A1: the `ask_user_question` card (issue #12).
 *
 * Docks above the composer, ahead of `ApprovalCard` (fixed order — the ask
 * blocks the model, the approval gates it). One card = one tool call: 1–4
 * questions paginated one per page with a `1/n` progress mark and Back /
 * Next →, each with 1–4 option buttons (label + description, recommendation
 * as a faint hint). A single-select row draws a circle, a multi-select row a
 * checkbox, and a second click on a picked row clears it. One custom-answer
 * input per page carries a "chat about this" toggle: the typed text is an
 * answer by default and discussion notes when the toggle is on.
 *
 * Every question is optional: Submit sends the picked options, the typed
 * text, or an empty answer, and the harness renders the last as
 * "(no answer)". A picked option and a typed note travel together — the
 * note supplements the choice instead of replacing it; "chat about this"
 * keeps the leaning picks next to the discussion notes. Back/Next sit in
 * fixed corners on the left (greyed at the ends), Skip/Submit on the right,
 * so paging never moves a button under the pointer.
 *
 * Answers resolve the store's pending ask (a live wait resolves in process
 * — that resolution is the `_zu/ask/create` JSON-RPC response; a card seeded
 * after a restart answers over the wire). Skip dismisses the whole card;
 * the harness tells the model to continue without an answer.
 */

import { effect, signal, Text, token, View } from "nsh";
import { Input } from "nsh/base";
import { K, t } from "../../ui/i18n";
import { Glyph, motionStyle } from "../../ui/ui";
import type { AskQuestion, AskResponse } from "./acp/host";
import { answerAsk, pendingAsks, type PendingAsk } from "./sessions";

type AskAnswer = Extract<AskResponse, { action: "accept" }>["answers"][number];

function questionsOf(entry: PendingAsk | undefined): AskQuestion[] {
  const raw =
    entry?.args && typeof entry.args === "object" ? (entry.args as { questions?: unknown }).questions : null;
  return Array.isArray(raw) ? (raw as AskQuestion[]) : [];
}

export function AskCard(props: { sessionId: string }) {
  const pending = () => {
    for (const entry of Object.values(pendingAsks())) {
      if (entry.sessionId === props.sessionId) return entry;
    }
    return undefined;
  };
  const questions = () => questionsOf(pending());
  const total = () => questions().length;
  const page = signal(0);
  const index = () => Math.min(page(), total() - 1);
  const question = () => questions()[index()];

  // Per-question draft state, keyed by question index so paging back keeps it.
  const picked = signal<Record<number, number[]>>({});
  const text = signal<Record<number, string>>({});
  const discuss = signal<Record<number, boolean>>({});
  const pickedFor = (qi: number) => picked()[qi] ?? [];
  const typedFor = (qi: number) => text()[qi] ?? "";
  const discussing = (qi: number) => discuss()[qi] === true;

  // A new ask takes the dock from page one and clears every draft: supersede
  // swaps the card without remounting it, and last ask's typed text or picks
  // must not leak into the next one. Other pendingAsks changes — entries for
  // other sessions appearing or dropping — leave the drafts alone.
  let draftsFor: string | undefined;
  effect(() => {
    const id = pending()?.toolCallId;
    if (id === draftsFor) return;
    draftsFor = id;
    page.set(0);
    picked.set({});
    text.set({});
    discuss.set({});
  });

  const setPicked = (qi: number, next: number[]) => {
    picked.set({ ...picked(), [qi]: next });
  };

  const toggleOption = (optionIndex: number) => {
    const qi = index();
    const current = pickedFor(qi);
    const next = current.includes(optionIndex)
      ? current.filter((i) => i !== optionIndex)
      : question()?.multiSelect
        ? [...current, optionIndex]
        : [optionIndex];
    // Both shapes toggle: a second click on a picked row clears it.
    setPicked(qi, next);
  };

  const toggleDiscuss = () => {
    const qi = index();
    discuss.set({ ...discuss(), [qi]: !discussing(qi) });
  };

  const answerFor = (qi: number): AskAnswer => {
    const notes = typedFor(qi).trim();
    const options = questions()[qi]?.options ?? [];
    const labels = pickedFor(qi).map((i) => options[i]?.label).filter((label) => !!label);
    // The toggle is a mode, not a text kind: "chat about this" means no
    // answer even when the notes are still empty.
    if (discussing(qi)) return labels.length > 0 ? { kind: "discuss", notes, labels } : { kind: "discuss", notes };
    if (notes.length === 0) return { kind: "option", labels };
    // A pick with a typed note sends both: the note supplements the choice.
    return labels.length > 0 ? { kind: "option", labels, text: notes } : { kind: "custom", text: notes };
  };

  const reset = () => {
    picked.set({});
    text.set({});
    discuss.set({});
    page.set(0);
  };

  const submit = () => {
    const entry = pending();
    if (!entry || total() === 0) return;
    const answers = questions().map((_, qi) => answerFor(qi));
    void answerAsk(props.sessionId, entry.toolCallId, { action: "accept", answers } satisfies AskResponse);
    reset();
  };

  const skip = () => {
    const entry = pending();
    if (!entry) return;
    void answerAsk(props.sessionId, entry.toolCallId, { action: "cancel" } satisfies AskResponse);
    reset();
  };

  const back = () => {
    if (index() > 0) page.set(index() - 1);
  };

  const next = () => {
    if (index() + 1 < total()) page.set(index() + 1);
  };

  return (
    <If when={!!pending()}>
      <View
        testID="ask-card"
        class="rounded-xl border border-line bg-card"
        style={{ gap: 8, paddingHorizontal: 12, paddingVertical: 10, ...motionStyle("fast") }}
      >
        <View class="flex-row items-center gap-2">
          <Glyph name="chat" size={12} tint={token("brand")} />
          <Text class="text-[11.5px] font-semibold text-foreground">{question()?.header}</Text>
          <View style={{ flex: 1 }} />
          <If when={total() > 1}>
            <Text testID="ask-progress" class="text-[10.5px] text-faint">
              {t(K.ask.progress, { current: index() + 1, total: total() })}
            </Text>
          </If>
        </View>
        <Text class="text-[12px] text-foreground" style={{ numberOfLines: 3 }}>
          {question()?.question}
        </Text>
        <View style={{ gap: 4 }}>
          <Each of={question()?.options ?? []} key={(option) => option.label}>
            {(option, optionIndex) => {
              const selected = () => pickedFor(index()).includes(optionIndex());
              const multi = () => question()?.multiSelect === true;
              return (
                <View
                  role="button"
                  testID={`ask-option-${optionIndex()}`}
                  accessibilityLabel={option().label}
                  class={
                    selected()
                      ? "flex-row items-start gap-2 rounded-lg border border-brand bg-hover px-2 py-1.5 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1 active:opacity-80"
                      : "flex-row items-start gap-2 rounded-lg border border-line px-2 py-1.5 hover:bg-hover active:opacity-70 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
                  }
                  onPress={() => toggleOption(optionIndex())}
                >
                  <View
                    class={
                      (multi()
                        ? "mt-0.5 h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm"
                        : "mt-0.5 h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full") +
                      (selected() ? " bg-brand" : " border border-line")
                    }
                  >
                    <If when={selected() && multi()}>
                      <Glyph name="check" size={10} tint={token("primary-foreground")} />
                    </If>
                    <If when={selected() && !multi()}>
                      <View class="h-1.5 w-1.5 rounded-full bg-primary-foreground" />
                    </If>
                  </View>
                  <View style={{ gap: 1, flex: 1 }}>
                    <Text class="text-[12px] font-medium text-foreground">{option().label}</Text>
                    <Text class="text-[11px] text-muted-foreground" style={{ numberOfLines: 2 }}>
                      {option().description}
                    </Text>
                    <If when={!!option().recommendedReason}>
                      <Text class="text-[10.5px] text-faint">
                        {t(K.ask.recommended, { reason: option().recommendedReason ?? "" })}
                      </Text>
                    </If>
                  </View>
                </View>
              );
            }}
          </Each>
        </View>
        <View class="flex-row items-center gap-2">
          <View style={{ flex: 1, minWidth: 0 }}>
            <Input
              testID="ask-other"
              value={typedFor(index())}
              onChange={({ value }) => text.set({ ...text(), [index()]: value })}
              placeholder={discussing(index()) ? t(K.ask.discussPlaceholder) : t(K.ask.other)}
              style={{ minHeight: 0, paddingHorizontal: 8, paddingVertical: 4, fontSize: 12 }}
            />
          </View>
          <View
            role="button"
            testID="ask-discuss-toggle"
            accessibilityLabel={t(K.ask.discuss)}
            class={
              discussing(index())
                ? "h-7 items-center justify-center rounded-lg border border-brand bg-hover px-2.5 active:opacity-80 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
                : "h-7 items-center justify-center rounded-lg border border-line px-2.5 hover:bg-hover active:opacity-70 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
            }
            onPress={toggleDiscuss}
          >
            <Text
              class={
                discussing(index())
                  ? "text-[11px] font-medium text-brand"
                  : "text-[11px] font-medium text-muted-foreground"
              }
            >
              {t(K.ask.discuss)}
            </Text>
          </View>
        </View>
        <View class="flex-row items-center gap-2">
          <If when={total() > 1}>
            <View class="flex-row items-center gap-2">
              <CardButton testID="ask-back" label={t(K.ask.back)} disabled={index() === 0} onPress={back} />
              <CardButton
                testID="ask-next"
                label={t(K.ask.next)}
                disabled={index() + 1 >= total()}
                onPress={next}
              />
            </View>
          </If>
          <View style={{ flex: 1 }} />
          <CardButton testID="ask-cancel" label={t(K.ask.cancel)} onPress={skip} />
          <CardButton testID="ask-submit" label={t(K.ask.submit)} primary onPress={submit} />
        </View>
      </View>
    </If>
  );
}

function CardButton(props: {
  testID: string;
  label: string;
  primary?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <View
      role="button"
      testID={props.testID}
      accessibilityLabel={props.label}
      disabled={props.disabled}
      class={
        props.primary
          ? "h-7 items-center justify-center rounded-lg bg-primary px-3 active:opacity-80 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
          : "h-7 items-center justify-center rounded-lg border border-line px-3 hover:bg-hover active:opacity-70 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
      }
      onPress={props.onPress}
    >
      <Text
        class={
          props.primary
            ? "text-[11.5px] font-medium text-primary-foreground"
            : "text-[11.5px] font-medium text-foreground"
        }
      >
        {props.label}
      </Text>
    </View>
  );
}
