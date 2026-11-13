/**
 * pi vocabulary → ACP vocabulary, as pure functions.
 *
 * These are the v2 §5.2 core mappings: prompt content blocks into pi prompt
 * text, streaming deltas into `agent_message_chunk` / `agent_thought_chunk`,
 * tool executions into `tool_call` / `tool_call_update`, and pi's message
 * stop reasons into ACP stop reasons. The module is dependency-free beyond
 * ACP types, so `bun test` exercises it without pi and without network.
 *
 * Deliberately absent here (later P stages, per docs/pi-acp-PROTOCOL.md):
 * thinking levels as session modes, model selection, compaction state events,
 * usage updates, permission requests, `_session/steering`.
 */

import type { ContentBlock, SessionUpdate, StopReason, ToolKind } from "@agentclientprotocol/sdk";
import { JSONRPC_CODE, codedError, type RequestError } from "./errors";

/**
 * ContentBlock[] → the prompt text pi's `session.prompt` takes.
 *
 * ACP's baseline requires text and `resource_link`; a `resource_link` is a
 * pointer the client resolved for the user, so it goes into the prompt as a
 * markdown link. Everything else is a declared no (the initialize reply says
 * so through `promptCapabilities`), refused with a coded invalid-params error
 * rather than silently dropped.
 */
export function promptBlocksToText(
  blocks: ContentBlock[],
): { ok: true; text: string } | { ok: false; error: RequestError } {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return {
      ok: false,
      error: codedError(JSONRPC_CODE.invalidParams, "empty_prompt", "session/prompt needs at least one content block"),
    };
  }
  let text = "";
  for (const block of blocks) {
    switch (block?.type) {
      case "text":
        text += block.text;
        break;
      case "resource_link":
        text += `[${block.name ?? block.uri}](${block.uri})`;
        break;
      case "image":
        return {
          ok: false,
          error: codedError(
            JSONRPC_CODE.invalidParams,
            "image_not_supported",
            "this harness does not accept image content blocks (promptCapabilities.image is false)",
          ),
        };
      case "audio":
        return {
          ok: false,
          error: codedError(
            JSONRPC_CODE.invalidParams,
            "audio_not_supported",
            "this harness does not accept audio content blocks (promptCapabilities.audio is false)",
          ),
        };
      case "resource":
        return {
          ok: false,
          error: codedError(
            JSONRPC_CODE.invalidParams,
            "embedded_context_not_supported",
            "this harness does not accept embedded resource blocks (promptCapabilities.embeddedContext is false)",
          ),
        };
      default:
        return {
          ok: false,
          error: codedError(
            JSONRPC_CODE.invalidParams,
            "content_block_not_supported",
            `unsupported content block type: ${String((block as { type?: unknown })?.type)}`,
          ),
        };
    }
  }
  if (text.trim().length === 0) {
    return {
      ok: false,
      error: codedError(JSONRPC_CODE.invalidParams, "empty_prompt", "session/prompt carries no text"),
    };
  }
  return { ok: true, text };
}

/**
 * pi tool names → ACP tool kinds. The host renders the generic card
 * (title/kind/status/locations) and never specializes on pi tool names
 * (v2 §2.5/§5.2).
 */
export function piToolKind(toolName: string): ToolKind {
  const name = toolName.toLowerCase();
  if (["read", "ls", "find", "view"].includes(name)) return "read";
  if (["grep", "glob", "search"].includes(name)) return "search";
  if (["edit", "write", "multiedit", "patch", "apply_patch"].includes(name)) return "edit";
  if (["rm", "delete", "remove"].includes(name)) return "delete";
  if (["mv", "move"].includes(name)) return "move";
  if (["bash", "execute", "run"].includes(name)) return "execute";
  if (["think", "plan", "thinking"].includes(name)) return "think";
  if (["fetch", "webfetch", "web_search", "browser"].includes(name)) return "fetch";
  return "other";
}

/** The arg keys a card title may quote, most salient first. */
const TITLE_ARG_KEYS = ["path", "file_path", "command", "pattern", "url", "query", "name", "description"];

/** A short human title for a tool card: the tool plus its salient argument. */
export function describeToolCall(toolName: string, args: unknown): string {
  if (!isRecord(args)) return toolName;
  for (const key of TITLE_ARG_KEYS) {
    const value = args[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return `${toolName} ${truncate(value.trim())}`;
    }
  }
  return toolName;
}

