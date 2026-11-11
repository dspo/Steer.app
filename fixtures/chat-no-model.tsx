import { mount } from "nsh";
import { seedSession, setModelTransport } from "../sessions";
import { SessionBody } from "../sheets";
import { visiblePanels } from "../dock";

// A session on a machine with no usable model: `session.info` carries no
// model and `session.models` answers with a reason. The first reads are the
// empty state (the composer's own ask, then the menu's); a later read stands
// in for signing in to pi, so a retry finds providers without a restart.
const providers = [
  {
    id: "bailian",
    name: "Bailian",
    models: [
      {
        provider: "bailian",
        id: "qwen3.8-flash",
        name: "Qwen3.8 Flash",
        contextWindow: 1_000_000,
        reasoning: true,
      },
    ],
  },
];
let reads = 0;

setModelTransport(async (type, payload: any = {}) => {
  switch (type) {
    case "session.models":
      reads += 1;
      // The composer's ask and the menu's first read are both empty; the
      // retry is after the pretend sign-in.
      if (reads <= 2) return { providers: [], thinkingLevel: "off", reason: { code: "no_credentials" } };
      return { providers, thinkingLevel: "off" };
    case "session.setModel": {
      const model = providers[0].models.find((row) => row.id === payload.id);
      if (!model) throw new Error(`unknown model ${String(payload.provider)}/${String(payload.id)}`);
      return {
        sessionId: payload.sessionId,
        path: "/tmp/zu-no-model.jsonl",
        name: "No model",
        running: false,
        customTypes: [],
        thinkingLevel: "off",
        model: { ...model },
      };
    }
    default:
      throw new Error(`unexpected ${type}`);
  }
});

seedSession("no-model", [], { path: "/tmp/zu-no-model.jsonl", cwd: "/tmp/zu" });
visiblePanels.set(["session:no-model"]);

mount(() => <SessionBody id="no-model" sheetId="session:no-model" />);
