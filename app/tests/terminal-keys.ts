import { test } from "nsh/test";

/**
 * The terminal surface is an AppKit view (`zu.terminal`): only
 * `nsh test --target macos` draws it, so its tests run under
 * `ZU_TERMINAL_GATE=1` on that target and are skipped elsewhere.
 */
export const terminalTest = process.env?.["ZU_TERMINAL_GATE"] === "1" ? test : test.skip;

/** The US layout's key for each shifted character. */
const SHIFTED: Record<string, string> = {
  '"': "shift+'",
  $: "shift+4",
  "%": "shift+5",
  "(": "shift+9",
  ")": "shift+0",
  "|": "shift+\\",
  _: "shift+-",
  ":": "shift+;",
  "!": "shift+1",
  "+": "shift+=",
  "<": "shift+,",
  ">": "shift+.",
  "?": "shift+/",
  "&": "shift+7",
  "*": "shift+8",
  "~": "shift+`",
  "{": "shift+[",
  "}": "shift+]",
  "^": "shift+6",
  "#": "shift+3",
  "@": "shift+2",
};

/** Types ASCII `text` into the focused view as key presses, as a keyboard does. */
export async function typeKeys(app: { keyboard: { press: (keys: string) => Promise<void> } }, text: string) {
  for (const c of text) {
    const key = c === " " ? "space" : (SHIFTED[c] ?? (/[A-Z]/.test(c) ? `shift+${c.toLowerCase()}` : c));
    await app.keyboard.press(key);
  }
}
