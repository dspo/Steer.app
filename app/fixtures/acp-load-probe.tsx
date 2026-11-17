import { mount, Text, View } from "nsh";
import { Fs, State } from "zu/native";
import { error as sessionError, openSession, refreshSessions, sessions } from "../modules/pi/sessions";

// Probe: the store's openSession against the REAL agent dir, in the app VM.
async function run(): Promise<string> {
  try {
    await refreshSessions();
    const rows = sessions();
    // A session whose recorded cwd still exists on disk.
    let picked: (typeof rows)[number] | undefined;
    for (const row of rows.slice(0, 40)) {
      try {
        const stat = await Fs.stat(row.cwd, ".");
        if (stat.kind === "dir") {
          picked = row;
          break;
        }
      } catch {
        // next
      }
    }
    if (!picked) return "no session with an existing cwd";
    const view = await openSession(picked.path);
    return `rows=${rows.length} id=${picked.id} view=${JSON.stringify(view?.transcript.entries.map((e) => e.kind) ?? null)} err=${view?.error ?? "none"} storeErr=${sessionError()}`;
  } catch (error) {
    return `thrown: ${String(error)} storeErr=${sessionError()}`;
  }
}

void run().then((result) => {
  mount(() => (
    <View class="flex-1 items-center justify-center">
      <Text testID="acp-probe-result" class="text-xs text-foreground">{result}</Text>
    </View>
  ));
});
