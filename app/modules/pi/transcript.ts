import type { AcpUpdate } from "./acp/acp";

/**
 * The transcript's native shape: ACP `SessionUpdate` payloads in, entries
 * out (issue #20 §5.5). There is no translation layer — live updates and a
 * `session/load` replay feed the same `reduceTranscript`, and what lands in
 * the store is what the distro said, in ACP vocabulary: tool states stay
 * `ToolCallStatus`, stop reasons stay ACP words. Message identity is the ACP
 * id alone (`messageId`, `toolCallId`; the settle marker's `_meta.pi.
 * entryId`), so a replayed transcript and a live one agree row for row.
 *
 * `_meta.pi` carries what ACP has no field for (timestamps, the model, the
 * settle facts); `_meta.zu` carries a tool card's render facts. Trimmed
 * against the reference design: no images, no navigate/regenerate, no
 * plan/compaction storage — those are other issues' scope.
 */

/** The distro's `_meta.pi` payload (pi-harness mapping.ts). */
export interface PiMeta {
  at?: number;
  model?: { provider: string; id: string; name?: string };
  entryId?: string;
  settled?: boolean;
  durationMs?: number;
  stopReason?: string;
  error?: string;
}

/** The distro's `_meta.zu` payload on a tool end frame (pi-harness mapping.ts). */
export interface ToolMeta {
  durationMs?: number;
  exitCode?: number;
  truncated?: boolean;
  totalLines?: number;
  fullOutputPath?: string;
  /** The live result's structured payload (`_meta.zu.details`); a replay
   * never carries one (pi does not persist it). */
  details?: unknown;
}

/** ACP `ToolCallStatus`, verbatim. */
export type ToolStatus = "pending" | "in_progress" | "completed" | "failed";

/** `ToolCallContent.diff`, the edit a tool made. */
export interface DiffBlock {
  path?: string;
  oldText?: string | null;
  newText: string;
}

/** The user's own message. */
export interface UserEntry {
  kind: "user";
  id: string;
  text: string;
  pi?: PiMeta;
}

/** An assistant reply: its text, its thinking, its settle facts. */
export interface AssistantEntry {
  kind: "assistant";
  id: string;
  text: string;
  /** The thinking deltas that preceded the text, folded for the collapse. */
  thoughts?: string;
  pi?: PiMeta;
}

/** One tool call: the card, keyed by `toolCallId`. */
export interface ToolEntry {
  kind: "tool";
  id: string;
  toolCallId: string;
  title: string;
  name?: string;
  /** ACP `ToolKind` (read/search/edit/execute/…), verbatim. */
  toolKind?: string;
  status: ToolStatus;
  rawInput?: unknown;
  /** The joined text of the result's content blocks (the output lane). */
  output: string;
  /** `ToolCallContent.diff` blocks the result carried (an edit's changes). */
  diffs: DiffBlock[];
  locations?: Array<{ path: string }>;
  /** The end frame's `_meta.zu`; a replay has none (a known gap). */
  meta?: ToolMeta;
}

/** An extension notice (the `notice` update's transcript lane). */
export interface NoteEntry {
  kind: "note";
  id: string;
  severity?: string;
  text: string;
}

export type Entry = UserEntry | AssistantEntry | ToolEntry | NoteEntry;

/** The assistant message that is still streaming; the settle marker folds
 * it into `entries` under its real entry id. */
export interface TranscriptDraft {
  id: string;
  text: string;
  thoughts?: string;
  pi?: PiMeta;
}

/** One session's transcript. */
export interface TranscriptState {
  entries: Entry[];
  draft: TranscriptDraft | null;
  /** The live message id the open deltas belong to. A live turn streams
   * under its own `mN` id while the settle marker carries pi's entry id; the
   * id lets a reply a tool card already flushed settle onto its own row
   * instead of opening an empty second one. */
  activeId?: string;
  /** Private id minting for identity-less payloads (notices, local rows). */
  seq: number;
}

export function emptyTranscript(): TranscriptState {
  return { entries: [], draft: null, seq: 0 };
}

/**
 * Reduces one ACP update into the transcript. Pure: it returns the next
 * state and never touches a signal, so a replay (`reduceUpdates`) and a
 * live turn take the same path.
 */
