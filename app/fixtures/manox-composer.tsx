import { mount, Storage, View } from "nsh";
import { channels, connectionStatus, setManoxFrameSink } from "../modules/manox/ahp";
import { ManoxComposer } from "../modules/manox/composer";
import { setPiModelsTransport } from "../domains/pimodels";
import type { PiProvider } from "../domains/pimodels";
import type { RootState } from "../../contracts/ahp/channels-root/state";
import type { SessionState } from "../../contracts/ahp/channels-session/state";
import type { ChatState } from "../../contracts/ahp/channels-chat/state";

/**
 * The manox composer's deterministic fixture (no host, no native pump): the
 * card mounts DIRECTLY (not `ManoxChatBody`, so no `ensureConnection`), its
 * channels are seeded by hand, and every outgoing frame lands in a captured
 * array instead of the pump (`setManoxFrameSink`). The models ride the
 * `setPiModelsTransport` seam, so the picker lists two bailian models
 * without the machine's `~/.pi`. No engine, no model run — everything the
 * UI test asserts is on screen or in the captured frames.
 */

/** The dispatches the composer made, parsed back from the wire frames. */
const frames: Array<Record<string, any>> = [];

setManoxFrameSink((frame) => {
  frames.push(JSON.parse(frame));
  // The test runs in another engine: storage is the bridge it can read.
  void Storage.setItem("manox-frames", JSON.stringify(frames));
});

// The model catalogue without the host: one provider, two models, both
// anthropic-messages so their manox refs are `bailian-anthropic/<id>`.
setPiModelsTransport(async () =>
  [
    {
      id: "bailian",
      name: "百炼",
      hasAuth: true,
      api: "anthropic-messages",
      models: [
        { id: "qwen3.8-flash", name: "Qwen3.8 Flash", contextWindow: 1_000_000 },
        { id: "qwen3.8-plus", name: "Qwen3.8 Plus", contextWindow: 1_000_000 },
      ],
    },
  ] as PiProvider[],
);

// The root channel: the agent's model catalogue, with the prompt budget the
// context ring divides by.
const ROOT: RootState = {
  agents: [
    {
      provider: "bailian-anthropic",
      displayName: "百炼",
      description: "",
      models: [
        {
          id: "qwen3.8-flash",
          provider: "bailian-anthropic",
          name: "Qwen3.8 Flash",
          maxPromptTokens: 1_000_000,
        },
        {
          id: "qwen3.8-plus",
          provider: "bailian-anthropic",
          name: "Qwen3.8 Plus",
          maxPromptTokens: 1_000_000,
        },
      ],
    },
  ],
};

// The session channel: the config schema the host would advertise (the
// writable enums) and the current values the fold carries.
const SESSION: SessionState = {
  resource: "ahp-session:/thread",
  provider: "bailian-anthropic",
  title: "composer fixture",
  status: 1,
  modifiedAt: "2026-11-16T00:00:00.000Z",
  lifecycle: "ready",
  activeClients: [],
  chats: [],
  config: {
    schema: {
      type: "object",
      properties: {
        model: { type: "string", title: "Model", sessionMutable: true },
        accessMode: {
          type: "string",
          title: "Access mode",
          enum: ["sandbox", "full-access"],
          default: "sandbox",
          sessionMutable: true,
        },
        reasoningEffort: {
          type: "string",
          title: "Reasoning effort",
          enum: ["high", "max"],
          default: "high",
          sessionMutable: true,
        },
      },
    },
    values: {
      model: "bailian-anthropic/qwen3.8-flash",
      accessMode: "full-access",
      reasoningEffort: "max",
    },
  },
} as unknown as SessionState;

// The chat channel: one completed turn whose usage the ring shows (12300 of
// 1M — `12.3k / 1M · 1%`), no active turn.
const CHAT: ChatState = {
  resource: "ahp-chat:/chat",
  title: "composer fixture",
  status: 0,
  modifiedAt: "2026-11-16T00:00:00.000Z",
  turns: [
    {
      id: "turn-1",
      startedAt: "2026-11-16T00:00:00.000Z",
      message: { text: "first turn", origin: { kind: "user" } },
      responseParts: [],
      usage: { inputTokens: 12300 },
      state: "complete",
    },
  ],
} as unknown as ChatState;

channels.set({
  "ahp-root://": { uri: "ahp-root://", serverSeq: 0, state: ROOT, pending: [] },
  "ahp-session:/thread": { uri: "ahp-session:/thread", serverSeq: 0, state: SESSION, pending: [] },
  "ahp-chat:/chat": { uri: "ahp-chat:/chat", serverSeq: 0, state: CHAT, pending: [] },
});
connectionStatus.set("ready");

mount(() => (
  <View class="flex-1 bg-background" style={{ padding: 16, justifyContent: "flex-end" }}>
    <ManoxComposer threadId="thread" chatId="chat" />
  </View>
));
