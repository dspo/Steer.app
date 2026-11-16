import { mount, View } from "nsh";
import { channels, setManoxFrameSink } from "../modules/manox/ahp";
import { ManoxModel, ManoxThinking } from "../modules/manox/composer-controls";
import { setPiModelsTransport } from "../domains/pimodels";
import type { SessionState } from "../../contracts/ahp/channels-session/state";

/**
 * The manox footer's edge states, deterministic: the model catalogue fails
 * and the session's current effort is outside the host's writable enum. The
 * controls mount directly (no host), so the test reads exactly the menu the
 * user would see on those states.
 */

setPiModelsTransport(async () => {
  throw new Error("boom");
});
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

mount(() => (
  <View class="bg-background" style={{ padding: 16 }}>
    <ManoxModel threadId="thread" />
    <ManoxThinking threadId="thread" />
  </View>
));