export function reduceTranscript(state: TranscriptState, update: AcpUpdate): TranscriptState {
  switch (update.sessionUpdate) {
    case "user_message_chunk":
      return reduceUserChunk(state, update);
    case "agent_message_chunk":
      return reduceAgentChunk(state, update);
    case "agent_thought_chunk":
      return reduceThoughtChunk(state, update);
    case "tool_call":
      return reduceToolCall(state, update);
    case "tool_call_update":
      return reduceToolCallUpdate(state, update);
    case "notice":
      return reduceNotice(state, update);
    default:
      // Protocol state (config/mode/usage/commands/info/banner) is the
      // host's projection, not transcript rows.
      return state;
  }
}

/** Folds a whole replay (or any update list) through the reducer. */
export function reduceUpdates(updates: AcpUpdate[]): TranscriptState {
  let state = emptyTranscript();
  for (const update of updates) state = reduceTranscript(state, update);
  return state;
}

// --- chunks ----------------------------------------------------------------

/**
 * Lands the open draft into `entries` as it stands. Called whenever another
 * row must precede the reply's settle (a tool card inside the same pi
 * message, the next user prompt after an interruption): the settle marker
 * later finds the entry by id and adds the facts it lacked. `exceptId`
 * spares the draft the incoming chunk is still growing.
 */
function flushDraft(state: TranscriptState, exceptId?: string): TranscriptState {
  const draft = state.draft;
  if (!draft || draft.id === exceptId) return state;
  return {
    ...state,
    entries: [
      ...state.entries,
      {
        kind: "assistant",
        id: draft.id,
        text: draft.text,
        ...(draft.thoughts ? { thoughts: draft.thoughts } : {}),
        ...(draft.pi ? { pi: { ...draft.pi } } : {}),
      },
    ],
    draft: null,
  };
}

function reduceUserChunk(state: TranscriptState, update: AcpUpdate): TranscriptState {
  const meta = piMetaOf(update);
  const text = textOf(update.content);
  const id = meta?.entryId ?? idOf(update.messageId);
  if (!id || !text) return state;
  const base = flushDraft(state);
  const entries = [...base.entries];
  const last = entries[entries.length - 1];
  if (last?.kind === "user" && last.id === id) {
    entries[entries.length - 1] = { ...last, text: last.text + text };
    return { ...base, entries };
  }
  // The optimistic row is ours: when the real chunk arrives with the same
  // words, the row re-keys onto the ACP id in place.
  if (last?.kind === "user" && isPendingId(last.id) && last.text === text) {
    entries[entries.length - 1] = { ...last, id, pi: meta ?? last.pi };
    return { ...base, entries };
  }
  entries.push({ kind: "user", id, text, ...(meta ? { pi: meta } : {}) });
  return { ...base, entries };
}

function reduceAgentChunk(state: TranscriptState, update: AcpUpdate): TranscriptState {
  const meta = piMetaOf(update);
  if (meta?.settled) return settleDraft(state, meta);
  const text = textOf(update.content);
  if (!text) return state;
  const target = meta?.entryId ?? idOf(update.messageId);
  if (!target) return state;
  const base = meta?.entryId ? flushDraft(state) : flushDraft(state, target);
  const entries = [...base.entries];
  const last = entries[entries.length - 1];
  if (last?.kind === "assistant" && last.id === target) {
    entries[entries.length - 1] = { ...last, text: last.text + text };
    return { ...base, entries };
  }
  if (meta?.entryId) {
    // A replay's chunks are born under their entry's id: they build the
    // entry directly; the marker adds the settle facts.
    entries.push({
      kind: "assistant",
      id: target,
      text,
      ...(meta ? { pi: { ...meta } } : {}),
    });
    return { ...base, entries };
  }
  if (base.draft && base.draft.id === target) {
    // A live draft the thought deltas opened: the text joins it.
    return { ...base, draft: { ...base.draft, text: base.draft.text + text }, activeId: target };
  }
  return { ...base, draft: { id: target, text, ...(meta ? { pi: { ...meta } } : {}) }, activeId: target };
}

