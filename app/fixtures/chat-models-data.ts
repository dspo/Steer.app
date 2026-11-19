import { setModelTransport, setSessionTransport } from "../modules/pi/sessions";

/** The model picker's fake engine: two providers, one switchable session.
 * The thinking ladder is one of the seeds (issue #54): the composer's effort
 * chip lists it, and `session.setThinking` moves it like a real engine. */
export function installModelTransport(): void {
  const providers = [
    {
      id: "anthropic",
      name: "Anthropic",
      authSource: "stored",
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
      authSource: "environment",
      authLabel: "DASHSCOPE_API_KEY",
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
  let thinkingLevel = "high";
  setModelTransport(async (type, payload: any = {}) => {
    switch (type) {
      case "session.models":
        return { providers, current, thinkingLevel };
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
          thinkingLevel,
          model: model,
        };
      }
      default:
        throw new Error(`model fixture transport: ${type}`);
    }
  });
  // The effort chip's engine leg: the thinking level rides the session
  // transport (the same wire the engine leg always rode), and both answers
  // carry the same `session.info` shape.
  setSessionTransport(async (type, payload: any = {}) => {
    switch (type) {
      case "session.setThinking": {
        thinkingLevel = String(payload.level ?? thinkingLevel);
        return { sessionId: payload.sessionId, thinkingLevel, model: current };
      }
      default:
        throw new Error(`session fixture transport: ${type}`);
    }
  });
}

/** The seeded view's config selectors: the model list (with each option's
 * harness `_meta` facts) and the thought ladder the effort chip renders. */
export const MODEL_CONFIG_OPTIONS = [
  {
    id: "model",
    name: "Model",
    category: "model",
    type: "select" as const,
    currentValue: "bailian/qwen3.8-flash",
    options: [
      {
        value: "anthropic/claude-sonnet-4",
        name: "Claude Sonnet 4",
        _meta: { contextWindow: 200_000, providerName: "Anthropic", authSource: "stored" },
      },
      {
        value: "bailian/qwen3.8-flash",
        name: "Qwen3.8 Flash",
        _meta: { contextWindow: 1_000_000, providerName: "Bailian", authSource: "environment", authLabel: "DASHSCOPE_API_KEY" },
      },
      {
        value: "bailian/qwen3.8-plus",
        name: "Qwen3.8 Plus",
        _meta: { contextWindow: 1_000_000, providerName: "Bailian", authSource: "environment", authLabel: "DASHSCOPE_API_KEY" },
      },
    ],
  },
  {
    id: "thought_level",
    name: "Thinking",
    category: "thought_level",
    type: "select" as const,
    currentValue: "high",
    options: [
      { value: "off", name: "off" },
      { value: "low", name: "low" },
      { value: "high", name: "high" },
    ],
  },
];

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
  configOptions: MODEL_CONFIG_OPTIONS,
};
