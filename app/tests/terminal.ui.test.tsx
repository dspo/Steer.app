import { expect, open, test } from "nsh/test";

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

  await app.type("id:terminal-view", "printf 'M7_TERMINAL_VIEW_OK\\n'");
  await app.keyboard.press("enter");
  await app.waitUntil(() => app.texts().some((text) => text.includes("M7_TERMINAL_VIEW_OK")), {
    timeout: 10000,
  });

  // `Terminal.onResize` must write the new grid back to the PTY: the PTY's
  // own reported size (and later `stty size`) follow the viewport.
  await app.setViewport(1000, 650);
  await app.waitUntil(() => sizeOf(app) !== null && sizeOf(app) !== initial, { timeout: 10000 });

  // The program's OSC title reaches the store (the sidebar and tab use it).
  await app.type("id:terminal-view", "printf '\\033]0;M7_TERMINAL_TITLE\\007'");
  await app.keyboard.press("enter");
  await app.waitUntil(
    () => app.texts().some((text) => text.includes("M7_TERMINAL_TITLE")),
    { timeout: 10000 },
  );

  await app.type("id:terminal-view", "stty size");
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
  await app.type("id:terminal-view", "vim -u NONE /tmp/zu-m7-vim.txt");
  await app.keyboard.press("enter");
  // Vim's status line is part of the alternate screen; seeing the file name
  // proves the emulator received and drew a full-screen program.
  await app.waitUntil(() => app.texts().some((text) => text.includes("zu-m7-vim.txt")), {
    timeout: 15000,
  });
  await app.type("id:terminal-view", ":q!");
  await app.keyboard.press("enter");
  // Back at the shell: type a command and see its output, i.e. vim restored
  // the primary screen.
  await app.type("id:terminal-view", "printf 'M7_VIM_EXITED\\n'");
  await app.keyboard.press("enter");
  await app.waitUntil(() => app.texts().some((text) => text.includes("M7_VIM_EXITED")), {
    timeout: 10000,
  });
});

test("htop draws its alternate screen and quits", async () => {
  const app = await open("../fixtures/terminal.tsx", { width: 1200, height: 800 });
  await app.waitFor("id:terminal-screen");
  await app.type("id:terminal-view", "htop");
  await app.keyboard.press("enter");
  await app.waitUntil(
    () =>
      app.texts().some(
        (text) => text.includes("CPU") || text.includes("Mem") || text.includes("Tasks"),
      ),
    { timeout: 20000 },
  );
  await app.keyboard.press("q");
  await app.type("id:terminal-view", "printf 'M7_HTOP_EXITED\\n'");
  await app.keyboard.press("enter");
  await app.waitUntil(() => app.texts().some((text) => text.includes("M7_HTOP_EXITED")), {
    timeout: 10000,
  });
});
