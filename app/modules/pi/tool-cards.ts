import type { JSX } from "nsh";

/**
 * Tool result cards, dispatched by pi's tool name.
 *
 * A tool whose live result carried structured `details` (the harness
 * forwards them under `_meta.zu.details`) can render as a card instead of
 * the compact line. The registry is intentionally tiny: modules register a
 * renderer per tool name and the transcript dispatches on it. It owns no
 * card itself — ask/plan/visualize register their own — and a tool with no
 * entry, or a result without details, keeps today's compact row.
 *
 * `details` is model-controlled data: cards read it, never interpolate it
 * into HTML or eval it, and derive nothing it does not carry (the row's
 * `state` stays the transport's status, not a details field).
 */

/** What a card renderer receives: the tool, its details, its state. */
export interface ToolCardProps {
  name: string;
  details: unknown;
  state: "running" | "done" | "failed";
}

export type ToolCardRenderer = (props: ToolCardProps) => JSX.Element | null;

const renderers = new Map<string, ToolCardRenderer>();

/** A tool result card, keyed by pi's tool name. Registration is idempotent
 * by name; a second owner replaces the first (the last module wins). */
export function registerToolCard(name: string, renderer: ToolCardRenderer): void {
  renderers.set(name, renderer);
}

export function toolCardFor(name: string): ToolCardRenderer | undefined {
  return renderers.get(name);
}
