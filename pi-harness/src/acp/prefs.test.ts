import { describe, expect, test } from "bun:test";
import { applySessionPrefs } from "./pi-session";

/** The env-carried prefs apply to a fresh session; an unknown model is
 * logged and skipped, never thrown (the turn runs on pi's default). */
describe("applySessionPrefs", () => {
  const fakeSession = (model?: unknown) => {
    const calls: string[] = [];
    return {
      calls,
      modelRuntime: model
        ? { getModel: (provider: string, id: string) => (provider === "bailian" && id === "m1" ? { provider, id } : undefined) }
        : undefined,
      setModel: async (m: unknown) => {
        calls.push(`setModel:${JSON.stringify(m)}`);
      },
      setThinkingLevel: (level: string) => {
        calls.push(`thinking:${level}`);
      },
    };
  };

  test("applies a known model and the effort", async () => {
    process.env.ZU_PI_MODEL = "bailian/m1";
    process.env.ZU_PI_EFFORT = "low";
    const session = fakeSession(true);
    const logs: string[] = [];
    applySessionPrefs(session as never, (line) => logs.push(line));
    await Promise.resolve();
    expect(session.calls).toContain('setModel:{"provider":"bailian","id":"m1"}');
    expect(session.calls).toContain("thinking:low");
    expect(logs).toBeEmpty();
    delete process.env.ZU_PI_MODEL;
    delete process.env.ZU_PI_EFFORT;
  });

  test("an unknown model is a log line, not a turn-killer", () => {
    process.env.ZU_PI_MODEL = "nope/m";
    const session = fakeSession(true);
    const logs: string[] = [];
    applySessionPrefs(session as never, (line) => logs.push(line));
    expect(session.calls).toBeEmpty();
    expect(logs[0]).toContain("unknown model");
    delete process.env.ZU_PI_MODEL;
  });
});
