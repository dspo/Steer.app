import type { AcpUpdate } from "./acp";
import type { Msg } from "../sessions";

/**
 * ACP vocabulary → the session store's fold vocabulary.
 *
 * The store folds engine events (`message.delta`, `tool.start`,
 * `tool.end`) into a session's transcript; a live ACP turn is translated
 * into the same shapes, so the store keeps one fold, whatever the
 * transport. A `session/load` replay is projected straight into transcript
 * rows (the reopen's read, v2 §5.4).
 *
 * Deliberately unfolded in this stage: `agent_thought_chunk` (thinking has
 * no transcript lane yet), mode/model/usage/config updates (the distro does
 * not emit them yet — v2 §12 P3), `session_info` and command tables.
 */

/** A store-shaped event: exactly what `foldStoreEvent` consumes. */
export interface StoreEvent {
  type: string;
  data?: unknown;
}

/** Translates one live update into zero or more store events. */
export function updateToStoreEvents(update: AcpUpdate): StoreEvent[] {
  const kind = update.sessionUpdate;
  if (kind === "agent_message_chunk") {
    const delta = blockText(update.content);
    if (!delta) return [];
    return [{ type: "message.delta", data: { delta } }];
  }
  if (kind === "tool_call") {
    return [
      {
        type: "tool.start",
        data: {
          toolName: String(update.name ?? update.title ?? "tool"),
          toolCallId: update.toolCallId !== undefined ? String(update.toolCallId) : undefined,
        },
      },
    ];
  }
  if (kind === "tool_call_update") {
    const status = String(update.status ?? "");
    if (status !== "completed" && status !== "failed") return [];
    return [
      {
        type: "tool.end",
        data: {
          toolName: update.name !== undefined ? String(update.name) : undefined,
          toolCallId: update.toolCallId !== undefined ? String(update.toolCallId) : undefined,
          isError: status === "failed",
        },
      },
    ];
  }
  return [];
}

/** Projects a `session/load` replay into the transcript's rows. */
export function transcriptFromReplay(updates: AcpUpdate[]): Msg[] {
  const rows: Msg[] = [];
  let lastKey = "";
  for (const update of updates) {
    const kind = update.sessionUpdate;
    if (kind === "user_message_chunk" || kind === "agent_message_chunk") {
      const role: Msg["role"] = kind === "user_message_chunk" ? "user" : "assistant";
      const text = blockText(update.content);
      if (!text) continue;
      const key = update.messageId !== undefined ? String(update.messageId) : "";
      const last = rows[rows.length - 1];
      if (last && last.role === role && key !== "" && key === lastKey) {
        last.text += text;
      } else {
        rows.push({ role, text });
        lastKey = key;
      }
      continue;
    }
    if (kind === "tool_call") {
      rows.push({
        role: "tool",
        text: String(update.title ?? update.name ?? "tool"),
        tool: {
          id: update.toolCallId !== undefined ? String(update.toolCallId) : undefined,
          name: String(update.name ?? "tool"),
          state: "running",
        },
      });
      lastKey = "";
      continue;
    }
    if (kind === "tool_call_update") {
      const id = update.toolCallId !== undefined ? String(update.toolCallId) : "";
      const status = String(update.status ?? "");
      const index = rows.map((row) => row.tool?.id).lastIndexOf(id || undefined);
      if (index >= 0 && (status === "completed" || status === "failed")) {
        const row = rows[index];
        rows[index] = { ...row, tool: { ...(row.tool ?? { name: "tool" }), state: status === "failed" ? "failed" : "done" } };
      }
      lastKey = "";
    }
  }
  // A text row carries content; a tool row always stands (its card is the
  // record of the call even when its result text was empty).
  return rows.filter((row) => row.role === "tool" || row.text.trim().length > 0);
}

/** The text of a content block, when it is textual. */
function blockText(content: unknown): string {
  if (typeof content === "string") return content;
  if (content && typeof content === "object" && !Array.isArray(content)) {
    const text = (content as { text?: unknown }).text;
    if (typeof text === "string") return text;
  }
  if (Array.isArray(content)) {
    return content
      .map(blockText)
      .filter((text) => text.length > 0)
      .join("");
  }
  return "";
}
