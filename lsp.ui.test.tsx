import { expect, open, test } from "nsh/test";
import { Fs } from "zu/native";
import { FAKE_LSP_SOURCE } from "./fixtures/m11-fake-lsp";
import { M11_UI_ROOT, M11_UI_SERVER } from "./fixtures/m11-paths";

// M11's UI acceptance, through the real `Workbench`.
//
// The server is a **controlled child process** (`fixtures/m11-fake-lsp.ts`,
// written to /tmp here and started through `zu/lsp` by the app): real argv,
// real cwd, real stdin/stdout framing. Its answers are fixed and labelled
// "fake" on screen; the real-rust-analyzer acceptance is `lsp.test.ts`.
// The test proves the app's paths: diagnostics into the editor and Problems,
// the hover card, F12 opening the target sheet at the target range, the
// completion list from `presentCompletions`, and a server restart.

const TAG = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function until(what: string, condition: () => boolean, timeoutMs = 20000): Promise<void> {
  for (let waited = 0; waited < timeoutMs; waited += 25) {
    if (condition()) return;
    await sleep(25);
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** A main.rs long enough that the middle of the editor is text. */
function mainSource(): string {
  const pad = " // padding keeps a line under the pointer at the editor's middle";
  const lines = ["use zu_m11_fixture::add;", "", "fn main() {"];
  for (let index = 0; index < 40; index += 1) {
    lines.push(`    let value_${index}: i32 = ${index};${pad}`);
  }
  lines.push('    let bad: i32 = "not a number";');
  lines.push("    let sum = add(1, 2);");
  lines.push('    println!("{bad} {sum}");');
  lines.push("}");
  return `${lines.join("\n")}\n`;
}

test("the UI shows diagnostics, hover, definition, completion, Problems and a restart", async () => {
  await Fs.mkdir("/tmp", "zu-m11-ui-fixture");
  await Fs.write(
    M11_UI_ROOT,
    "Cargo.toml",
    `[package]\nname = "zu-m11-ui-${TAG}"\nversion = "0.1.0"\nedition = "2021"\n`,
    null,
    null,
  );
  await Fs.mkdir(M11_UI_ROOT, "src");
  await Fs.write(M11_UI_ROOT, "src/main.rs", mainSource(), null, null);
  await Fs.write(
    M11_UI_ROOT,
    "src/target.rs",
    "// the definition target\npub fn target() -> i32 {\n    1\n}\n",
    null,
    null,
  );
  await Fs.write(M11_UI_ROOT, "fake-lsp.js", FAKE_LSP_SOURCE, null, null);
  const canonical = (await Fs.stat(M11_UI_ROOT, ".")).path;
  const mainPath = `${canonical}/src/main.rs`;
  const targetPath = `${canonical}/src/target.rs`;

  const app = await open("./fixtures/lsp.tsx", { width: 1200, height: 800, platform: "macos" });
  try {
    await app.waitFor("id:open-problems");
    await app.waitFor("id:editor-view");

    // The controlled server initializes and opens the document; its
    // publishDiagnostics reaches the editor store and the editor's count.
    await app.waitUntil(() => app.texts().some((text) => text.includes("rust:ready")), {
      timeout: 30000,
    });
    await app.waitUntil(() => app.texts().some((text) => text.includes("main.rs:2")), {
      timeout: 20000,
    });
    await app.waitUntil(() => app.texts().some((text) => text === "2 个诊断"), {
      timeout: 10000,
    });
    expect(app.texts().some((text) => text.includes("main.rs:2"))).toBe(true);

    // Hover card: headless `app.hover` sends MouseMove only to the selector's
    // own view, and `Editor` listens on its inner rows, so the pointer path
    // cannot be driven here (documented as a limitation). The fixture mounts
    // the very same `HoverCard` with a fixed anchor; the native test is what
    // exercises `textDocument/hover`.
    await app.press("id:fixture-hover");
    await app.waitFor("id:editor-hover", { timeout: 10000 });
    expect(app.texts().some((text) => text.includes("fake hover: fn main()"))).toBe(true);
    await app.press("id:fixture-hover");

    // Problems: the top bar entry lists the diagnostics, and its row opens
    // the file at the diagnostic's range. Revealing also focuses the editor,
    // so the keyboard steps below have a target.
    await app.press("id:open-problems");
    await app.waitFor("id:problems-title");
    await app.waitUntil(
      () => app.texts().some((text) => text.includes("fake diagnostic: mismatched types")),
      { timeout: 10000 },
    );
    const rowId = `problems-row-${`${mainPath}#0`.replace(/[^A-Za-z0-9]+/g, "-")}`;
    await app.waitFor(`id:${rowId}`);
    await app.press(`id:${rowId}`);
    await app.waitFor("id:editor-view");
    await app.waitUntil(
      () =>
        app
          .texts()
          .some((text) => text.startsWith("editor:") && text.endsWith(":0:0")),
      { timeout: 10000 },
    );

    // Completion: Ctrl+Space asks at the caret; `presentCompletions` shows
    // the server's item in the editor's list.
    await app.keyboard.press("ctrl+space");
    await app.waitUntil(() => app.texts().some((text) => text.includes("fake_completion")), {
      timeout: 10000,
    });
    await app.keyboard.press("escape");

    // Definition: F12 on the word asks, the target sheet opens, and the
    // app requests the server's target range (the target starts at 1:0) to
    // be revealed; the symbol's own range is 1:4.
    await app.keyboard.press("f12");
    await app.waitUntil(() => app.texts().some((text) => text.includes("target.rs:ready")), {
      timeout: 20000,
    });
    await app.waitUntil(
      () =>
        app
          .texts()
          .some((text) => text.startsWith("editor:") && text.endsWith(":1:0")),
      { timeout: 10000 },
    );

    // Restart: bring Problems back to the front (definition switched the
    // canvas to the target sheet), then its button starts a new process.
    await app.press("id:open-problems");
    await app.waitFor("id:problems-title");
    const before = app.texts().find((text) => text.startsWith("rust:ready")) ?? "";
    const oldPid = Number(before.split(":")[3] ?? "0");
    expect(oldPid).toBeGreaterThan(0);
    await app.press("id:problems-restart-rust");
    await app.waitUntil(
      () =>
        app.texts().some((text) => {
          if (!text.startsWith("rust:ready")) return false;
          const pid = Number(text.split(":")[3] ?? "0");
          return pid > 0 && pid !== oldPid;
        }),
      { timeout: 30000 },
    );
    await app.waitUntil(() => app.texts().some((text) => text.includes("main.rs:2")), {
      timeout: 20000,
    });
  } finally {
    // The fixture's native handles are dropped with the app; no server is
    // left behind by the test itself.
  }
}, 180000);
