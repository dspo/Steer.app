/**
 * session/load history replay: pi session data → `session/update` stream.
 *
 * ACP v1 semantics (v2 §4.3): a `session/load` MUST replay the conversation
 * as `session/update` notifications before the load response returns — the
 * updates are how a client that knows nothing about pi files rebuilds its
 * view. The input is pi's own session projection (`SessionManager.
 * buildSessionProjection()`): the compaction-aware, leaf-branch-resolved
 * message list with the provenance of each message's source entry, so the
 * replay shows what the model actually sees and `messageId`s stay stable.
 *
 * Parts of pi session data with no ACP chunk shape are skipped here, on
 * purpose and registered (v2: "pi 会话数据里映射不了的部件跳过并在代码注释登记"):
 *
 *   - `system` messages — pi's own prompt lines, not conversation.
 *   - image blocks inside replayed user messages — the harness declares no
 *     image support (promptCapabilities.image false); replay stays text-only
 *     until a P stage declares images end to end.
 *   - empty or redacted thinking blocks — nothing displayable.
 *   - tool calls whose result never arrived (interrupted turns) — replayed
 *     as `tool_call` left `in_progress`, which is the honest state; the
 *     next `session/load` after a resumed turn shows the settled pair.
 *   - state-only entries (model_change, thinking_level_change, usage, zu.*
 *     custom entries, labels) — pi's projection already drops them from the
 *     message list; they are agent-side state, not conversation.
 *
 * Compaction and branch summaries DO replay: pi's projection resolves them
 * into the summary messages that now stand in the context.
 */

import type { SessionUpdate } from "@agentclientprotocol/sdk";
import { describeToolCall, isRecord, piToolKind } from "./mapping";

/** The one projection entry this module consumes. */
export interface ReplayEntry {
  /** The pi session entry's id — becomes the chunk `messageId`. */
  sourceId: string;
  /** The messages pi's projection resolved this entry into. */
  messages: ReplayMessage[];
}

/** The subset of a pi `AgentMessage` the replay reads. */
export interface ReplayMessage {
  role: string;
  content: unknown;
  toolCallId?: unknown;
  toolName?: unknown;
  isError?: unknown;
}

/** Maps a pi session projection onto the replay update list, in order. */
export function replayUpdates(entries: ReplayEntry[]): SessionUpdate[] {
  const updates: SessionUpdate[] = [];
  for (const entry of entries) {
    for (const message of entry.messages) {
      pushMessage(updates, entry.sourceId, message);
    }
  }
  return updates;
}

function pushMessage(updates: SessionUpdate[], messageId: string, message: ReplayMessage): void {
  switch (message.role) {
    case "user":
      pushUserContent(updates, messageId, message.content);
      return;
    case "assistant":
      pushAssistantContent(updates, messageId, message.content);
      return;
    case "toolResult":
      pushToolResult(updates, message);
      return;
    default:
      // `system` and anything newer: no ACP shape (see header comment).
      return;
  }
}

function pushUserContent(updates: SessionUpdate[], messageId: string, content: unknown): void {
  for (const text of userText(content)) {
    if (text.length > 0) {
      updates.push({ sessionUpdate: "user_message_chunk", content: { type: "text", text }, messageId });
    }
  }
}

function pushAssistantContent(updates: SessionUpdate[], messageId: string, content: unknown): void {
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (!isRecord(block)) continue;
    if (block.type === "text" && typeof block.text === "string" && block.text.length > 0) {
      updates.push({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: block.text }, messageId });
    } else if (block.type === "thinking" && typeof block.thinking === "string" && block.thinking.length > 0) {
      updates.push({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: block.thinking }, messageId });
    } else if (block.type === "toolCall" && typeof block.id === "string" && typeof block.name === "string") {
      updates.push({
        sessionUpdate: "tool_call",
        toolCallId: block.id,
        title: describeToolCall(block.name, block.arguments),
        name: block.name,
        kind: piToolKind(block.name),
        status: "in_progress",
        ...(isRecord(block.arguments) ? { rawInput: block.arguments } : {}),
      });
    }
    // image blocks: skipped (header comment).
  }
}

function pushToolResult(updates: SessionUpdate[], message: ReplayMessage): void {
  if (typeof message.toolCallId !== "string") return;
  const content: Array<{ type: "content"; content: { type: "text"; text: string } }> = [];
  if (Array.isArray(message.content)) {
    for (const block of message.content) {
      if (isRecord(block) && block.type === "text" && typeof block.text === "string" && block.text.length > 0) {
        content.push({ type: "content", content: { type: "text", text: block.text } });
      }
    }
  }
  updates.push({
    sessionUpdate: "tool_call_update",
    toolCallId: message.toolCallId,
    status: message.isError === true ? "failed" : "completed",
    ...(content.length > 0 ? { content } : {}),
  });
}

/** User content is a string or a block list; images and unknown blocks drop. */
function userText(content: unknown): string[] {
  if (typeof content === "string") return [content];
  if (!Array.isArray(content)) return [];
  const texts: string[] = [];
  for (const block of content) {
    if (isRecord(block) && block.type === "text" && typeof block.text === "string") texts.push(block.text);
  }
  return texts;
}
