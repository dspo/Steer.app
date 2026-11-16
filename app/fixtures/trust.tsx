import { effect, mount, signal, Text, View } from "nsh";
import { askProjectTrust, TrustDialog } from "../ui/trust";

// The dialog is app-root, not session-root: this fixture proves it can be
// answered before any conversation exists.
const outcome = signal("pending");

mount(() => {
  let asked = false;
  effect(() => {
    if (asked) return;
    asked = true;
    void askProjectTrust("/tmp/zu-trust-fixture", "Trust /tmp/zu-trust-fixture?").then((trusted) =>
      outcome.set(trusted ? "trusted" : "declined"),
    );
  });
  return (
    <View class="flex-1">
      <TrustDialog />
      <Text testID="trust-result" class="text-[12px] text-foreground">{outcome()}</Text>
    </View>
  );
});
