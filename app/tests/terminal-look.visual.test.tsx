import { open } from "nsh/test";
import { terminalTest as test, typeKeys } from "./terminal-keys";

// Pictures of what only a real platform draws, for the visual check: the
// box and block sprites, the theme's ANSI colors, the scrollbar while the
// viewport is in the history and after it fades, and the find marks.
// Screenshots go to /tmp/zu-look-*.png.
test("the terminal's look: sprites, colors, scrollbar, find marks", async () => {
  const app = await open("../fixtures/terminal.tsx", { width: 1200, height: 800 });
  await app.waitFor("id:terminal-screen");
  await app.wait(1200);
  // ANSI colors, box and block characters (as octal UTF-8), a URL, history.
  await typeKeys(
    app,
    "clear; for c in 0 1 2 3 4 5 6 7; do printf \"\\e[3${c}m col$c \\e[9${c}m bright$c\\e[0m\\n\"; done; " +
      "printf '\\342\\224\\214\\342\\224\\200\\342\\224\\254\\342\\224\\200\\342\\224\\220 " +
      "\\342\\226\\221\\342\\226\\222\\342\\226\\223\\342\\226\\210\\n'; " +
      "echo 'url https://ghostty.org/docs (x).'; seq 1 120 | sed 's/^/row /'; echo LOOK_END",
  );
  await app.keyboard.press("enter");
  await app.waitUntil(() => app.texts().some((text) => text.includes("LOOK_END")), { timeout: 10000 });
  await app.screenshot("/tmp/zu-look-1-screen.png");
  await app.press("id:fixture-scroll-up");
  await app.wait(150);
  await app.screenshot("/tmp/zu-look-2-scrolled.png");
  await app.wait(1500);
  await app.screenshot("/tmp/zu-look-3-faded.png");
  await app.press("id:fixture-scroll-bottom");
  await app.press("id:fixture-select-all");
  await app.keyboard.press("cmd+f");
  await app.waitFor("id:terminal-find-input", { timeout: 5000 });
  await app.type("id:terminal-find-input", "row 1");
  await app.wait(400);
  await app.screenshot("/tmp/zu-look-4-find.png");
}, 90000);

// A Kitty graphics placement paints the four red pixels at the cursor.
test("the terminal's look: inline Kitty image", async () => {
  const app = await open("../fixtures/terminal.tsx", {
    width: 1200,
    height: 800,
  });
  await app.waitFor("id:terminal-screen");
  await app.wait(1200);
  await typeKeys(
    app,
    "clear; printf '\\033_Ga=T,f=32,s=2,v=2,q=2;/wAA//8AAP//AAD//wAA/w==\\033\\\\'; echo IMAGE_END",
  );
  await app.keyboard.press("enter");
  await app.waitUntil(
    () => app.texts().some((text) => text.includes("IMAGE_END")),
    {
      timeout: 10000,
    },
  );
  await app.screenshot("/tmp/zu-look-5-image.png");
}, 90000);