function reduceThoughtChunk(state: TranscriptState, update: AcpUpdate): TranscriptState {
  const meta = piMetaOf(update);
  const text = textOf(update.content);
  if (!text) return state;
  const target = meta?.entryId ?? idOf(update.messageId);
  if (!target) return state;
  const base = meta?.entryId ? flushDraft(state) : flushDraft(state, target);
  const entries = [...base.entries];
  const last = entries[entries.length - 1];
  if (last?.kind === "assistant" && last.id === target) {
    entries[entries.length - 1] = { ...last, thoughts: (last.thoughts ?? "") + text };
    return { ...base, entries };
  }
  if (meta?.entryId) {
    entries.push({
      kind: "assistant",
      id: target,
      text: "",
      thoughts: text,
      ...(meta ? { pi: { ...meta } } : {}),
    });
    return { ...base, entries };
  }
  if (base.draft && base.draft.id === target) {
    // A live draft the thought deltas opened: the text joins it.
    return { ...base, draft: { ...base.draft, thoughts: (base.draft.thoughts ?? "") + text }, activeId: target };
  }
  // Thinking deltas can precede the message's first text delta.
  return {
    ...base,
    draft: { id: target, text: "", thoughts: text, ...(meta ? { pi: { ...meta } } : {}) },
    activeId: target,
  };
}

// --- tool calls ------------------------------------------------------------

function reduceToolCall(state: TranscriptState, update: AcpUpdate): TranscriptState {
  const toolCallId = idOf(update.toolCallId);
  if (!toolCallId) return state;
  const base = flushDraft(state);
  const entries = [...base.entries];
  const index = findTool(entries, toolCallId);
  const card: ToolEntry = {
    kind: "tool",
    id: toolCallId,
    toolCallId,
    title: stringOf(update.title) ?? stringOf(update.name) ?? "tool",
    ...(stringOf(update.name) ? { name: stringOf(update.name)! } : {}),
    ...(stringOf(update.kind) ? { toolKind: stringOf(update.kind)! } : {}),
    status: toolStatus(update.status) ?? "in_progress",
    ...(update.rawInput !== undefined ? { rawInput: update.rawInput } : {}),
    output: "",
    diffs: [],
    ...(Array.isArray(update.content) ? contentOf(update.content) : {}),
    ...(Array.isArray(update.locations) ? { locations: update.locations as Array<{ path: string }> } : {}),
  };
  if (index >= 0) entries[index] = { ...entries[index], ...card };
  else entries.push(card);
  return { ...base, entries };
}

function reduceToolCallUpdate(state: TranscriptState, update: AcpUpdate): TranscriptState {
  const toolCallId = idOf(update.toolCallId);
  if (!toolCallId) return state;
  const entries = [...state.entries];
  const index = findTool(entries, toolCallId);
  if (index < 0) {
    // A settlement with no open card (a replayed result whose call was in an
    // unloaded branch): keep the result as its own card.
    entries.push({
      kind: "tool",
      id: toolCallId,
      toolCallId,
      title: stringOf(update.title) ?? "tool",
      status: toolStatus(update.status) ?? "completed",
      output: "",
      diffs: [],
      ...(Array.isArray(update.content) ? contentOf(update.content) : {}),
    });
    return { ...state, entries };
  }
  const card = entries[index] as ToolEntry;
  const next: ToolEntry = { ...card };
  const status = toolStatus(update.status);
  if (status) next.status = status;
  if (stringOf(update.title)) next.title = stringOf(update.title)!;
  if (Array.isArray(update.content)) {
    // A partial frame's content is a cumulative snapshot: replace, not
    // append, or a streaming output would double every chunk.
    const patch = contentOf(update.content);
    next.output = patch.output;
    next.diffs = patch.diffs;
  }
  const meta = zuMetaOf(update);
  if (meta) next.meta = meta;
  entries[index] = next;
  return { ...state, entries };
}

// --- notices ---------------------------------------------------------------

