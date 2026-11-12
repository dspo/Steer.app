import { mount, signal, Text, View } from "nsh";
import { Workbench } from "../shell/shell";
import { registerManoxPack, openManoxChat } from "../harness/manox/register";
import {
  createManoxThread,
  manoxChatSheetId,
  sendManoxMessage,
} from "../harness/manox/stores";
import { containerError, loadContainers, setContainerTransport } from "../stores/containers";
import { error as sessionError } from "../stores/sessions";
import { phase } from "../stores/engine";

/**
 * The manox conversation fixture: the real Workbench around the real
 * in-proc stub host (native/manox). No engine — the container store talks
 * to an empty in-memory transport, and the manox pack drives the pump
 * itself. The fixture creates one thread, opens its sheet, and sends the
 * first message, so the test lands mid-script (streaming → tool call).

 * The boot order is the containers fixture's: `loadContainers` runs while
 * the engine phase is still `stopped` (its engine probes fail fast and are
 * caught), and the phase flips only after, so nothing waits on a socket.
 */

setContainerTransport(async () => ({}));

registerManoxPack();

export const fixtureState = signal<string>("booting");

void loadContainers().then(async () => {
  // No engine in this fixture: the shell's status line is the only piece
  // that would otherwise show "connecting"/"offline".
  phase.set("connected");
  sessionError.set(null);
  containerError.set(null);
  try {
    const { threadId, chatId } = await createManoxThread();
    openManoxChat(threadId, chatId);
    // Give the sheet a beat to subscribe, then start the scripted turn.
    sendManoxMessage(threadId, chatId, "trace the stub");
    fixtureState.set(`ready:${manoxChatSheetId(threadId, chatId)}`);
  } catch (failure) {
    fixtureState.set(`failed:${String(failure)}`);
    containerError.set(String(failure));
  }
});

mount(() => (
  <View class="flex-1 bg-background">
    <Workbench />
    <Text testID="manox-fixture-state" class="text-[10px] text-faint">
      {fixtureState()}
    </Text>
  </View>
));
