import { mount, Text, View } from "nsh";
import { locale } from "nsh";
import { setLocale } from "nsh/i18n";
import { containerError, loadContainers, setContainerTransport } from "../containers";
import { Workbench } from "../shell";
import { phase } from "../engine";
import { followSystemLocale, shellLocale } from "../ui/i18n";
import { error as sessionError } from "../sessions";

/** A Chinese system: `setLocale` is what the platform reports to `locale()`. */
setLocale("en-US");
followSystemLocale();

setContainerTransport(async (type: string) => {
  switch (type) {
    case "container.list":
      return { containers: [], activeContainerId: null };
    default:
      throw new Error(`locale fixture transport: ${type}`);
  }
});

void loadContainers().then(() => {
  phase.set("connected");
  sessionError.set(null);
  containerError.set(null);
  mount(() => (
    <View class="flex-1" style={{ flexDirection: "column", minHeight: 0 }}>
      <Text testID="fixture-locale" class="text-[10px] font-mono">{`system=${locale()} shell=${shellLocale()}`}</Text>
      <View class="flex-1" style={{ minHeight: 0 }}>
        <Workbench />
      </View>
    </View>
  ));
});
