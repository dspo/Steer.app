import { mount } from "nsh";
import { seedSession } from "../modules/pi/sessions";
import { SessionBody } from "../modules/pi/view";
import { visiblePanels } from "../core/dock";

// A restored session whose history is still in flight: the sheet draws the
// loading page (the pixel meerkat), not the empty conversation page. Seeded;
// no engine.
seedSession("loading", [], {
  path: "/tmp/zu-loading.jsonl",
  cwd: "/tmp/zu",
  loading: true,
  model: { provider: "bailian", id: "qwen3.8-flash", name: "Qwen3.8 Flash", contextWindow: 1_000_000, reasoning: true },
  thinkingLevel: "high",
});
visiblePanels.set(["session:loading"]);

mount(() => <SessionBody id="loading" sheetId="session:loading" />);
