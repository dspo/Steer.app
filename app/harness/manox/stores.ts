import { signal } from "nsh";
import { ActionType, catalog, channels, createChatOn, createSessionOn, dispatchAction, effectiveState, ensureConnection } from "./ahp";
import type { ChannelCell } from "./ahp";
import type { SessionSummary } from "../../../contracts/ahp/channels-session/state";
import type { SessionState } from "../../../contracts/ahp/channels-session/state";
import type { ChatState } from "../../../contracts/ahp/channels-chat/state";
import type { URI } from "../../../contracts/ahp/common/state";

/**
 * The manox threads and chats stores (DESIGN §3.3/§4.2): a thread is a
 * manox container (`manox:{threadId}`, the sidebar's row — AHP `ahp-session`),
 * a chat is a manox session sheet (`manox-chat:{threadId}:{chatId}` — AHP
 * `ahp-chat`). Container organization rides the shell's existing mechanisms;
 * the archived bit is the `session/isArchivedChanged` action folded into the
 * session state's `IsArchived` flag — no shadow copy anywhere — so the
 * sidebar projection below just reads the fold.
 */

/** A thread row: what the sidebar shows, what the sheet opens. */
export interface ManoxThread {
  threadId: string;
  uri: URI;
  title: string;
  /** The chat the sheet opens (the session's defaultChat). */
  defaultChatId: string | null;
  archived: boolean;
  /** The cwd-like subtitle (the session's first working directory). */
  subtitle: string;
}

/** The stable container id of a thread. */
export function threadContainerId(threadId: string): string {
  return `manox:${threadId}`;
}

/** The sheet id of a thread's chat. */
export function manoxChatSheetId(threadId: string, chatId: string): string {
  return `manox-chat:${threadId}:${chatId}`;
}

/** Parses a `manox-chat:` sheet id into its thread and chat. */
export function parseManoxChatSheet(id: string): { threadId: string; chatId: string } | null {
  if (!id.startsWith("manox-chat:")) return null;
  const rest = id.slice("manox-chat:".length);
  const at = rest.indexOf(":");
  if (at < 0) return null;
  return { threadId: rest.slice(0, at), chatId: rest.slice(at + 1) };
}

/** The AHP chat URI of a chat id. */
export function chatResource(chatId: string): URI {
  return `ahp-chat:/${chatId}`;
}

/** The AHP session URI of a thread id. */
export function sessionResource(threadId: string): URI {
  return `ahp-session:/${threadId}`;
}

/** The chat id a chat URI names. */
function chatIdOf(uri: URI): string {
  return uri.startsWith("ahp-chat:/") ? uri.slice("ahp-chat:/".length) : uri;
}

function sessionCellOf(threadId: string): ChannelCell | null {
  return channels()[sessionResource(threadId)] ?? null;
}

/** Whether a folded session state carries the IsArchived flag (bit 64). */
export function isArchived(threadId: string): boolean {
  const state = effectiveState<SessionState>(sessionResource(threadId));
  return state != null && ((state.status ?? 0) & 64) !== 0;
}

/** Every thread the catalog knows, newest summary first, archived last. */
export function threads(): ManoxThread[] {
  const rows = Object.values(catalog()).map((summary) => toThread(summary));
  return rows.sort((a, b) => {
    if (a.archived !== b.archived) return a.archived ? 1 : -1;
    return a.threadId < b.threadId ? -1 : 1;
  });
}

function toThread(summary: SessionSummary): ManoxThread {
  const threadId = summary.resource.replace("ahp-session:/", "");
  const state = effectiveState<SessionState>(summary.resource);
  const chatIds = (state?.chats ?? summary.chats ?? []).map((chat) =>
    chatIdOf(chat.resource),
  );
  const defaultChat = state?.defaultChat ?? summary.defaultChat ?? null;
  return {
    threadId,
    uri: summary.resource,
    title: summary.title,
    defaultChatId: defaultChat ? chatIdOf(defaultChat) : chatIds[0] ?? null,
    archived: ((state?.status ?? summary.status ?? 0) & 64) !== 0,
    subtitle: state?.workingDirectories?.[0] ?? "",
  };
}

/** One thread by id (from the catalog). */
export function threadOf(threadId: string): ManoxThread | null {
  const summary = catalog()[sessionResource(threadId)];
  return summary ? toThread(summary) : null;
}

/** The folded chat state of a chat id, optimistic layer included. */
export function chatOf(chatId: string): ChatState | null {
  return effectiveState<ChatState>(chatResource(chatId));
}

