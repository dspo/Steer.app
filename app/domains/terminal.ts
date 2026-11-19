import { nativeComponent, type NativeComponentRef } from "nsh";
import { Ghostty } from "zu/native";
import type { TerminalViewRef } from "./pty";

/**
 * The terminal surface: an AppKit view of the app's crate (`zu.terminal`,
 * `native/src/term_view`) that draws a `TerminalSession`'s emulator with
 * CoreText and is the input method's client itself. It takes the session by
 * id and talks to it directly: no byte of output or input passes through
 * TSX. What leaves the terminal stays the app's: the clipboard (`Clipboard`,
 * under its capability; the view emits `copy` and asks with `paste`), links
 * (`open`, which the sheet opens in Zu's browser) and the find bar (`find`).
 * Where no backend registers it
 * (headless tests, Linux), it is an empty box.
 */

/** Theme colors as `token()` gives them (`#rrggbbaa`). */
export interface TerminalColors {
  foreground: string;
  background: string;
  cursor: string;
  selection: string;
  preedit: string;
  /** A link's underline (Cmd-hover). */
  link: string;
  /** Find matches, and the current one. */
  mark: string;
  markCurrent: string;
  scrollbar: string;
}

/** What the view reports on `snapshot`: its cursor, grid and face. */
export interface TerminalSnapshot {
  cursor: [number, number] | null;
  /** Cell width, row height, baseline (points). */
  cell: [number, number, number];
  grid: [number, number];
  focused: boolean;
  font: string;
}

/** The Ghostty kernel's version — the vendored libghostty-vt's pinned rev,
 * shortened to 8 characters the way a rev-pinned kernel is cited. Null when
 * the native module is not there to ask (a headless run), so the About axis
 * can leave the row out. */
export function ghosttyVersion(): string | null {
  try {
    return Ghostty.version().slice(0, 8) || null;
  } catch {
    return null;
  }
}

export const TerminalSurface = nativeComponent<
  {
    session: number | null;
    fontFamily: string;
    fontSize: number;
    lineHeight: number;
    colors: TerminalColors;
    cursorStyle: "block" | "bar" | "underline";
    cursorBlink: boolean;
    /** Option types Meta (`ESC` + key) rather than the layout's characters. */
    optionAsMeta: boolean;
    /** The context menu's titles. */
    menu: { copy: string; paste: string; selectAll: string; find: string; clear: string };
  },
  {
    snapshot: TerminalSnapshot;
    /** A selection to put on the clipboard. */
    copy: { text: string };
    /** Edit > Paste: the app pastes its clipboard into the session. */
    paste: null;
    /** Cmd+click on a link (the program's OSC 8, or a URL in the text). */
    open: { url: string };
    /** Cmd+F: the app's find bar. */
    find: null;
    /** Cmd+G / Cmd+Shift+G: the next (1) or previous (-1) match. */
    findStep: { step: number };
  }
>("zu.terminal", {
  props: [
    "session",
    "fontFamily",
    "fontSize",
    "lineHeight",
    "colors",
    "cursorStyle",
    "cursorBlink",
    "optionAsMeta",
    "menu",
  ],
  events: ["snapshot", "copy", "paste", "open", "find", "findStep"],
});

/**
 * A surface's ref as the store's `TerminalViewRef`. Reads are answered by the
 * view's `snapshot` event, in the order they were asked; `answer` is the
 * sheet's `onSnapshot`.
 */
export function surfaceView(node: NativeComponentRef): {
  view: TerminalViewRef;
  answer: (s: TerminalSnapshot) => void;
} {
  const waiting: ((s: TerminalSnapshot) => void)[] = [];
  const snapshot = () =>
    new Promise<TerminalSnapshot>((resolve) => {
      waiting.push(resolve);
      node.command("snapshot");
    });
  const view: TerminalViewRef = {
    focus: () => node.command("focus"),
    font: () => snapshot().then((s) => s.font),
  };
  return { view, answer: (s) => waiting.shift()?.(s) };
}
