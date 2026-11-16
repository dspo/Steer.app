import { mount, signal, Text, View } from "nsh";
import { setEnsureConnectionForTest } from "../modules/manox/ahp";
import { ManoxChatBody } from "../modules/manox/conversation";
import { chatResource, seedChatForTest } from "../modules/manox/stores";
import type { ChatState } from "../../contracts/ahp/channels-chat/state";

// A live manox turn with no host: the chat starts mid-thinking (one reasoning
// part), and the settle button freezes it. The thinking block's interaction is
// the gallery's — open while the turn runs, folded once it settles.

setEnsureConnectionForTest(async () => {});

const startedAt = "2026-11-16T10:00:00.000Z";
const message = { text: "what is my cwd?", origin: { kind: "user" } };
const reasoning = { kind: "reasoning", id: "r-live", content: "Checking the working directory first." };
const answer = { kind: "markdown", id: "m-live", content: "It is /tmp." };

const chat = (state: "active" | "settled"): ChatState =>
  ({
    resource: chatResource("chat-live"),
    title: "manox",
    status: 0,
    modifiedAt: new Date().toISOString(),
    ...(state === "active"
      ? {
          turns: [],
          activeTurn: { id: "t-live", startedAt, message, responseParts: [reasoning], usage: undefined },
        }
      : {
          turns: [
            {
              id: "t-live",
              startedAt,
              message,
              responseParts: [reasoning, answer],
              usage: undefined,
              state: "complete",
            },
          ],
        }),
  }) as ChatState;

seedChatForTest("chat-live", chat("active"));

mount(() => (
  <View class="flex-1 bg-background">
    <View
      role="button"
      testID="fixture-settle"
      class="h-6 items-center justify-center bg-card"
      onPress={() => seedChatForTest("chat-live", chat("settled"))}
    >
      <Text class="text-[10px] text-muted-foreground">settle</Text>
    </View>
    <ManoxChatBody id="manox-chat:thread-live:chat-live" />
  </View>
));