/** Mints a client-side uuid (the protocol hands channel minting to clients). */
export function mintId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `id-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  }
}

/**
 * Creates a thread with its first chat: the client mints both uuids,
 * `createSession` is idempotent by design, and both channels subscribe —
 * after the creates, because a subscribe for a channel the host does not
 * have yet is a refusal, not an empty snapshot. Returns the chat id the
 * sheet opens.
 */
export async function createManoxThread(): Promise<{ threadId: string; chatId: string }> {
  const threadId = mintId();
  const chatId = mintId();
  await ensureConnection();
  await createSessionOn(sessionResource(threadId), { provider: "stub" });
  await createChatOn(sessionResource(threadId), chatResource(chatId));
  await ensureConnection([sessionResource(threadId), chatResource(chatId)]);
  return { threadId, chatId };
}

/**
 * Sends one user message: the client mints the turn (the protocol's
 * `chat/turnStarted` is client-dispatchable; the host folds and runs its
 * scripted reply). Optimistic: the ledger holds it until the echo.
 */
export function sendManoxMessage(threadId: string, chatId: string, text: string): void {
  const chat = chatOf(chatId);
  if (chat?.activeTurn) return;
  dispatchAction(chatResource(chatId), {
    type: ActionType.ChatTurnStarted,
    turnId: mintId(),
    startedAt: new Date().toISOString(),
    message: { text, origin: { kind: "user" } },
  } as never);
  void threadId;
}

/** Cancels the chat's active turn (the turn id is the active one's). */
export function cancelManoxTurn(chatId: string): void {
  const chat = chatOf(chatId);
  const active = chat?.activeTurn;
  if (!active) return;
  const elapsed = Math.max(0, Date.now() - Date.parse(active.startedAt));
  dispatchAction(chatResource(chatId), {
    type: ActionType.ChatTurnCancelled,
    turnId: active.id,
    duration: elapsed,
  } as never);
}

/** Approves the tool call waiting on the chat (the minimal approval card). */
export function confirmManoxToolCall(chatId: string, turnId: string, toolCallId: string): void {
  dispatchAction(chatResource(chatId), {
    type: ActionType.ChatToolCallConfirmed,
    turnId,
    toolCallId,
    approved: true,
    confirmed: "user-action",
  } as never);
}

/** Denies the tool call (the minimal card's deny). */
export function denyManoxToolCall(chatId: string, turnId: string, toolCallId: string): void {
  dispatchAction(chatResource(chatId), {
    type: ActionType.ChatToolCallConfirmed,
    turnId,
    toolCallId,
    approved: false,
    reason: "denied",
  } as never);
}

/**
 * Answers the chat's open elicitation with one of the three actions
 * (accept/decline/cancel); `text` carries a text question's answer.
 */
export function answerManoxInput(
  chatId: string,
  requestId: string,
  response: "accept" | "decline" | "cancel",
  text?: string,
): void {
  const chat = chatOf(chatId);
  const part = chat?.activeTurn?.responseParts.find(
    (candidate) => candidate.kind === "inputRequest" && candidate.request.id === requestId,
  );
  const questions = part?.kind === "inputRequest" ? part.request.questions ?? [] : [];
  const answers: Record<string, { state: "submitted"; value: { kind: "text"; value: string } }> = {};
  for (const question of questions) {
    if (question.kind === "text") {
      answers[question.id] = {
        state: "submitted",
        value: { kind: "text", value: text ?? "" },
      };
    }
  }
  dispatchAction(chatResource(chatId), {
    type: ActionType.ChatInputCompleted,
    requestId,
    response,
    answers: Object.keys(answers).length > 0 ? answers : undefined,
  } as never);
}

/**
 * The sidebar projection: one row per live thread (archived ones drop — the
 * archived bit is the folded `IsArchived` flag). The shell renders what this
 * contributes through the neutral seam; the pack owns the vocabulary.
 */
export interface ManoxSidebarRow {
  id: string;
  title: string;
  subtitle: string;
  active: boolean;
  threadId: string;
  chatId: string;
}

export function sidebarRows(activeContainerId: string | null): ManoxSidebarRow[] {
  return threads()
    .filter((thread) => !thread.archived)
    .filter((thread) => thread.defaultChatId != null)
    .map((thread) => ({
      id: threadContainerId(thread.threadId),
      title: thread.title,
      subtitle: thread.subtitle,
      active: activeContainerId === threadContainerId(thread.threadId),
      threadId: thread.threadId,
      chatId: thread.defaultChatId!,
    }));
}

/** Test seam: resets the stores' fold state (fixtures start fresh). */
export function resetStoresForTest(): void {
  channels.set({});
  catalog.set({});
}
