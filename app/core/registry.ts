import { signal } from "nsh";
import type { JSX } from "nsh";
import type {
  IntentContext,
  IntentResult,
  Launcher,
  SearchHit,
  SheetId,
  SheetKindSpec,
  SheetModule,
  TitlebarAction,
} from "../../contracts/module";

export type { SearchHit } from "../../contracts/module";

/**
 * The module registry (docs/sheet-module-ARCHITECTURE.md §4): the shell's one
 * extension seam. Modules are registered by the assembly point (`App.tsx`)
 * before the first render; the shell looks everything up here and never
 * imports a module.
 *
 * Registration is idempotent per module id (a hot reload must not throw) but a
 * second owner of one sheet kind is a bug: the kind's `title`/`body` would be
 * ambiguous.
 */

interface RegisteredKind {
  moduleId: string;
  spec: SheetKindSpec;
}

const modules = new Map<string, SheetModule>();
const kinds = new Map<string, RegisteredKind>();
const launchers = signal<Launcher[]>([]);
const intents = new Map<string, (payload: unknown, context: IntentContext) => IntentResult>();
const titlebar: TitlebarAction[] = [];
const searchers: Array<(query: string) => SearchHit[]> = [];

/** The kind portion of a sheet id (`kind:instance`). */
export function kindOf(id: SheetId): string {
  const at = id.indexOf(":");
  return at < 0 ? id : id.slice(0, at);
}

/** Registers one module. Idempotent by id; a kind owned twice throws. */
export function registerModule(module: SheetModule): void {
  if (modules.has(module.id)) return;
  for (const spec of module.kinds) {
    const owner = kinds.get(spec.kind);
    if (owner) {
      throw new Error(`sheet kind ${spec.kind} is already owned by module ${owner.moduleId}`);
    }
  }
  modules.set(module.id, module);
  for (const spec of module.kinds) kinds.set(spec.kind, { moduleId: module.id, spec });
  if (module.launchers?.length) launchers.set([...launchers(), ...module.launchers]);
  for (const [name, handler] of Object.entries(module.intents ?? {})) {
    if (intents.has(name)) throw new Error(`intent ${name} is already registered`);
    intents.set(name, handler);
  }
  if (module.titlebar?.length) titlebar.push(...module.titlebar);
  if (module.search) searchers.push(module.search);
}

/** The registered spec for a sheet id's kind, or undefined. */
export function sheetSpec(id: SheetId): SheetKindSpec | undefined {
  return kinds.get(kindOf(id))?.spec;
}

/** The module that owns a sheet id's kind, or undefined. */
export function sheetModule(id: SheetId): SheetModule | undefined {
  const registered = kinds.get(kindOf(id));
  return registered ? modules.get(registered.moduleId) : undefined;
}

/** A sheet's tab title, or null when no module owns its kind. */
export function moduleSheetTitle(id: SheetId): string | null {
  const spec = sheetSpec(id);
  return spec ? spec.title(id) : null;
}

/** A sheet's glyph name, or null when no module owns its kind (or draws it). */
export function moduleSheetGlyph(id: SheetId): string | null {
  const spec = sheetSpec(id);
  return spec && typeof spec.glyph === "string" ? spec.glyph : null;
}

/** A sheet's custom glyph, when its module draws one. */
export function moduleSheetIcon(id: SheetId): (() => JSX.Element) | null {
  const spec = sheetSpec(id);
  return spec && typeof spec.glyph !== "string" ? spec.glyph.icon : null;
}

/** Whether a sheet may name its container (true when unowned). */
export function sheetNamesContainer(id: SheetId): boolean {
  return sheetSpec(id)?.namesContainer?.(id) ?? true;
}

/** Whether the tab may be closed (true when unowned). */
export function sheetClosable(id: SheetId): boolean {
  return sheetSpec(id)?.closable?.(id) ?? true;
}

/** The start page's instantiable objects, in registration order. */
export function startPageLaunchers(): Launcher[] {
  return launchers();
}

/** The titlebar's contributed actions, ordered by `order`. */
export function titlebarActions(): TitlebarAction[] {
  return titlebar.slice().sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
}

/** Every module's search results for `query`, in registration order. */
export function moduleSearch(query: string): SearchHit[] {
  return searchers.flatMap((search) => search(query));
}

/** Opens a sheet through the module that owns the kind. */
export function dispatchIntent(name: string, payload: unknown, context: IntentContext): IntentResult {
  const handler = intents.get(name);
  if (!handler) return null;
  return handler(payload, context);
}

/** Notifies every module that a container is gone (end PTYs, LSP, connections). */
export function notifyContainerArchived(containerId: string): void {
  for (const module of modules.values()) module.onContainerArchive?.(containerId);
}

/**
 * The sheets whose modules say their resource still exists. A module with no
 * `restore` keeps its sheets (the layout is the fact). Called when a container
 * is shown, before its stashed layout is pruned.
 */
export async function restoreSheetIds(ids: string[]): Promise<string[]> {
  const kept: string[] = [];
  for (const id of ids) {
    const restore = sheetSpec(id)?.restore;
    if (!restore || (await restore(id))) kept.push(id);
  }
  return kept;
}

/** Tells the owning module that a sheet became the displayed tab. */
export function notifySheetActivated(id: SheetId): void {
  sheetModule(id)?.onSheetActivated?.(id);
}

/** Runs every module's one-time initialization (after registration). */
export function initializeModules(): void {
  for (const module of modules.values()) module.initialize?.();
}


/** Tells every module which sheets are open now (close vanished resources). */
export function notifyLayoutChanged(openSheetIds: SheetId[]): void {
  for (const module of modules.values()) module.onLayoutChanged?.(openSheetIds);
}

/** Tells every module that a container became the canvas. */
export function notifyContainerShown(containerId: string): void {
  for (const module of modules.values()) module.onContainerShown?.(containerId);
}

/** Tells every module that the app is quitting (kill children, close stdio). */
export function notifyAppQuit(): void {
  for (const module of modules.values()) module.onAppQuit?.();
}

/** The registered modules (assembly diagnostics and tests). */
export function registeredModules(): SheetModule[] {
  return [...modules.values()];
}
