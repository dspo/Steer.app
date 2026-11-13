import { K, t } from "../../ui/i18n";
import {
  registerHeroSubmitter,
  registerSheetKind,
  setSidebarSection,
  type ContributedSection,
} from "../../shell/contrib";
import { ManoxChatBody } from "./conversation";
import {
  createManoxThread,
  manoxChatSheetId,
  parseManoxChatSheet,
  sendManoxMessage,
  sidebarRows,
} from "./stores";
import { chatOf } from "./stores";
import { activeContainerId, layout, noteSheetOpened, setLayout } from "../../stores/containers";
import { appendSheet } from "../../stores/dock";
import { effectiveState } from "./ahp";
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
      const { threadId, chatId } = await createManoxThread({
        cwd: context.cwd,
        model: context.model,
      });
      openManoxChat(threadId, chatId);
      sendManoxMessage(threadId, chatId, text);
    },
  });
  setSidebarSection(manoxSection());
}

/** The sidebar's manox group: one row per live thread. */
function manoxSection(): ContributedSection {
  return {
    key: "manox",
    title: () => t(K.manox.sidebarTitle),
    rows: () =>
      sidebarRows(null).map((row) => ({
        id: row.id,
        glyph: "chat" as const,
        testID: `manox-thread-${row.threadId}`,
        title: () => row.title,
        subtitle: () => row.subtitle,
        active: () => activeContainerId() === row.id,
        onPress: () => openManoxChat(row.threadId, row.chatId),
      })),
  };
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
