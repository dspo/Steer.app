import { expect, test } from "nsh/test";
import { activeContainerId, containers, layout, noteSheetOpened, setLayout, sheetOrder } from "../core/containers";
import { appendSheet, removeSheet } from "../core/dock";
import { defaultLayoutForSessions, sessionSheetId } from "../modules/pi/sheets";
import { applyBrowserNavigation, browserSheetId, ensureBrowserPage } from "../modules/browser/store";
import { seedSession } from "../modules/pi/sessions";
import { assistantEntry } from "../modules/pi/transcript";
import { terminalInfo, terminalSheetId } from "../domains/pty";
import { editorSheetId } from "../modules/files/editors";
import { sheetTabTitle, sheetTitle } from "../canvas/sheets";
import { containerTitle } from "../canvas/titles";
import {
  closeTitleChannel,
  flushPendingTitle,
  programTitle,
  pruneTitles,
  setProgramTitle,
} from "../modules/pi/titles";
import { registerAllModules } from "../modules/register-all";

registerAllModules();

// §2.1-5 (S2): a container's title is its earliest-created surviving sheet's,
// and each kind names itself — a session its name, a terminal its OSC title,
// a browser page its page title. Closing the first tab promotes the second.

const container = {
  id: "c1",
  kind: "Pi" as const,
  cwd: "/tmp/alpha",
  archived: false,
  createdAt: 1,
  updatedAt: 1,
  sessions: [
    { sessionId: "s1", path: "/tmp/alpha.jsonl", name: "Alpha" },
    { sessionId: "s2", path: "/tmp/beta.jsonl", name: "Beta" },
  ],
};

function seedOrder(ids: string[]): void {
  containers.set([container]);
  activeContainerId.set("c1");
  sheetOrder.set({ c1: ids });
  layout.set(defaultLayoutForSessions(["s1", "s2"]));
}

test("closing the first sheet promotes the second's title", () => {
  seedSession("s1", [assistantEntry("fx-a", "alpha body")], { path: "/tmp/alpha.jsonl", name: "Alpha", loaded: true });
  seedSession("s2", [assistantEntry("fx-b", "beta body")], { path: "/tmp/beta.jsonl", name: "Beta", loaded: true });
  seedOrder([sessionSheetId("s1"), sessionSheetId("s2")]);
  expect(containerTitle(container)).toBe("Alpha");

  // The tab bar's × is `setLayout(removeSheet(...))`: the order prunes with it.
  setLayout(removeSheet(layout(), sessionSheetId("s1")));
  expect(sheetOrder().c1).toEqual([sessionSheetId("s2")]);
  expect(containerTitle(container)).toBe("Beta");
});

test("a terminal's OSC title is the container's title, and follows it", () => {
  const sheet = terminalSheetId("c1", 1);
  seedOrder([sheet]);
  const info = { title: "Claude Code", running: true, exitCode: null, exitSignal: null, error: null, session: null, progress: null };
  terminalInfo.set({ [sheet]: info });
  expect(containerTitle(container)).toBe("Claude Code");

  // What a TUI's OSC 0/2 does: the store republishes the title.
  terminalInfo.set({ [sheet]: { ...info, title: "fix the failing test" } });
  expect(containerTitle(container)).toBe("fix the failing test");
});

test("a browser page's own title wins, then its address", () => {
  const sheet = browserSheetId("c1", 1);
  seedOrder([sheet]);
  ensureBrowserPage(sheet);
  applyBrowserNavigation(sheet, {
    url: "https://example.org",
    title: "Example Domain",
    loading: false,
    canGoBack: false,
    canGoForward: false,
  } as any);
  expect(containerTitle(container)).toBe("Example Domain");

  applyBrowserNavigation(sheet, {
    url: "https://example.org/next",
    title: "",
    loading: false,
    canGoBack: true,
    canGoForward: false,
  } as any);
  expect(containerTitle(container)).toBe("example.org/next");
});

test("opening and closing sheets records creation order; an empty one falls back", () => {
  containers.set([container]);
  activeContainerId.set("c1");
  sheetOrder.set({});
  layout.set(defaultLayoutForSessions([]));

  noteSheetOpened(sessionSheetId("s2"));
  setLayout(appendSheet(layout(), sessionSheetId("s2")));
  noteSheetOpened(sessionSheetId("s1"));
  setLayout(appendSheet(layout(), sessionSheetId("s1")));
  // Creation order, not tab order: s2 was opened first.
  expect(sheetOrder().c1).toEqual([sessionSheetId("s2"), sessionSheetId("s1")]);

  // No sheets at all: the folder is all a container is.
  setLayout(removeSheet(removeSheet(layout(), sessionSheetId("s2")), sessionSheetId("s1")));
  expect(sheetOrder().c1).toEqual([]);
  expect(containerTitle(container)).toBe("alpha");
});

