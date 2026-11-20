import { mount, Storage, View } from "nsh";
import { channels, connectionStatus, setManoxFrameSink } from "../modules/manox/ahp";
import { ManoxComposer } from "../modules/manox/composer";
import { Manox } from "../domains/manox";
import type { ModelCatalog } from "../domains/manox";
import type { SessionState } from "../../contracts/ahp/channels-session/state";
import type { ChatState } from "../../contracts/ahp/channels-chat/state";

/**
 * The manox composer's deterministic fixture (no host, no native pump): the
 * card mounts DIRECTLY (not `ManoxChatBody`, so no `ensureConnection`), its
 * channels are seeded by hand, and every outgoing frame lands in a captured
 * array instead of the pump (`setManoxFrameSink`). The kernel catalogue is
 * stood in by the fixture itself (`Manox.models`), so the pickers list two
 * bailian models and the ring reads their context window without the host.
 * No engine, no model run — everything the UI test asserts is on screen or
 * in the captured frames.
 */

/** The dispatches the composer made, parsed back from the wire frames. */
const frames: Array<Record<string, any>> = [];

setManoxFrameSink((frame) => {
  frames.push(JSON.parse(frame));
  // The test runs in another engine: storage is the bridge it can read.
  void Storage.setItem("manox-frames", JSON.stringify(frames));
});

// The kernel model catalogue without the host (Q120): one provider, two
// models; the canonical refs are `bailian-anthropic/<id>` and the context
// window is what the ring divides the last turn's usage by.
const CATALOG: ModelCatalog = {
  providers: [
    {
      id: "bailian",
      name: "百炼",
      models: [
        {
          id: "qwen3.8-flash",
          name: "Qwen3.8 Flash",
          provider: "bailian",
          reference: "bailian-anthropic/qwen3.8-flash",
          contextWindow: 1_000_000,
          maxTokens: 64_000,
          reasoning: true,
          efforts: ["high", "max"],
        },
        {
          id: "qwen3.8-plus",
          name: "Qwen3.8 Plus",
          provider: "bailian",
          reference: "bailian-anthropic/qwen3.8-plus",
          contextWindow: 1_000_000,
          maxTokens: 64_000,
          reasoning: true,
          efforts: ["high", "max"],
        },
      ],
    },
  ],
};

// The fixture owns the models query: Manox.models is the only door the
// stores open to the host, and replacing it keeps the whole surface hermetic.
(Manox as { models: () => Promise<ModelCatalog> }).models = async () => CATALOG;

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
  "ahp-session:/thread": { uri: "ahp-session:/thread", serverSeq: 0, state: SESSION, pending: [] },
  "ahp-chat:/chat": { uri: "ahp-chat:/chat", serverSeq: 0, state: CHAT, pending: [] },
});
connectionStatus.set("ready");

mount(() => (
  <View class="flex-1 bg-background" style={{ padding: 16, justifyContent: "flex-end" }}>
    <ManoxComposer threadId="thread" chatId="chat" />
  </View>
));