function reduceNotice(state: TranscriptState, update: AcpUpdate): TranscriptState {
  const notice = (update.notice ?? {}) as { severity?: unknown; title?: unknown; description?: unknown };
  const title = stringOf(notice.title);
  const description = stringOf(notice.description);
  const text = [title, description].filter((part) => part && part.length > 0).join(" — ");
  if (!text) return state;
  const base = flushDraft(state);
  const seq = base.seq + 1;
  const entries = [
    ...base.entries,
    {
      kind: "note" as const,
      id: `notice:${seq}`,
      ...(stringOf(notice.severity) ? { severity: stringOf(notice.severity)! } : {}),
      text,
    },
  ];
  return { ...base, entries, seq };
}

// --- settle ----------------------------------------------------------------

/** The settle marker: an empty chunk whose `_meta.pi` carries the facts. */
function settleDraft(state: TranscriptState, meta: PiMeta): TranscriptState {
  const entryId = meta.entryId ?? state.draft?.id ?? "";
  if (!entryId) return state;
  return settleInto(state, entryId, meta);
}

/** Folds the streaming draft (or a bare marker) into `entries` for good. */
function settleInto(state: TranscriptState, entryId: string, meta: PiMeta): TranscriptState {
  const entries = [...state.entries];
  const index = entries.findIndex((entry) => entry.kind === "assistant" && entry.id === entryId);
  const settlePi: PiMeta = { ...meta, settled: true, entryId };
  if (index >= 0) {
    // A replay's entry already exists from its chunks; the marker adds the
    // facts it lacked.
    const entry = entries[index] as AssistantEntry;
    entries[index] = { ...entry, pi: { ...(entry.pi ?? {}), ...settlePi } };
    return { ...state, entries, activeId: undefined };
  }
  const draft = state.draft;
  if (draft) {
    entries.push({
      kind: "assistant",
      id: entryId,
      text: draft.text,
      ...(draft.thoughts ? { thoughts: draft.thoughts } : {}),
      pi: { ...(draft.pi ?? {}), ...settlePi },
    });
    return { ...state, entries, draft: null, activeId: undefined };
  }
  // A tool card inside the same pi message flushes the live draft under its
  // `mN` id before the settle marker (which carries pi's entry id) arrives.
  // Re-key that row, so the reply keeps its place and no empty second row
  // closes the turn.
  const liveId = state.activeId;
  if (liveId) {
    const live = entries.findIndex(
      (entry) => entry.kind === "assistant" && entry.id === liveId && !entry.pi?.settled,
    );
    if (live >= 0) {
      const entry = entries[live] as AssistantEntry;
      entries[live] = { ...entry, id: entryId, pi: { ...(entry.pi ?? {}), ...settlePi } };
      return { ...state, entries, activeId: undefined };
    }
  }
  // No streamed text reached the client (an error entry, a fast settle):
  // the marker itself is the record.
  entries.push({ kind: "assistant", id: entryId, text: "", pi: settlePi });
  return { ...state, entries, activeId: undefined };
}

// --- helpers ----------------------------------------------------------------

/** Reads the distro's `_meta.pi`, when the update carries one. */
function piMetaOf(update: AcpUpdate): PiMeta | undefined {
  const meta = update._meta as { pi?: unknown } | undefined;
  if (!meta || typeof meta !== "object" || !meta.pi || typeof meta.pi !== "object") return undefined;
  return meta.pi as PiMeta;
}

/** Reads the distro's `_meta.zu` (a tool end frame), when it carries one. */
function zuMetaOf(update: AcpUpdate): ToolMeta | undefined {
  const meta = update._meta as { zu?: unknown } | undefined;
  if (!meta || typeof meta !== "object" || !meta.zu || typeof meta.zu !== "object") return undefined;
  return meta.zu as ToolMeta;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((block) => (isTextBlock(block) ? block.text : "")).join("");
  }
  if (content && typeof content === "object" && (content as { type?: unknown }).type === "text") {
    return String((content as { text?: unknown }).text ?? "");
  }
  return "";
}

function isTextBlock(block: unknown): block is { type: "text"; text: string } {
  return !!block && typeof block === "object" && (block as { type?: unknown }).type === "text";
}

function idOf(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const id = String(value);
  return id.length > 0 ? id : null;
}

