import { mount } from "nsh";
import { seedSession } from "../modules/pi/sessions";
import { SessionBody } from "../modules/pi/view";
import { visiblePanels } from "../core/dock";
import { assistantEntry, toolEntry, userEntry, type Entry } from "../modules/pi/transcript";
import type { SessionBanner } from "../modules/pi/protocol";

// The transcript language in one frame (issue #20 §8): the session banner,
// a folded thinking block, and the three tool kinds the cards specialize
// on — execute with a failing exit and truncated output, read with
// parameters, edit with a diff. Seeded; no engine.

export const BANNER: SessionBanner = {
  version: "1.5.0",
  model: { provider: "bailian", id: "qwen3.8-flash", name: "Qwen3.8 Flash" },
  thinkingLevel: "high",
  skills: [
    { name: "nsh", description: "the repo's own skill", source: "project" },
    { name: "cnb-api", description: "CNB 的 API 语义", source: "user" },
  ],
  extensions: [{ name: "ghostex-session", path: "/x/ghostex-session.ts", source: "user" }],
  warnings: [{ severity: "warning", source: "skill", message: "auto (user) ~/.agents/skills/surge/SKILL.md: name contains invalid characters" }],
};

const entries: Entry[] = [
  userEntry("fx-u1", "修一下 login 的 500", { at: 1760000000000, entryId: "fx-u1" }),
  {
    kind: "assistant",
    id: "fx-a1",
    text: "",
    thoughts:
      "login 500 出现在 session 解析之后，先看 cookie 过期分支……\n先确认 /session 中间件有没有吞掉 Set-Cookie。",
    pi: { at: 1760000001000, entryId: "fx-a1", settled: true, durationMs: 4200, stopReason: "end_turn" },
  },
  toolEntry("fx-t2", "bash bun test login", "failed", {
    name: "bash",
    toolKind: "execute",
    rawInput: { command: "bun test login" },
    output: "$ bun test login\n✓ parses the form\n✗ rejects an expired session\nexpected 302, received 500\nerror: login.test.ts:12\n…",
    meta: { durationMs: 1800, exitCode: 1, truncated: true, totalLines: 36, fullOutputPath: "/tmp/pi-bash-8123.log" },
  }),
  toolEntry("fx-t1", "read app/routes/login.ts", "completed", {
    name: "read",
    toolKind: "read",
    rawInput: { path: "app/routes/login.ts", line: 1, limit: 80 },
    locations: [{ path: "app/routes/login.ts" }],
    output: "import { Handler } from \"../http\";\n\nexport async function login(req: Response) {\n  const session = req.cookie(\"session\");\n  if (!session) return 500;\n  return render(session.user);\n}\n",
  }),
  toolEntry("fx-t3", "edit app/routes/login.ts", "completed", {
    name: "edit",
    toolKind: "edit",
    rawInput: { path: "app/routes/login.ts" },
    diffs: [
      {
        path: "app/routes/login.ts",
        oldText: "  if (!session) return 500;",
        newText: "  if (!session) return redirect(\"/login?expired=1\");",
      },
    ],
    locations: [{ path: "app/routes/login.ts" }],
  }),
  assistantEntry("fx-a2", "login 的 500 是 **session cookie 过期**后没有走重定向。已改为跳转 `/login?expired=1`，并保留原会话校验。\n\n```ts\nif (!session) return redirect(\"/login?expired=1\");\n```\n\n重新跑 `bun test login` 即可验证。", {
    at: 1760000005000,
    entryId: "fx-a2",
    settled: true,
    durationMs: 2600,
    stopReason: "end_turn",
  }),
  {
    kind: "assistant",
    id: "fx-a0",
    text: "",
    thoughts: "只把过期的 cookie 重定向走，其余 500 保留。",
    pi: { at: 1760000000500, entryId: "fx-a0", settled: true, durationMs: 1200, stopReason: "end_turn" },
  },
];

seedSession("transcript", entries, {
  path: "/tmp/zu-transcript.jsonl",
  cwd: "/tmp/zu",
  banner: BANNER,
  // The live model differs from the banner's first-frame snapshot: the
  // banner must read this view value, not the stale banner model.
  model: { provider: "bigmodel", id: "glm-5.3-flash", name: "GLM-5.3 Flash", contextWindow: 1_000_000, reasoning: true },
  thinkingLevel: "high",
  contextUsage: { tokens: 12300, contextWindow: 1_000_000, percent: 1 },
});
visiblePanels.set(["session:transcript"]);

mount(() => <SessionBody id="transcript" sheetId="session:transcript" />);
