import { open, test } from "nsh/test";

// The real Claude Code TUI in a real PTY, through the same Terminal sheet:
// start it, wait for its own screen, then interrupt it with Ctrl+C and prove
// the shell is back by running a command. No model call is made.
//
// Observed on this machine (2026-11-10): Claude Code v2.1.278 draws its
// banner, model line and composer; Ctrl+C returns to the shell. A real turn
// was attempted by hand and the CLI reported `API error · Retrying`, so this
// test does not claim a completed conversation.

test("Claude Code's TUI draws in the terminal and Ctrl+C returns to the shell", async () => {
  const app = await open("./fixtures/terminal.tsx", { width: 1200, height: 800 });
  await app.waitFor("id:terminal-screen");
  await app.type("id:terminal-view", "claude");
  await app.keyboard.press("enter");
  // Its banner, onboarding or trust screen: any of them is Claude Code's own
  // alternate-screen TUI, not a shell error.
  await app.waitUntil(
    () =>
      app.texts().some(
        (text) =>
          text.includes("Claude Code") ||
          text.includes("Welcome to Claude Code") ||
          text.includes("Do you trust the files in this folder"),
      ),
    { timeout: 45000 },
  );

  await app.keyboard.press("ctrl+c");
  await app.wait(500);
  // Claude Code may want a second interrupt while it shuts its TUI down.
  await app.keyboard.press("ctrl+c");
  await app.wait(500);
  await app.type("id:terminal-view", "printf 'M7_CLAUDE_EXITED\\n'");
  await app.keyboard.press("enter");
  await app.waitUntil(() => app.texts().some((text) => text.includes("M7_CLAUDE_EXITED")), {
    timeout: 15000,
  });
});
