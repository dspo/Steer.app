import { K, t } from "../../ui/i18n";
import { registerModule } from "../../core/registry";
import { ManoxChatBody } from "./conversation";
import {
  createManoxThread,
  manoxChatSheetId,
  parseManoxChatSheet,
  sendManoxMessage,
} from "./stores";
import { chatOf } from "./stores";
import { layout, noteSheetOpened, setLayout } from "../../core/containers";
import { appendSheet } from "../../core/dock";
import { effectiveState } from "./ahp";
import { manoxModelRef, usableModels } from "../../domains/pimodels";
import type { ChatState } from "../../../contracts/ahp/channels-chat/state";
import type { SessionState } from "../../../contracts/ahp/channels-session/state";
import { chatResource, sessionResource } from "./stores";

/**
 * The manox module (docs/sheet-module-ARCHITECTURE.md §8): one `manox-chat`
 * kind and the Hero's Manox starter. It is a citizen like pi, not an add-on —
 * the assembly point is `App.tsx`, the only file that imports modules.
 */

let registered = false;

/** Registers the manox module with the shell's neutral registry. */
export function registerManoxModule(): void {
  if (registered) return;
  registered = true;
  registerModule({
    id: "manox",
    capabilities: ["manox"],
    kinds: [
      {
        kind: "manox-chat",
        glyph: "chat",
        title: manoxChatTitle,
        body: ({ id }) => <ManoxChatBody id={id} />,
        parse: (id) => parseManoxChatSheet(id),
      },
    ],
    hero: {
      starters: [
        {
          id: "manox",
          label: "Manox",
          submit: async (text, context) => {
            // The Hero hands a pi ref (`provider/id`); the kernel wants the
            // registration-qualified form the provider bridge registered under.
            const piRef = context.model?.split("/") ?? [];
            const row =
              piRef.length === 2
                ? usableModels().find((r) => r.provider.id === piRef[0] && r.model.id === piRef[1])
                : undefined;
            const modelRef = row ? manoxModelRef(row) : context.model;
            const { threadId, chatId } = await createManoxThread({
              cwd: context.cwd,
              model: modelRef,
              effort: context.effort,
            });
            openManoxChat(threadId, chatId);
            sendManoxMessage(threadId, chatId, text);
          },
        },
      ],
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
