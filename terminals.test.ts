import { expect, test } from "nsh/test";
import { defaultAction, terminalResource, terminalSheetContainer, terminalSheetId } from "./stores/terminals";

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

test("a container's own terminal runs its kind's CLI", () => {
  expect(defaultAction("Pi")).toBe("shell");
  expect(defaultAction("Terminal")).toBe("shell");
  expect(defaultAction("Claude")).toBe("Claude");
  expect(defaultAction("Codex")).toBe("Codex");
  expect(defaultAction("Copilot")).toBe("Copilot");
});