test("a workspace sheet opened first names the container", () => {
  // openEditorSheet / openChangesSheet note the sheet like every other opener:
  // the earliest-created sheet speaks, fixed titles included (§2.1-5).
  containers.set([container]);
  activeContainerId.set("c1");
  sheetOrder.set({});
  layout.set(defaultLayoutForSessions([]));

  setLayout(appendSheet(layout(), "changes:c1"));
  noteSheetOpened("changes:c1");
  expect(sheetOrder().c1).toEqual(["changes:c1"]);
  expect(containerTitle(container)).toBe(sheetTitle("changes:c1"));

  const editorSheet = editorSheetId("c1", "/tmp/alpha/main.rs");
  setLayout(appendSheet(layout(), editorSheet));
  noteSheetOpened(editorSheet);
  setLayout(removeSheet(layout(), "changes:c1"));
  // The editor sheet was created after Changes, so Changes' departure
  // promotes it — its fixed title, not the captain session's.
  expect(sheetOrder().c1).toEqual([editorSheet]);
  expect(containerTitle(container)).toBe(sheetTitle(editorSheet));
});


// Issue #73: a hosted session's tools set OSC titles through the harness's
// Bash tap. Decision D1 — the program title renames the session's dock tab
// and nothing else; the container keeps the session's own name. D3 — an
// empty title falls back to the session name. The store is keyed by
// session: it survives sheets closing and harness restarts.

test("an agent's program title renames the tab, not the container", () => {
  seedSession("s1", [assistantEntry("fx-a", "alpha body")], { path: "/tmp/alpha.jsonl", name: "Alpha", loaded: true });
  seedOrder([sessionSheetId("s1")]);
  const sheet = sessionSheetId("s1");

  expect(sheetTabTitle(sheet)).toBe("Alpha");
  setProgramTitle("s1", "Zu: 阶段名");
  flushPendingTitle();
  expect(sheetTabTitle(sheet)).toBe("Zu: 阶段名");
  // The container title keeps the session's own name.
  expect(containerTitle(container)).toBe("Alpha");
  // The sheet title (close button, container naming) also stays.
  expect(sheetTitle(sheet)).toBe("Alpha");
});

test("an empty program title falls back to the session name", () => {
  seedSession("s1", [assistantEntry("fx-a", "alpha body")], { path: "/tmp/alpha.jsonl", name: "Alpha", loaded: true });
  seedOrder([sessionSheetId("s1")]);
  const sheet = sessionSheetId("s1");

  setProgramTitle("s1", "");
  expect(sheetTabTitle(sheet)).toBe("Alpha");
  expect(programTitle("s1")).toBe("");
});

test("the program title store is keyed by session, not by sheet", () => {
  seedSession("s1", [assistantEntry("fx-a", "alpha body")], { path: "/tmp/alpha.jsonl", name: "Alpha", loaded: true });
  seedOrder([sessionSheetId("s1")]);
  const sheet = sessionSheetId("s1");

  setProgramTitle("s1", "阶段");
  setProgramTitle("s2", "另一会话");
  flushPendingTitle();
  expect(sheetTabTitle(sheet)).toBe("阶段");
  expect(programTitle("s2")).toBe("另一会话");
});

test("a whitespace-only program title clears and falls back synchronously", () => {
  seedSession("s1", [assistantEntry("fx-a", "alpha body")], { path: "/tmp/alpha.jsonl", name: "Alpha", loaded: true });
  seedOrder([sessionSheetId("s1")]);
  const sheet = sessionSheetId("s1");

  setProgramTitle("s1", "Zu: 阶段名");
  flushPendingTitle();
  expect(sheetTabTitle(sheet)).toBe("Zu: 阶段名");
  setProgramTitle("s1", "   ");
  expect(sheetTabTitle(sheet)).toBe("Alpha");
});

test("pruning drops leftovers without a live view and keeps live sessions", () => {
  seedSession("s1", [assistantEntry("fx-a", "alpha body")], { path: "/tmp/alpha.jsonl", name: "Alpha", loaded: true });
  seedOrder([sessionSheetId("s1")]);
  const sheet = sessionSheetId("s1");
  setProgramTitle("s1", "Zu: live");
  flushPendingTitle();
  // A deleted session's leftover: a store entry whose session no longer
  // exists anywhere (no view, no scan row).
  setProgramTitle("ghost-session", "Zu: leftover");
  flushPendingTitle();

  // refreshSessions composes the live set (scan rows + live views); here
  // s1 is live and ghost-session left everything (D4).
  pruneTitles(["s1"]);
  expect(programTitle("s1")).toBe("Zu: live");
  expect(programTitle("ghost-session")).toBe("");
  expect(sheetTabTitle(sheet)).toBe("Zu: live");
});