function stringOf(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function toolStatus(value: unknown): ToolStatus | undefined {
  return value === "pending" || value === "in_progress" || value === "completed" || value === "failed"
    ? value
    : undefined;
}

/** Splits a frame's `ToolCallContent` into the entry's two lanes. */
function contentOf(content: unknown[]): { output: string; diffs: DiffBlock[] } {
  let output = "";
  const diffs: DiffBlock[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const typed = block as { type?: unknown; content?: unknown };
    if (typed.type === "content" && isTextBlock(typed.content)) {
      output += typed.content.text;
    } else if (typed.type === "diff") {
      const diff = block as { path?: unknown; oldText?: unknown; newText?: unknown };
      if (typeof diff.newText !== "string") continue;
      diffs.push({
        ...(typeof diff.path === "string" ? { path: diff.path } : {}),
        ...(typeof diff.oldText === "string" || diff.oldText === null ? { oldText: diff.oldText as string | null } : {}),
        newText: diff.newText,
      });
    }
  }
  // Tool output often ends with blank lines; they only add dead rows to the
  // card (and are not what the model sees after its own trim).
  return { output: output.replace(/[ \t\r\n]+$/, ""), diffs };
}

function findTool(entries: Entry[], toolCallId: string): number {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.kind === "tool" && entry.toolCallId === toolCallId) return index;
  }
  return -1;
}

/** The optimistic row's id prefix: minted locally, re-keyed on the real id. */
export function isPendingId(id: string): boolean {
  return id.startsWith("pending:");
}

/** An entry's display text: the transcript rows' plain words. */
export function entryText(entry: Entry): string {
  if (entry.kind === "note") return entry.text;
  if (entry.kind === "tool") return entry.title;
  return entry.text;
}

/** The transcript rows the list renders: the settled entries plus the draft. */
export function transcriptRows(state: TranscriptState | undefined): Entry[] {
  if (!state) return [];
  const rows = state.draft ? [...state.entries, draftEntry(state.draft)] : state.entries;
  return rows.map(normalizeEntry);
}

/** Render-time defaults for a tool row. Every producer sets both lanes, but a
 * row can outlive a schema change (a hot reload, a state restored by a newer
 * build); the card must not throw on the missing one. */
function normalizeEntry(entry: Entry): Entry {
  if (entry.kind !== "tool") return entry;
  return {
    ...entry,
    output: entry.output ?? "",
    diffs: entry.diffs ?? [],
  };
}

/** The streaming draft as a renderable entry (never keyed like a settled one). */
export function draftEntry(draft: TranscriptDraft): AssistantEntry {
  return {
    kind: "assistant",
    id: draft.id,
    text: draft.text,
    ...(draft.thoughts ? { thoughts: draft.thoughts } : {}),
    pi: { ...(draft.pi ?? {}) },
  };
}

// --- fixture builders -------------------------------------------------------
//
// Fixtures and tests seed entries directly; these keep their seed rows
// readable and their ids explicit.

export function userEntry(id: string, text: string, pi?: PiMeta): UserEntry {
  return { kind: "user", id, text, ...(pi ? { pi } : {}) };
}

export function assistantEntry(id: string, text: string, pi?: PiMeta): AssistantEntry {
  return { kind: "assistant", id, text, ...(pi ? { pi } : {}) };
}

export function toolEntry(
  id: string,
  title: string,
  status: ToolStatus = "completed",
  extra: Partial<Pick<ToolEntry, "name" | "toolKind" | "rawInput" | "output" | "diffs" | "locations" | "meta">> = {},
): ToolEntry {
  return {
    kind: "tool",
    id,
    toolCallId: id,
    title,
    status,
    output: extra.output ?? "",
    diffs: extra.diffs ?? [],
    ...(extra.name ? { name: extra.name } : {}),
    ...(extra.toolKind ? { toolKind: extra.toolKind } : {}),
    ...(extra.rawInput !== undefined ? { rawInput: extra.rawInput } : {}),
    ...(extra.locations ? { locations: extra.locations } : {}),
    ...(extra.meta ? { meta: extra.meta } : {}),
  } as ToolEntry;
}

export function noteEntry(id: string, text: string, severity?: string): NoteEntry {
  return { kind: "note", id, ...(severity ? { severity } : {}), text };
}
