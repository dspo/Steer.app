import { open } from "nsh/test";
import { terminalTest as test, typeKeys } from "./terminal-keys";

// Acceptance for M7's sheet: a real PTY's output is read back from the
// Terminal's emulator (not a fake stream), the view's own resize reaches the
// process, and closing the handle kills it. `vim` runs in the same view to
// prove the alternate screen and full-screen drawing are real.
//
// The fixture shows the last lines of `TerminalRef.text()`; a test asserts on
// those lines, so what it sees is what the emulator drew.

function sizeOf(app: { texts: () => string[] }): string | null {
  return app.texts().find((text) => /^\d+x\d+$/.test(text)) ?? null;
}

test("a PTY reaches the Terminal view, resizes with it and closes", async () => {
  const app = await open("../fixtures/terminal.tsx", { width: 1200, height: 800 });
  await app.waitFor("id:terminal-screen");
  await app.waitUntil(() => sizeOf(app) !== null, { timeout: 10000 });
  const initial = sizeOf(app);
  // The sheet's face (`SHEET_FONT`) is the one drawn: the app's font is
  // registered before the surface resolves it, never a silent fallback.
  await app.waitUntil(() => app.texts().includes("font:Geist Mono"), { timeout: 10000 });

  await typeKeys(app, "printf 'M7_TERMINAL_VIEW_OK\\n'");
  await app.keyboard.press("enter");
  await app.waitUntil(() => app.texts().some((text) => text.includes("M7_TERMINAL_VIEW_OK")), {
    timeout: 10000,
  });

  // `Terminal.onResize` must write the new grid back to the PTY: the PTY's
  // own reported size (and later `stty size`) follow the viewport.
  await app.setViewport(1000, 650);
  await app.waitUntil(() => sizeOf(app) !== null && sizeOf(app) !== initial, { timeout: 10000 });

  // The program's OSC title reaches the store (the sidebar and tab use it).
  await typeKeys(app, "printf '\\033]0;M7_TERMINAL_TITLE\\007'");
  await app.keyboard.press("enter");
  await app.waitUntil(
    () => app.texts().some((text) => text.includes("M7_TERMINAL_TITLE")),
    { timeout: 10000 },
  );

  await typeKeys(app, "stty size");
  await app.keyboard.press("enter");
  // `stty size` prints "rows cols"; `sizeOf` reads the PTY's "cols x rows".
  const [cols, rows] = sizeOf(app)!.split("x");
  await app.waitUntil(
    () => app.texts().some((text) => text.includes(`${rows} ${cols}`)),
    { timeout: 10000 },
  );

  await app.press("id:fixture-close");
  await app.waitUntil(() => app.shows("text:closed"), { timeout: 10000 });
  await app.waitUntil(() => app.shows("text:stopped"), { timeout: 10000 });
});

test("vim draws in the real terminal and quits", async () => {
  const app = await open("../fixtures/terminal.tsx", { width: 1200, height: 800 });
  await app.waitFor("id:terminal-screen");
  await typeKeys(app, "vim -u NONE /tmp/zu-m7-vim.txt");
  await app.keyboard.press("enter");
  // Vim's status line is part of the alternate screen; seeing the file name
  // proves the emulator received and drew a full-screen program.
  await app.waitUntil(() => app.texts().some((text) => text.includes("zu-m7-vim.txt")), {
    timeout: 15000,
  });
  await typeKeys(app, ":q!");
  await app.keyboard.press("enter");
  // Back at the shell: type a command and see its output, i.e. vim restored
  // the primary screen.
  await typeKeys(app, "printf 'M7_VIM_EXITED\\n'");
  await app.keyboard.press("enter");
  await app.waitUntil(() => app.texts().some((text) => text.includes("M7_VIM_EXITED")), {
    timeout: 10000,
  });
});

test("htop draws its alternate screen and quits", async () => {
  const app = await open("../fixtures/terminal.tsx", { width: 1200, height: 800 });
  await app.waitFor("id:terminal-screen");
  await typeKeys(app, "htop");
  await app.keyboard.press("enter");
  await app.waitUntil(
    () =>
      app.texts().some(
        (text) => text.includes("CPU") || text.includes("Mem") || text.includes("Tasks"),
      ),
    { timeout: 20000 },
  );
  await app.keyboard.press("q");
  await typeKeys(app, "printf 'M7_HTOP_EXITED\\n'");
  await app.keyboard.press("enter");
  await app.waitUntil(() => app.texts().some((text) => text.includes("M7_HTOP_EXITED")), {
    timeout: 10000,
  });
});

// The Spike terminal draws libghostty-vt's grid itself. A shrink must reflow
// the history instead of truncating it (the defect `nsh/base`'s VtEmulator
// still has), and the pixels must show the same text the ref reads.
// Best effort: headless has no pixels to capture; a `--target macos` run
// writes the evidence.
async function shot(app: { screenshot: (path: string) => Promise<unknown> }, path: string): Promise<void> {
  try {
    await app.screenshot(path);
  } catch {
    // No real platform.
  }
}

function zerosOf(app: { texts: () => string[] }): number {
  // The fixture's screen text is one element per rendered line; the zeros
  // wrap, so count them across every text the fixture shows.
  return app.texts().reduce((n, text) => n + (text.match(/0/g) ?? []).length, 0);
}

