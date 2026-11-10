import { signal } from "nsh";
import { en } from "./locales/en";
import { zhCN } from "./locales/zh-CN";

/**
 * The shell's copy, in one key table per language. `zh-CN` is the source
 * language and the default; `en` is the fallback and the status bar's
 * language button switches this run to it. A persisted choice, and following
 * the system's language list, belong to M6.
 *
 * The table is plain TS rather than pi/nsh's translation runtime: the
 * released nsh 0.4.0 test runtime does not expose `nsh/i18n` yet (the
 * checkout does), and the shell needs its copy testable in `nsh test`. The
 * key contract is unchanged: every shell string is a key, and the parity
 * test walks `K` to prove both languages have all of them.
 */
export type ShellLocale = "zh-CN" | "en";

const TABLES: Record<ShellLocale, Record<string, string>> = {
  "zh-CN": zhCN,
  en,
};

/**
 * The language the shell is drawing. Chinese is the source language, so it
 * is the default; the status bar's language button switches to English for
 * this run. (A persisted, in-app language setting belongs to M6. nsh
 * 0.4.0's runtime does not expose `localeSettings` yet, so reading the
 * system list is not an option today; the key contract is unaffected.)
 */
const shellLanguage = signal<ShellLocale>("zh-CN");

/** Shows the shell in `locale`; `t` reads this reactively. */
export function setShellLocale(locale: ShellLocale): void {
  shellLanguage.set(locale);
}

/** Switches between the two languages the shell ships. */
export function toggleShellLocale(): void {
  shellLanguage.set(shellLocale() === "zh-CN" ? "en" : "zh-CN");
}

/** The language the shell is drawing. */
export function shellLocale(): ShellLocale {
  return shellLanguage();
}

/** Fills rust-i18n's `%{name}` arguments; an argument left out stays visible. */
export function fill(text: string, args: Record<string, unknown>): string {
  return text.replace(/%\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(args, name) ? String(args[name]) : whole,
  );
}

/** The text of `key` in the shell's language, then English, then the key. */
export function t(key: string, options: { locale?: string; [name: string]: unknown } = {}): string {
  const asked = options.locale;
  const locale: ShellLocale =
    asked === "zh-CN" || asked === "en" ? asked : asked ? (asked.toLowerCase().startsWith("zh") ? "zh-CN" : "en") : shellLocale();
  const text = TABLES[locale][key] ?? TABLES.en[key];
  if (text === undefined) return key;
  return fill(text, options);
}

export const K = {
  phase: {
    stopped: "app.phase.stopped",
    starting: "app.phase.starting",
    connected: "app.phase.connected",
    recovering: "app.phase.recovering",
    incompatible: "app.phase.incompatible",
    error: "app.phase.error",
  },
  engine: {
    start: "app.engine.start",
    retry: "app.engine.retry",
    refresh: "app.engine.refresh",
    stop: "app.engine.stop",
    reconnect: "app.engine.reconnect",
    recovered: "app.engine.recovered",
  },
  rail: {
    projects: "app.rail.projects",
    chats: "app.rail.chats",
    specs: "app.rail.specs",
    changes: "app.rail.changes",
    terminal: "app.rail.terminal",
  },
  sidebar: {
    title: "app.sidebar.title",
    allSessions: "app.sidebar.allSessions",
    empty: "app.sidebar.empty",
  },
  container: {
    title: "app.container.title",
    create: "app.container.create",
    empty: "app.container.empty",
    archive: "app.container.archive",
    sessions: "app.container.sessions",
  },
  canvas: {
    emptyTitle: "app.canvas.emptyTitle",
    emptyNote: "app.canvas.emptyNote",
  },
  status: {
    sheets: "app.status.sheets",
    sessions: "app.status.sessions",
    containers: "app.status.containers",
    hint: "app.status.hint",
    unsupported: "app.status.unsupported",
    language: "app.status.language",
  },
  tool: {
    running: "app.tool.running",
    done: "app.tool.done",
    failed: "app.tool.failed",
  },
  session: {
    running: "app.session.running",
    placeholder: "app.session.placeholder",
    stop: "app.session.stop",
    send: "app.session.send",
    interrupted: "app.session.interrupted",
    degraded: "app.session.degraded",
    hidden: "app.session.hidden",
  },
  dialog: {
    confirm: "app.dialog.confirm",
    cancel: "app.dialog.cancel",
    save: "app.dialog.save",
    select: "app.dialog.select",
    inputPlaceholder: "app.dialog.inputPlaceholder",
    editorPlaceholder: "app.dialog.editorPlaceholder",
  },
  sheet: {
    sessionTitle: "app.sheet.session.title",
    sessionNote: "app.sheet.session.note",
    terminalTitle: "app.sheet.terminal.title",
    terminalNote: "app.sheet.terminal.note",
    claudeTitle: "app.sheet.claude.title",
    claudeNote: "app.sheet.claude.note",
    codexTitle: "app.sheet.codex.title",
    codexNote: "app.sheet.codex.note",
    copilotTitle: "app.sheet.copilot.title",
    copilotNote: "app.sheet.copilot.note",
    webviewTitle: "app.sheet.webview.title",
    webviewNote: "app.sheet.webview.note",
    editorTitle: "app.sheet.editor.title",
    editorNote: "app.sheet.editor.note",
    diffTitle: "app.sheet.diff.title",
    diffNote: "app.sheet.diff.note",
    filesTitle: "app.sheet.files.title",
    filesNote: "app.sheet.files.note",
    subagentsTitle: "app.sheet.subagents.title",
    subagentsNote: "app.sheet.subagents.note",
    tasksTitle: "app.sheet.tasks.title",
    tasksNote: "app.sheet.tasks.note",
    tracesTitle: "app.sheet.traces.title",
    tracesNote: "app.sheet.traces.note",
    statsTitle: "app.sheet.stats.title",
    statsNote: "app.sheet.stats.note",
    taps: "app.sheet.taps",
  },
} as const;

/** Every key the shell uses, as a flat list (the parity test's input). */
export const SHELL_KEYS: string[] = Object.values(K).flatMap((group) => Object.values(group));