/** `tool_execution_start` → a `tool_call` update (the card opens). */
export function toolCallStartUpdate(toolCallId: string, toolName: string, args: unknown): SessionUpdate {
  const locations =
    isRecord(args) && typeof args.path === "string" && args.path.length > 0 ? [{ path: args.path }] : undefined;
  return {
    sessionUpdate: "tool_call",
    toolCallId,
    title: describeToolCall(toolName, args),
    name: toolName,
    kind: piToolKind(toolName),
    status: "in_progress",
    ...(isRecord(args) ? { rawInput: args } : {}),
    ...(locations ? { locations } : {}),
  };
}

/**
 * `tool_execution_update` → a `tool_call_update` with the partial output as
 * text when it has a textual shape; anything else is left out rather than
 * stringified blindly (the final update carries the result).
 */
export function toolCallPartialUpdate(toolCallId: string, partialResult: unknown): SessionUpdate | undefined {
  const text = partialText(partialResult);
  if (text === undefined) return undefined;
  return {
    sessionUpdate: "tool_call_update",
    toolCallId,
    status: "in_progress",
    content: [{ type: "content", content: { type: "text", text } }],
  };
}

/** `tool_execution_end` → the card settles: completed or failed. */
export function toolCallEndUpdate(toolCallId: string, result: unknown, isError: boolean): SessionUpdate {
  const content = toolResultContent(result);
  return {
    sessionUpdate: "tool_call_update",
    toolCallId,
    status: isError ? "failed" : "completed",
    ...(content.length > 0 ? { content } : {}),
  };
}

/**
 * A streaming assistant delta → its chunk update. Only text and thinking
 * deltas are protocol chunks; tool-call argument deltas are transport detail
 * (the tool card comes from the execution events) and yield `undefined`.
 */
export function assistantDeltaUpdate(
  assistantMessageEvent: unknown,
  messageId: string,
): SessionUpdate | undefined {
  if (!isRecord(assistantMessageEvent)) return undefined;
  const { type, delta } = assistantMessageEvent;
  if (typeof delta !== "string" || delta.length === 0) return undefined;
  if (type === "text_delta") {
    return { sessionUpdate: "agent_message_chunk", content: { type: "text", text: delta }, messageId };
  }
  if (type === "thinking_delta") {
    return { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: delta }, messageId };
  }
  return undefined;
}

/**
 * pi's message stop reason → the `session/prompt` stopReason.
 *
 * `error` maps to `end_turn` because ACP stop reasons have no error case; the
 * error text itself streams as an `agent_message_chunk` (see pi-session), so
 * the client still sees why the turn ended. `toolUse` never ends a settled
 * turn; `deferred` (pi continues asynchronously) is reported as `end_turn`
 * until a P stage gives it a real shape.
 */
export function stopReasonFromPi(piStopReason: string | undefined): StopReason {
  switch (piStopReason) {
    case "aborted":
      return "cancelled";
    case "length":
      return "max_tokens";
    default:
      return "end_turn";
  }
}

/** Extracts displayable text from a pi tool result object. */
export function toolResultContent(result: unknown): Array<{ type: "content"; content: { type: "text"; text: string } }> {
  if (!isRecord(result) || !Array.isArray(result.content)) return [];
  const content: Array<{ type: "content"; content: { type: "text"; text: string } }> = [];
  for (const block of result.content) {
    if (isRecord(block) && block.type === "text" && typeof block.text === "string" && block.text.length > 0) {
      content.push({ type: "content", content: { type: "text", text: block.text } });
    }
    // Image results are dropped here: the harness declares no image support
    // on the prompt side, and a tool card image would render unexplained.
  }
  return content;
}

/** Text from a partial tool update when it carries any. */
function partialText(partialResult: unknown): string | undefined {
  if (typeof partialResult === "string" && partialResult.length > 0) return partialResult;
  if (isRecord(partialResult)) {
    if (typeof partialResult.text === "string" && partialResult.text.length > 0) return partialResult.text;
    // pi tool streams expose partial output as content blocks too.
    if (Array.isArray(partialResult.content)) {
      const texts = partialResult.content
        .filter((block): block is { type: "text"; text: string } => isRecord(block) && block.type === "text")
        .map((block) => block.text)
        .filter((text) => typeof text === "string" && text.length > 0);
      if (texts.length > 0) return texts.join("");
    }
  }
  return undefined;
}

function truncate(value: string, max = 80): string {
  const line = value.split("\n")[0] ?? value;
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
