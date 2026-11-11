import { setModelTransport } from "../sessions";

/** The model picker's fake engine: two providers, one switchable session. */
export function installModelTransport(): void {
  const providers = [
    {
      id: "anthropic",
      name: "Anthropic",
      models: [
        {
          provider: "anthropic",
          id: "claude-sonnet-4",
          name: "Claude Sonnet 4",
          contextWindow: 200_000,
          reasoning: true,
        },
      ],
    },
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
        {
          provider: "bailian",
          id: "qwen3.8-plus",
          name: "Qwen3.8 Plus",
          contextWindow: 1_000_000,
          reasoning: true,
        },
      ],
    },
  ];
  let current = {
    provider: "bailian",
    id: "qwen3.8-flash",
    name: "Qwen3.8 Flash",
    contextWindow: 1_000_000,
    reasoning: true,
  };
  setModelTransport(async (type, payload: any = {}) => {
    switch (type) {
      case "session.models":
        return { providers, current, thinkingLevel: "high" };
      case "session.setModel": {
        const provider = providers.find((row) => row.id === payload.provider);
        const model = provider?.models.find((row) => row.id === payload.id);
        if (!model) throw new Error(`unknown model ${String(payload.provider)}/${String(payload.id)}`);
        current = { ...model };
        return {
          sessionId: payload.sessionId,
          path: "/tmp/zu-models.jsonl",
          name: "Models",
          running: false,
          customTypes: [],
          thinkingLevel: "high",
          model: model,
        };
      }
      default:
        throw new Error(`model fixture transport: ${type}`);
    }
  });
}

export const MODEL_SEED = {
  path: "/tmp/zu-models.jsonl",
  cwd: "/tmp/zu",
  model: {
    provider: "bailian",
    id: "qwen3.8-flash",
    name: "Qwen3.8 Flash",
    contextWindow: 1_000_000,
    reasoning: true,
  },
  thinkingLevel: "high" as const,
};
