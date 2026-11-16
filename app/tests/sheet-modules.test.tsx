import { expect, test } from "nsh/test";
import { registerAllModules } from "../modules/register-all";
import {
  dispatchIntent,
  kindOf,
  moduleSearch,
  registerModule,
  registeredModules,
  restoreSheetIds,
  sheetSpec,
  titlebarActions,
} from "../core/registry";
import { sessions } from "../modules/pi/sessions";
import { sheetGlyph, sheetTitle } from "../canvas/sheets";

/**
 * The module contract (docs/sheet-module-ARCHITECTURE.md §11): every shipped
 * kind is registered, its id parser is total, a duplicate owner is a bug, a
 * dead resource is pruned, and an unknown kind degrades to no spec (the
 * canvas draws its placeholder).
 */

registerAllModules();

test("every shipped kind is registered with a title, a glyph and a total parser", () => {
  const modules = registeredModules();
  expect(modules.length).toBeGreaterThanOrEqual(7);
  const kinds = modules.flatMap((module) => module.kinds);
  const ids = [
    "home:c1",
    "session:s1",
    "subagents:c1",
    "terminal:c1:1",
    "webview:c1:1",
    "files:c1",
    "editor:c1:abc",
    "diff:c1:a~b",
    "changes:c1",
    "history:c1",
    "problems:c1",
    "manox-chat:t1:c1",
  ];
  for (const id of ids) {
    const spec = sheetSpec(id);
    expect(spec).toBeTruthy();
    expect(typeof spec!.title(id)).toBe("string");
    expect(sheetGlyph(id)).toBeTruthy();
    expect(spec!.parse(id)).not.toBeNull();
    // A parser is total: a malformed or foreign id is null, never a throw.
    expect(spec!.parse(`${kindOf(id)}:not-a-real-id`)).not.toBeUndefined();
  }
});

test("an unowned kind has no spec and reads as its id", () => {
  expect(sheetSpec("svg:c1")).toBeUndefined();
  expect(sheetTitle("svg:c1")).toBe("svg:c1");
  expect(sheetGlyph("svg:c1")).toBe("file");
});

test("a second owner of one kind is a bug", () => {
  expect(() =>
    registerModule({
      id: "fake-owner",
      kinds: [
        {
          kind: "session",
          glyph: "chat",
          title: () => "x",
          body: () => <></>,
          parse: () => null,
        },
      ],
    }),
  ).toThrow(/already owned/);
});

test("restore drops sheets whose module says the resource is gone", async () => {
  registerModule({
    id: "fake-restore",
    kinds: [
      {
        kind: "fake-live",
        glyph: "file",
        title: () => "live",
        body: () => <></>,
        parse: (id) => id,
        restore: () => true,
      },
      {
        kind: "fake-dead",
        glyph: "file",
        title: () => "dead",
        body: () => <></>,
        parse: (id) => id,
        restore: () => false,
      },
    ],
  });
  const kept = await restoreSheetIds(["fake-live:a", "fake-dead:b", "session:s9"]);
  expect(kept).toEqual(["fake-live:a", "session:s9"]);
});

test("the titlebar and the search are module contributions", () => {
  const ids = titlebarActions().map((action) => action.id);
  expect(ids).toContain("open-files");
  expect(ids).toContain("open-browser");
  sessions.set([
    {
      id: "s1",
      path: "/tmp/alpha.jsonl",
      cwd: "/tmp/alpha",
      name: "Alpha talk",
      created: 1,
      modified: 2,
      messageCount: 3,
      preview: "hello",
    },
  ]);
  const hits = moduleSearch("alpha");
  expect(hits.length).toBe(1);
  expect(hits[0].title).toBe("Alpha talk");
});

test("intents resolve through the owning module and unknown intents are null", () => {
  expect(dispatchIntent("nope.nothing", {}, { containerId: null })).toBeNull();
  // A browser works on any canvas, so its intent needs no container.
  expect(dispatchIntent("browser.open", { containerId: null }, { containerId: null })).toBeTruthy();
});
