import type { JSX } from "nsh";

/**
 * The sheet-module contract (docs/sheet-module-ARCHITECTURE.md §4): the one
 * extension unit. A module owns one or more sheet kinds, its presentation and
 * its state; it may contribute Hero entries, commands and intents. The shell
 * renders what is registered and never interprets a kind's meaning.
 *
 * This file is vocabulary only — the registry that enforces it lives in
 * `app/core/registry.ts`.
 */

/** A sheet id: `kind:instance`. */
export type SheetId = string;

/** The tint tokens the shell's glyphs accept. */
export type TintToken =
  | "brand"
  | "warn"
  | "up"
  | "info"
  | "muted-foreground"
  | "primary-foreground"
  | "faint";

/** What a sheet body receives. */
export interface SheetProps {
  id: SheetId;
  /** The container the sheet lives in; `null` on the scratch canvas. */
  containerId: string | null;
  /** Whether this sheet is the displayed tab of its group (or zoomed). */
  visible: boolean;
}

/** One kind a module owns. */
export interface SheetKindSpec {
  /** The id prefix (`session`, `svg`, `manox-chat`). */
  kind: string;
  /** The tab title; also feeds the container title. Reactive. */
  title: (id: SheetId) => string;
  /** The body. State must live in the module's store, never in this component:
   * switching tabs unmounts it. */
  body: (props: SheetProps) => JSX.Element;
  /** A glyph name from `ui/ui.tsx`, or an icon the module draws itself. */
  glyph: string | { icon: () => JSX.Element };
  tint?: TintToken;
  /** Whether the tab may be closed. Defaults to true. */
  closable?: (id: SheetId) => boolean;
  /** Whether this sheet may name its container (an unnamed session may not).
   * Defaults to true. */
  namesContainer?: (id: SheetId) => boolean;
  /** Layout restore: does the resource behind `id` still exist? A false answer
   * removes the sheet silently (the pre-module semantics). */
  restore?: (id: SheetId) => boolean | Promise<boolean>;
  /** The module's sole interpretation of its ids; null on a malformed one. */
  parse: (id: SheetId) => unknown | null;
}

/** One row of the start page (the object's own group, in this order). */
export type LauncherGroup = "conversation" | "tool" | "agent";

/** The attributes an instantiable object is pressed with. The start page is
 * the same everywhere; the context only pins what the instance inherits. */
export interface LaunchContext {
  /** The container to add the instance to; null mints one. */
  containerId: string | null;
  /** The project the context pins; null is Chats. */
  projectId: string | null;
  /** The cwd the context pins (a container's, a project root, or the
   * conversation fallback). Null means the object's own fallback: a tool
   * minted outside a project gets its per-container `scratch/<id>` folder. */
  cwd: string | null;
}

/** One instantiable object on the start page. Every press mints a new
 * instance — a conversation, a terminal, a browser page — never focuses an
 * existing one. */
export interface Launcher {
  /** The object's stable id (`zu`, `manox`, `terminal`, `browser`, `claude`,
   * `codex`, `copilot`, `pi`). */
  id: string;
  /** The tile's label, read at draw time so the shell's language applies; a
   * product name is not translated. */
  label: () => string;
  /** A glyph name from `ui/ui.tsx`, or a brand icon (`brand`). */
  glyph?: string;
  brand?: string;
  /** The row it belongs to (conversations, tools, terminal agents). */
  group: LauncherGroup;
  /** Ordering inside the group (smaller first). */
  order?: number;
  /** A conversation asks which project to start in when the context pins
   * none; a tool defaults to Chats. */
  asksProject?: boolean;
  /** Creates the instance and opens its sheet beside the start page (the
   * palette stays usable, so repeated presses need no `+`). A rejection is
   * the start page's error line. */
  instantiate: (context: LaunchContext) => void | Promise<void>;
}

/** What an intent handler receives. */
export interface IntentContext {
  /** The container the intent should act on; null means the active canvas. */
  containerId: string | null;
}

export type IntentResult = SheetId | null | Promise<SheetId | null>;

/** One row of the sidebar's search results. */
export interface SearchHit {
  id: string;
  title: string;
  subtitle: string;
  meta?: string;
  open: () => void;
}

/** One entry in the titlebar's tools menu. */
export interface TitlebarAction {
  id: string;
  label: () => string;
  glyph: string;
  testID: string;
  /** Ordering in the tools menu (smaller first). */
  order?: number;
  enabled?: () => boolean;
  onPress: () => void;
}

/** One sheet module. */
export interface SheetModule {
  /** The module id (`pi`, `manox`, `browser`, `files`, ...). */
  id: string;
  /** The kinds this module owns (one or more). */
  kinds: SheetKindSpec[];
  /** Capability ids the module consumes (`fs`, `git`, `pty`, `lsp`, `acp`,
   * `state`, `manox`). Declarative: the assembly point resolves them; the
   * dependency gate checks them. */
  capabilities?: string[];
  /** The objects the start page instantiates (docs/DESIGN §4.1). */
  launchers?: Launcher[];
  /** The titlebar's tools menu, in `order`. */
  titlebar?: TitlebarAction[];
  /** Sidebar search results for a query (a harness's own session index). */
  search?: (query: string) => SearchHit[];
  /** Cross-module openers. Names are global (`editor.open`). */
  intents?: Record<string, (payload: unknown, context: IntentContext) => IntentResult>;
  /** Container teardown: end PTYs, LSP servers, connections. */
  onContainerArchive?: (containerId: string) => void;
  /** Runs once at assembly (start a background scan, install an observer). */
  initialize?: () => void;
  /** A container became the active canvas: hydrate its visible sheets. */
  onContainerShown?: (containerId: string) => void;
  /** The app is quitting: release processes and connections. */
  onAppQuit?: () => void;
  /** A sheet of this module became its group's displayed tab (focus its
   * resource, hydrate it). */
  onSheetActivated?: (id: SheetId) => void;
  /** A layout edit happened: the ids are every canvas's open sheets (close
   * resources whose sheet went away anywhere; scope per container yourself
   * if your ledger is per container). */
  onLayoutChanged?: (openSheetIds: SheetId[]) => void;
}
