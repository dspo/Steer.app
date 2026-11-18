import { signal } from "nsh";
import type { SessionThinkingLevel } from "./protocol";
import { clearSessionView, compactSession, send, setThinkingLevel, viewFor } from "./sessions";
import { openStartPage } from "../../core/projects";
import { K, t } from "../../ui/i18n";

/**
 * The composer's slash commands. The **distro owns the command table**
 * (`availableCommands`): extensions, prompt templates and skills arrive over
 * ACP. Only the few commands the host itself performs stay local here:
 * `/model`, `/thinking`, `/compact`, `/clear`, `/new`, `/resume`.
 *
 * Everything else is sent verbatim in a prompt; the distro's dispatcher
 * decides what to do with it. There is no static "unsupported" list.
 */

/** The `/model` command opens the model menu of one session. */
export const openModelMenuRequest = signal<string | null>(null);

export type SlashOutcome = { kind: "local" } | { kind: "prompt" };

export interface SlashCommand {
  name: string;
  description: string;
  kind: "local" | "prompt";
}

/** Actions the host installs (the sidebar search). */
interface SlashActions {
  openSidebarSearch(): void;
}

let actions: SlashActions | null = null;

/** Installs the host actions (shell.tsx; fixtures install their own). */
export function setSlashActions(next: SlashActions | null): void {
  actions = next;
}

/** The thinking levels pi cycles through, low to high. */
const THINKING_ORDER: SessionThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

function nextThinkingLevel(level: string): SessionThinkingLevel {
  const at = THINKING_ORDER.indexOf(level as SessionThinkingLevel);
  return THINKING_ORDER[(at + 1) % THINKING_ORDER.length];
}

const LOCAL_COMMANDS: SlashCommand[] = [
  { name: "model", description: t(K.slash.model), kind: "local" },
  { name: "thinking", description: t(K.slash.thinking), kind: "local" },
  { name: "compact", description: t(K.slash.compact), kind: "local" },
  { name: "clear", description: t(K.slash.clear), kind: "local" },
  { name: "new", description: t(K.slash.new), kind: "local" },
  { name: "resume", description: t(K.slash.resume), kind: "local" },
];

/** The candidates: local commands plus the session's advertised commands. */
export function slashCandidates(query: string, sessionId?: string | null): SlashCommand[] {
  const term = query.replace(/^\//, "").trim().toLowerCase();
  const advertised = (sessionId ? viewFor(sessionId)?.commands ?? [] : []).map((command) => ({
    name: command.name,
    description: command.description,
    kind: "prompt" as const,
  }));
  const all = [
    ...LOCAL_COMMANDS,
    ...advertised.filter((command) => !LOCAL_COMMANDS.some((local) => local.name === command.name)),
  ];
  return all.filter((command) => command.name.toLowerCase().startsWith(term));
}

/** Runs one slash draft (leading `/` included). */
export async function runSlash(sessionId: string, draft: string): Promise<SlashOutcome> {
  const text = draft.trim();
  const name = text.slice(1).split(/\s+/)[0]?.toLowerCase() ?? "";
  if (!name) return { kind: "prompt" };
  if (LOCAL_COMMANDS.some((command) => command.name === name)) {
    await runLocal(sessionId, name);
    return { kind: "local" };
  }
  // Extension commands, templates, skills and anything else the distro
  // advertises: the protocol's prompt lane decides.
  void send(text, sessionId);
  return { kind: "prompt" };
}

async function runLocal(sessionId: string, name: string): Promise<void> {
  switch (name) {
    case "model":
      openModelMenuRequest.set(sessionId);
      return;
    case "resume":
      actions?.openSidebarSearch();
      return;
    case "thinking": {
      const level = viewFor(sessionId)?.thinkingLevel ?? "off";
      void setThinkingLevel(sessionId, nextThinkingLevel(level));
      return;
    }
    case "compact":
      void compactSession(sessionId);
      return;
    case "clear":
      clearSessionView(sessionId);
      return;
    case "new":
      openStartPage();
      return;
    default:
      return;
  }
}