test("a narrower viewport reflows history instead of truncating it", async () => {
  const app = await open("../fixtures/terminal.tsx", { width: 1200, height: 800 });
  await app.waitFor("id:terminal-screen");
  await app.waitUntil(() => sizeOf(app) !== null, { timeout: 10000 });
  const initial = sizeOf(app)!;

  // 300 zeros wrap to 2 lines at the initial width; the ref sees them all.
  await typeKeys(app, "printf 'REF%s\\n' \"$(printf '%0300d' 0)\"");
  await app.keyboard.press("enter");
  await app.waitUntil(() => zerosOf(app) >= 300, { timeout: 10000 });
  await shot(app, "/tmp/ghostty-spike-wide.png");

  await app.setViewport(1000, 650);
  await app.waitUntil(() => sizeOf(app) !== null && sizeOf(app) !== initial, { timeout: 10000 });
  // A truncating emulator loses characters here; a reflowing one keeps all 300.
  await app.waitUntil(() => zerosOf(app) >= 300, { timeout: 10000 });
  await shot(app, "/tmp/ghostty-spike-narrow.png");
});
test("the ref scrolls through history and a selection reads it", async () => {
  const app = await open("../fixtures/terminal.tsx", { width: 1200, height: 800 });
  await app.waitFor("id:terminal-screen");
  await typeKeys(app, "for i in $(seq 1 400); do echo LINE$i; done; echo BOTTOM");
  await app.keyboard.press("enter");
  await app.waitUntil(() => app.texts().some((text) => text.includes("BOTTOM")), {
    timeout: 15000,
  });

  await app.press("id:fixture-select-all");
  await app.waitUntil(
    () => app.texts().some((text) => text.includes("LINE400") && text.includes("BOTTOM")),
    { timeout: 10000 },
  );

  await app.press("id:fixture-scroll-up");
  await app.waitUntil(
    () => app.texts().some((text) => text.includes("LINE1") && !text.includes("LINE400")),
    { timeout: 10000 },
  );
  await app.press("id:fixture-select-all");
  await app.waitUntil(
    () => app.texts().some((text) => text.includes("LINE1") && text.includes("LINE2")),
    { timeout: 10000 },
  );
  await shot(app, "/tmp/ghostty-spike-selection.png");

  await app.press("id:fixture-scroll-bottom");
  await app.waitUntil(
    () => app.texts().some((text) => text.includes("LINE400") && text.includes("BOTTOM")),
    { timeout: 10000 },
  );
  // The selection is anchored to screen rows, so scrolling the viewport does
  // not move it off its text: select-all still reads the whole buffer.
  await app.waitUntil(
    () => app.texts().some((text) => text.includes("LINE1") && text.includes("LINE400")),
    { timeout: 10000 },
  );
});

// Wide cells and emoji must survive the cell grid: the snapshot reports the
// grapheme once and the spacer tail must not shift the line after it.
test("wide characters and emoji stay in the grid", async () => {
  const app = await open("../fixtures/terminal.tsx", { width: 1200, height: 800 });
  await app.waitFor("id:terminal-screen");
  // A keyboard types no CJK: the shell's printf spells it out — as UTF-8
  // octal bytes, because stock bash 3.2 (macOS, CI images) predates the
  // \u escape and would print the literals instead.
  await typeKeys(app, "printf 'CJK\\344\\270\\255\\346\\226\\207\\360\\237\\231\\202END\\n'");
  await app.keyboard.press("enter");
  await app.waitUntil(
    () => app.texts().some((text) => text.includes("CJK中文🙂END")),
    { timeout: 10000 },
  );
  await shot(app, "/tmp/ghostty-spike-cjk.png");
});

// Cmd+C must reach the component's binding, not be swallowed by the platform
// input; nsh tests use their own in-memory clipboard, so this touches nothing
// on the machine. `CLIP:` keeps the clipboard text distinct from the selection.
test("Cmd+C copies the selection to the clipboard", async () => {
  const app = await open("../fixtures/terminal.tsx", { width: 1200, height: 800 });
  await app.waitFor("id:terminal-screen");
  await typeKeys(app, "printf 'COPY_MARK_XYZ\\n'");
  await app.keyboard.press("enter");
  await app.waitUntil(() => app.texts().some((text) => text.includes("COPY_MARK_XYZ")), {
    timeout: 10000,
  });
  await app.press("id:fixture-select-all");
  await app.keyboard.press("cmd+c");
  await app.waitUntil(
    () =>
      app.texts().some(
        (text) => text.startsWith("CLIP:") && text.includes("COPY_MARK_XYZ"),
      ),
    { timeout: 10000 },
  );
});

// Cmd+F opens the sheet's find bar; typing finds in the history, Return
// walks to older matches, Escape-free close returns the keyboard.
test("Cmd+F finds in the terminal's history", async () => {
  const app = await open("../fixtures/terminal.tsx", { width: 1200, height: 800 });
  await app.waitFor("id:terminal-screen");
  await typeKeys(app, "for i in 1 2 3; do echo FINDME$i; done");
  await app.keyboard.press("enter");
  await app.waitUntil(() => app.texts().some((text) => text.includes("FINDME3")), { timeout: 10000 });
  await app.keyboard.press("cmd+f");
  await app.waitFor("id:terminal-find-input", { timeout: 5000 });
  await app.type("id:terminal-find-input", "FINDME");
  await app.waitUntil(() => app.texts().some((text) => /^1\/\d+$|^1 of \d+$/.test(text)), { timeout: 5000 });
  await app.press("id:terminal-find-next");
  await app.waitUntil(() => app.texts().some((text) => /^2\/\d+$|^2 of \d+$/.test(text)), { timeout: 5000 });
  await app.press("id:terminal-find-close");
  await app.waitUntil(() => !app.shows("id:terminal-find"), { timeout: 5000 });
});
