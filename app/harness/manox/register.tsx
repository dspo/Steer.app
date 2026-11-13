import { K, t } from "../../ui/i18n";
import {
  registerHeroSubmitter,
  registerSheetKind,
} from "../../shell/contrib";
import { ManoxChatBody } from "./conversation";
import {
  createManoxThread,
  manoxChatSheetId,
  parseManoxChatSheet,
  sendManoxMessage,
} from "./stores";
import { chatOf } from "./stores";
import { layout, noteSheetOpened, setLayout } from "../../stores/containers";
import { appendSheet } from "../../stores/dock";
import { effectiveState } from "./ahp";
import { manoxModelRef, usableModels } from "../../stores/pi-models";
import type { ChatState } from "../../../contracts/ahp/channels-chat/state";
import type { SessionState } from "../../../contracts/ahp/channels-session/state";
import { chatResource, sessionResource } from "./stores";

/**
 * The manox pack's registration (the assembly point is `App.tsx`, the only
 * file allowed to import a pack): the Hero's manox submitter (the harness
 * segment's Manox arm), the
 * sidebar's manox group, and the `manox-chat:` sheet kind. Registration is
 * idempotent — `App` renders once, but a hot reload must not throw.
 */

let registered = false;

/** Registers the manox pack with the shell's neutral seams. */
export function registerManoxPack(): void {
  if (registered) return;
  registered = true;
  registerSheetKind({
    kind: "manox-chat",
    glyph: "chat",
    title: manoxChatTitle,
    body: (id) => <ManoxChatBody id={id} />,
  });
  // The Hero's harness segment carries manox now (v2 Hero redesign): the
  // submitter takes the composer's first message; a bare tool row is gone.
  registerHeroSubmitter({
    id: "manox",
    label: "Manox",
    submit: async (text, context) => {
      // The Hero hands a pi ref (`provider/id`); the kernel wants the
      // registration-qualified form the provider bridge registered under.
      const piRef = context.model?.split("/") ?? [];
      const row = piRef.length === 2 ? usableModels().find((r) => r.provider.id === piRef[0] && r.model.id === piRef[1]) : undefined;
      const modelRef = row ? manoxModelRef(row) : context.model;
      const { threadId, chatId } = await createManoxThread({
        cwd: context.cwd,
        model: modelRef,
        effort: context.effort,
      });
      openManoxChat(threadId, chatId);
      sendManoxMessage(threadId, chatId, text);
    },
  });
}

/** Opens (or focuses) a thread's chat sheet on the current canvas. */
export function openManoxChat(threadId: string, chatId: string): void {
  const id = manoxChatSheetId(threadId, chatId);
  noteSheetOpened(id);
  setLayout(appendSheet(layout(), id));
}

/** The tab title of a manox chat sheet: the chat's title, thread fallback. */
function manoxChatTitle(id: string): string {
  const parsed = parseManoxChatSheet(id);
  if (!parsed) return t(K.manox.chatTitle);
  const chat = effectiveState<ChatState>(chatResource(parsed.chatId));
  if (chat?.title) return chat.title;
  const session = effectiveState<SessionState>(sessionResource(parsed.threadId));
  return session?.title ?? t(K.manox.chatTitle);
}
