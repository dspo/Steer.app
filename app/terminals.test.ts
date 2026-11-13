import { expect, test } from "nsh/test";
import { defaultAction, registerTerminal, terminalAction, terminalResource, terminalSheetContainer, terminalSheetId } from "./domains/pty";

// A terminal is a resource of a container (`terminal:{containerId}:{n}`), so
// one container can hold a shell beside an agent TUI. Container ids carry
// their own colons (`pi:…`, `external:claude:…`); the sheet id's last segment
// is the only numeric one.

test("a terminal sheet id names one resource of one container", () => {
  const id = terminalSheetId("external:claude:u-1", 3);
  expect(id).toBe("terminal:external:claude:u-1:3");
  expect(terminalResource(id)).toEqual({ containerId: "external:claude:u-1", index: 3 });
  // A layout written before terminals were resources is resource 1.
  expect(terminalResource("terminal:pi:abc")).toEqual({ containerId: "pi:abc", index: 1 });
  expect(terminalSheetContainer("terminal:pi:abc:2")).toBe("pi:abc");
  // Another kind is not a terminal.
  expect(terminalResource("session:pi:abc")).toBeNull();
  expect(terminalSheetContainer("home:pi:abc")).toBeNull();
});

test("a terminal's action is what its opener registered", () => {
  // No container kind decides it any more: the sheet's opener does, and a
  // restored sheet falls back to a plain shell.
  expect(defaultAction()).toBe("shell");
  const id = terminalSheetId("external:claude:u-2", 1);
  registerTerminal(id, "Claude");
  expect(terminalAction(id)).toBe("Claude");
  expect(terminalAction(terminalSheetId("external:claude:u-2", 2))).toBeUndefined();
});
