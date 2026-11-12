// Vendored from dspo's AHP spec checkout (microsoft/agent-host-protocol):
//   repo:    ~/projects/github/agent-host-protocol  (remote: https://github.com/microsoft/agent-host-protocol.git)
//   commit:  296b25e7b698a4a84a0ee5a28d9573e70048a0bf  (working tree clean at vendoring time)
//   spec:    v0.9.0 (clients/typescript package.json version), LAST_SYNCED_COMMIT file said 20c6b266 (not resolvable locally)
//   pin:     contracts/ahp/PIN.md — read it before syncing; do not edit these files by hand.
// The only transform applied at vendoring time: relative import specifiers lost
// their `.js` suffix (upstream ships ESM `.js` extensions; this app resolves
// extensionless TS). A second transform (contracts/ahp/enums-to-consts.py,
// see PIN.md) rewrites `export const enum` into const objects + unions +
// namespaces: the nsh bundler's oxc cannot transform TS enums. Everything
// else is byte-identical to the pinned commit.
/**
 * Chat Channel Commands — `createChat` and `disposeChat`.
 *
 * @module channels-chat/commands
 */

import type { URI } from '../common/state';
import type { BaseParams } from '../common/commands';
import type { Message, SideChatSelection } from './state';

// ─── createChat ──────────────────────────────────────────────────────────────

/**
 * How a new chat uses its source chat and turn.
 * @nonexhaustive
 */
export const ChatSourceKind = {

  /** Copy source history through the referenced turn into the new chat. */
  Fork: 'fork',
  /** Supply source context without copying it into the new chat's visible history. */
  SideChat: 'sideChat',
} as const;
export type ChatSourceKind = (typeof ChatSourceKind)[keyof typeof ChatSourceKind];
export namespace ChatSourceKind {
  export type Fork = (typeof ChatSourceKind)["Fork"];
  export type SideChat = (typeof ChatSourceKind)["SideChat"];
}

/**
 * Copies source history through a completed turn into the new chat.
 */
export interface ForkChatSource {
  /** Discriminant */
  kind: ChatSourceKind.Fork;
  /** URI of the existing source chat. */
  chat: URI;
  /**
   * Completed turn identifier in the source chat.
   *
   * Content through this turn is copied into the new chat's visible `turns`.
   */
  turnId: string;
}

/**
 * Supplies source context to a new side chat without copying it into the side
 * chat's visible history.
 */
export interface SideChatSource {
  /** Discriminant */
  kind: ChatSourceKind.SideChat;
  /** URI of the existing source chat. */
  chat: URI;
  /**
   * Stable source-turn identifier in the source chat.
   *
   * Hosts resolve this id against the source chat's current `activeTurn` or its
   * retained `turns` when accepting `createChat`. If it names the current
   * active turn, the host snapshots the source chat's retained history plus
   * that turn's current user message and any partial assistant response already
   * available. Once that turn later becomes historical, it is still referenced
   * by this same identifier.
   */
  turnId: string;
  /**
   * Optional immutable selected-text snapshot to carry into the created side
   * chat's origin.
   *
   * When present, the host MUST snapshot and preserve this exact selection when
   * it accepts `createChat`; later source-turn deltas do not alter it.
   */
  selection?: SideChatSelection;
}

/**
 * Identifies a source chat for a new chat.
 */
export type ChatSource =
  | ForkChatSource
  | SideChatSource;

/**
 * Creates a new chat within a session.
 *
 * @category Commands
 * @method createChat
 * @direction Client → Server
 * @messageType Request
 * @version 1
 */
export interface CreateChatParams extends BaseParams {
  /** Session URI containing the new chat. */
  channel: URI;
  /** Chat URI (client-chosen, e.g. `ahp-chat:/<uuid>`). */
  chat: URI;
  /** Optional initial message for the new chat. */
  initialMessage?: Message;
  /**
   * Optional source chat and source turn.
   *
   * The source chat MUST belong to this session. Clients MUST only request
   * `kind: "fork"` when the selected agent advertises
   * `capabilities.multipleChats.fork`, and `kind: "sideChat"` when the
   * selected agent advertises `capabilities.multipleChats.sideChat`. Both
   * source forms carry a stable top-level `turnId`. Forks target completed
   * turns. Side chats also carry a stable `turnId`, which the host resolves
   * against the source chat's current active turn or retained history. If it
   * resolves to the active turn, the host snapshots the currently available
   * partial response when accepting `createChat`. When
   * `source.kind === "sideChat"` and `source.selection` is present, the host
   * also snapshots and preserves that exact selected text in the created chat's
   * origin; any `responsePartId` there is provenance only, not a live range.
   */
  source?: ChatSource;
  /**
   * Initial working-directory subset for this chat. Every entry MUST be
   * present in the owning session's `workingDirectories`; the server MUST
   * reject any entry that is not. When absent, the chat inherits the full
   * session set. Forked chats (those whose `source.kind` is `"fork"`) inherit
   * the source chat's `workingDirectories`; this field is ignored for forks.
   *
   * A client MUST NOT supply this field unless the agent advertises
   * {@link AgentCapabilities.multipleWorkingDirectories}.
   */
  workingDirectories?: URI[];
}

// ─── disposeChat ─────────────────────────────────────────────────────────────

/**
 * Disposes a chat and cleans up server-side resources.
 *
 * @category Commands
 * @method disposeChat
 * @direction Client → Server
 * @messageType Request
 * @version 1
 */
export interface DisposeChatParams extends BaseParams {}
