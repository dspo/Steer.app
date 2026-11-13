import { signal } from "nsh";
import type { JSX } from "nsh";
import type { GlyphName } from "../ui/ui";

/**
 * The shell's one neutral contribution seam. Until S0 lands the full pack
 * assembly model, a harness pack reaches the shell's shared surfaces — the
 * Hero's tool rows, the sidebar's extra groups, and sheet kinds — through
 * these registries and through nowhere else: the shell renders what is
 * registered, the registries carry no harness vocabulary, and the packs
 * never get imported by the shell (the assembly point, `App.tsx`, imports
 * the packs and lets them register).
 */

/** A Hero tool row contributed beside the built-in direct tools. */
export interface ContributedTool {
  id: string;
  label: string;
  glyph: GlyphName;
  testID: string;
  /** A disabled tool renders dim and never fires. */
  disabled: () => boolean;
  onPress: () => void;
}

const heroTools = signal<ContributedTool[]>([]);

/** Registers one Hero tool row (last registration per id wins). */
export function registerHeroTool(tool: ContributedTool): void {
  heroTools.set([...heroTools().filter((row) => row.id !== tool.id), tool]);
}

/** The Hero's contributed tools, in registration order. */
export function contributedHeroTools(): ContributedTool[] {
  return heroTools();
}

/** One sidebar row of a contributed group. */

/** A group of rows under one header (a pack's containers, say). */
/** A sheet kind a pack owns: its body, tab title and glyph. */
export interface ContributedSheet {
  kind: string;
  glyph: GlyphName;
  title: (id: string) => string;
  body: (id: string) => JSX.Element;
}

const sheetKinds = new Map<string, ContributedSheet>();

/** Registers one sheet kind (re-registering a kind is a bug and throws). */
export function registerSheetKind(sheet: ContributedSheet): void {
  if (sheetKinds.has(sheet.kind)) {
    throw new Error(`sheet kind ${sheet.kind} is already registered`);
  }
  sheetKinds.set(sheet.kind, sheet);
}

/** The kind of a sheet id a pack owns, or null for the shell's kinds. */
export function contributedSheetKind(id: string): string | null {
  const at = id.indexOf(":");
  const kind = at < 0 ? id : id.slice(0, at);
  return sheetKinds.has(kind) ? kind : null;
}

/** The registered sheet of a kind a pack owns. */
export function contributedSheet(kind: string): ContributedSheet | undefined {
  return sheetKinds.get(kind);
}

/** A conversation starter a pack contributes to the Hero: the harness the
 * first message goes to. The shell's own starter (Pi, the built-in distro)
 * is not a contribution — submitters are the *other* harnesses. */
export interface HeroSubmitter {
  /** The harness id the segmented control switches on (`manox`). */
  id: string;
  /** The control's label (`Manox`). */
  label: string;
  /** Starts the conversation: creates the session, opens its sheet and
   * dispatches the first message. `cwd` is the chosen project's primary
   * root (null for Chats); `model` is the selected `provider/model` id;
   * `effort` is pi's reasoning-effort level. */
  submit: (
    text: string,
    context: { cwd: string | null; model: string | null; effort: string; sheetId: string },
  ) => Promise<void>;
}

const heroSubmitters = new Map<string, HeroSubmitter>();

/** Registers one Hero submitter (last registration per id wins). */
export function registerHeroSubmitter(submitter: HeroSubmitter): void {
  heroSubmitters.set(submitter.id, submitter);
}

/** The contributed submitters, in registration order. */
export function contributedHeroSubmitters(): HeroSubmitter[] {
  return [...heroSubmitters.values()];
}
