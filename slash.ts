import { signal } from "nsh";
import type { SessionThinkingLevel } from "./contracts/protocol";
import { clearSessionView, compactSession, send, setThinkingLevel, viewFor } from "./sessions";
import { openHero } from "./projects";
import { K, t } from "./ui/i18n";

/**
 * The `/model` command opens the model menu of one session. The request
 * lives here because both the table and the composer's picker read it (and
 * the composer cannot import itself).
 */
export const openModelMenuRequest = signal<string | null>(null);

/**
 * The composer's slash commands (§2.2-11a), mapped from pi 1.5.0's
 * interactive set. Three buckets:
 *
 * - **local** — Zu does the work itself (model menu, thinking level, clear,
 *   compact, new, resume);
 * - **prompt** — sent verbatim through `session.prompt`, which is how pi
 *   invokes extension, prompt-template and skill commands;
 * - **unsupported** — pi's interactive-only commands (`/login`, `/quit`,
 *   `/settings`, …): the composer says so instead of guessing.
 *
 * The table is the single source for the popup's candidates and for what
 * Enter does when the draft starts with `/`.
 */

export type SlashOutcome =
  | { kind: "local" }
  | { kind: "prompt" }
  | { kind: "unsupported"; name: string };

interface SlashCommand {
  name: string;
  /** The one-line description the popup shows (an `app.slash.*` key). */
  description: (locale?: string) => string;
  kind: "local" | "prompt";
}

/** Actions the host installs (opening the model menu, the sidebar search). */
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

const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: "model",
    description: (locale) => t(K.slash.model, { locale }),
    kind: "local",
  },
  {
    name: "thinking",
    description: (locale) => t(K.slash.thinking, { locale }),
    kind: "local",
  },
  {
    name: "compact",
    description: (locale) => t(K.slash.compact, { locale }),
    kind: "local",
  },
  {
    name: "clear",
    description: (locale) => t(K.slash.clear, { locale }),
    kind: "local",
  },
  {
    name: "new",
    description: (locale) => t(K.slash.new, { locale }),
    kind: "local",
  },
  {
    name: "resume",
    description: (locale) => t(K.slash.resume, { locale }),
    kind: "local",
  },
];

/** pi's interactive-only commands: the composer does not replace them. */
const INTERACTIVE_ONLY = new Set([
  "help",
  "login",
  "logout",
  "settings",
  "export",
  "import",
  "fork",
  "clone",
  "session",
  "tree",
  "name",
  "reload",
  "trust",
  "share",
  "copy",
  "bug",
  "quit",
  "hotkeys",
  "changelog",
]);

/** The candidates whose names start with what the user typed. */
export function slashCandidates(query: string): SlashCommand[] {
  const term = query.replace(/^\//, "").trim().toLowerCase();
  return SLASH_COMMANDS.filter((command) => command.name.startsWith(term));
}

/**
 * Runs one slash draft (leading `/` included). The popup's rows and Enter
 * both land here.
 */
export async function runSlash(sessionId: string, draft: string): Promise<SlashOutcome> {
  const text = draft.trim();
  const name = text.slice(1).split(/\s+/)[0]?.toLowerCase() ?? "";
  if (!name) return { kind: "unsupported", name: "" };

  const known = SLASH_COMMANDS.find((command) => command.name === name);
  if (known?.kind === "local") {
    await runLocal(sessionId, name);
    return { kind: "local" };
  }
  if (INTERACTIVE_ONLY.has(name)) return { kind: "unsupported", name };

  // Everything else is invokable through pi's prompt: extension commands,
  // prompt templates and skill commands. Sent verbatim, slash included.
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
      openHero(null);
      return;
    default:
      return;
  }
}
