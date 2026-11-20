import { signal } from "nsh";
import { Manox, type ModelCatalog } from "../../domains/manox";
import { ActionType, catalog, channels, createSessionOn, dispatchAction, effectiveState, ensureConnection } from "./ahp";
import type { ChannelCell } from "./ahp";
import type { ReasoningTiming, XManoxState } from "./ext";
import type { SessionSummary } from "../../../contracts/ahp/channels-session/state";
import type { SessionState } from "../../../contracts/ahp/channels-session/state";
import type { ChatState } from "../../../contracts/ahp/channels-chat/state";
import type { SessionConfigChangedAction } from "../../../contracts/ahp/channels-session/actions";
import type { URI, UsageInfo } from "../../../contracts/ahp/common/state";

/**
 * The manox threads and chats stores (DESIGN §3.3/§4.2): a thread is an AHP
 * `ahp-session` (one instance created by `[Manox]`), a chat is one session
 * sheet (`manox-chat:{threadId}:{chatId}` — AHP `ahp-chat`). A thread is NOT
 * a container: Zu's container owns one or more chats (issue #55 / #53).
 * The archived bit is the `session/isArchivedChanged` action folded into the
 * session state's `IsArchived` flag — no shadow copy anywhere.
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
export function manoxThreadContainerId(threadId: string): string {
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

/** The metrics extension channel of a chat (the kernel's `x-manox` face). */
export function metricsResource(chatId: string): URI {
  return `x-manox-metrics:/${chatId}`;
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

/** The folded session state of a thread (null before its snapshot). */
export function sessionOf(threadId: string): SessionState | null {
  return effectiveState<SessionState>(sessionResource(threadId));
}

/**
 * One session config value: the fold's explicit value when it has one, else
 * the schema's default (the schema is what the host advertises the property
 * with; an absent value means the default is in force).
 */
export function sessionConfigValue(threadId: string, key: string): unknown {
  const config = sessionOf(threadId)?.config;
  if (!config) return undefined;
  return key in config.values ? config.values[key] : config.schema.properties[key]?.default;
}

/**
 * The usage the context ring shows: the active turn's when one runs, else the
 * last completed turn's. It is last-turn context — a settled accounting, not
 * pi's live `session.info` gauge.
 */
export function latestChatUsage(chatId: string): UsageInfo | null {
  const chat = chatOf(chatId);
  if (!chat) return null;
  if (chat.activeTurn?.usage) return chat.activeTurn.usage;
  for (let index = chat.turns.length - 1; index >= 0; index--) {
    const usage = chat.turns[index]?.usage;
    if (usage) return usage;
  }
  return null;
}

/** One reasoning part's settled timing, from the chat's metrics channel.
 * Null when the kernel carries no row — a part that predates the anchor, or
 * a kernel without the face — and the label stays durationless rather than
 * guessed. */
export function reasoningTimingOf(chatId: string, partId: string): ReasoningTiming | null {
  const state = effectiveState<XManoxState>(metricsResource(chatId));
  return state?.reasoningTimings?.[partId] ?? null;
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
 * Creates a thread: the client mints the session uuid and `createSession` is
 * idempotent by design. The real host holds ONE journal per session — the
 * default chat exists from the create, named by the session's own id — so
 * there is no `createChat` leg; the chat id is read back from the session
 * fold once its channel subscribes. Returns the chat id the sheet opens.
 */
export async function createManoxThread(
  options: { cwd?: string | null; model?: string | null; effort?: string | null } = {},
): Promise<{ threadId: string; chatId: string }> {
  const threadId = mintId();
  await ensureConnection();
  // The Hero's context rides createSession: the project's primary root as the
  // working directory (none for Chats — the kernel anchors on home), and the
  // selected model as the session config (the machine's pi list, not cx's).
  await createSessionOn(sessionResource(threadId), {
    ...(options.cwd ? { workingDirectories: [`file://${options.cwd}`] } : {}),
    ...((options.model || options.effort) && {
      config: {
        ...(options.model ? { model: options.model } : {}),
        ...(options.effort && options.effort !== "off" ? { reasoningEffort: options.effort } : {}),
      },
    }),
  });
  await ensureConnection([sessionResource(threadId)]);
  // The session fold names the default chat (AHP 1.0's one-chat catalogue);
  // the session id is the fallback while the snapshot is in flight.
  const state = effectiveState<SessionState>(sessionResource(threadId));
  const chat = state?.defaultChat ?? state?.chats?.[0]?.resource ?? chatResource(threadId);
  await ensureConnection([chat]);
  return { threadId, chatId: chatIdOf(chat) };
}

/**
 * Sends one user message: the client mints the turn (the protocol's
 * `chat/turnStarted` is client-dispatchable; the host folds it, the echo
 * fills the ledger, and the kernel runs the turn — its projection streams
 * the response parts back on the same channel). Optimistic: the ledger
 * holds it until the echo.
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

/** The host's callable model directory, cached for this process (issue #55).
 * It is a host query, not a pi module computation: the same builder feeds
 * the kernel's provider registry, so every ref here is actually callable.
 * One in-flight request is shared, so a composer mount cannot stack several
 * host reads (each of which re-registers providers). */
let modelsCache: ModelCatalog | null = null;
let modelsPending: Promise<ModelCatalog> | null = null;

/** Test seam: resets the stores' fold state (fixtures start fresh). */
export function resetStoresForTest(): void {
  channels.set({});
  catalog.set({});
  modelsCache = null;
  modelsPending = null;
}

export async function manoxModels(refresh = false): Promise<ModelCatalog> {
  if (!refresh && modelsCache) return modelsCache;
  if (!refresh && modelsPending) return modelsPending;
  const request = Promise.resolve()
    .then(() => Manox.models())
    .then((catalog) => {
      modelsCache = catalog;
      return catalog;
    });
  modelsPending = request;
  try {
    return await request;
  } finally {
    if (modelsPending === request) modelsPending = null;
  }
}

/** The config ref of a model, from the host directory or the session's own
 * current value (which may name a model the directory no longer lists). */
export function currentModelRef(threadId: string): string {
  const value = effectiveState<SessionState>(sessionResource(threadId))?.config?.values?.["model"];
  return typeof value === "string" ? value : "";
}

/** Changes a session config field through AHP. The kernel applies the model
 * on the next turn (AHP `SessionConfigChanged` → `apply_session_config`). */
export function setManoxConfig(threadId: string, config: Record<string, unknown>): void {
  const action: SessionConfigChangedAction = {
    type: ActionType.SessionConfigChanged,
    config,
  };
  dispatchAction(sessionResource(threadId), action);
}

/** Selects a model by its canonical host ref; takes effect on the next turn. */
export function setManoxModel(threadId: string, ref: string): void {
  setManoxConfig(threadId, { model: ref });
}

/** The host runtime's mutable effort subset is high|max (issue #55). */
export function setManoxEffort(threadId: string, effort: "high" | "max"): void {
  setManoxConfig(threadId, { reasoningEffort: effort });
}

/** Test seam: puts one chat's folded state in the channel map, so a fixture
 * renders a conversation without a host (see `setEnsureConnectionForTest`). */
export function seedChatForTest(chatId: string, state: ChatState): void {
  const uri = chatResource(chatId);
  channels.set({ ...channels(), [uri]: { uri, serverSeq: 1, state, pending: [] } });
}

/** Test seam: puts one chat's metrics cell in the channel map (the same
 * no-host trick, for the extension face's timing rows). */
export function seedMetricsForTest(chatId: string, state: XManoxState): void {
  const uri = metricsResource(chatId);
  channels.set({ ...channels(), [uri]: { uri, serverSeq: 1, state, pending: [] } });
}
