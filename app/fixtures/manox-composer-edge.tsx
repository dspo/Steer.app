import { mount, View } from "nsh";
import { channels, connectionStatus, setManoxFrameSink } from "../modules/manox/ahp";
import { ManoxComposer } from "../modules/manox/composer";
import { Manox } from "../domains/manox";
import type { ModelCatalog } from "../domains/manox";
import type { SessionState } from "../../contracts/ahp/channels-session/state";

/**
 * The manox card's edge states, deterministic: the model catalogue fails and
 * the session's current effort is outside the host's writable subset. The
 * card mounts directly (no host), so the test reads exactly the footer the
 * user would see on those states.
 */

// The kernel catalogue read fails the way a machine without a callable
// directory would; the menu must name the reason, not hang.
(Manox as { models: () => Promise<ModelCatalog> }).models = async () => {
  throw new Error("boom");
};
// A no-op sink: dispatching must never reach the native pump here.
setManoxFrameSink(() => {});

const SESSION = {
  resource: "ahp-session:/thread",
  provider: "bailian-anthropic",
  title: "edge fixture",
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
      // The store's creation-time effort can be outside the writable subset;
      // the trigger still names it, and the menu must not offer it.
      reasoningEffort: "medium",
    },
  },
} as unknown as SessionState;

channels.set({
  "ahp-session:/thread": { uri: "ahp-session:/thread", serverSeq: 0, state: SESSION, pending: [] },
});
connectionStatus.set("ready");

mount(() => (
  <View class="bg-background" style={{ padding: 16, justifyContent: "flex-end" }}>
    <ManoxComposer threadId="thread" chatId="chat" />
  </View>
));
