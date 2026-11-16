/**
 * `~/.pi/zu/settings.json` is written by the app and only read here. The
 * contract that matters: a bad or missing file never stops a session, and
 * `disabledExtensions` is the only key that becomes behavior.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readZuSettings, ZU_SETTINGS_FILE, zuStateDir } from "./settings";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** An agent dir shaped like `~/.pi/agent`, with optional settings in `~/.pi/zu`. */
function sandbox(settings?: string): { agentDir: string; stateDir: string } {
  const root = mkdtempSync(join(tmpdir(), "zu-settings-"));
  roots.push(root);
  const agentDir = join(root, ".pi", "agent");
  mkdirSync(agentDir, { recursive: true });
  if (settings !== undefined) {
    const stateDir = zuStateDir(agentDir);
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(stateDir, ZU_SETTINGS_FILE), settings);
  }
  return { agentDir, stateDir: zuStateDir(agentDir) };
}

describe("zuStateDir", () => {
  test("derives ~/.pi/zu from the agent dir, like the subagent store", () => {
    expect(zuStateDir("/home/me/.pi/agent")).toBe("/home/me/.pi/zu");
  });
});

describe("readZuSettings", () => {
  test("a missing file means nothing is disabled", async () => {
    const { agentDir } = sandbox();
    expect(await readZuSettings(agentDir)).toEqual({ disabled: new Set(), raw: {} });
  });

  test("a corrupt file is ignored, not thrown", async () => {
    const { agentDir } = sandbox("{ not json");
    expect((await readZuSettings(agentDir)).disabled.size).toBe(0);
  });

  test("a JSON value that is not an object is ignored", async () => {
    const { agentDir } = sandbox("[1, 2, 3]");
    const read = await readZuSettings(agentDir);
    expect(read.disabled.size).toBe(0);
    expect(read.raw).toEqual({});
  });

  test("disabledExtensions that is not an array is ignored", async () => {
    const { agentDir } = sandbox(JSON.stringify({ disabledExtensions: "todos" }));
    expect((await readZuSettings(agentDir)).disabled.size).toBe(0);
  });

  test("a string array becomes the disabled set; junk entries are dropped", async () => {
    const { agentDir } = sandbox(JSON.stringify({ disabledExtensions: ["todos", 7, "", null, " ask "] }));
    expect([...(await readZuSettings(agentDir)).disabled].sort()).toEqual(["ask", "todos"]);
  });

  test("other keys are kept in raw but decide nothing", async () => {
    const { agentDir } = sandbox(JSON.stringify({ sidebarWidth: 232, disabledExtensions: [] }));
    expect((await readZuSettings(agentDir)).raw).toEqual({ sidebarWidth: 232, disabledExtensions: [] });
  });
});
