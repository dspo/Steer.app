import { K, t } from "../../ui/i18n";
import { registerModule } from "../../core/registry";
import { ManoxChatBody } from "./conversation";
import { createManoxThread, manoxChatSheetId, parseManoxChatSheet, manoxThreadContainerId } from "./stores";
import { programTitle } from "./titles";
import { activeContainerId, createContainerRecord, layout, noteSheetOpened, setLayout, switchContainer } from "../../core/containers";
import { appendSheet } from "../../core/dock";
import { chatsCwd } from "../../core/workspace";
import { effectiveState } from "./ahp";
import type { ChatState } from "../../../contracts/ahp/channels-chat/state";
import type { SessionState } from "../../../contracts/ahp/channels-session/state";
import { chatResource, sessionResource } from "./stores";

/**
 * The manox module (docs/sheet-module-ARCHITECTURE.md §8): one `manox-chat`
 * kind and the start page's Manox entry. It is a citizen like pi, not an
 * add-on — the assembly point is `App.tsx`, the only file that imports
 * modules.
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
        // Issue #73: a tool's OSC title renames this chat's tab and
        // nothing else — the container keeps the session's own name.
        tabTitle: (id) => {
          const parsed = parseManoxChatSheet(id);
          return parsed ? programTitle(parsed.threadId) : "";
        },
        body: ({ id }) => <ManoxChatBody id={id} />,
        parse: (id) => parseManoxChatSheet(id),
      },
    ],
    launchers: [
      {
        id: "manox",
        label: () => "Manox",
        glyph: "chat",
        group: "conversation",
        order: 20,
        asksProject: true,
        instantiate: async (context) => {
          const cwd = context.cwd ?? (await chatsCwd());
          if (!cwd) throw new Error("no folder to start the conversation in");
          const { threadId, chatId } = await createManoxThread({ cwd });
          const sheetId = manoxChatSheetId(threadId, chatId);
          // A thread is a chat instance, never a container: in a container
          // every press adds another chat sheet; outside one, the first chat
          // mints a container that owns it. A switch during create still
          // lands the sheet in the container the user pressed from.
          if (context.containerId) {
            if (activeContainerId() !== context.containerId) await switchContainer(context.containerId);
            noteSheetOpened(sheetId);
            setLayout(appendSheet(layout(), sheetId));
            return;
          }
          await createContainerRecord({
            id: manoxThreadContainerId(threadId),
            cwd,
            projectId: context.projectId,
            sheets: [sheetId],
          });
        },
      },
    ],
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
