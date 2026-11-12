import { locale as systemLocale } from "nsh";
import { localeToShellLocale, type ShellLocale } from "./i18n";

/**
 * The shell's copy language for tests. The app reads the system's locale
 * once at startup (Q71), and the headless runtime reports the machine's —
 * so a test that asserts copy asks here, which reads the same tag the app
 * read, and stays honest on any machine. The mapping itself is covered by
 * `i18n.test.ts` and `locale.ui.test.tsx`.
 */
export function shellCopyLocale(): ShellLocale {
  return localeToShellLocale(systemLocale());
}

/** The copy the shell is drawing: `zh` on a Chinese system, else `en`. */
export function copy(zh: string, en: string): string {
  return shellCopyLocale() === "zh-CN" ? zh : en;
}
